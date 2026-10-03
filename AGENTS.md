<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FPL Raptor project notes

- Two parts in one repo: the Next.js app at the root, and Python jobs in `jobs/` (uv, Python 3.12).
- The database schema lives in `supabase/migrations/`. Add new migrations as new files; don't edit applied ones.
- FPL money is tenths of a million (`65` = £6.5m). Every FPL API call goes through `jobs/raptor/fpl.py`.
- The web app reads Supabase with the publishable key only (row-level security applies). The secret key is for jobs in GitHub Actions and must never appear in app code.
- Signed-in pages use `lib/supabase/server.ts` (cookie session); public pages use `lib/supabase/public.ts` so they stay static. `proxy.ts` refreshes sessions.
- Pure data-shaping logic lives in `lib/` with Vitest tests (`lib/*.test.ts`).
- Checks: `npm run lint && npm test && npm run build` for the app; `cd jobs && uv run pytest` for the jobs.
