-- Run once in Supabase → SQL Editor.
-- One row per user holds their whole bookmark document as JSON.
create table if not exists public.boards (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security: each user can only touch their own row. The public anon
-- key in the browser is safe precisely because of these policies.
alter table public.boards enable row level security;

create policy "own board select" on public.boards
  for select using (auth.uid() = user_id);
create policy "own board insert" on public.boards
  for insert with check (auth.uid() = user_id);
create policy "own board update" on public.boards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own board delete" on public.boards
  for delete using (auth.uid() = user_id);
