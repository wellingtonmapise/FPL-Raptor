# Phase 6 review — League and recaps

22 October 2026. Implemented locally; ready for visual review. Nothing committed, pushed or deployed.

## Review in the running app

Open `/league`, choose a followed league, and review these destinations:

- **Standings:** your published position, total and current gameweek points, a compact closest-rival comparison, the standings, and a latest-recap entry. The rival row expands to show the latest stored squads. The table appears beside the recap entry on desktop and below it on phones.
- **Insights:** stored-gameweek awards, captain choices, chips, template ownership, your differentials and threats. Player names open the existing player card. The page names the snapshot gameweek separately from the current standings.
- **Recap:** the existing illustrated story, full roast text, per-card reactions, picture sharing/downloads and a text-copy fallback. Original seeded raptors, stickers and award facts remain.

The selector retains Insights or Recap when switching leagues. All your leagues also retains that view. Opening a recap through the compact entry and switching tabs uses the URL without refetching the whole page. Once opened, the story stays mounted so its position and reaction state survive tab changes. A different league, account or recap gameweek receives a fresh story identity.

Existing `/league/ID#recap` notification links still open the story after hydration. Explicit `?view=recap` links also retain their destination through login. A single followed league redirects directly to it, keeping the requested view.

## Data and failure behavior

Standings remain the latest published FPL standings; the Live link leads to provisional scoring. Stored squad comparisons and insights carry their own gameweek label. Missing ranks, totals and scores stay unavailable rather than becoming invented zeros.

A complete squad needs 15 distinct players and valid distinct squad positions. Ownership and captain counts wait for complete squads and player details. Rival comparisons need both squads. Weekly awards need all manager scores and transfer costs; captain awards additionally need complete captain points. These presentation gates avoid false winners and zero ownership caused by missing data. Existing calculations in `lib/league.ts` and `lib/recap.ts` are unchanged.

No followed leagues, no stored squads, pending recaps, unavailable recaps, unavailable reactions and failed page loads have separate explanations or recovery actions. Text-only recaps from the older schema remain supported.

Reaction writes still use the existing server action and database policies. One pending reaction disables reaction controls to prevent overlapping optimistic updates. A rejected or failed write restores the prior count and selection, then explains how to retry.

PNG exports keep the league/gameweek credit beneath the caption, including long league names. File sharing falls back to a picture download where native file sharing is unavailable. Rejected sharing and image-rendering failures expose download/text alternatives. Clipboard failures expose selectable text. Shared text includes the league, gameweek and card identity. The card reader uses a bounded width, readable long-name wrapping, keyboard navigation, reduced-motion support and explicit card position.

## Verification

- `npm run lint`: passed.
- `npm test`: **204 tests passed across 20 files**. Five new tests cover view validation, league-switch URLs, complete-squad eligibility, duplicate/invalid positions and published-rank ordering.
- `npm run build -- --webpack`: production build passed, including TypeScript and page generation. The default Turbopack build retains the previously recorded local worker/socket permission limitation; this is not a claim that default Turbopack passed.
- A native headless Chrome harness exercised the built application, real Supabase SDK, cookie session and reaction server action against disposable local HTTP stand-ins. It did not write to the real database or send a real share message.
- Browser checks covered 320/390/430/768/1280 widths and light/dark themes; standings, rival expansion, player-card return, view retention through league selection, story position retention, long names, page/card overflow, legacy notification links and explicit recap login redirects.
- Reaction checks covered save/change/remove, failure rollback, retry, correct league/card/gameweek/user payloads, a second league and a new recap gameweek.
- A real PNG was rendered and downloaded, its file signature checked, and the exported picture inspected. Native-share dispatch and clipboard success/denial were simulated so tests did not open a real share sheet or change the system clipboard. Image-rendering failure and manual text-copy recovery were exercised.
- Missing squads, partial squads, missing captain points, pending recap, older text-only recap, unavailable reactions, unavailable recap, no followed leagues, one-league redirect and page error/retry were checked.

Temporary synthetic fixtures and screenshots are outside the repo, most recently in `/private/tmp/fpl-raptor-league-WisXGE`. Phone/desktop layouts, both themes and the exported card were inspected. An earlier browser run exposed a navigation timing issue in the harness; the final run uses the actual card controls and passed.

The normal build configuration is restored after fixture testing. `.env.local`, dependencies, migrations, jobs, optimizer, league calculations, recap calculations and the reaction server action are unchanged. The pre-existing `package-lock.json` edit is preserved. Development remains on port 3000.

## Remaining review

Physical iPhone Safari, native share-sheet behavior, installed-PWA safe areas and real database policy edge cases are not established by these local stand-ins. The earlier physical phone/PWA check remains deferred by the user. User visual review of this milestone is still pending.

Next: Phase 7 — supporting screens, final feature inventory, responsive consistency and release review.
