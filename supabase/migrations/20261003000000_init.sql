-- FPL Raptor: initial schema
--
-- How to run: Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
-- Safe to read top to bottom: shared football data first, then per-user tables,
-- then row-level security.
--
-- Conventions
--   * Ids that come from FPL keep FPL's numbers (players.id = FPL "element" id,
--     teams.id = FPL club id, team_id = FPL "entry" id, gameweek_id = FPL event id).
--   * Money is stored the way FPL sends it: tenths of a million (65 = £6.5m).
--   * The scheduled jobs write with the secret key, which bypasses RLS.
--     The web app reads with the publishable key, so RLS decides what it can see.


-- ---------------------------------------------------------------------------
-- Shared football data (one copy for everyone, written by the jobs)
-- ---------------------------------------------------------------------------

create table public.teams (
  id          smallint primary key,
  name        text not null,
  short_name  text not null,
  updated_at  timestamptz not null default now()
);

create table public.players (
  id                            integer primary key,
  web_name                      text not null,
  first_name                    text,
  second_name                   text,
  team_id                       smallint not null references public.teams (id),
  position                      smallint not null check (position between 1 and 4), -- 1 GK, 2 DEF, 3 MID, 4 FWD
  now_cost                      smallint not null,           -- tenths of a million
  status                        text not null,               -- a, d, i, s, u, n (see README)
  news                          text not null default '',
  chance_of_playing_next_round  smallint,                    -- null means no flag
  selected_by_percent           numeric(5, 1),
  form                          numeric(4, 1),
  total_points                  smallint,
  updated_at                    timestamptz not null default now()
);
create index players_team_idx on public.players (team_id);

-- Only what changed between fetches: this drives alerts and keeps the
-- database far below the 500 MB free limit.
create table public.player_changes (
  id         bigint generated always as identity primary key,
  player_id  integer not null references public.players (id),
  field      text not null,       -- now_cost, status, news, chance_of_playing_next_round
  old_value  text,
  new_value  text,
  seen_at    timestamptz not null default now()
);
create index player_changes_seen_idx on public.player_changes (seen_at desc);
create index player_changes_player_idx on public.player_changes (player_id, seen_at desc);

create table public.gameweeks (
  id             smallint primary key,
  name           text not null,
  deadline_time  timestamptz not null,
  is_previous    boolean not null default false,
  is_current     boolean not null default false,
  is_next        boolean not null default false,
  finished       boolean not null default false,
  data_checked   boolean not null default false,   -- FPL has confirmed final points
  updated_at     timestamptz not null default now()
);

create table public.fixtures (
  id               integer primary key,
  gameweek_id      smallint references public.gameweeks (id),   -- null while unscheduled
  kickoff_time     timestamptz,
  home_team_id     smallint not null references public.teams (id),
  away_team_id     smallint not null references public.teams (id),
  home_difficulty  smallint,
  away_difficulty  smallint,
  home_score       smallint,
  away_score       smallint,
  started          boolean not null default false,
  finished         boolean not null default false,
  updated_at       timestamptz not null default now()
);
create index fixtures_gameweek_idx on public.fixtures (gameweek_id);


-- ---------------------------------------------------------------------------
-- Leagues and squads (public FPL data about the managers you follow)
-- ---------------------------------------------------------------------------

create table public.leagues (
  id          integer primary key,      -- FPL league id, e.g. 1086012
  name        text not null,
  updated_at  timestamptz not null default now()
);

create table public.league_members (
  league_id     integer not null references public.leagues (id) on delete cascade,
  team_id       integer not null,       -- FPL entry id
  manager_name  text not null,
  team_name     text not null,
  rank          integer,
  last_rank     integer,
  total         integer,
  event_total   integer,
  updated_at    timestamptz not null default now(),
  primary key (league_id, team_id)
);
create index league_members_team_idx on public.league_members (team_id);

-- One row per squad per gameweek: chip, points, bank, transfers.
create table public.entry_gameweeks (
  team_id               integer not null,
  gameweek_id           smallint not null references public.gameweeks (id),
  active_chip           text,
  points                smallint,
  total_points          integer,
  overall_rank          integer,
  bank                  smallint,       -- tenths of a million
  value                 smallint,       -- tenths of a million
  event_transfers       smallint,
  event_transfers_cost  smallint,
  points_on_bench       smallint,
  final                 boolean not null default false,  -- true once FPL confirmed the gameweek's points
  updated_at            timestamptz not null default now(),
  primary key (team_id, gameweek_id)
);

-- One row per player per squad per gameweek.
create table public.picks (
  team_id          integer not null,
  gameweek_id      smallint not null references public.gameweeks (id),
  player_id        integer not null references public.players (id),
  squad_position   smallint not null check (squad_position between 1 and 15), -- 1-11 start, 12-15 bench
  multiplier       smallint not null,    -- 0 bench, 1 starter, 2 captain, 3 triple captain
  is_captain       boolean not null,
  is_vice_captain  boolean not null,
  primary key (team_id, gameweek_id, player_id)
);
create index picks_gameweek_idx on public.picks (gameweek_id, player_id);


-- ---------------------------------------------------------------------------
-- People using the app (tied to Supabase Auth)
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  fpl_team_id   integer unique,
  display_name  text,
  created_at    timestamptz not null default now()
);

create table public.notification_prefs (
  user_id     uuid not null references auth.users (id) on delete cascade,
  alert_type  text not null check (alert_type in (
                'deadline_24h', 'deadline_1h', 'player_flag',
                'price_change', 'transfer_suggestion', 'league')),
  enabled     boolean not null default true,
  primary key (user_id, alert_type)
);

create table public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Stops the same alert going out twice, e.g. alert_key = 'deadline_24h:gw6'.
create table public.notifications_sent (
  user_id    uuid not null references auth.users (id) on delete cascade,
  alert_key  text not null,
  sent_at    timestamptz not null default now(),
  primary key (user_id, alert_key)
);


-- ---------------------------------------------------------------------------
-- Model output and job bookkeeping
-- ---------------------------------------------------------------------------

create table public.predictions (
  player_id        integer not null references public.players (id),
  gameweek_id      smallint not null references public.gameweeks (id),
  expected_points  numeric(5, 2) not null,
  model_version    text not null,
  created_at       timestamptz not null default now(),
  primary key (player_id, gameweek_id, model_version)
);

create table public.job_runs (
  id           bigint generated always as identity primary key,
  job          text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running'
                 check (status in ('running', 'ok', 'skipped', 'failed')),
  detail       text
);
create index job_runs_job_idx on public.job_runs (job, started_at desc);


-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.teams               enable row level security;
alter table public.players             enable row level security;
alter table public.player_changes      enable row level security;
alter table public.gameweeks           enable row level security;
alter table public.fixtures            enable row level security;
alter table public.leagues             enable row level security;
alter table public.league_members      enable row level security;
alter table public.entry_gameweeks     enable row level security;
alter table public.picks               enable row level security;
alter table public.profiles            enable row level security;
alter table public.notification_prefs  enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.notifications_sent  enable row level security;
alter table public.predictions         enable row level security;
alter table public.job_runs            enable row level security;

-- Football data, predictions and job status: anyone can read.
create policy "public read" on public.teams          for select to anon, authenticated using (true);
create policy "public read" on public.players        for select to anon, authenticated using (true);
create policy "public read" on public.player_changes for select to anon, authenticated using (true);
create policy "public read" on public.gameweeks      for select to anon, authenticated using (true);
create policy "public read" on public.fixtures       for select to anon, authenticated using (true);
create policy "public read" on public.predictions    for select to anon, authenticated using (true);
create policy "public read" on public.job_runs       for select to anon, authenticated using (true);

-- Leagues and squads: signed-in users only, so friends' teams aren't on open URLs.
create policy "signed-in read" on public.leagues         for select to authenticated using (true);
create policy "signed-in read" on public.league_members  for select to authenticated using (true);
create policy "signed-in read" on public.entry_gameweeks for select to authenticated using (true);
create policy "signed-in read" on public.picks           for select to authenticated using (true);

-- Each user manages only their own rows.
create policy "own rows" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.notification_prefs
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.push_subscriptions
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows read" on public.notifications_sent
  for select to authenticated
  using ((select auth.uid()) = user_id);


-- ---------------------------------------------------------------------------
-- Table privileges (explicit, so the Data API exposes exactly this)
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

grant select on public.teams, public.players, public.player_changes, public.gameweeks,
  public.fixtures, public.predictions, public.job_runs
  to anon, authenticated;

grant select on public.leagues, public.league_members, public.entry_gameweeks, public.picks
  to authenticated;

grant select, insert, update, delete on public.profiles, public.notification_prefs,
  public.push_subscriptions
  to authenticated;
grant select on public.notifications_sent to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
