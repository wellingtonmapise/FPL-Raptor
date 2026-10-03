-- FPL Raptor 0004: Scout page stats and AI gameweek recaps.
--
-- How to run: Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.

-- One row per player, replaced after every fetch by the prediction job:
-- season totals from FPL, the last few gameweeks, and the model's outlook.
create table public.player_stats (
  player_id            integer primary key references public.players (id) on delete cascade,
  minutes              integer,
  starts               smallint,
  goals                smallint,
  assists              smallint,
  clean_sheets         smallint,
  bonus                smallint,
  defensive_contribution integer,          -- FPL's defensive actions count (2025/26 rules)
  xg                   numeric(6, 2),
  xa                   numeric(6, 2),
  xgi                  numeric(6, 2),
  xgc                  numeric(6, 2),
  points_per_game      numeric(4, 1),
  ict                  numeric(6, 1),
  recent_gameweeks     smallint,          -- how many gameweeks the recent_ columns cover (up to 6)
  recent_minutes       integer,
  recent_points        smallint,
  recent_xg            numeric(5, 2),
  recent_xa            numeric(5, 2),
  recent_dc            integer,
  transfers_in_event   integer,           -- since the last deadline
  transfers_out_event  integer,
  xp_gameweek          smallint,          -- the gameweek xp_next is for
  xp_next              numeric(5, 2),     -- model expected points, next gameweek
  xp_next5             numeric(6, 2),     -- model expected points, next five gameweeks
  updated_at           timestamptz not null default now()
);

alter table public.player_stats enable row level security;
create policy "public read" on public.player_stats for select to anon, authenticated using (true);
grant select on public.player_stats to anon, authenticated;
grant all on public.player_stats to service_role;

-- A recap of each mini-league gameweek, written once the gameweek's points are final.
create table public.recaps (
  league_id    integer not null references public.leagues (id) on delete cascade,
  gameweek_id  smallint not null references public.gameweeks (id),
  title        text not null,
  body         text not null,
  model        text not null,               -- which AI model wrote it
  created_at   timestamptz not null default now(),
  primary key (league_id, gameweek_id)
);

alter table public.recaps enable row level security;
create policy "signed-in read" on public.recaps for select to authenticated using (true);
grant select on public.recaps to authenticated;
grant all on public.recaps to service_role;
