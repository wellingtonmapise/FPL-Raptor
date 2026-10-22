# Planner review

21 October 2026. Planner is implemented and locally verified after the user requested the next step from Live. No commit, push, or deployment has been made. Physical iPhone/PWA testing remains deferred at the user's request.

## What changed

Suggested plan leads with this deadline's moves or roll, bank, free transfers, and hit cost. The gain and total comparison retain their full optimizer horizon. Weekly optimizer xP is stored before hits; the selected week now shows net xP after deducting its hit, while the horizon total is already net and is not deducted twice. Roll wording refers to the current deadline, allowing for moves later in the plan; Team uses the same distinction.

A shared week picker selects the squad and transfers. Chip comparison and model/method/track-record detail expand on request. An older plan is labeled as a saved recommendation rather than presented as the next deadline's plan. Both modes retain the last-deadline squad limitation and say that nothing is submitted to FPL.

Build your own keeps Save, Undo and the selected week's budget close to the squad. More holds saved drafts, starting over, and loading the suggestion. The desktop layout puts horizon comparisons and chip/data controls beside the pitch; phones show them afterward. Saved drafts retain a projection preview with its comparison range, when their counting players have predictions.

Local edits are scoped to the Supabase user, linked team and starting gameweek. Restoration runs before persistence writes. Older unscoped drafts remain available through explicit recovery; they are never silently attached to another team. A confirmed recovery retains a saved identity only when it belongs to the signed-in account's returned draft list. Other recoveries become a new local draft.

Unsaved changes are detected against the last saved move list. Loading a saved draft, the suggestion, or an incoming Ask Raptor scenario asks before replacing unsaved work. Incoming scenarios and older local drafts have an explicit Review action even when the current draft is empty. Saving captures the selected move snapshot, keeps the record's identity when updating, and offers retry without discarding edits. Named drafts, save-as-new, the existing five-draft limit, and confirmed deletion are preserved; deleting a saved copy leaves the open moves intact.

The simulation and optimizer are unchanged. Stale plan bank, free transfers, selling prices and chip availability are not reused as current inputs. Fallback budget assumptions are labeled. Missing predictions hide the affected player/weekly/horizon estimates; a boosted bench also needs prediction coverage. Missing player details stop drafting with a retry message. Query failures are distinguished from season end, and unavailable fixture labels are not presented as confirmed blanks.

## Feature inventory

| Feature | Location after this phase |
| --- | --- |
| Current transfer/roll/chip recommendation, hit, bank and FT | Suggested plan summary |
| Plan versus keeping the squad; full comparison period | Compare totals disclosure; headline gain retains its horizon |
| All suggested weeks, squads, bench, captain, transfer prices and weekly points | Week picker and selected squad; net weekly points include hits |
| Chip advice, comparison by week and expiry reasoning | Chip comparison disclosure |
| Model version, generation time, data limitations and backtest record | How this plan is made |
| Transfer, captain, legal bench swap, player card | Tap a player in Build your own; shared sheet returns to the same menu |
| Chip choice, availability and copies used in other weeks | Chip for the selected gameweek |
| Undo, starting squad, suggested-plan replay | Undo and More; replacing unsaved edits requires a decision |
| Keeping-squad and suggested-plan comparison | Draft horizon summary; replay range is explicit |
| Saved drafts and projection previews | Saved drafts; named Save, Save changes, Save as new and Delete |
| Unsaved device state and Ask Raptor scenario | Scoped local restoration; explicit incoming-scenario review |
| Missing projections, budget assumptions and fixture failures | Selected-week messages and Budget & data |

## Verification

- Lint passed. All 185 Vitest tests in 17 files passed. Ten additional tests cover scoped keys, local move/identity/baseline restoration, corrupt/legacy input, handoff gameweek validation, net weekly points, prediction coverage including Bench Boost, fresh/stale plan inputs, known-zero projections, and query/fixture failures.
- `npm run build -- --webpack` passed production compilation, TypeScript and page generation. The default Turbopack worker/socket failure recorded in earlier phases remains separate; it is not recorded as passing.
- A disposable Chrome/CDP harness used the built app and actual Supabase SDK/server actions against temporary local Auth/Supabase/FPL HTTP stand-ins. All synthetic squads, drafts and credentials stayed outside the repository and real services.
- Suggested-plan browser checks verified the full `GW9-12` gain, a visible four-point hit, the selected week's hit-adjusted projection, week switching, chip advice and model explanation. A roll with a positive horizon gain retained current-deadline wording in Planner and Team.
- Manual checks covered captain, transfer search and selection, legal bench swap, chip selection/removal through Undo, local reload, player-card return/focus, protected suggestion/saved-draft replacement, named save, update of the same identity, save failure/retry, saved identity after reload, delete failure/retry, and the five-draft limit without lost edits.
- Incoming Ask Raptor moves waited for review; applying them retained the scenario and started a new draft. Legacy unscoped moves waited for team confirmation. Switching to a second test account did not inherit the first account's edits; signing back into the first retained its local draft. This checks application scoping, not real Supabase RLS.
- Layouts had no page overflow at 320, 390, 430, 768 and 1280 CSS pixels. Suggested/manual phone and desktop screenshots were reviewed in light/dark themes. Further cases covered stale/no suggested plan, unavailable predictions, saved-draft query failure, incomplete player rows, fixture-query failure and gameweek-query failure.

The shared scoring/simulation tests remain the mathematical regression checks. Browser fixtures establish local presentation, interaction and persistence wiring; they do not establish real Supabase account-policy behavior or installed-phone behavior. Remaining authentication checks stay tracked in `AUTH_SETUP.md`.

## Review and next phase

Open `http://localhost:3000/planner` and `http://localhost:3000/planner?mode=build` while signed in. Review the current recommendation, then try a local draft before proceeding to Phase 5: Scout and Ask Raptor.
