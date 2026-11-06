-- Admin dashboard: revenue, packages sold, registrations and live visitors.
-- Revenue: every time an admin makes a plan live or extends it, one row goes into `payments`
-- (plan price x months). Totals are summed from there, so they stay exact even after extensions.
-- Visitors: each open page sends an anonymous heartbeat (random id kept in the browser, no name,
-- no IP). "Live" = a heartbeat in the last 70 seconds.

-- ---------- payments ----------
create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references public.subscriptions (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  plan_id          text not null references public.plans (id),
  kind             text not null check (kind in ('new', 'renewal')),
  months           integer not null check (months between 1 and 24),
  amount_aed       integer not null check (amount_aed >= 0),
  paid_on          date not null default public.dubai_today(),
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null
);
create index payments_paid_on on public.payments (paid_on);
alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;
create policy payments_read_admin on public.payments for select to authenticated using (public.is_admin());

-- Backfill plans that were already made live before this migration (one 'new' payment each).
insert into public.payments (subscription_id, user_id, plan_id, kind, months, amount_aed, paid_on, created_at, created_by)
select s.id, s.user_id, s.plan_id, 'new', m.months, pl.price_aed * m.months,
       coalesce((s.confirmed_at at time zone 'Asia/Dubai')::date, s.starts_on), coalesce(s.confirmed_at, now()), s.confirmed_by
  from public.subscriptions s
  join public.plans pl on pl.id = s.plan_id
  cross join lateral (
    select greatest(1, least(24, (extract(year from age(s.ends_on + 1, s.starts_on)) * 12
                                 + extract(month from age(s.ends_on + 1, s.starts_on)))::int)) as months
  ) m
 where s.starts_on is not null and s.ends_on is not null and s.confirmed_at is not null;

-- Same signatures as 0001; now also record the payment.
create or replace function public.confirm_subscription(p_subscription uuid, p_starts_on date, p_months integer)
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
  insert into public.payments (subscription_id, user_id, plan_id, kind, months, amount_aed, created_by)
  select result.id, result.user_id, result.plan_id, 'new', p_months, pl.price_aed * p_months, auth.uid()
    from public.plans pl where pl.id = result.plan_id;
  return result;
end $$;

create or replace function public.extend_subscription(p_subscription uuid, p_months integer)
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
     and not exists (
       select 1 from public.subscriptions o
        where o.user_id = s.user_id and o.id <> s.id and o.status in ('pending', 'active'))
  returning * into result;
  if not found then
    raise exception 'Plan not found, not extendable, or the customer already has another open plan' using errcode = 'P0002';
  end if;
  insert into public.payments (subscription_id, user_id, plan_id, kind, months, amount_aed, created_by)
  select result.id, result.user_id, result.plan_id, 'renewal', p_months, pl.price_aed * p_months, auth.uid()
    from public.plans pl where pl.id = result.plan_id;
  return result;
end $$;

-- ---------- visitors ----------
create table public.visitor_pings (
  visitor_id  uuid primary key,
  path        text not null default '/',
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index visitor_pings_last_seen on public.visitor_pings (last_seen);
create table public.daily_visitors (
  day         date not null,
  visitor_id  uuid not null,
  primary key (day, visitor_id)
);
alter table public.visitor_pings enable row level security;
alter table public.daily_visitors enable row level security;
revoke all on public.visitor_pings, public.daily_visitors from anon, authenticated;

-- Called by every page about every 30 seconds while it is open and visible.
create function public.track_visit(p_visitor uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  clean text := left(coalesce(nullif(regexp_replace(p_path, '[?#].*$', ''), ''), '/'), 120);
begin
  if p_visitor is null then return; end if;
  insert into public.visitor_pings (visitor_id, path) values (p_visitor, clean)
  on conflict (visitor_id) do update set last_seen = now(), path = excluded.path;
  insert into public.daily_visitors (day, visitor_id) values (public.dubai_today(), p_visitor)
  on conflict do nothing;
  if random() < 0.01 then  -- keep the live table small
    delete from public.visitor_pings where last_seen < now() - interval '2 days';
  end if;
end $$;

-- ---------- admin stats (one call for the whole dashboard) ----------
create function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  today date := public.dubai_today();
  month_start date := date_trunc('month', public.dubai_today())::date;
  out jsonb;
begin
  perform public.assert_admin();
  select jsonb_build_object(
    'generated_at', now(),
    'live_visitors', (select count(*) from public.visitor_pings where last_seen > now() - interval '70 seconds'),
    'live_pages', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'n', n) order by n desc)
                              from (select path, count(*) n from public.visitor_pings
                                     where last_seen > now() - interval '70 seconds' group by path order by n desc limit 6) t), '[]'::jsonb),
    'visitors_today', (select count(*) from public.daily_visitors where day = today),
    'signups_today', (select count(*) from public.profiles where (created_at at time zone 'Asia/Dubai')::date = today),
    'customers_today', (select count(distinct user_id) from public.payments where paid_on = today),
    'requests_pending', (select count(*) from public.subscriptions where status = 'pending'),
    'plans_live', (select count(*) from public.subscriptions where status = 'active'),
    'customers_total', (select count(*) from public.profiles),
    'revenue_today', (select coalesce(sum(amount_aed), 0) from public.payments where paid_on = today),
    'revenue_month', (select coalesce(sum(amount_aed), 0) from public.payments where paid_on >= month_start),
    'revenue_all', (select coalesce(sum(amount_aed), 0) from public.payments),
    'packages_sold', (select count(*) from public.payments where kind = 'new'),
    'renewals', (select count(*) from public.payments where kind = 'renewal'),
    'by_plan', (select jsonb_agg(jsonb_build_object('plan', pl.name, 'sold', coalesce(x.sold, 0), 'revenue', coalesce(x.rev, 0)) order by pl.sort)
                  from public.plans pl
                  left join (select plan_id, count(*) filter (where kind = 'new') sold, sum(amount_aed) rev
                               from public.payments group by plan_id) x on x.plan_id = pl.id),
    'daily', (select jsonb_agg(jsonb_build_object(
                       'day', d::date,
                       'signups', (select count(*) from public.profiles p where (p.created_at at time zone 'Asia/Dubai')::date = d::date),
                       'visitors', (select count(*) from public.daily_visitors v where v.day = d::date),
                       'revenue', (select coalesce(sum(amount_aed), 0) from public.payments y where y.paid_on = d::date))
                     order by d)
                from generate_series((today - 13)::timestamp, today::timestamp, interval '1 day') d)
  ) into out;
  return out;
end $$;

revoke execute on function public.track_visit(uuid, text) from public;
revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.track_visit(uuid, text) to anon, authenticated;
grant execute on function public.admin_stats() to authenticated;
