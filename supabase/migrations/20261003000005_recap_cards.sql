-- FPL Raptor 0006: recap cards and reactions.
--
-- How to run: Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.

-- The week's award cards (Top Dog, Bench Warmer, ...) with the AI's one-line roasts.
alter table public.recaps add column if not exists cards jsonb;

-- Reactions to recap cards: one emoji per person per card. Everyone signed in
-- can see the counts; you can only react in leagues you're in.
create table public.recap_reactions (
  league_id    integer not null references public.leagues (id) on delete cascade,
  gameweek_id  smallint not null references public.gameweeks (id),
  card_id      text not null check (char_length(card_id) <= 32),
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  emoji        text not null check (emoji in ('laugh', 'skull', 'fire', 'clown')),
  created_at   timestamptz not null default now(),
  primary key (league_id, gameweek_id, card_id, user_id)
);

alter table public.recap_reactions enable row level security;
create policy "signed-in read" on public.recap_reactions for select to authenticated using (true);
create policy "own reactions in your leagues" on public.recap_reactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.league_members lm
      join public.profiles p on p.fpl_team_id = lm.team_id
      where p.user_id = (select auth.uid()) and lm.league_id = recap_reactions.league_id
    )
  );

grant select, insert, update, delete on public.recap_reactions to authenticated;
grant all on public.recap_reactions to service_role;
