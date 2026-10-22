# Google sign-in and team linking

Google sign-in is optional and disabled by default. Email/password access continues to work. Configure the provider before setting `GOOGLE_AUTH_ENABLED=true`.

## 1. Google Cloud and Supabase

1. In Google Cloud / Google Auth Platform, create or select the project's OAuth application. Set the app name to FPL Raptor and configure its support email, audience, branding, and the basic identity/email/profile scopes. If the audience is in testing mode, add the accounts that will test sign-in.
2. Create a **Web application** OAuth client. If Google asks for authorized JavaScript origins, use the exact app origins: `http://localhost:3000` for development and the real HTTPS production origin.
3. In Supabase → Authentication → Sign In / Providers → Google, copy the callback URL shown by the dashboard. Add that exact URL to Google's **Authorized redirect URIs**. For hosted Supabase it normally looks like `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Copy the OAuth client ID and secret into the Google provider configuration in Supabase and enable it. Keep the secret there; it is not an app environment variable and must not go in git or chat.
5. In Supabase → Authentication → URL Configuration, set the production Site URL and allow the app callbacks: `http://localhost:3000/auth/callback` and `https://<production-host>/auth/callback`. Callbacks carry `next` and sometimes SDK flow parameters. Confirm Supabase accepts those query-bearing callbacks; if a pattern is required, scope it to the exact callback path, for example `http://localhost:3000/auth/callback?**`. Do not allow arbitrary production domains or paths. Add explicit preview callbacks only if previews need authentication.
6. Enable **manual identity linking** in the project's Auth settings to support Account → Connect Google for people whose Google email differs from their existing Raptor email. The dashboard location can vary; Supabase documents this under Identity Linking configuration. If linking is disabled or the identity belongs to another user, the app retains the current sign-in method and shows an error.

There are two callbacks: Google returns to Supabase's `/auth/v1/callback`; Supabase then returns to Raptor's `/auth/callback`. Swapping these URLs is a common setup error.

## 2. App settings

Create an ignored `.env.local` from `.env.example`. Supply the existing Supabase project URL and publishable key, then set:

```dotenv
GOOGLE_AUTH_ENABLED=true
APP_URL=http://localhost:3000
```

In Vercel use the production HTTPS origin as `APP_URL`, enable the same flag, and redeploy. `APP_URL` must be an origin without a path, query, credentials, or fragment. HTTPS is required except for localhost/loopback development. These two settings are read on the server. An invalid origin or a disabled flag leaves email sign-in available and hides the Google entry action.

## 3. Existing users

Supabase handles provider identities. The app continues to use the Supabase user UUID for profiles, drafts, and notification preferences. It does not replace that UUID with Google's ID or merge accounts based on names.

- With the same email, verify Supabase's automatic identity-linking behavior against the actual project's account/verification settings before rollout.
- With a different Google email, first sign in using the existing email/password, open **Team → Account → Connect Google**, and complete Google's flow. This links Google to the signed-in account.
- If a person already created a second Raptor account, do not move its team or merge records automatically. Sign into the original account and resolve identity ownership before retrying.

## 4. Finding an FPL team

Google supplies an identity and optional display name, not an FPL entry ID. Onboarding uses the name as an editable search hint in the existing followed-league data. Results are bounded and deduplicated by team ID; the person selects a team and confirms it before the profile is saved.

People outside followed leagues can still paste their FPL Points page address or a numeric ID. Both paths validate through the existing FPL client. When FPL is unavailable, linking returns a retry message and leaves the existing profile untouched. A newly linked squad can load through the existing direct FPL fallback; predictions/plans still depend on the scheduled jobs.

Team selection is a confirmation of a public FPL team, not proof of ownership of that FPL account. Google authentication does not change that distinction.

## Before committing / enabling production Google sign-in

- [ ] Run `npm run lint && npm test && npm run build`. Record existing/environment failures separately. `npm run build -- --webpack` is a supported alternative for validating a production bundle when the local environment blocks Turbopack workers; it does not establish that the default build passed.
- [x] Real Google login on localhost: user confirmed success on 21 October 2026. Server logs show the OAuth callback returning to `/me` successfully, followed by `/live`, both HTTP 200. This confirms the basic provider/callback/session path; additional scenarios are tracked separately below.
- [ ] New Google user: complete the real Google consent/PKCE callback, see candidate teams, confirm one, and arrive at Team without typing an ID.
- [x] Returning user: on 21 October 2026 the user confirmed signing out and back in with Google returns to the same team without another ID prompt, and confirmed the requested saved-draft/notification-preference check. This records the user-facing retention check; explicit UUID/identity-linking and cross-account access checks remain separate below.
- [x] Team finder with an existing account: on 21 October 2026 the user confirmed searching for their manager/team, selecting their current team, confirming it, and returning to the same Team page. This verifies real-data discovery and confirmation without claiming that a fresh-account flow has been tested.
- [x] No-match and Points-link fallback: on 21 October 2026 the user confirmed searching for a nonmatching name, seeing the no-matches path, pasting their current team's Points-page URL, and returning to the same Team page. A real team outside followed leagues has not separately been tested.
- [ ] Existing email user with the same Google email: verify the user UUID, team, drafts, and notification preferences are retained.
- [ ] Different Google email: connect from the authenticated Account page, then sign out and sign in with Google. Verify the original UUID and saved data remain.
- [ ] Cancel consent, retry a used/expired callback, and attempt a duplicate team link. Confirm clear errors and no unintended profile overwrite.
- [ ] Search an ambiguous name, a nonmatching name, and a team outside followed leagues. Check confirmation details and the Points-link fallback.
- [ ] Preserve an intended destination such as Planner through login and first-time team linking.
- [ ] Review the phone layout, keyboard, dark mode, long team names, and keyboard navigation. Confirm candidate selection requires an explicit confirmation.
- [ ] Test return from Google in Safari/Chrome and an installed PWA. A desktop/local stand-in cannot establish that mobile provider behavior works.
- [ ] Confirm production callbacks/allowed URLs and perform a real production-origin smoke test with an authorized test account before general rollout.

Local unit tests use mocks and cannot verify Google Cloud configuration, actual Supabase account linking/RLS, real provider cookie persistence, or installed-phone behavior. Keep unverified items open in the refactor plan. No automatic commit or push is authorized. On 21 October 2026 the user deferred the physical iPhone/PWA check and requested that Phase 2 proceed; this is not a mobile-provider test pass.

## Local verification record — 20 October 2026

| Check | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npm test` | Passed: 170 tests in 14 files, including auth/discovery regressions and the existing 112-test baseline. |
| `npm run build -- --webpack` | Passed: production compilation, TypeScript, and page generation. |
| Default `npm run build` | Turbopack was blocked by a local worker socket/port permission error, including an escalated retry. It is not recorded as passing. |
| Chrome smoke against the built app | Passed with disposable local HTTP stand-ins for Supabase/Auth/FPL. Used the actual installed Supabase SDK, browser cookies, and a checked PKCE challenge/verifier exchange. |
| Browser paths reviewed | New Google user → name suggestions → explicit confirmation → Team; returning user skips linking; email login retains its destination; Connect Google preserves the original UUID/team; missing team/FPL outage/duplicate-team errors; provider cancellation. |
| Layout checks | Login and discovery screenshots inspected; light/dark discovery and no horizontal page overflow at 320, 390, and 1280 CSS pixels. These are browser emulations, not installed-phone tests. |

The browser run found a callback-origin problem: Next supplied `localhost` as the internal request origin while the app/cookie origin was `127.0.0.1`. The callback now uses the configured canonical origin, and a regression test covers that distinction.

The local stand-ins live outside the repo and never become production fallbacks. They establish local wiring and cookie behavior, not actual provider configuration, Supabase identity-linking/RLS behavior, or real FPL availability. Real-provider and installed-phone checklist items above remain open. No commit or push has been made.

Setup progress — 21 October 2026: the user reports that the Google client/provider setup, replacement of the shared secret, and test-user configuration are complete. The publishable key is stored in the ignored `.env.local`; no Google client secret is stored in the repository. The real Supabase auth settings endpoint returned HTTP 200 with Google and email sign-in enabled. The local `/login` returned HTTP 200 with both sign-in options present. The user confirmed real Google login, sign-out/relogin and existing-team/saved-data retention, team search and confirmation, and the no-match/Points-link fallback using their existing team. Logs corroborate the initial callback reaching `/me` and a subsequent `/live` request. Local callback allowlisting worked for these flows. Fresh-account onboarding, a team outside followed leagues, manual identity-linking configuration and UUID preservation, cross-account access, and phone checks remain unverified against real services. No commit or push has been made.

References: [Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), and [Google identity claims](https://developers.google.com/identity/openid-connect/reference).
