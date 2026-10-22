# Shared foundations and Team review

21 October 2026. The user reviewed and approved the Team design, allowing Phase 3 (Live) to proceed. No commit, push, or deployment has been made. The physical iPhone/PWA check was deferred by the user; browser emulation does not establish installed-phone behavior.

## What changed

The shared shell now has a restrained light/dark palette, consistent surfaces and controls, a labeled Account entry, and stable Team, Live, Planner, Scout, and League navigation. Bottom tabs stay visible below the desktop breakpoint and account for the phone's safe area. Desktop navigation uses the available width.

Team puts its name, deadline, and recorded budget first, followed by a compact expandable availability summary and the squad. Recommendations share one section and one Planner action; previous results expand on request. Desktop places advice beside the squad. All 15 squad places and the saved pitch/list preference remain available.

Current and suggested captains have separate labels. Captain advice and the full XI estimate require predictions for every starter. The estimate still uses the existing calculation with the suggested captain doubled. The transfer comparison retains its full gameweek horizon. Budget is labeled as a plan snapshot or last-deadline value. Unknown transfers, bank, player details, fixtures, predictions, and minutes are not presented as a known zero or a confirmed blank fixture.

Player details and planner menus use the same native dialog foundation, with an explicit keyboard focus loop, Escape/backdrop/close dismissal, background scroll locking, and focus return. Opening a player card suspends the planner menu; closing it restores the same menu, focused action, and draft. Player requests can be aborted and failed cards offer a retry.

## Team feature inventory

| Existing feature | Location after this phase |
| --- | --- |
| Team/manager, overall points and rank | Page header |
| Deadline, local time and reminders | Compact deadline section |
| Bank and free transfers | Labeled snapshot below the deadline; unknown values stay unknown |
| Formation, pitch/list, all starters and bench | Your squad; existing preference retained |
| Availability and player news | Summary before the squad; expand for each player's news and card |
| Current captain | Squad armband and Captain → Current |
| Suggested captain, alternatives, XI xP and methodology | Outlook → Captain; comparison/explanation disclosure |
| Transfers, chip suggestion, horizon and gain | Outlook → Transfers; full details through Open planner |
| Last deadline's points, bench points, transfers/hit, bank, value and captain | Expand View results |
| Notifications, change team, sign out | Account in the shared header; reminders also link directly to notifications |

## Verification

- Lint passed; all 170 Vitest tests in 14 files passed.
- Production compilation, TypeScript, and page generation passed with `npm run build -- --webpack`. The default Turbopack build's previously recorded local worker/socket failure remains separate; it is not recorded as passing.
- A disposable Chrome/CDP harness exercised a production build against local HTTP stand-ins for Supabase/Auth/FPL. It completed sign-in/team confirmation before testing the UI. The harness and fixtures are outside the repo; no production fallback was added.
- Layout checks passed at 320, 390, 430, 768, and 1280 CSS pixels, with no page overflow and one visible active Team tab. Light/dark screenshots were reviewed. At 390 × 844, even the long fixture team name and two availability flags left the squad heading and first pitch row visible in the initial screen.
- Browser checks covered saved pitch/list preference, flags and expandable news, complete/missing predictions, missing player details, unavailable fixtures, unavailable squads, gameweek query failures, and error-boundary retry after a deliberate malformed response.
- Player-card checks covered contained keyboard focus, Escape, focus/scroll return, and HTTP-error retry. A planner captain change survived menu → player card → same menu, followed by a transfer search and dismissal. Only one dialog was open at a time; background scroll was restored. Backdrop dismissal also passed.
- The first keyboard run caught focus escaping the player dialog; the shared sheet now explicitly loops Tab/Shift+Tab. Screenshot review also caught a missing player being labeled as having no fixture; that row now says fixtures are unavailable.

Local browser fixtures verify wiring and presentation, not real Supabase RLS, real provider edge cases, or physical iPhone/PWA behavior. The remaining authentication checks are tracked independently in `AUTH_SETUP.md`.

## Visual checkpoint

The user reviewed the linked team at `http://localhost:3000/me` and approved the visual direction on 21 October 2026. Phase 3 applies it to Live. Supporting pages retain their existing content layout until their planned phases, while using the shared navigation and palette.
