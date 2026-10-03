# FPL Raptor

A free, installable web app for Fantasy Premier League: deadline countdowns, alerts about your players, transfer ideas, and a mini-league page built for banter with friends.

This is the **starter**: the database, a scheduled job that pulls FPL data into it, and a home page showing the next deadline. Later phases (sign-in, notifications, league page, points model, transfer optimizer) build on top of it.

## What's in here

```
FPL-Raptor/
├── app/                     Next.js pages (App Router)
├── components/              React components (deadline countdown)
├── lib/                     Supabase client, FPL helpers
├── jobs/                    Python: the scheduled FPL -> Supabase fetch
│   ├── raptor/              fpl.py (API + parsing), db.py, changes.py, run.py
│   └── tests/               pytest, using small made-up FPL responses
├── supabase/migrations/     SQL that creates every table and its access rules
└── .github/workflows/       fetch.yml (every 3 hours), ci.yml (tests + build)
```

Everything runs on free tiers: Vercel (web app), Supabase (database and sign-in), GitHub Actions (scheduled jobs).

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (sign in with GitHub, pick a US East region).
2. Open **SQL Editor → New query**, paste all of `supabase/migrations/20261003000000_init.sql`, and click **Run**.
3. From **Project Settings → API Keys** (or the **Connect** button), note three values:
   - the project URL, like `https://abcd1234.supabase.co`
   - the **publishable key** (`sb_publishable_...`): for the web app; safe to expose
   - the **secret key** (`sb_secret_...`): for the jobs only; never put it in the web app or in git

   Older projects show `anon` and `service_role` keys instead. They work the same way here, but Supabase is retiring them by the end of 2026.

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

## Running it on your laptop

You need Node.js 22 (LTS) and [uv](https://docs.astral.sh/uv/).

**Web app**

```bash
npm install
cp .env.example .env.local     # then fill in the two values
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

## How the data works

| Table | What's in it | Written |
| --- | --- | --- |
| `teams`, `players`, `gameweeks`, `fixtures` | Current FPL state | Every run, overwritten |
| `player_changes` | Price, status, news and chance-of-playing changes | Every run, only what changed |
| `leagues`, `league_members` | Standings of followed leagues | Every run |
| `entry_gameweeks`, `picks` | Each tracked manager's squad, captain, chip, points, bank | Current and previous gameweek, until FPL confirms final points |
| `profiles`, `notification_prefs`, `push_subscriptions`, `notifications_sent` | App users and their alert settings | By the app (Phases 2–3) |
| `predictions` | Expected points per player per gameweek | By the model (Phase 5) |
| `job_runs` | One row per fetch, with status and a summary | Every run |

Things worth knowing about FPL's data:

- **Money is in tenths of a million.** `now_cost = 65` means £6.5m and `bank = 3` means £0.3m. Use `formatPrice` in `lib/fpl.ts` (or `format_price` in `jobs/raptor/fpl.py`).
- **Player status codes:** `a` available, `d` doubtful, `i` injured, `s` suspended, `u` unavailable, `n` not in squad.
- **Positions:** 1 GK, 2 DEF, 3 MID, 4 FWD.
- Every FPL call lives in `jobs/raptor/fpl.py`, so if the unofficial API changes, that's the one file to fix.

**Who can read what:** football data and job status are readable by anyone with the publishable key. League standings and squads need a signed-in user. Each user can only see and change their own profile and alert settings. The jobs use the secret key, which bypasses these rules.

## Troubleshooting

- **Fetch fails with `401 Invalid API key`:** check the `SUPABASE_SECRET_KEY` secret is the secret key, not the publishable one.
- **Fetch fails with `relation ... does not exist`:** the SQL in `supabase/migrations` hasn't been run yet.
- **Fetch shows `skipped`:** FPL was down or mid-update (common around deadlines). The next run picks it up.
- **FPL returns 403 to GitHub Actions:** FPL occasionally blocks cloud servers. Run the job from your laptop to confirm the code works; if the block persists, the fetch can move to another scheduler.
- **Scheduled runs stopped:** GitHub pauses schedules in public repos after 60 days without a commit. Push anything, or re-enable it under Actions.

## What's next

Phase 2 of the plan: sign-in with Supabase Auth, onboarding with an FPL team id, and the My gameweek page (squad, captain, flagged players).
