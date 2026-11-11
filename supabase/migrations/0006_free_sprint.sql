-- 0006: free 7-Day Growth Sprint for new customers.
-- A new customer requests the sprint (no payment). An admin clicks "Start sprint": it runs for 7 days
-- (start day + 6), records no sale, and the customer gets a reminder the day before it ends.
-- One sprint per customer, and only for customers who have never had a paid plan.

-- ---------- the sprint plan ----------
alter table public.plans drop constraint if exists plans_id_check;
alter table public.plans add constraint plans_id_check check (id in ('sprint', 'essential', 'growth', 'elite'));
alter table public.plans drop constraint if exists plans_price_aed_check;
alter table public.plans add constraint plans_price_aed_check check (price_aed >= 0);
alter table public.plans add column if not exists duration_days integer check (duration_days between 1 and 60);

insert into public.plans (id, name, price_aed, sort, duration_days)
values ('sprint', '7-Day Growth Sprint', 0, 0, 7)
on conflict (id) do update set name = excluded.name, price_aed = 0, sort = 0, duration_days = 7;

-- ---------- new customers only, once ----------
create or replace function public.check_sprint_eligible() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.plan_id = 'sprint' then
    if exists (select 1 from public.subscriptions s
                where s.user_id = new.user_id
                  and (s.plan_id <> 'sprint' and s.status in ('active', 'expired')      -- had a paid plan
                       or s.plan_id = 'sprint' and s.status <> 'cancelled')) then        -- already had a sprint
      raise exception 'The free sprint is for new customers only' using errcode = '23514';
    end if;
    new.months := 1;
    new.pay_status := 'verified';   -- nothing to pay
  end if;
  return new;
end $$;
drop trigger if exists subscriptions_sprint_eligible on public.subscriptions;
create trigger subscriptions_sprint_eligible before insert on public.subscriptions
  for each row execute function public.check_sprint_eligible();

-- ---------- admin: start the sprint ----------
create or replace function public.start_sprint(p_subscription uuid, p_starts_on date)
returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  result public.subscriptions;
begin
  perform public.assert_admin();
  if p_starts_on is null then
    raise exception 'Start date is required' using errcode = '22023';
  end if;
  update public.subscriptions
     set status = 'active',
         starts_on = p_starts_on,
         ends_on = p_starts_on + 6,
         confirmed_at = now(),
         confirmed_by = auth.uid(),
         reminder_7d_sent_at = now(),   -- a 7-day plan only gets the "ends tomorrow" reminder
         reminder_1d_sent_at = null
   where id = p_subscription and status = 'pending' and plan_id = 'sprint'
  returning * into result;
  if not found then
    raise exception 'Sprint request not found or not pending' using errcode = 'P0002';
  end if;
  return result;
end $$;

-- Paid-plan functions must not be used on a sprint (they would record a sale of AED 0).
create or replace function public.block_sprint_paid_actions() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.plan_id = 'sprint' then
    raise exception 'Sprints are not sold' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists payments_no_sprint on public.payments;
create trigger payments_no_sprint before insert on public.payments
  for each row execute function public.block_sprint_paid_actions();

revoke execute on function public.start_sprint(uuid, date) from public, anon;
revoke execute on function public.check_sprint_eligible() from public, anon, authenticated;
revoke execute on function public.block_sprint_paid_actions() from public, anon, authenticated;
grant execute on function public.start_sprint(uuid, date) to authenticated;
