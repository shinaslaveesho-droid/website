-- 0004: pay by bank transfer.
-- Flow: customer picks a plan and length -> sees bank details, amount (+5% VAT) and a unique reference
-- -> uploads the transfer receipt -> an admin checks the bank and clicks "Payment received" (plan goes
-- live and the sale is recorded) or "Not received" (customer is asked to check and re-upload).
-- Adds columns, functions and a private storage bucket. No existing data is removed.

-- ---------- request details ----------
create sequence if not exists public.payment_ref_seq start 1001;

alter table public.subscriptions
  add column if not exists ref_no               text unique default ('LV-' || nextval('public.payment_ref_seq')),
  add column if not exists months               integer not null default 1 check (months in (1, 3, 6, 12)),
  add column if not exists pay_status           text not null default 'awaiting'
                                                check (pay_status in ('awaiting', 'submitted', 'verified', 'rejected')),
  add column if not exists proof_path           text check (char_length(proof_path) <= 300),
  add column if not exists proof_note           text check (char_length(proof_note) <= 300),
  add column if not exists proof_submitted_at   timestamptz,
  add column if not exists reject_reason        text check (char_length(reject_reason) <= 300),
  add column if not exists pay_reminder_sent_at timestamptz;

-- Plans that were already made live by hand count as paid.
update public.subscriptions set pay_status = 'verified' where status in ('active', 'expired') and pay_status = 'awaiting';

-- Customers choose the length when they request a plan.
grant insert (months) on public.subscriptions to authenticated;

-- ---------- receipt uploads (private bucket, 5 MB, images or PDF) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists payment_proofs_upload_own on storage.objects;
create policy payment_proofs_upload_own on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists payment_proofs_read_own_or_admin on storage.objects;
create policy payment_proofs_read_own_or_admin on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- customer: "I've paid" ----------
create or replace function public.submit_payment_proof(p_subscription uuid, p_path text, p_note text)
returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  result public.subscriptions;
begin
  if p_path is null or p_path not like auth.uid()::text || '/%' or char_length(p_path) > 300 then
    raise exception 'Please upload your payment receipt' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'payment-proofs' and o.name = p_path) then
    raise exception 'Please upload your payment receipt' using errcode = '22023';
  end if;
  update public.subscriptions
     set pay_status = 'submitted',
         proof_path = p_path,
         proof_note = nullif(left(trim(coalesce(p_note, '')), 300), ''),
         proof_submitted_at = now(),
         reject_reason = null
   where id = p_subscription and user_id = auth.uid() and status = 'pending'
     and pay_status in ('awaiting', 'rejected')
  returning * into result;
  if not found then
    raise exception 'This payment was already sent or the request is closed' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- ---------- admin: payment received / not received ----------
create or replace function public.verify_payment(p_subscription uuid, p_starts_on date)
returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  m integer;
  result public.subscriptions;
begin
  perform public.assert_admin();
  select months into m from public.subscriptions where id = p_subscription and status = 'pending';
  if not found then
    raise exception 'Request not found or not pending' using errcode = 'P0002';
  end if;
  perform public.confirm_subscription(p_subscription, p_starts_on, m);   -- goes live + records the sale
  update public.subscriptions set pay_status = 'verified' where id = p_subscription returning * into result;
  return result;
end $$;

create or replace function public.reject_payment(p_subscription uuid, p_reason text)
returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  result public.subscriptions;
begin
  perform public.assert_admin();
  update public.subscriptions
     set pay_status = 'rejected',
         reject_reason = nullif(left(trim(coalesce(p_reason, '')), 300), '')
   where id = p_subscription and status = 'pending' and pay_status = 'submitted'
  returning * into result;
  if not found then
    raise exception 'No receipt waiting to be checked' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- Manual "go live" (without a receipt) also marks the request as paid.
create or replace function public.mark_paid_on_confirm() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'active' and old.status = 'pending' then
    new.pay_status := 'verified';
  end if;
  return new;
end $$;
drop trigger if exists subscriptions_mark_paid on public.subscriptions;
create trigger subscriptions_mark_paid before update of status on public.subscriptions
  for each row execute function public.mark_paid_on_confirm();

-- ---------- daily job: remind people who chose a plan but have not paid after 2 days ----------
create or replace function public.due_payment_reminders()
returns table (subscription_id uuid, email text, full_name text, plan_name text, ref_no text, months integer, price_aed integer)
language sql stable security definer set search_path = '' as $$
  select s.id, p.email, p.full_name, pl.name, s.ref_no, s.months, pl.price_aed
    from public.subscriptions s
    join public.profiles p on p.id = s.user_id
    join public.plans pl on pl.id = s.plan_id
   where s.status = 'pending' and s.pay_status = 'awaiting'
     and s.requested_at < now() - interval '2 days'
     and s.pay_reminder_sent_at is null
$$;

create or replace function public.mark_payment_reminder_sent(p_subscription uuid) returns void
language sql security definer set search_path = '' as $$
  update public.subscriptions set pay_reminder_sent_at = now() where id = p_subscription
$$;

-- ---------- privileges ----------
revoke execute on function public.submit_payment_proof(uuid, text, text) from public, anon;
revoke execute on function public.verify_payment(uuid, date) from public, anon;
revoke execute on function public.reject_payment(uuid, text) from public, anon;
revoke execute on function public.due_payment_reminders() from public, anon, authenticated;
revoke execute on function public.mark_payment_reminder_sent(uuid) from public, anon, authenticated;
revoke execute on function public.mark_paid_on_confirm() from public, anon, authenticated;
grant execute on function public.submit_payment_proof(uuid, text, text) to authenticated;
grant execute on function public.verify_payment(uuid, date) to authenticated;
grant execute on function public.reject_payment(uuid, text) to authenticated;
grant execute on function public.due_payment_reminders() to service_role;
grant execute on function public.mark_payment_reminder_sent(uuid) to service_role;
