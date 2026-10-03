-- FPL Raptor 0002: points each player scored in each gameweek.
--
-- How to run: Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Powers captain awards ("captain fail", "captain hero") and, later, the points model.
-- Filled by the fetch job from FPL's live endpoint for the current and previous gameweek.

create table public.player_gameweeks (
  player_id    integer not null references public.players (id),
  gameweek_id  smallint not null references public.gameweeks (id),
  points       smallint not null,
  minutes      smallint not null default 0,
  bonus        smallint not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (player_id, gameweek_id)
);
create index player_gameweeks_gameweek_idx on public.player_gameweeks (gameweek_id);

alter table public.player_gameweeks enable row level security;
create policy "public read" on public.player_gameweeks for select to anon, authenticated using (true);

grant select on public.player_gameweeks to anon, authenticated;
grant all on public.player_gameweeks to service_role;
