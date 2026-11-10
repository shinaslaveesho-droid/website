-- 0005: automatic tax invoice + payment receipt for every verified bank payment.
-- When an admin clicks "Payment received", the server numbers the documents (LAV-INV-0001,
-- LAV-RCT-0001, in order, never reused), renders both PDFs, stores them privately and emails them.
-- Adds a table, two sequences, functions and a private storage bucket. No existing data is changed.

create sequence if not exists public.invoice_no_seq start 1;
create sequence if not exists public.receipt_no_seq start 1;

create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null unique references public.subscriptions (id) on delete restrict,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  invoice_no      text not null unique,
  receipt_no      text not null unique,
  issued_on       date not null default public.dubai_today(),
  plan_id         text not null references public.plans (id),
  months          integer not null check (months between 1 and 24),
  rate_aed        numeric(12, 2) not null,
  subtotal_aed    numeric(12, 2) not null,
  vat_aed         numeric(12, 2) not null,
  total_aed       numeric(12, 2) not null,
  invoice_path    text,
  receipt_path    text,
  emailed_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists documents_user on public.documents (user_id, created_at desc);

alter table public.documents enable row level security;
drop policy if exists documents_read_own_or_admin on public.documents;
create policy documents_read_own_or_admin on public.documents for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
revoke all on public.documents from anon, authenticated;
grant select on public.documents to authenticated;

-- PDFs: private bucket, written only by the server; customers read their own folder, admins read all.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists documents_read_own_or_admin on storage.objects;
create policy documents_read_own_or_admin on storage.objects for select to authenticated
  using (bucket_id = 'documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Give a verified payment its invoice and receipt numbers. Safe to call again: returns the same row.
create or replace function public.issue_documents(p_subscription uuid)
returns public.documents
language plpgsql security definer set search_path = '' as $$
declare
  d public.documents;
  s public.subscriptions;
  price integer;
  sub numeric(12, 2);
  vat numeric(12, 2);
begin
  select * into d from public.documents where subscription_id = p_subscription;
  if found then return d; end if;

  select * into s from public.subscriptions where id = p_subscription for update;
  if not found or s.pay_status <> 'verified' then
    raise exception 'Payment is not verified' using errcode = 'P0002';
  end if;
  select price_aed into price from public.plans where id = s.plan_id;
  sub := price * s.months;
  vat := round(sub * 0.05, 2);

  insert into public.documents (subscription_id, user_id, invoice_no, receipt_no, issued_on, plan_id, months,
                                rate_aed, subtotal_aed, vat_aed, total_aed)
  values (s.id, s.user_id,
          'LAV-INV-' || lpad(nextval('public.invoice_no_seq')::text, 4, '0'),
          'LAV-RCT-' || lpad(nextval('public.receipt_no_seq')::text, 4, '0'),
          public.dubai_today(), s.plan_id, s.months, price, sub, vat, sub + vat)
  on conflict (subscription_id) do nothing
  returning * into d;
  if d.id is null then
    select * into d from public.documents where subscription_id = p_subscription;
  end if;
  return d;
end $$;

create or replace function public.set_document_files(p_subscription uuid, p_invoice text, p_receipt text, p_emailed boolean)
returns void
language sql security definer set search_path = '' as $$
  update public.documents
     set invoice_path = coalesce(p_invoice, invoice_path),
         receipt_path = coalesce(p_receipt, receipt_path),
         emailed_at = case when p_emailed then now() else emailed_at end
   where subscription_id = p_subscription
$$;

revoke execute on function public.issue_documents(uuid) from public, anon, authenticated;
revoke execute on function public.set_document_files(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.issue_documents(uuid) to service_role;
grant execute on function public.set_document_files(uuid, text, text, boolean) to service_role;
