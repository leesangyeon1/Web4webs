-- Run once in Supabase → SQL Editor.
-- ID + passphrase sync (no email/OAuth). The passphrase is stored as a bcrypt
-- hash; all access goes through two SECURITY DEFINER functions, so the anon key
-- can never read the table directly.

create extension if not exists pgcrypto;

create table if not exists public.simple_boards (
  id         text primary key,
  secret     text not null,                 -- bcrypt hash of the passphrase
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Lock the table: RLS on, no policies => no direct anon/authenticated access.
alter table public.simple_boards enable row level security;

-- Save: create the board on first use (hashing the passphrase), otherwise
-- verify the passphrase before updating.
create or replace function public.board_save(p_id text, p_secret text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare existing text;
begin
  if length(coalesce(p_id, '')) < 3 or length(coalesce(p_secret, '')) < 4 then
    raise exception 'id or passphrase too short';
  end if;
  select secret into existing from simple_boards where id = p_id;
  if existing is null then
    insert into simple_boards(id, secret, data)
      values (p_id, crypt(p_secret, gen_salt('bf')), p_data);
  elsif existing = crypt(p_secret, existing) then
    update simple_boards set data = p_data, updated_at = now() where id = p_id;
  else
    raise exception 'wrong passphrase';
  end if;
end;
$$;

-- Load: null if the ID doesn't exist yet; raises if the passphrase is wrong.
create or replace function public.board_load(p_id text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r simple_boards;
begin
  select * into r from simple_boards where id = p_id;
  if r.id is null then
    return null;
  end if;
  if r.secret = crypt(p_secret, r.secret) then
    return r.data;
  else
    raise exception 'wrong passphrase';
  end if;
end;
$$;

revoke all on function public.board_save(text, text, jsonb) from public;
revoke all on function public.board_load(text, text) from public;
grant execute on function public.board_save(text, text, jsonb) to anon, authenticated;
grant execute on function public.board_load(text, text) to anon, authenticated;
