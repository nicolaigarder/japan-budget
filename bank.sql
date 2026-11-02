-- Japan Budget – bankforbindelse (Enable Banking) + skærpet kode-tjek
-- Kør hele scriptet i Supabase → SQL Editor → Run (efter supabase.sql)

-- 1) Bankposteringer på udgifterne
alter table public.entries add column if not exists source text not null default 'manual';
alter table public.entries add column if not exists bank_ref text;
create unique index if not exists entries_bank_ref on public.entries(bank_ref);

-- Posteringer du har slettet, så de ikke bliver hentet igen
create table if not exists public.bank_ignored (
  bank_ref text primary key,
  created_at timestamptz not null default now()
);

-- Forbindelsen til banken (kun læsbar for edge-funktionen)
create table if not exists public.bank_link (
  id int primary key default 1,
  session_id text,
  aspsp text,
  accounts jsonb not null default '[]'::jsonb,
  valid_until timestamptz,
  pending_state text,
  last_sync timestamptz,
  last_result jsonb,
  exclude_patterns text[] not null default array[
    'husleje', 'leje', 'afdrag', 'ydelse', 'overf', 'mobilepay', 'opsparing',
    'egen konto', 'budgetkonto', 'renter', 'gebyr', 'kreditkort'
  ],
  cron_secret text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  updated_at timestamptz not null default now()
);
insert into public.bank_link (id) values (1) on conflict (id) do nothing;

alter table public.bank_ignored enable row level security;
alter table public.bank_link    enable row level security;

-- 2) Skærpet kode-tjek: forkert kode giver 1,5 sek. ventetid (gør gætteri langsomt)
create or replace function public.jb_check(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from app_secret where pin_hash = crypt(p_pin, pin_hash)) then
    perform pg_sleep(1.5);
    raise exception 'Forkert kode' using errcode = '28000';
  end if;
end $$;

-- Bruges af edge-funktionen
create or replace function public.jb_pin_ok(p_pin text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from app_secret where pin_hash = crypt(p_pin, pin_hash)) then return true; end if;
  perform pg_sleep(1.5);
  return false;
end $$;
revoke execute on function public.jb_pin_ok(text) from public, anon, authenticated;
grant execute on function public.jb_pin_ok(text) to service_role;
revoke execute on function public.jb_check(text) from public, anon, authenticated;

-- Sletning af en bankpostering husker den, så den ikke hentes igen
create or replace function public.jb_delete(p_pin text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare r text;
begin
  perform jb_check(p_pin);
  delete from entries where id = p_id returning bank_ref into r;
  if r is not null then
    insert into bank_ignored (bank_ref) values (r) on conflict do nothing;
  end if;
end $$;
grant execute on function public.jb_delete(text, uuid) to anon;

-- 3) Automatisk hentning kl. 06:00 og 18:00 japansk tid
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'jb-bank-sync';
select cron.schedule('jb-bank-sync', '0 9,21 * * *', $cron$
  select net.http_post(
    url := 'https://qahijmlsyayauonvqrnj.supabase.co/functions/v1/bank',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select cron_secret from public.bank_link where id = 1)
    ),
    body := '{"action":"sync"}'::jsonb
  );
$cron$);
