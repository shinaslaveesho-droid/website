-- Laveesho customer accounts: profiles, plan requests and live plans.
-- Security model: every table has row-level security. Customers can read and edit only their own
-- profile, and can only *request* a plan (status 'pending'). Only admins (profiles.is_admin) can make
-- a plan live, extend or cancel it, through the security-definer functions at the bottom.
-- Dates: starts_on / ends_on are calendar dates in Dubai time; ends_on is the last day of service.

-- ---------- plans ----------
create table public.plans (
  id         text primary key check (id in ('essential', 'growth', 'elite')),
  name       text not null,
  price_aed  integer not null check (price_aed > 0),
  sort       smallint not null
);

insert into public.plans (id, name, price_aed, sort) values
  ('essential', 'Laveesho Essential', 3000, 1),
  ('growth',    'Laveesho Growth',    6000, 2),
  ('elite',     'Laveesho Elite',    12000, 3);

-- ---------- profiles (one per auth user) ----------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '' check (char_length(full_name) <= 120),
  phone       text check (char_length(phone) <= 30),
  company     text check (char_length(company) <= 120),
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- subscriptions ----------
create type public.subscription_status as enum ('pending', 'active', 'expired', 'cancelled');

create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.profiles (id) on delete cascade,
  plan_id              text not null references public.plans (id),
  status               public.subscription_status not null default 'pending',
  note                 text check (char_length(note) <= 500),
  requested_at         timestamptz not null default now(),
  starts_on            date,
  ends_on              date,
  confirmed_at         timestamptz,
  confirmed_by         uuid references public.profiles (id) on delete set null,
  reminder_7d_sent_at  timestamptz,
  reminder_1d_sent_at  timestamptz,
  updated_at           timestamptz not null default now(),
  constraint live_plans_have_dates check (status not in ('active', 'expired') or (starts_on is not null and ends_on is not null)),
  constraint ends_on_or_after_start check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

-- A customer can have at most one open (pending or live) plan at a time.
create unique index subscriptions_one_open_per_user on public.subscriptions (user_id) where status in ('pending', 'active');
create index subscriptions_user on public.subscriptions (user_id, requested_at desc);
create index subscriptions_status_ends on public.subscriptions (status, ends_on);

-- ---------- helpers ----------
create function public.dubai_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Dubai')::date
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false)
$$;

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();

-- Create a profile for every new sign-up (email or Google). Google provides full_name / name.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), 120)
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in step when a user changes their login email.
create function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ---------- row-level security ----------
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;

create policy plans_read on public.plans for select to anon, authenticated using (true);

create policy profiles_read_own_or_admin on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy subscriptions_read_own_or_admin on public.subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy subscriptions_request_own on public.subscriptions for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

-- Column privileges: customers may only set these columns. Everything else (status, dates,
-- is_admin, email, reminders) is changed only by the functions below.
revoke all on public.plans, public.profiles, public.subscriptions from anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, company) on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;
grant insert (user_id, plan_id, note) on public.subscriptions to authenticated;

-- ---------- customer actions ----------
create function public.cancel_my_request(p_subscription uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.subscriptions
     set status = 'cancelled'
   where id = p_subscription and user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'No pending request to cancel' using errcode = 'P0002';
  end if;
end $$;

-- ---------- admin actions ----------
create function public.assert_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
end $$;

-- Make a pending request live. ends_on is the last day of service: start + N months - 1 day.
create function public.confirm_subscription(p_subscription uuid, p_starts_on date, p_months integer)
returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  result public.subscriptions;
begin
  perform public.assert_admin();
  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception 'Months must be between 1 and 24' using errcode = '22023';
  end if;
  if p_starts_on is null then
    raise exception 'Start date is required' using errcode = '22023';
  end if;
  update public.subscriptions
     set status = 'active',
         starts_on = p_starts_on,
         ends_on = (p_starts_on + make_interval(months => p_months) - interval '1 day')::date,
         confirmed_at = now(),
         confirmed_by = auth.uid(),
         reminder_7d_sent_at = null,
         reminder_1d_sent_at = null
   where id = p_subscription and status = 'pending'
  returning * into result;
  if not found then
    raise exception 'Request not found or not pending' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- Add months to a live plan (or reactivate an expired one) and reset its reminders.
create function public.extend_subscription(p_subscription uuid, p_months integer)
returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  result public.subscriptions;
begin
  perform public.assert_admin();
  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception 'Months must be between 1 and 24' using errcode = '22023';
  end if;
  update public.subscriptions s
     set ends_on = (greatest(s.ends_on, public.dubai_today() - 1) + make_interval(months => p_months))::date,
         status = 'active',
         reminder_7d_sent_at = null,
         reminder_1d_sent_at = null
   where s.id = p_subscription and s.status in ('active', 'expired')
     and not exists (  -- reactivating must not create a second open plan
       select 1 from public.subscriptions o
        where o.user_id = s.user_id and o.id <> s.id and o.status in ('pending', 'active'))
  returning * into result;
  if not found then
    raise exception 'Plan not found, not extendable, or the customer already has another open plan' using errcode = 'P0002';
  end if;
  return result;
end $$;

create function public.cancel_subscription(p_subscription uuid)
returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  result public.subscriptions;
begin
  perform public.assert_admin();
  update public.subscriptions set status = 'cancelled'
   where id = p_subscription and status in ('pending', 'active')
  returning * into result;
  if not found then
    raise exception 'Plan not found or already closed' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- ---------- daily job (service role only) ----------
-- Mark finished plans as expired. Returns how many changed. Safe to run any number of times.
create function public.expire_finished_subscriptions() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.subscriptions set status = 'expired'
   where status = 'active' and ends_on < public.dubai_today();
  get diagnostics n = row_count;
  return n;
end $$;

-- Reminders that are due today: '1d' when 0-1 days are left, '7d' when 2-7 days are left.
create function public.due_reminders()
returns table (subscription_id uuid, kind text, email text, full_name text, plan_name text, ends_on date, days_left integer)
language sql stable security definer set search_path = '' as $$
  select s.id,
         case when s.ends_on - public.dubai_today() <= 1 then '1d' else '7d' end,
         p.email, p.full_name, pl.name, s.ends_on,
         s.ends_on - public.dubai_today()
    from public.subscriptions s
    join public.profiles p on p.id = s.user_id
    join public.plans pl on pl.id = s.plan_id
   where s.status = 'active'
     and s.ends_on >= public.dubai_today()
     and (
       (s.ends_on - public.dubai_today() <= 1 and s.reminder_1d_sent_at is null)
       or (s.ends_on - public.dubai_today() between 2 and 7 and s.reminder_7d_sent_at is null)
     )
$$;

create function public.mark_reminder_sent(p_subscription uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_kind = '7d' then
    update public.subscriptions set reminder_7d_sent_at = now() where id = p_subscription;
  elsif p_kind = '1d' then
    update public.subscriptions set reminder_1d_sent_at = now() where id = p_subscription;
  else
    raise exception 'Unknown reminder kind' using errcode = '22023';
  end if;
end $$;

-- Plan requests made in the last 24 hours, for the admin's daily digest.
create function public.recent_requests()
returns table (subscription_id uuid, email text, full_name text, plan_name text, requested_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, p.email, p.full_name, pl.name, s.requested_at
    from public.subscriptions s
    join public.profiles p on p.id = s.user_id
    join public.plans pl on pl.id = s.plan_id
   where s.status = 'pending' and s.requested_at > now() - interval '24 hours'
   order by s.requested_at
$$;

-- ---------- function privileges ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.dubai_today() to authenticated;
grant execute on function public.cancel_my_request(uuid) to authenticated;
grant execute on function public.confirm_subscription(uuid, date, integer) to authenticated;
grant execute on function public.extend_subscription(uuid, integer) to authenticated;
grant execute on function public.cancel_subscription(uuid) to authenticated;
grant execute on function public.expire_finished_subscriptions() to service_role;
grant execute on function public.due_reminders() to service_role;
grant execute on function public.mark_reminder_sent(uuid, text) to service_role;
grant execute on function public.recent_requests() to service_role;
