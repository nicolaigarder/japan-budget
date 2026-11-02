-- Japan Budget – Supabase setup
-- 1) Skift 'VÆLG-EN-KODE' nederst til jeres fælles kode (gerne 6+ tegn)
-- 2) Kør hele scriptet i Supabase → SQL Editor → Run

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_secret (
  id int primary key default 1,
  pin_hash text not null
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  person text not null check (person in ('nicolai','alex')),
  day date not null,
  amount_dkk numeric(12,2) not null,
  amount_orig numeric(14,2) not null,
  currency text not null check (currency in ('DKK','JPY')),
  rate numeric(14,8),
  category text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists entries_person_day on public.entries(person, day);

create table if not exists public.settings (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- Ingen direkte adgang til tabellerne – alt går gennem funktionerne nedenfor
alter table public.app_secret enable row level security;
alter table public.entries    enable row level security;
alter table public.settings   enable row level security;

create or replace function public.jb_check(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from app_secret where pin_hash = crypt(p_pin, pin_hash)) then
    raise exception 'Forkert kode' using errcode = '28000';
  end if;
end $$;

create or replace function public.jb_load(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform jb_check(p_pin);
  return jsonb_build_object(
    'entries',  coalesce((select jsonb_agg(to_jsonb(e) order by e.day, e.created_at) from entries e), '[]'::jsonb),
    'settings', (select data from settings where id = 1)
  );
end $$;

create or replace function public.jb_add(
  p_pin text, p_person text, p_day date, p_amount_dkk numeric, p_amount_orig numeric,
  p_currency text, p_rate numeric, p_category text, p_note text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r entries;
begin
  perform jb_check(p_pin);
  insert into entries (person, day, amount_dkk, amount_orig, currency, rate, category, note)
  values (p_person, p_day, p_amount_dkk, p_amount_orig, p_currency, p_rate, p_category, p_note)
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.jb_update(
  p_pin text, p_id uuid, p_day date, p_amount_dkk numeric, p_amount_orig numeric,
  p_currency text, p_rate numeric, p_category text, p_note text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r entries;
begin
  perform jb_check(p_pin);
  update entries set day = p_day, amount_dkk = p_amount_dkk, amount_orig = p_amount_orig,
    currency = p_currency, rate = p_rate, category = p_category, note = p_note
  where id = p_id returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.jb_delete(p_pin text, p_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform jb_check(p_pin);
  delete from entries where id = p_id;
end $$;

create or replace function public.jb_save_settings(p_pin text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform jb_check(p_pin);
  update settings set data = p_data, updated_at = now() where id = 1;
  return p_data;
end $$;

revoke execute on function public.jb_check(text) from anon, authenticated, public;
grant execute on function public.jb_load(text) to anon;
grant execute on function public.jb_add(text,text,date,numeric,numeric,text,numeric,text,text) to anon;
grant execute on function public.jb_update(text,uuid,date,numeric,numeric,text,numeric,text,text) to anon;
grant execute on function public.jb_delete(text,uuid) to anon;
grant execute on function public.jb_save_settings(text,jsonb) to anon;

-- Jeres fælles kode (skift den her):
insert into public.app_secret (id, pin_hash)
values (1, extensions.crypt('VÆLG-EN-KODE', extensions.gen_salt('bf')))
on conflict (id) do update set pin_hash = excluded.pin_hash;
