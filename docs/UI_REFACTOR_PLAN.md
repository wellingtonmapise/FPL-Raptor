# FPL Raptor UI refactor plan

Created: 20 October 2026. Updated: 22 October 2026. Status: the user approved the Phase 2 Team design and requested the subsequent phases. Live, Planner, Scout/chat, League/recaps and the Phase 7 supporting screens are implemented and locally verified. The final feature inventory and local release review are recorded in `UI_PHASE_7_REVIEW.md`. Google login, returning-user retention, team search/confirmation, and the Points-link fallback were verified by the user. Remaining real-provider edge cases stay open; the user deferred the physical iPhone/PWA check and asked to continue with the UI refactor. The user approved the completed UI and requested a local commit on 22 October. Deployment remains pending.

## Outcome

Make Raptor easier to scan and comfortable to use as an installed phone app. Give each screen a clear purpose, reveal detail when requested, and use consistent navigation and interactions. Keep the football personality in the pitch, raptor illustrations, recaps, and writing.

This is a refactor of the existing Next.js web app and PWA. The scope includes Google sign-in and easier team linking, followed by presentation, information architecture, accessibility, and interaction behavior. Sign-in and finding a team are reported pain points, so address them before the main visual refactor. Keep the existing FPL calculations, prediction model, optimizer, database access rules, jobs, and feature set. No database migration or new UI framework is expected; provider configuration in Google Cloud and Supabase is required for Google sign-in.

## How to follow this plan

- Work through the phases in order, with a separate reviewable change for each phase. Split a phase further when its scope makes review difficult.
- The first milestone is phases 0 and 1: Google sign-in, easier team linking, and returning users going straight to their linked team.
- At each phase, record the files changed, checks run, screenshots reviewed, and remaining issues in the progress log below.
- Phase 2 establishes the visual standard with Team and the shared shell. Review that milestone visually before carrying its styling through the remaining screens. This is a design checkpoint using the running app.
- Keep unfinished phases usable with the shared shell. Avoid a large switch that requires every screen to be finished together.

## Design decisions

| Area | Direction |
| --- | --- |
| Joining | Lead with Continue with Google, preserve email/password access, and help new users find and confirm their FPL team. Returning users skip team linking when their profile is complete. |
| Primary navigation | Keep Team, Live, Planner, Scout, and League in a stable order. Keep their existing URLs and deep links. |
| Screen hierarchy | One dominant task and one leading action in each view. Secondary actions remain clearly discoverable. |
| Surfaces | Group related content with spacing, headings, and dividers. Use enclosing cards for content that needs emphasis or separation. |
| Typography | Define a small shared scale for page titles, section titles, body text, labels, and scores. Use aligned tabular numbers for comparisons. |
| Color | Keep emerald as the brand/action color. Define consistent warning, injury, positive, negative, and neutral treatments in both themes. Pair status colors with text or icons. |
| Personality | Preserve original shirts and raptor art. Let recaps and chat carry more expression; keep data and controls restrained. |
| Detail | Put calculation explanations and advanced metrics behind labeled controls. Keep decision-critical context visible beside the number or action. |
| Phone interactions | Comfortable touch targets, consistent sheets, keyboard-safe forms, immediate action feedback, and preserved context after closing details. |
| Wider screens | Use available width for related content side by side. Keep text readable and preserve a sensible reading order. |
| Motion | Short transitions that clarify a change. Respect reduced-motion preferences. |

Reference principles: Apple's [layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout), [tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), and [sheets](https://developer.apple.com/design/human-interface-guidelines/sheets). Adapt these principles to the web app's existing routes and behavior.

## Screen map

| Screen | Default content | Secondary content and entry point |
| --- | --- | --- |
| Sign-in and onboarding | Continue with Google, then existing team or suggested matches with confirmation | Email/password access, editable team search within tracked leagues, Points-link or numeric-ID fallback |
| Team | Compact deadline and squad summary, availability attention, pitch, one recommendation summary | Previous gameweek results in a labeled section; methodology through an explanation control; account actions in a clearly labeled account menu |
| Live | Current score, players remaining, league movement, your players | Labeled views for league standings and matches; ownership and rival detail from an impact summary |
| Planner | This week's proposed moves, hit cost, expected benefit with its gameweek range, selected week's pitch | Week selector; chip comparison and reasoning controls; existing Build your own mode |
| Scout | Player discovery with search, compact rows, position filter, and a sort control | Fixtures, Differentials, and Ask Raptor remain labeled views; advanced metrics in player detail or an explicit expanded table |
| League | League selector, standings, closest-rival summary, latest recap entry | Recap opens the story; a labeled Insights view groups ownership, captains, and awards |

Existing Scout URLs must still open the requested view. A clean visit can default to player discovery; a return visit should preserve the person's selected view where practical. Do not change the selected top-level tab automatically as match or gameweek status changes.

## Phase 0 — Establish the baseline

Primary files: `package.json`, `package-lock.json`, `AGENTS.md`, existing pages and `lib/*.test.ts`.

- [x] Check the working tree and preserve existing edits. The pre-existing `package-lock.json` edit was preserved.
- [x] Install dependencies using the current lockfile and read the installed Next.js authentication, server-action, route-handler, redirect, cookie, and revalidation guides before implementation.
- [x] Record the baseline checks: lint and 112 tests passed. The default Turbopack build encountered an environment worker/port error. The implemented change subsequently passed a production Webpack build with TypeScript checking; see `AUTH_SETUP.md` for verification details.
- [x] Arrange development access to representative signed-in data. The user has linked their real team. Disposable HTTP stand-ins outside the repo also cover representative squads, flags, predictions, and failure states; production behavior never falls back to those fixtures.
- [ ] Capture sign-in, onboarding, and the current five main screens on phone and desktop. Include long names, flagged players, and populated leagues. Keep private account data out of committed artifacts. Original pre-refactor captures were not completed; final synthetic screen captures and reviews are recorded per phase and in `UI_PHASE_7_REVIEW.md`.
- [ ] Check whether team linking is requested repeatedly for existing users. The current profile stores the team ID already; distinguish first-time discovery friction from session, account-identity, or profile-persistence failures.
- [x] Map current features to their proposed locations so nothing disappears during simplification. The final feature-to-destination inventory is in `UI_PHASE_7_REVIEW.md`, with detailed interaction inventories in the earlier reviews.

Done when: the app can be reviewed with useful data, baseline check results are recorded, and each existing feature has a destination.

## Phase 1 — Google sign-in and easier team linking

Primary files: `app/login/page.tsx`, `app/login/LoginForm.tsx`, `app/login/actions.ts`, a new `app/auth/callback/route.ts`, `app/onboarding/`, `lib/supabase/server.ts`, `lib/supabase/proxy.ts`, `lib/teamId.ts`, and `README.md`. Read the existing `profiles` and `league_members` schema and policies before implementation.

### Identity constraint

Google supplies a Google account identifier and, with the appropriate scopes, email/profile information. It does not supply an FPL team ID. Keep three identities distinct: Google's provider identity, the Supabase user UUID used by Raptor, and the FPL entry ID saved in `profiles.fpl_team_id`. Keep Supabase responsible for authenticating the user and linking provider identities.

The current database has manager names, team names, and entry IDs for followed leagues. That supports candidate suggestions for those leagues, not global FPL discovery or verified ownership. Google display names may differ from FPL names, and names are not unique. Never silently attach a team based on a name match. No supported Google-to-FPL account mapping was established while preparing this plan; automatic universal team detection is not a delivery promise.

### Joining flow

1. Continue with Google and complete the Supabase session callback.
2. If the signed-in user's existing profile has an FPL team, open their requested destination without asking for the ID again.
3. Otherwise, offer candidate teams from tracked leagues using the Google display name when available. Allow the name/team query to be edited and clearly label the search's limited coverage.
4. Show manager name, team name, and league context, then ask the person to select and confirm their team. Store the underlying entry ID without asking them to type it.
5. If there is no match or Google supplies no useful name, offer the existing Points-page-link or numeric-ID method with a direct link and clear mobile instructions. Keep this fallback visible from the discovery view.
6. Save against the authenticated Supabase user, open Team, and reuse that link on later sign-ins. Keep Change team available from the account menu.

### Implementation checklist

- [x] Make Continue with Google the main entry action when configured, keeping existing email/password access available. Google remains disabled by default until provider setup is ready.
- [x] Configure a Google web OAuth client, app consent branding, and the Google provider in Supabase. Request basic identity/email/profile scopes only. Store the OAuth client secret in provider configuration, outside app/browser code. The user completed provider setup and verified real Google login on 21 October; remaining production/mobile and identity-linking cases are tracked separately.
- [x] Document the separate Google-to-Supabase and Supabase-to-Raptor callbacks, scoped redirect configuration, and canonical app origin in `AUTH_SETUP.md`.
- [x] Implement the SSR PKCE callback and cookie session using the existing session-aware client. Preserve validated destinations and handle cancellation/errors. A browser test caught and verified the fix for an internal-hostname callback redirect that lost the session cookie.
- [ ] Keep the Supabase user UUID and existing profile as the account key. Test the project's existing-user identity-linking behavior against Supabase's documented rules so the Google path preserves drafts, team links, and notification preferences.
- [ ] Handle users whose Google email differs from their existing Raptor email through a deliberate authenticated account-linking flow where configured. Do not merge records by display name, or reassign a team already attached to another account. Give duplicate-team conflicts a clear route back to the original account.
- [x] Query bounded candidate results from `league_members`, deduplicate teams across leagues, and prefill an editable name hint from metadata. Ambiguous/no-match results and the existing signed-in access boundary are preserved.
- [x] Require explicit team selection and confirmation; validate through the existing FPL client, retain duplicate-team handling, and leave the existing profile untouched if FPL is unavailable. Selection is confirmation, not proof of FPL account ownership.
- [x] Improve the paste-link fallback, mobile keyboard hint, and instructions for teams outside followed leagues.
- [x] Retain the existing direct FPL squad fallback and scheduled prediction/plan behavior. The local browser test reaches Team immediately after linking with a stand-in FPL response.
- [x] Add focused auth/discovery/persistence checks. All 170 tests pass, including existing tests. New/returning Google flows and existing-email-to-Google linking also pass against local HTTP stand-ins using the real SDK in Chrome. Real provider tests remain separate below.
- [ ] Document provider setup and verify the real OAuth round trip in development and production configuration. Test ordinary mobile browsers and an installed PWA, including cancellation and return from the provider. Record steps and failure points during the review of first-time team linking.

Done when: a Google user whose team is in a tracked league can reach Team by signing in and selecting/confirming a candidate, without typing an ID. Users outside that coverage have a clear fallback. Returning users are not asked to link again, existing accounts retain their data, and real provider callback/session tests pass. The UI must not claim universal automatic FPL team detection.

External setup needed for the real OAuth test: access to the project's Google Cloud OAuth client and Supabase Auth provider/redirect settings. Prepare the code, callback, tests, and exact configuration instructions before requesting any missing setup. Keep credentials out of chat and git. Local mocked checks do not replace the real provider test.

Sources: [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), and [Google's identity claims](https://developers.google.com/identity/openid-connect/reference). Team-discovery coverage follows this repository's current `league_members` data and policies.

## Phase 2 — Shared foundations and Team

Primary files: `app/globals.css`, `app/layout.tsx`, `app/manifest.ts`, `components/SiteHeader.tsx`, `components/NavTabs.tsx`, `components/Sheet.tsx`, `components/PlayerSheet.tsx`, `components/ViewToggle.tsx`, `components/Pitch.tsx`, `app/me/page.tsx`.

- [x] Establish shared spacing, type, surface, color, radius, focus, and motion values. Extract small reusable controls as patterns recur; keep page-specific composition near its page.
- [x] Refine the app shell: stable mobile bottom tabs, clear active states, usable desktop navigation, safe-area spacing, and a labeled account entry for notifications, change team, and sign out.
- [x] Give Team this reading order: compact team/gameweek/deadline header; bank and free transfers when known; availability summary when relevant; pitch and bench; one recommendation summary; previous results.
- [x] Keep current captain and suggested captain clearly distinguished. Keep the squad's last-deadline context visible. Link recommendations to the full Planner explanation.
- [x] Show compact availability warnings before the pitch and open detailed news on request. Make multiple affected players discoverable without a long list above the squad.
- [x] Reuse a single dialog/sheet foundation for player details and planner flows. Include accessible labels, contained keyboard focus, focus return, scroll locking, consistent dismissal, loading/error content, and protection against overlapping dialogs.
- [x] Audit planner actions that open player details from another sheet. Use an explicit transition between them and preserve the planner's selection and scroll position on return.
- [x] Add appropriate Team loading, empty, partial-data, and failure states. Show unavailable values as unavailable, never as a fabricated zero.
- [x] Keep pitch/list preference behavior, player-card entry points, full bench access, and shirt readability in both themes.

Done when: at a 390 × 844 viewport with ordinary populated data, the compact header, attention summary if present, and start of the squad appear before secondary explanations. The complete squad and recommendation remain easy to reach. Wider screens use intentional grouping rather than a stretched phone layout. Opening and closing player details preserves context.

Implementation and local verification are recorded in `UI_PHASE_2_REVIEW.md`. The user approved the Team design on 21 October 2026. Physical iPhone/PWA verification was deferred at their request.

Checkpoint: review Team and the shell in light/dark themes, with and without flags, with missing predictions, and on phone/desktop. Adjust the shared patterns here before proceeding.

## Phase 3 — Live

Primary files: `app/live/page.tsx`, `components/AutoRefresh.tsx`, shared pitch/player components. Preserve calculations in `lib/live.ts`.

- [x] Make score, players remaining, and live league position the first readable summary.
- [x] Keep your players in the default view. Provide labeled views for the full league table and match list instead of stacking every full section.
- [x] Reduce the initial impact section to the leading changes, with a clear way to expand saving/hurting players and nearest-rival comparisons.
- [x] Label provisional bonus, projected substitutions, final scores, and update freshness clearly. Preserve automatic subs, vice-captain behavior, chips, hits, and captain multipliers.
- [x] Ensure refreshes retain the selected view, scroll, and open details. Preserve existing refresh cadence; avoid new polling for presentation changes.

Done when: a person can immediately find their score, remaining players, and league movement. Full impact detail, matches, and standings are still reachable. Refreshing data does not dismiss or reset the current task.

Implementation, feature locations, and local browser evidence are recorded in `UI_PHASE_3_REVIEW.md`. No commit or push has been made.

## Phase 4 — Planner

Primary files: `app/planner/page.tsx`, `components/PlanWeeks.tsx`, `components/DraftPlanner.tsx`, `app/planner/actions.ts`. Reuse `lib/plan.ts`, `lib/draft.ts`, and `lib/draftData.ts`.

- [x] Lead Suggested plan with the current week's move or roll recommendation, visible hit cost, and expected gain labeled with the full comparison period. Do not present a four-week gain as this week's gain.
- [x] Use a clear week selector with the selected week's pitch and transfers. Move the full chip comparison and longer reasoning behind labeled controls.
- [x] Keep Suggested plan and Build your own as distinct modes, with a persistent compact budget/free-transfer summary where useful.
- [x] Simplify Build your own actions around the selected player. Preserve transfer, captain, bench swap, chip, undo, starting-team/bot comparison, and saved-draft functionality.
- [x] Preserve unsaved work, saved draft identities, and the Ask Raptor handoff. Make save success, failure, and pending states visible; protect edits when loading another draft or plan would replace them.
- [x] Keep last-deadline squad limitations visible. Put model version, detailed methodology, and backtest history in an accessible explanation view.
- [x] Use explicit labels for saving a draft and inspecting a suggestion. Actions must not imply that Raptor has submitted changes to the official FPL game.

Done when: the current recommendation is understandable before opening comparisons. A person can complete a transfer/captain/swap/chip draft, undo it, save/reload it, and return from player details without losing work. The suggested four-week horizon and manual five-week horizon remain accurate.

Implementation, feature locations, persistence behavior, and verification are recorded in `UI_PHASE_4_REVIEW.md`. No commit or push has been made.

## Phase 5 — Scout and Ask Raptor

Primary files: `app/scout/page.tsx`, `components/AskRaptor.tsx`, shared player controls. Preserve `lib/scout.ts` and the Ask Raptor API/tool contracts.

- [x] Make player discovery the default for a clean visit, with search, position filtering, and a compact labeled sort control. Preserve existing query parameters and explicit links to Fixtures, Stats, Differentials, and Ask Raptor.
- [x] Use readable phone rows: player/club/position, price, and the selected comparison metric. Make additional statistics available through player detail or an explicit detailed-table view.
- [x] Keep the detailed statistics table useful on larger screens. Avoid requiring horizontal scrolling for basic phone discovery tasks; intentional wide tables can still scroll in their own region.
- [x] Group secondary filters, show active choices and a clear reset, and retain view/filter context after inspecting a player. Preserve season/last-six ranges and minutes eligibility rules.
- [x] Keep fixture home/away, difficulty, blank weeks, and double weeks understandable without depending on color or capitalization alone. Preserve league-specific differential criteria.
- [x] Give Ask Raptor a keyboard-safe conversation layout, compact starter questions, clear streamed status/error feedback, and an obvious way to open scenarios in Planner. Keep factual grounding, account restrictions, and request limits intact.

Done when: a person can find a player, compare the chosen metric, inspect details, and return without resetting their search. Fixtures, differentials, and chat retain their existing capabilities. Streaming and the scenario handoff work on a phone.

## Phase 6 — League and recaps

Primary files: `app/league/page.tsx`, `app/league/[id]/page.tsx`, `components/recap/RecapStory.tsx`, existing recap art and reaction actions. Preserve `lib/league.ts` and `lib/recap.ts` calculations.

- [x] Lead with a league selector, your position/rival summary, standings, and a compact latest-recap entry.
- [x] Open the full recap story from that entry. Keep raptor avatars, original art, reactions, sharing, and gameweek identity intact.
- [x] Group captains, ownership, and extended awards in a labeled Insights view. Avoid showing full awards twice in the default overview and story.
- [x] Keep manager comparisons and long league/team names readable. Ensure people in several followed leagues can switch without losing the chosen view unexpectedly.
- [x] Give no-followed-league, incomplete-squad, pending-recap, reaction-failure, and unavailable-share states clear actions or explanations.

Done when: standings and rival context are immediately accessible, the recap is clearly discoverable, and every existing insight has a labeled destination. Reaction and share flows still work with the correct league/card.

## Phase 7 — Supporting screens and release review

Primary files: `app/page.tsx`, `app/login/`, `app/onboarding/`, `app/notifications/`, shared layout and install help.

- [x] Apply the shared visual language to the public landing page, sign-in, onboarding, notifications, and install help.
- [x] Check account-menu destinations, redirect behavior, validation messages, notification permissions, and existing subscriptions. Keep signed-out paths understandable. Local SDK/server-action/browser checks passed; permission/registration and policy responses were simulated, with real delivery/RLS checks still open below.
- [ ] Verify standalone phone presentation, theme colors, safe areas, small screens, landscape, and the on-screen keyboard. Preserve the PWA manifest, service-worker registration, and notification behavior. Resized Chrome layouts, theme colors, emulated install states, manifest/assets and worker headers/source were checked; physical Safari/PWA safe areas and keyboard remain deferred.
- [x] Complete a desktop/tablet pass for all five main screens, including dense tables and planner controls. Phase-specific reviews cover the detailed controls; the final pass checked the five default screens across the representative widths and both themes.
- [x] Remove obsolete duplicate styles and components after their callers have migrated. Update README descriptions if navigation or behavior changed.
- [x] Run the final feature inventory and validation checklist below. Record any environment-dependent checks that remain unverified. See `UI_PHASE_7_REVIEW.md` for passing local checks and the remaining real-device/provider review.

Done when: the complete app feels consistent, all features have reachable homes, required checks pass or any pre-existing failures are explicitly accounted for, and the key user flows have been reviewed in a browser.

Implemented and locally verified on 22 October. Lint, 210 tests, the production Webpack build and focused browser batches passed. The user approved the completed UI review with “lgtm” on 22 October. The final inventory, verification limits and remaining real-device/provider checklist are in `UI_PHASE_7_REVIEW.md`.

## Validation for each phase

Run the existing app checks for changes to application code:

```sh
npm run lint && npm test && npm run build
```

Use existing Vitest coverage for calculations. Add focused tests when extracting or changing data shaping, filtering, or persisted-state behavior. Pure data-shaping logic belongs in `lib/`. Styling-only changes need visual review; tests that merely duplicate JSX/classes provide little value. Do not introduce an end-to-end framework as a prerequisite for this refactor. If Python jobs change for a separately justified reason, also run `cd jobs && uv run pytest`.

| Review | Acceptance |
| --- | --- |
| Phone/tablet/desktop | Review representative widths of 320, 390, 430, 768, and 1280 CSS pixels. No accidental page overflow or content hidden behind fixed controls. |
| Themes and text | Both themes have readable contrast. Longer names and 200% zoom do not hide essential actions. |
| Touch and keyboard | Aim for at least 44 × 44 CSS-pixel primary touch targets. All controls have visible keyboard focus and accessible names. Sheets contain focus, close predictably, and restore it. |
| Content hierarchy | The first screenful exposes the current context and primary task. Secondary content has a labeled entry point. |
| Data honesty | Actual versus projected points, comparison horizon, provisional scores, missing data, and last-deadline squad context stay distinguishable. |
| State | Opening details, switching supported views, browser back, live refreshes, and draft reloads preserve the appropriate context. Handle gameweek rollover and account changes without reusing the wrong squad/draft. |
| Failure/loading | Review populated, loading, empty, partial-data, stale, and failed states relevant to the phase. Skeletons broadly match the eventual content. |
| Performance | Keep data fetching and page composition on the server where appropriate; use client components for interactions. Avoid duplicate requests and new app-wide polling. |
| Access and privacy | Public pages retain the public Supabase client; signed-in pages retain session-aware access. Keep secrets server-only and account data out of public caches and committed fixtures. |
| Joining | Google round trip, existing-account data, requested destination, candidate confirmation, fallback linking, and subsequent sign-in all work. Do not treat Google identity as an FPL entry ID. |

## Risks to address during implementation

| Risk | Mitigation |
| --- | --- |
| Clutter is reduced by hiding useful features | Maintain the feature-to-destination inventory and verify each destination before finishing its phase. |
| Urgent flags or caveats become too subtle | Keep compact decision-critical information beside the squad, score, or recommendation; expand only the detailed explanation. |
| Shared-sheet changes break Planner | Exercise player-action-to-detail transitions, keyboard focus, scroll locking, and return to an unsaved draft together in phase 2. |
| A presentation change alters a calculation or API contract | Keep the domain functions and job interfaces stable; run their existing tests and isolate any necessary logic change. |
| Styles spread before the direction is settled | Finish and visually review the Team milestone before migrating the other screens. |
| Development data is unavailable | Track access as a review prerequisite, or use explicitly development-only fixtures; record checks requiring real services separately. |
| Google identity is mistaken for an FPL account link | Keep the identity fields separate, limit discovery claims to available data, require candidate confirmation, and retain the link/ID fallback. |
| A current user gets a second account when moving to Google | Verify Supabase identity linking and account settings with existing-user cases; retain email access and an authenticated linking path. |

## Progress log

| Phase | Status | Evidence / remaining work |
| --- | --- | --- |
| 0 — Baseline | Baseline recorded; historical gaps remain | Dependencies installed and required guides read; baseline lint/112 tests passed. The final feature inventory is complete. Original pre-refactor screenshots were not fully captured, and the original repeated-linking report was not independently reproduced; the user subsequently verified returning-account retention. |
| 1 — Google sign-in + team linking | In progress | Lint, 170 tests, production Webpack build, and Chrome/SDK/PKCE smoke passed locally. On 21 October the user confirmed real Google login, sign-out/relogin and saved-data retention, real team search/confirmation, and the no-match/Points-link fallback on their existing account. Logs corroborate the initial callback reaching Team. Fresh-account onboarding, explicit identity-linking/UUID and cross-account/RLS checks remain unverified. Physical iPhone/PWA verification was deferred by the user so UI work could continue. See `AUTH_SETUP.md`. |
| 2 — Foundations + Team | Design approved | Shared tokens/navigation, compact Team context and warnings, pitch/list, grouped recommendations/results, loading/error/partial states, and one sheet foundation. Local browser checks cover both themes, representative widths, keyboard/scroll return, and an unsaved planner draft. See `UI_PHASE_2_REVIEW.md`. The user approved the Team design on 21 October 2026. |
| 3 — Live | Implemented; next phase requested | Score-first summary; Your players, Standings, and Matches views; compact impact with full detail; partial-data/rank safeguards; unchanged scoring engine and refresh cadence. Lint, 175 tests, production Webpack build, and local Chrome checks passed. See `UI_PHASE_3_REVIEW.md`. |
| 4 — Planner | Implemented; next phase requested | Weekly moves and hit costs first, explicit horizon totals, shared week controls, expandable chip/method detail, simpler manual drafting, scoped local persistence, protected draft/scenario replacement, named save/update/delete and recovery states. Lint, 185 tests, production Webpack build, and local browser checks passed. See `UI_PHASE_4_REVIEW.md`. |
| 5 — Scout + Ask Raptor | Implemented; next phase requested | Search-first discovery, compact comparison rows, detailed table, explicit fixture labels, scoped chat history, streamed status/retry, and Planner scenario review. Lint, 199 tests, production Webpack build, and local Chrome checks passed. See `UI_PHASE_5_REVIEW.md`; physical iPhone/PWA keyboard verification remains deferred. |
| 6 — League | Implemented; next phase requested | Standings-first overview, league/view retention, stored-gameweek insights, compact recap entry, preserved notification links, reaction rollback, and picture/text sharing fallbacks. Lint, 204 tests, production Webpack build, and local Chrome checks passed. See `UI_PHASE_6_REVIEW.md`; native iPhone/PWA/share-sheet behavior remains unverified. |
| 7 — Supporting screens + release review | Implemented; visual review approved | Consistent welcome/auth/onboarding/account/install screens, reliable notification status and failure recovery, completed feature inventory and responsive review. Lint, 210 tests, production Webpack build and local browser batches passed. The user approved the UI and requested a local commit on 22 October. See `UI_PHASE_7_REVIEW.md`; real iPhone/PWA, native push/share and provider/RLS edge cases remain open. Deployment remains pending. |
