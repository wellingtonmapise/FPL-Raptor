-- FPL Raptor 0005: saved drafts from the do-it-yourself planner.
--
-- How to run: Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- A draft is your list of moves (transfers, captains, swaps, chips) on top of
-- your squad. Only you can see or change your own drafts.

create table public.planner_drafts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name           text not null check (char_length(name) between 1 and 40),
  from_gameweek  smallint not null,               -- the first gameweek the draft plans
  moves          jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);

create index planner_drafts_user on public.planner_drafts (user_id, updated_at desc);

alter table public.planner_drafts enable row level security;
create policy "own rows" on public.planner_drafts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.planner_drafts to authenticated;
grant all on public.planner_drafts to service_role;
