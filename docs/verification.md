# Verification

Updated locally on 12 November 2026 for the compact photo workspace and public farewell wall.

The final NVIDIA-inspired PCB background/logo theme, interactive views and clean message wall have completed local verification.

## Current automated checks

- Final `npm run check`: **54 passing tests, zero failures**, followed by successful TypeScript checking and the Vite production build, with no warnings. Coverage includes photo-puzzle and year-choice behavior, client response validation, redacted errors, idempotent tribute writes, signed sessions, origin checks, shared rate limits, presence expiry and hidden-message retry protection.
- Both actual SQL migrations execute in PGlite (PostgreSQL). Tests cover shared counts, message insertion and retry idempotency, hiding messages without allowing an original-request retry to recreate them, visitor/network quota rollback, the newest-30 message limit, denied anonymous/authenticated access, service-role access, and preservation of data when migrations run again.
- Message API tests cover public reads without a session, signed-session writes, malformed/oversized JSON, same-origin enforcement, plain-text/Unicode limits, link/control/markup rejection, pre-parsed Vercel bodies and real byte limits on raw request streams.
- PGlite uses one connection. Simultaneously queued requests exercise idempotency, but this is not a multi-connection PostgreSQL race or load test.
- The production bundle scan found no `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `service_role`, local-preview labels or local-test labels.
- The live local HTTP smoke test passed with two independent signed sessions. Shared contribution totals and five simultaneous message retries produced one saved message visible to the second session.
- After verification, the local memory service was restarted. `GET /api/messages` returned exactly `{ "messages": [], "totalMessages": 0 }` for the clean delivery.

## Current browser checks

- Final-theme checks passed at **1280 × 800**, **390 × 844**, **360 × 740** and **768 × 1024**. Page width and height matched each viewport, with no page overflow. The tablet uses the photos/wall view switch and a large game area.
- At 360 px, all four year-answer buttons are visible and 44 px high.
- Submitting a farewell through the browser showed server acknowledgement, cleared the draft and displayed the saved message at the top of the wall.
- A keyboard-driven puzzle was completed in six swaps; focus moved to the completion result. The puzzle was completed again with the final theme.
- All five quiz rounds were completed, producing a score of 2/5; focus moved to the score result.
- The online count appears at the top. The independent-session HTTP smoke test verifies shared data; browser and SQL/API tests cover message retry behavior.
- Reduced-motion CSS has been inspected and supplies a static path. Actual operating-system reduced-motion emulation was unavailable, so that device-level behavior has not been independently exercised.
- The footer displays **Made by Ayush Pathania**, linked to `https://www.linkedin.com/in/ayush-pathania-9a025b31b/`.
- Final views show zero farewell notes, no verification messages and no debug labels. There were no new browser errors after the final server restart; earlier HMR missing-file errors occurred only while files were being replaced during editing.

Validation, network failures, character limits and posting quotas are covered by automated API/client tests; this document does not claim a separate browser run of every failure scenario.

## Current review artifacts

Open [`screenshots/interactive/index.html`](screenshots/interactive/index.html) for the current screenshot gallery:

1. `01-community-room.jpg` — the compact community room.
2. `02-photo-puzzle.jpg` — the photo puzzle in progress.
3. `03-puzzle-complete.jpg` — the restored photograph and completion result.
4. `04-guess-the-year.jpg` — the year quiz.
5. `05-mobile-photos.jpg` — the mobile photos view.
6. `06-mobile-wall.jpg` — the mobile public farewell wall.

`tablet-768.jpg` is the additional 768 px tablet capture. All six captures and the tablet JPEG exist, are nonempty, and show the final theme with a clean, unseeded message wall.

## Earlier iteration checks

The preceding long-form design passed local desktop/laptop, 360 px mobile, 768 px tablet and 1440 px desktop inspection, contribution/reload checks, album opening, sharing and skip-link navigation. Its TypeScript/Vite build and the HTTP contribution smoke script also passed. Those results do not verify the revised compact layout or new message UI.

The photograph library contains 69 optimized variants for 23 photographs. Earlier six-composition screenshots and mobile/tablet captures directly inside `docs/screenshots/` remain historical artifacts. The `interactive/` subfolder contains the current revision.

OS-level reduced-motion emulation was unavailable during the earlier browser review; a device-level check remains useful before launch.

## Deployment boundary

The user selected local completion. No Vercel deployment or live Supabase connection was made. The explicit local memory adapter starts with zero counts and no messages, shares data only within its running server process, and resets on restart. It is forbidden on Vercel preview and production deployments.

The visitor-facing interface omits development/debug labels. Restarting the local demo clears verification messages; there are no seeded public messages in application code. Production code and setup instructions are supplied, while the actual hosted database, environment secrets and release deployment remain to be configured by the owner.

Before publishing, apply both migrations to the intended Supabase project and perform the separate preview deployment checks described in the README. The wall publishes messages immediately with basic spam filters and posting quotas; it is not comprehensively moderated. Authorized maintainers can remove reviewed messages through the documented SQL procedure.

Reviewed messages are hidden with `hidden_at`, retaining their request IDs. Hidden posts are omitted from the public list and visible total; an original-request retry receives HTTP 410 `MESSAGE_REMOVED`. This protection passed actual SQL and API tests. Public message reads also require the documented Vercel Firewall rule at deployment, initially 120 GET requests per minute per client IP; that hosted rule has not been configured locally.
