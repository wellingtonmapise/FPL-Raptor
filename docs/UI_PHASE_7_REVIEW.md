# Phase 7 review — supporting screens and release review

22 October 2026. Implemented locally; the user approved the completed UI review with “lgtm” and requested a local commit after validation. Deployment remains pending.

## What changed

The welcome page, Google/email sign-in, team discovery, Account, Notifications and install help now use the shared spacing, type, controls, surfaces and theme colors. Form fields use 16px text and comfortable heights. Account keeps sign-in options, changing teams, notifications, installation and sign-out together.

The public welcome page stays static and cacheable, using only the public Supabase client. It leads with opening your team and the next deadline, followed by short descriptions of the main tasks. Missing deadlines have an availability message. Raw database errors, job details and infrastructure setup instructions are no longer product content; setup remains in the documentation.

Google remains separate from FPL team discovery. A candidate still needs explicit selection and confirmation. Existing email access, requested destinations, validation and the Points-link/ID fallback remain. Google does not provide an FPL entry ID.

Notifications now distinguish permission, browser registration and a registration saved to the signed-in account. A browser subscription alone cannot make the account appear subscribed. Device and preference queries explicitly filter by the authenticated user, in addition to existing RLS.

Preference writes show pending/success/error feedback and roll back on failure. Turning notifications on reuses an existing browser registration; a failed server save leaves a retry path. Turning them off removes the account's saved endpoint before unsubscribing locally, so a rejected deletion cannot silently disable the working browser registration. If local removal fails after the server deletion, the page explains that account alerts are off and asks for a device recheck. Other devices remain registered. Account conflicts explain how to return to the original account.

Device checks have a timeout and retry, and recheck permission on focus/visibility changes. Failed settings reads remain unavailable rather than becoming false defaults. A test notification reports a request to the push service rather than claiming that the device displayed it. Owner-facing messages omit private configuration names and database errors.

Install help is shared by the welcome and Account screens. Notification setup distinguishes an iPhone/iPad browser from a supported installed app. Manifest, service-worker registration and notification click handling retain their existing roles. Remaining neutral legacy colors use shared theme tokens, fixture labels use explicit home/away text, and an unused animation was removed.

## Final feature inventory

| Existing capability | Reachable location |
| --- | --- |
| Welcome, deadline and update freshness | `/`; deadline details on Team |
| Google sign-in and existing email/password access | `/login`; email expands beneath Google |
| Candidate discovery, selection and confirmation | `/onboarding`; editable search of tracked leagues |
| Points-page link or numeric entry ID | Onboarding fallback; Change team in Account |
| Returning account and requested destination | Cookie session, saved profile and validated login/callback destination |
| Connect Google to an existing account | `/account`, Sign-in options |
| Team identity, bank, free transfers and deadline | `/me`, compact header and deadline panel |
| Availability flags and full player news | Team attention summary; expanded flags and player cards |
| Complete squad, bench, captain and pitch/list choice | Team squad; shared pitch/list controls |
| Captain/transfer outlook and previous results | Team outlook and View results |
| Player facts, history, fixtures and model estimates | Player names/shirts open the shared player card |
| Live points, remaining players and league movement | `/live`, first summary |
| Live squads, substitutions, bonus, impacts and rival | Your players; impact details and rival comparison |
| Live standings and current matches | Live's Standings and Matches views |
| Freshness and refresh | Live update time/Refresh; existing visibility-aware refresh cadence |
| Suggested transfers/roll, hits and full-horizon comparison | `/planner`, Suggested plan summary and Compare totals |
| Suggested weeks, squads, benches and captains | Planner week selector |
| Chip advice, model/method and backtest explanation | Chip comparison and How this plan is made |
| Manual transfer, captain, bench swap and chip | Build your own; selected-player actions and gameweek chip control |
| Undo, starting squad, suggestion replay and comparisons | Draft controls, More and horizon summary |
| Named saved drafts, update/new/delete and projection previews | Build your own Save and Saved drafts |
| Device draft restoration and Ask Raptor scenario import | Account/team/gameweek-scoped storage; explicit import/replacement review |
| Player/club search, position, metric, period and minutes filters | `/scout`, Players and expanded stats-period controls |
| Detailed statistics and existing deep links | Players' Detailed table; `?view=stats` |
| Fixture difficulty, home/away, blanks and doubles | Scout Fixtures; table scroll stays within its region |
| League-specific and overall differential discovery | Scout Differentials |
| Grounded chat, streamed progress, history and retry | Scout Ask Raptor |
| Chat scenarios and Planner handoff | Scenario card, then review in Build your own |
| League selection, rank, rival and published standings | `/league` → selected league's Standings |
| Stored-gameweek awards, captains, chips and ownership | League Insights |
| Illustrated cards, original raptors/stickers and write-up | League Recap; compact entry from Standings |
| Reactions, image/text sharing and download/copy fallbacks | Recap card controls |
| Existing recap notification links | `/league/ID#recap` and explicit Recap view links |
| Alert preferences, device registration and test control | Account → Notifications |
| Installation, changing teams and sign-out | Account; installation also on welcome |
| Loading/error/partial/empty states and missing-value labels | Relevant page/view; phase reviews document scenario coverage |

The earlier detailed reviews remain the evidence for each phase's interactions and failure cases: [Team](UI_PHASE_2_REVIEW.md), [Live](UI_PHASE_3_REVIEW.md), [Planner](UI_PHASE_4_REVIEW.md), [Scout/chat](UI_PHASE_5_REVIEW.md) and [League/recaps](UI_PHASE_6_REVIEW.md).

## Verification

- `npm run lint`: passed.
- `npm test`: **210 tests passed across 21 files**. Six new notification tests cover defaults, saved choices, permission/registration/account status and iPhone/iPad/install capability detection.
- `npm run build -- --webpack`: passed production compilation, TypeScript and page generation using the normal environment. The public welcome page remains static with five-minute revalidation. Default Turbopack retains the previously recorded worker/socket permission failure; the Webpack result does not establish that Turbopack passed.
- Local browser checks passed Google cancellation, friendly email errors, signup confirmation feedback, fresh candidate onboarding, deduplication across leagues, requested-destination return, failed Points-link validation without changing the profile, valid linking and Account destinations.
- Notification checks passed preference rollback/save, denied/dismissed permission, failed registration save and retry using the existing browser subscription, failed server removal, local-unsubscribe failure after server removal, successful removal while retaining another device, unavailable settings/reload, worker timeout/retry, emulated iPhone install states and account isolation/conflict feedback. Push APIs and ownership policy responses were stand-ins; no real delivery or database-policy claim follows from these checks.
- All five main screens and supporting forms were checked for page overflow at 320/390/430/768/1280 CSS pixels. Main screens were also checked at 844×390 landscape and 640×422 reduced dimensions. These resized layouts approximate limited space; they do not establish real browser 200% zoom or a physical keyboard as passed.
- Phone/desktop and light/dark screenshots were inspected. The focused native Chrome keyboard run received real key events and closed the player card with Escape. Scout search survived player-card closure. The earlier phase reviews cover sheet focus containment/return and the more detailed Planner, table, refresh and chat interactions.
- Manifest start URL/standalone mode, icon responses, the viewport safe-area directive, service-worker response headers and notification-click handler were checked. The original worker and registration component are unchanged. Sign-out and a signed-out notification link retained the login destination.
- `git diff --check`: passed. Only the existing development server remains on port 3000; disposable test ports 3100/3101 are closed.

Browser tests use the actual built app, Supabase SDK, cookies and server actions against disposable local HTTP stand-ins. Push permission and registration are simulated. The test process has no private VAPID key and sends no real notifications. Synthetic accounts, fixtures and screenshots stay outside the repository.

Screenshots inspected during this review are in `/private/tmp/fpl-raptor-release-WtqlVY`. The final main-flow/layout batch is in `/private/tmp/fpl-raptor-release-pCkykh`; focused keyboard and final supporting-screen checks are in `/private/tmp/fpl-raptor-release-b61HCS` and `/private/tmp/fpl-raptor-release-o7hZOq`. The long test's UA/mobile-emulation sequence dropped CDP keyboard events before they reached the page, so keyboard behavior was verified in a separate unmodified Chrome input session. Early harness runs also needed navigation timing and the existing-account onboarding label corrected. These were test-harness corrections; application keyboard/auth behavior was not changed to satisfy them.

The normal production build was restored after fixture testing. `.env.local` is unchanged, and no synthetic account data was added to the repository.

## Remaining real-device/service review

These checks remain separate from the local fixtures and are not marked as passed:

- Physical iPhone Safari and installed-PWA safe areas, theme/status bar, landscape and on-screen keyboard. The user previously deferred this check; the refactor proceeded on that basis.
- Real push permission, test delivery and notification-tap navigation on an installed phone; confirm the existing device registration survives an app update and disabling this device leaves another device working.
- Real native recap share sheet, file delivery and clipboard behavior. Local image rendering/download and simulated fallback checks are recorded in Phase 6.
- Fresh-account Google onboarding, explicit existing-account identity linking with UUID/data retention, cross-account/RLS edge cases and production redirect configuration. The user's successful real login/returning-account/team-link tests remain recorded in [AUTH_SETUP.md](AUTH_SETUP.md); local fixtures do not establish the remaining provider cases.

## Review locally

Use the development app on `http://localhost:3000`. Review `/`, `/account`, `/notifications`, and `/onboarding` in both themes. Sign out to inspect `/login`, then return through Google. Review the five main tabs with the same account. Actual notification enable/disable/test actions affect that account and device, so leave the delivery check for the intended test device.

No dependencies, migrations, jobs, optimizer, model or domain calculation modules changed in this phase. The pre-existing `package-lock.json` edit is preserved.
