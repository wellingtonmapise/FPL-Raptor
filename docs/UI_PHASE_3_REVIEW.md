# Live screen review

21 October 2026. Live is implemented and locally verified after the user approved the Team design. No commit, push, or deployment has been made. Physical iPhone/PWA testing remains deferred at the user's request.

## What changed

Live leads with gameweek points after hits, the number of counting players still to finish, and league position/movement. Status distinguishes upcoming kick-off, matches in progress, waiting for confirmation, and final points. A checked time and manual refresh control accompany the existing minute/visibility refresh behavior.

Your players is the default view, followed by labeled Standings and Matches views. View changes update the URL and browser history using Next's supported native History API integration, without fetching the page again. The panels remain mounted, preserving the squad's pitch/list choice and expanded details. Switching leagues preserves the selected view, and existing `?league=` links continue to work.

The squad leads on phones. Desktop places compact league impact beside it. The leading helping/hurting player stays visible; full impact, effective ownership, closest-rival gap, and differential swings expand on request. Matches are grouped into Playing now, Still to come, and Full time.

The scoring functions in `lib/live.ts` are unchanged. A presentation/data-completeness helper prevents missing picks, player rows, or live elements from becoming zero-point players or triggering invented substitutions. Unknown starting totals do not establish a visible rank. Incomplete standings show available scores in manager-name order, with missing totals and all ranks unavailable; rank-dependent impact and rival comparisons wait for complete data. The signed-in user's own score can still load when league queries fail or no league is followed.

## Feature inventory

| Existing feature | Location after this phase |
| --- | --- |
| Score, transfer hit, chip, players remaining and movement | Summary at the top; remaining count includes players currently playing |
| Full 15-player pitch/list and player cards | Your players; existing saved view preference retained |
| Captain multipliers, vice-captain handover, bonus and automatic subs | Existing scoring engine; pitch/list badges, provisional labels, projected-sub notes and rings |
| Saving/hurting players and effective ownership | Compact impact summary, with the full list in its disclosure |
| Nearest-rival gap, gameweek difference and swings | Full impact & closest rival |
| All league managers, GW points, total, captain, chip, hits and players left | Standings; selected league through the labeled selector |
| Current, upcoming and finished match scores/times | Matches, grouped by state |
| Minute refresh and refresh when returning to the page | Same active-match predicate and 60-second interval; hidden pages do not refresh |
| Next-gameweek handoff | Prepare your team link after a finished gameweek |

## Verification

- `npm run lint` passed.
- `npm test` passed: 175 tests in 15 files. Five new tests cover view URLs, preserved league/view context, complete versus incomplete scoring inputs, and known-zero versus missing starting totals. The existing live-scoring tests still pass.
- `npm run build -- --webpack` passed production compilation, TypeScript, and page generation. The previously recorded local Turbopack worker/socket failure is separate; the default build is not recorded as passing.
- A disposable Chrome/CDP harness exercised the built app with temporary local Auth/Supabase/FPL HTTP stand-ins. It used explicit synthetic squads and scores, outside the repository. No fixtures or test overrides were added to production behavior.
- Browser assertions verified a 61-point gross score minus a four-point hit, six players still to finish after a projected goalkeeper substitution, rival captain impact, live league position/movement, complete squad/bench access, and the expanded rival gap.
- Your players → Standings → Matches and browser back preserved the requested view without new page-data requests. League selection retained Standings and the league-specific table. Manual refresh and the registered minute callback retained the selected view.
- The harness invoked the actual registered 60-second callback and visibility listener rather than waiting a full minute: hidden-page refresh was skipped, returning to visible refreshed, and no additional polling interval was introduced. Final matches did not mount the interval.
- Refreshes preserved the open player card, its internal scroll in a shorter phone viewport, focus return, expanded impact, the squad view, and page scroll.
- Layouts had no horizontal page overflow at 320, 390, 430, 768, and 1280 CSS pixels. Light/dark phone and desktop screenshots, matches, standings, and missing-total presentation were inspected.
- Additional browser cases passed: missing rival squad, missing starting total, missing player data, no followed league, league-query outage, direct FPL squad fallback, pre-kick-off, Bench Boost, triple-captain handover to the vice-captain, waiting for confirmation, final points, no fixtures, preseason, query failure, error-boundary retry, and FPL-outage recovery through Refresh.

Local stand-ins establish wiring and presentation. They do not establish real-provider edge cases, live FPL service availability, Supabase RLS behavior, or installed-phone behavior. Authentication follow-ups remain tracked separately in `AUTH_SETUP.md`.

## Review and next phase

Open `http://localhost:3000/live` while signed in. Review the three views and the selected league with the linked team. Phase 4 is Planner: simplify the current recommendation, week selection, chip detail, and manual drafting controls while preserving saved and unsaved work.
