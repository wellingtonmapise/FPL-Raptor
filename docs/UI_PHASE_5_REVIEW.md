# Phase 5 review — Scout and Ask Raptor

22 October 2026. Implemented locally; ready for visual review. Nothing committed, pushed, or deployed.

## Review in the running app

- `/scout`: clean visits start with player discovery. Search a name or club, choose a position and comparison metric, then open and close a player card. The URL retains the filters.
- `/scout?view=stats`: the detailed table remains directly accessible and scrolls inside its own region. Its Compact rows link retains the chosen filters. Season/last-six ranges and minutes eligibility still use `lib/scout.ts`.
- `/scout?view=fixtures&weeks=3`: home/away and difficulty have text labels; blanks and doubles are explicit. Six-week tables own their horizontal scrolling.
- `/scout?view=differentials`: existing ownership, availability, position and model-ranking criteria remain. A complete latest squad is required to exclude owned players; unavailable league ownership is labeled as an overall-only comparison.
- `/scout?view=ask`: compact starters, contained conversation scrolling, a persistent composer, progress feedback, retry, and explicit scenario review in Planner.

Players, Fixtures, Differentials and Ask Raptor fit in the phone view bar. Detailed stats lives inside Players and keeps its existing deep link. Search updates immediately through Next's integrated History API; position/sort/period changes create history entries. Switching views keeps filter parameters. A clean `/scout` deliberately starts a fresh discovery view rather than restoring a device-wide last tab.

## Behavior and boundaries

Chat storage now separates Supabase user UUID, linked FPL team and gameweek. Restoration completes before persistence. The old `raptor-ask` record has no account identity and is ignored; it is not silently imported or deleted. Up to 40 validated messages remain on the device; the API still receives at most 20 recent turns. A conversation restored with an unanswered question offers retry. Leaving the chat aborts the browser request, and retry reuses the question without duplicating it.

Status events can arrive in split network chunks, including split UTF-8 text. A final event without a trailing newline is accepted. Errors remain visible with retry; the question stays in history. The existing signed-in API, grounding prompt, tool calculations, Gemini thought signatures, request limits, and request/response shapes are preserved. Only owner-facing infrastructure error copy was replaced with user-facing availability messages.

Scenario cards show their own gameweek range and expected gain after hits against no moves. They write the existing handoff payload and open Build your own. Planner still asks for review before replacing the current draft. If storage blocks the handoff, chat explains the failure and stays open.

The composer sits inside the panel rather than floating over the page. Dynamic viewport sizing handles resized browser viewports; a Visual Viewport listener adjusts for keyboards that shrink only the visible viewport. Reading older messages disables automatic following and exposes Latest message. The original raptor illustration and player-detail links remain.

## Verification

- `npm run lint`: passed.
- `npm test`: **199 tests passed across 19 files**. New coverage exercises Scout URL validation/round-tripping, accent/club search, unknown metrics, account/team/gameweek storage keys, malformed and bounded history, interrupted-question recovery, and NDJSON chunk/error handling.
- `npm run build -- --webpack`: production build passed, including TypeScript and page generation. The default Turbopack build retains the previously recorded local worker/socket permission limitation; the fallback is not a claim that default Turbopack passed.
- Native headless Chrome exercised the actual built app, Supabase SDK, cookies and Ask API against disposable local Supabase/FPL/Gemini HTTP stand-ins. The stand-in model called the real `what_if` tool, received its result and returned a reply. No real model call or database write was used for these checks.
- Browser checks cover 320/390/430/768/1280 widths, both themes, page overflow, discovery/filter/deep-link context, player-card return, reset/no matches, per-90 eligibility, home/away/blank/double labels, statistics/fixtures/page failures, unavailable squad, streamed progress, service failure/retry, history reload, account isolation, interrupted-request recovery, unlinked-team chat, blocked handoff, and reviewed Planner loading.
- Phone, desktop, dark/light, table, fixture, differential, streaming, answer, error and reduced-height screenshots were inspected. Temporary browser fixtures and screenshots live outside the repo in `/private/tmp`; they contain synthetic account data only.

The normal production build is restored after fixture testing; `.env.local` is unchanged. The development app remains on port 3000. No dependencies, migrations, jobs, optimizer, Scout calculations, or Ask tool/model contracts changed. The pre-existing `package-lock.json` edit is preserved.

## Still to verify

- Physical iPhone Safari and installed-PWA keyboard/safe-area behavior remain deferred by the user. Chrome resized-view checks do not establish those as passed.
- Real production Gemini/provider availability and the auth edge cases listed in `AUTH_SETUP.md` remain environment-dependent checks.
- User visual approval of this milestone; then Phase 6, League and recaps.
