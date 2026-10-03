-- FPL Raptor 0003: transfer plans from the optimizer.
--
-- How to run: Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- One row per user, replaced after every fetch. Only the user can read their own plan.

create table public.transfer_plans (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  team_id          integer not null,
  from_gameweek    smallint not null,          -- first gameweek the plan covers
  horizon          smallint not null,          -- how many gameweeks it plans
  free_transfers   smallint not null,          -- estimated, before the first deadline
  bank             smallint not null,          -- tenths of a million
  plan             jsonb not null,             -- weeks: transfers, captain, XI, bench, expected points
  expected_points  numeric(6, 2) not null,     -- over the horizon, after hits
  baseline_points  numeric(6, 2) not null,     -- same squad, no transfers
  model_version    text not null,
  created_at       timestamptz not null default now()
);

alter table public.transfer_plans enable row level security;
create policy "own rows read" on public.transfer_plans
  for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.transfer_plans to authenticated;
grant all on public.transfer_plans to service_role;
