# FPL Raptor

A free, installable web app for Fantasy Premier League: deadline countdowns, alerts about your players, transfer ideas, and a mini-league page built for banter with friends.

Built: the database and a scheduled job that pulls FPL data into it, sign-in, My gameweek, push notifications on an installable app, a mini-league page with AI-written weekly roasts, live scores, a Scout page, an expected-points model, and a transfer and chip planner built on it, backtested against a real season.

## What's in here

```
FPL-Raptor/
├── app/                     Next.js pages: / (deadline), /login, /onboarding, /me (My gameweek), /live, /planner, /scout, /league, /notifications
├── components/              Pitch, shirts, player card, countdown, squad list, header and tab bar, install help
├── public/                  sw.js (shows notifications) and app icons
├── lib/                     Supabase clients, FPL helpers, squad, league, live scoring, Scout, pitch and player-card logic (+ Vitest tests)
├── proxy.ts                 Refreshes the sign-in session on every request
├── jobs/                    Python: the scheduled FPL -> Supabase fetch
│   ├── raptor/              fpl.py (API + parsing), db.py, changes.py, run.py (fetch), alerts.py (push), recaps.py (AI recaps)
│   ├── raptor/model/        expected-points model: history.py, features.py, train.py, predict.py
│   ├── raptor/optimizer/    transfer planner: solve.py (the integer program), chips.py, inputs.py, run.py
│   ├── raptor/backtest/     season replay: season.py, actuals.py (last season's real results), report.py
│   ├── backtest/            replay results and REPORT.md
│   ├── model/               the trained model (xpts.joblib), its metadata, and REPORT.md
│   └── tests/               pytest, using small made-up FPL responses
├── supabase/migrations/     SQL that creates every table and its access rules
└── .github/workflows/       fetch.yml (every 3 hours), alerts.yml (every 15 minutes), ci.yml (tests + build)
```

Everything runs on free tiers: Vercel (web app), Supabase (database and sign-in), GitHub Actions (scheduled jobs).

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (sign in with GitHub, pick a US East region).
2. Open **SQL Editor → New query**, paste all of `supabase/migrations/20261003000000_init.sql`, and click **Run**. Then do the same with every later file in `supabase/migrations`, in order (each one is a new query). Today that's `20261003000001_player_gameweeks.sql`, `20261003000002_transfer_plans.sql`, `20261003000003_scout_and_recaps.sql` and `20261003000004_planner_drafts.sql`.
3. From **Project Settings → API Keys** (or the **Connect** button), note three values:
   - the project URL, like `https://abcd1234.supabase.co`
   - the **publishable key** (`sb_publishable_...`): for the web app; safe to expose
   - the **secret key** (`sb_secret_...`): for the jobs only; never put it in the web app or in git

   Older projects show `anon` and `service_role` keys instead. They work the same way here, but Supabase is retiring them by the end of 2026.
4. Go to **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email", then save. Supabase's built-in mailer only delivers to members of your Supabase team (2 emails an hour), so friends would never get a confirmation link.
5. Under **Authentication → URL Configuration**, set **Site URL** to your Vercel address, e.g. `https://fpl-raptor.vercel.app`.

### 2. GitHub Actions (the data fetch)

1. In this repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
2. Go to **Actions → Fetch FPL data → Run workflow**.
3. When it goes green, open Supabase's **Table Editor**: `players` should have every PL player, and `job_runs` should show a row with status `ok`.

From then on it runs every 3 hours on its own. To follow more leagues, add their ids to `FPL_LEAGUE_IDS` in `.github/workflows/fetch.yml` (comma-separated). A league id is the number in its standings URL.

### 3. Vercel (the web app)

1. At [vercel.com](https://vercel.com), **Add New → Project** and import this repo. The defaults are right.
2. Under **Environment Variables**, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Deploy. The home page shows the next deadline once the first fetch has run.

### 4. Push notifications

Pushes are signed with a VAPID key pair. The public half is in `lib/pushConfig.ts`; the private half is a secret that goes in two places:

1. **GitHub:** add a repository secret `VAPID_PRIVATE_KEY` (same place as the Supabase secrets). The **Send alerts** workflow uses it.
2. **Vercel:** add an environment variable `VAPID_PRIVATE_KEY` with the same value, then redeploy. The **Send a test notification** button uses it.

To make a new pair: `npx web-push generate-vapid-keys`. Put the private key in both places above and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in Vercel to the new public key. Everyone then needs to turn notifications on again.

## Using the app

1. Open the site and tap **My gameweek**, then **Create an account** with an email and password.
2. Paste your FPL team ID (the number after `/entry/` on your Points page) or the whole Points link.
3. **Team** (My gameweek) shows your deadline countdown, your team on a pitch (club-colour shirts with each player's expected points on the shirt and next fixture underneath; a list view too), flagged players with FPL's injury news, the model's captain pick and a transfer suggestion, and last gameweek's points, bank and team value. Tap any player, anywhere in the app, for their card: price, availability, form, ownership, the next five fixtures with expected points, the last five results and underlying stats.
4. **Live** shows your points as matches happen: provisional bonus, projected automatic subs, the vice-captain taking over if needed, and your league's live table. It refreshes every minute while matches are on.
5. **Planner** shows the full plan for the next four gameweeks, a tab per week: what to sell and buy, whether a hit is worth it, which chips to play when (or save), and the team on a pitch with new signings ringed. **Build your own** lets you plan the next five gameweeks yourself: tap a player to transfer them (affordable replacements, best outlook first), captain them or swap them with the bench, play chips, and see your expected points against keeping your team and against the bot's plan, with undo. Start from your team or the bot's plan, and save up to five drafts to your account.
6. **Scout** has a fixture ticker (every club's next 3 or 6 gameweeks by difficulty), underlying stats (xP, xGI/90, xG, xA, defensive contributions, for the season or the last six gameweeks) and differentials (good picks almost nobody in your league has).
7. **League** shows each followed mini-league you're in: the AI recap of the last gameweek, the table with movement, your closest rival (what they start that you don't, and their captain), the week's awards, everyone's captains, and who owns whom (the template, your differentials, and threats you don't own).
8. For notifications, open **Notifications** (linked from My gameweek). On iPhone, first add the site to the Home Screen (Share → Add to Home Screen) and open it from the icon; Apple only allows notifications from Home Screen apps. Tap **Turn on notifications**, then **Send a test notification**.

A new user's team is picked up by the next scheduled fetch. Until then, My gameweek loads their squad straight from FPL.

**What gets sent** (every 15 minutes, each alert once):

| Alert | When |
| --- | --- |
| Deadline reminder | Under 24 hours to the deadline, and again under 75 minutes. Lists flagged players in your team, your captain, the model's pick and the planner's transfer |
| Team news | A player in your squad gets flagged, their chance of playing or news changes, or they're available again |
| Price change | A player in your squad rises or falls in price |
| League captains | Within 48 hours of a deadline, once most of your league's squads are in: everyone's captain picks, yours, and your rival's |
| League awards | Once FPL confirms the gameweek's points: top score, wooden spoon, captain hero and fail, bench of shame, and where you finished |
| League recap | When the AI recap is written (after the gameweek's points are final): its headline and first lines |

Team news and prices come from the fetch, so they arrive within about 3 hours of FPL changing them.

## Running it on your laptop

You need Node.js 22 (LTS) and [uv](https://docs.astral.sh/uv/).

**Web app**

```bash
npm install
cp .env.example .env.local     # then fill in the two values
npm test                       # unit tests, no network needed
npm run dev                    # http://localhost:3000
```

**Jobs**

```bash
cd jobs
uv sync
uv run pytest                  # tests, no network needed
cp .env.example .env           # then fill in the values
uv run --env-file .env python -m raptor.run
```

## The expected-points model

Predicts every player's points for each of the next five gameweeks. Gradient-boosted trees
(scikit-learn) trained on four seasons of FPL history (2022/23 to 2025/26, about 113,000
player-fixtures) from the public [vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League)
dataset, using recent form, xG/xA, minutes, bonus, defensive contributions, price, position,
home/away, fixture difficulty and both teams' recent goals and xG.

In backtests on matches it never saw, it beats recent form and FPL's own pre-match xP on accuracy
and on ranking players. **[jobs/model/REPORT.md](jobs/model/REPORT.md)** has the numbers, how
they were measured, and the limits.

- **Live:** after every fetch, `raptor.model.predict` rebuilds this season's history from FPL's
  live data, predicts the next five gameweeks, scales by FPL's chance of playing, and saves to
  `predictions`. My gameweek shows each player's xP, the model's captain pick and your XI's
  expected total; deadline reminders include the pick.
- **Retrain** (e.g. each summer, once the dataset has the new season):

  ```bash
  cd jobs
  uv run python -m raptor.model.train   # downloads history, backtests, saves jobs/model/
  ```

  Commit the updated `jobs/model/` files; the next fetch uses them.

## The transfer planner

After the predictions, `raptor.optimizer.run` plans transfers for every signed-up manager over
the next four gameweeks. It's an integer program (PuLP with the free CBC solver) that chooses,
for each week, the squad, the starting XI, the captain and the transfers, to maximise expected
points under FPL's rules:

- 2 GK, 5 DEF, 5 MID, 3 FWD; at most 3 per club; a valid formation (1 GK, 3+ DEF, 2+ MID, 1+ FWD)
- the bank can't go negative, and players are sold at FPL's selling price (you keep half of any
  rise since you bought them, rounded down)
- free transfers roll over, up to 5; every extra transfer costs 4 points, so a hit is only taken
  when the extra expected points beat it

Later weeks count a little less (×0.85 a week) because predictions get less reliable, and the
bench counts for a tenth of its expected points as cover. Free transfers, bank and purchase prices
come from your public FPL history and transfers. The same model with transfers switched off gives
the "keeping your team" baseline; a plan is only suggested when it beats that by at least a point.

Because the model's predictions flatter the players it picks (it picks whoever it rates highest, so
its errors lean upwards), every transfer must gain a point more than it costs, and a hit must gain
6 rather than 4. Both were tuned on a replay of a past season (see the backtest below).

**Chips.** `chips.py` works out which chips you still have from your FPL history and the chip
windows FPL publishes (since 2025/26, each chip once per half-season), re-solves the plan with each
chip in each planned week, and places them (one a week) only where the gain beats a bar: 18 expected
points for a Wildcard, 15 for a Free Hit or Bench Boost, 13.5 for a Triple Captain. Ordinary weeks
don't clear those; doubles and big swings do. A chip about to expire is played in its best week
rather than lost.

It considers your squad plus the best-predicted players in each position and some cheap budget
picks (about 70), which solves in a second or two per plan. My gameweek shows the first week's move,
**Planner** shows every week and the chip table, and deadline reminders include it.

Limits: it plans from your squad at the last deadline (FPL doesn't share transfers until the next
deadline passes), and it is only as good as the model's predictions.

## The season backtest

`raptor.backtest.season` replays a whole past season with a bot making every decision exactly as
the live app would: retrain the model on everything before each deadline, predict, plan transfers
and chips, make the moves, and score them with the real points (automatic subs, vice-captain,
chips, hits). Over 2025/26 it scored **2,107** (about rank 2.2 million), against 2,264 (rank
360,298) for JP Morgan: decent, not elite. **[jobs/backtest/REPORT.md](jobs/backtest/REPORT.md)** has the details:
where it lost points, how the settings were tuned on 2024/25, and the limits (no injury news in the
history data, one season is a small sample).

```bash
cd jobs
uv run python -m raptor.backtest.season --season 2025-26 --tag tuned   # about 10 minutes
uv run python -m raptor.backtest.report
```

The **Season backtest data** workflow (manual) fetches what the report compares against: a
league's results last season, or a sample of (points, rank) pairs across the game.

## AI gameweek recaps

Once a gameweek's points are final, `raptor.recaps` (after each fetch) gathers each followed
league's facts (scores, captains, hits, chips, benches, movement, players only one manager had) and
asks Google's Gemini to write a short roast in the voice of a football pundit. The League page
shows it and the alerts job pushes it.

- **Free:** Gemini's API has a free tier for its Flash models (rate-limited, no card). Create a key
  at [Google AI Studio](https://aistudio.google.com/apikey) and add it as the `GEMINI_API_KEY`
  repository secret (same place as the Supabase secrets). Without it, recaps are skipped.
- The model only sees the gameweek's numbers and first names, and is told not to invent anything
  and to roast FPL decisions, never people. On the free tier Google may use prompts to improve its
  models.
- To turn recaps off, delete the secret (or the "Write gameweek recaps" step in
  `.github/workflows/fetch.yml`).

## Live scores

The Live page calls FPL's `event/{gw}/live/` and `fixtures/?event={gw}` from the web server (cached
for a minute) and works out what FPL adds later: provisional bonus (3/2/1 by BPS in every started
match whose bonus isn't confirmed, ties shared), automatic substitutions (first bench player who
has played, keeping a valid formation; goalkeepers only for goalkeepers) and the vice-captain
taking the armband when the captain can't play. Squads come from the database, or straight from FPL
if the fetch hasn't stored them yet.

## How the data works

| Table | What's in it | Written |
| --- | --- | --- |
| `teams`, `players`, `gameweeks`, `fixtures` | Current FPL state | Every run, overwritten |
| `player_changes` | Price, status, news and chance-of-playing changes | Every run, only what changed |
| `leagues`, `league_members` | Standings of followed leagues | Every run |
| `entry_gameweeks`, `picks` | Each tracked manager's squad, captain, chip, points, bank | Current and previous gameweek, until FPL confirms final points |
| `player_gameweeks` | Each player's points, minutes and bonus per gameweek | Current and previous gameweek, until FPL confirms final points |
| `predictions` | Expected points per player for each of the next five gameweeks | After every fetch, by the model |
| `transfer_plans` | Each user's four-week transfer and chip plan and the no-transfer baseline (only they can read it) | After every fetch, by the planner |
| `player_stats` | Season and last-six-gameweek stats and the model's next 1 and 5 gameweeks, for Scout | After every fetch, by the prediction job |
| `recaps` | Each league's AI recap per gameweek | Once per gameweek, after its points are final |
| `planner_drafts` | Saved do-it-yourself plans: a list of moves (only the owner can see them) | By the app, from Build your own |
| `profiles` | Each user's FPL team id and name | By the app, at onboarding |
| `notification_prefs`, `push_subscriptions` | Which alerts each user wants; their devices | By the app, on the Notifications page |
| `notifications_sent` | Every alert sent, so none goes out twice | By the alerts job |
| `job_runs` | One row per fetch, prediction, plan, recap or alerts run, with status and a summary | Every run |

Things worth knowing about FPL's data:

- **Money is in tenths of a million.** `now_cost = 65` means £6.5m and `bank = 3` means £0.3m. Use `formatPrice` in `lib/fpl.ts` (or `format_price` in `jobs/raptor/fpl.py`).
- **Player status codes:** `a` available, `d` doubtful, `i` injured, `s` suspended, `u` unavailable, `n` not in squad.
- **Positions:** 1 GK, 2 DEF, 3 MID, 4 FWD.
- Every FPL call lives in `jobs/raptor/fpl.py`, so if the unofficial API changes, that's the one file to fix.

**Who can read what:** football data and job status are readable by anyone with the publishable key. League standings and squads need a signed-in user. Each user can only see and change their own profile and alert settings. The jobs use the secret key, which bypasses these rules.

## Troubleshooting

- **Fetch fails with `401 Invalid API key`:** check the `SUPABASE_SECRET_KEY` secret is the secret key, not the publishable one.
- **Fetch fails with `relation ... does not exist`:** the SQL in `supabase/migrations` hasn't been run yet.
- **Fetch summary says "player points skipped":** run `supabase/migrations/20261003000001_player_gameweeks.sql` in the SQL Editor. Captain awards appear after the next fetch.
- **Fetch summary says "plans skipped":** run `supabase/migrations/20261003000002_transfer_plans.sql` in the SQL Editor. Plans appear after the next fetch.
- **Fetch summary says "scout stats skipped" or "recaps skipped (run ...)":** run `supabase/migrations/20261003000003_scout_and_recaps.sql` in the SQL Editor.
- **Recaps show "failed: ... HTTP 429":** Gemini's free-tier rate limit; the next fetch tries again. **HTTP 400/401/403** usually means the `GEMINI_API_KEY` secret is wrong.
- **Live says FPL isn't answering:** FPL's API goes quiet for a while around deadlines and while it updates; try again in a minute.
- **Planner says your first plan appears after the next update:** the plan is made by the scheduled fetch (every 3 hours). Run **Fetch FPL data** by hand to get one now.
- **League page says none of your leagues are followed:** add the league's id to `FPL_LEAGUE_IDS` in `.github/workflows/fetch.yml`.
- **Fetch shows `skipped`:** FPL was down or mid-update (common around deadlines). The next run picks it up.
- **FPL returns 403 to GitHub Actions:** FPL occasionally blocks cloud servers. Run the job from your laptop to confirm the code works; if the block persists, the fetch can move to another scheduler.
- **"Account created, but Supabase is waiting for email confirmation":** turn off "Confirm email" (Setup, step 1.4). Accounts created before that can be confirmed by hand in **Authentication → Users**.
- **"Send a test notification" says VAPID_PRIVATE_KEY is missing:** add it in Vercel (Setup, step 4) and redeploy.
- **Send alerts shows "Push not set up":** add the `VAPID_PRIVATE_KEY` repository secret on GitHub.
- **No notifications on iPhone:** the app must be opened from the Home Screen icon (not a Safari tab) when you turn notifications on, and notifications must be allowed in Settings → Notifications → FPL Raptor.
- **Scheduled runs stopped:** GitHub pauses schedules in public repos after 60 days without a commit. Push anything, or re-enable it under Actions.

## What's next

All seven phases of the plan are done. Ideas from here: a "what if" mode on the Planner to test your
own transfers, injury news in the backtest (so tuning sees what managers see), a model that
discounts its own favourites (to fix the optimism the backtest found), and whatever the league asks for.
