-- Japan Budget – én bankforbindelse pr. person + personlig bankkode
-- Kør i Supabase → SQL Editor (efter bank.sql)

alter table public.bank_link add column if not exists person text;
alter table public.bank_link add column if not exists code_hash text;
alter table public.bank_link add column if not exists fail_count int not null default 0;
alter table public.bank_link add column if not exists locked_until timestamptz;

update public.bank_link set person = 'nicolai' where id = 1 and person is null;
insert into public.bank_link (id, person) values (2, 'alex') on conflict (id) do nothing;
create unique index if not exists bank_link_person on public.bank_link(person);

-- Tjek / sæt personlig bankkode (kun edge-funktionen må kalde dem)
create or replace function public.jb_bank_code_ok(p_person text, p_code text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (
    select 1 from bank_link
    where person = p_person and code_hash is not null and code_hash = crypt(p_code, code_hash)
  );
$$;

create or replace function public.jb_bank_code_set(p_person text, p_code text) returns void
language sql security definer set search_path = public, extensions as $$
  update bank_link set code_hash = crypt(p_code, gen_salt('bf', 8)), fail_count = 0, locked_until = null
  where person = p_person;
$$;

revoke execute on function public.jb_bank_code_ok(text, text) from public, anon, authenticated;
revoke execute on function public.jb_bank_code_set(text, text) from public, anon, authenticated;
grant execute on function public.jb_bank_code_ok(text, text) to service_role;
grant execute on function public.jb_bank_code_set(text, text) to service_role;
