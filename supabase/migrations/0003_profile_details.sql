-- 0003: address and gender on profiles; sign-up form now sends phone, address and gender.
-- Safe to run once on the live database. Adds columns only; no data is changed or removed.

alter table public.profiles
  add column if not exists address text check (char_length(address) <= 300),
  add column if not exists gender  text check (gender in ('female', 'male', 'prefer_not_to_say'));

-- Customers may edit their own address and gender (same as name, phone, company).
grant update (address, gender) on public.profiles to authenticated;

-- Copy the extra sign-up fields into the profile. Anything invalid is dropped, never stored.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  g text := m ->> 'gender';
begin
  insert into public.profiles (id, email, full_name, phone, address, gender)
  values (
    new.id,
    coalesce(new.email, ''),
    left(trim(coalesce(m ->> 'full_name', m ->> 'name', '')), 120),
    nullif(left(trim(coalesce(m ->> 'phone', '')), 30), ''),
    nullif(left(trim(coalesce(m ->> 'address', '')), 300), ''),
    case when g in ('female', 'male', 'prefer_not_to_say') then g end
  );
  return new;
end $$;
