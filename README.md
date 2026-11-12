# A farewell, built together

An independent photographic tribute to Jensen Huang, built with React, TypeScript and Vite. The compact experience combines an **Explore** photo album, a tile **Puzzle**, a **Year Quiz**, an online visitor count at the top, and a public farewell message wall. Vercel Functions and Supabase Postgres provide shared counts and persistent messages.

The application includes the production build, serverless API routes and database migrations. Publishing requires the Vercel/Supabase setup below; no live deployment or production credentials have been configured in this local delivery.

## Run locally

Use Node.js 22.

```sh
npm ci
npm run dev:demo
```

Open **http://127.0.0.1:5173**. The explicitly local memory service starts with zero contributions and an empty message wall. It shares counts and messages between browsers using this running server, and resets both when the process stops. Open a private browser window for a second visitor. A refresh or a second tab in the same browser does not add another tribute. There are no seeded messages or fabricated online counts.

`npm run dev` uses the Supabase configuration in `.env.local` instead. If no service is configured, the photos and games remain available while live counts and messages show their unavailable state. `npm run preview` previews built static files only; use the development server or Vercel to test API functions.

```sh
npm run check
```

The release check runs the automated suite and production build. The local demo has the same visitor-facing interface, with no debug labels or seeded posts. To remove messages created during local verification, stop and restart `npm run dev:demo`; this resets the entire development-only memory store.

## Set up the shared database

1. Create a Supabase project for a **preview environment**. Use a separate project for production so test contributions never affect public totals.
2. In the project's SQL editor, run [`supabase/migrations/202611120001_tribute.sql`](supabase/migrations/202611120001_tribute.sql), then [`supabase/migrations/202611120002_messages.sql`](supabase/migrations/202611120002_messages.sql). Alternatively, run `supabase init`, link the intended project with the Supabase CLI, and apply both migrations using `supabase db push`.
3. Copy `.env.example` to `.env.local` and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, and `TRIBUTE_STORE=supabase`. Generate the secret locally, for example:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Keep credentials out of chat, source control and any `VITE_` environment variable. Preserve `SESSION_SECRET` across restarts and deployments so existing browser sessions remain valid. The browser never connects directly to Supabase. Row-level security denies anonymous and authenticated users access to the tables; only server-held service credentials can call the four narrow service RPCs for presence, participation, reading messages and posting a message.

## Deploy to Vercel

1. Sign in using `vercel login`, then run `vercel link` from this directory, or import the repository in the Vercel dashboard.
2. Use the **Vite** framework preset, build command `npm run build`, output directory `dist`, and Node.js 22. The `api/` directory is deployed as Vercel Functions automatically.
3. Add the four server environment variables above to the **Preview** environment, using the preview Supabase project. Set `SITE_URL` to your canonical HTTPS origin when using a custom domain; otherwise Vercel's deployment URL is detected automatically for the social image.
4. Run `vercel` for a preview deployment. Verify contributions and message visibility from two separate browsers, returning visitors, failed-write retries, rate limits, error states, and sharing metadata there.
5. In Vercel Firewall, configure a rate-limit rule scoped to `GET /api/messages`, initially **120 requests per minute per client IP**. Adjust that threshold for observed traffic and shared networks. Message writes already have database quotas; public reads otherwise have no application-level rate limit.
6. Configure the **Production** environment with a separate production Supabase project and secret. Apply both migrations there, then deploy using `vercel --prod`.

Vercel builds fail early if required server environment variables are missing, `SESSION_SECRET` is shorter than 32 characters, the memory store is selected, or `SUPABASE_URL` does not use HTTPS. The memory store also refuses to run in either a Vercel preview or production deployment. No deployment was performed during local implementation because the user selected local completion and deployment instructions.

## Participation behavior

- `POST /api/presence` creates or verifies a signed HttpOnly browser cookie, records activity, and returns `{ totalTributes, onlineNow, participated }`.
- `POST /api/tribute` requires that session and returns the same state plus `added`. A database primary key and transaction guarantee idempotent insertion and an atomic aggregate update.
- “Here now” counts browsers active within the last **90 seconds**. Visible pages send a heartbeat every **30 seconds**; multiple tabs share the same cookie. There is no logout-on-close request, so closing one tab cannot remove another active tab.
- Cookies persist for one year. Clearing cookies or changing browsers creates a new visitor, so the metric is **tributes**, not verified unique people.
- A contribution is confirmed only after server acknowledgement. A lost response can safely be retried. Online counts become unavailable after 90 seconds without fresh data.
- Database-backed, one-minute network rate limits allow 600 presence requests and 60 contribution attempts. Network keys are HMAC hashes, not stored raw addresses. Expired presence and rate records are pruned after one day on subsequent requests.

Anonymous counts are not a proof of human identity. If the page receives significant abuse, configure Vercel Firewall protection before increasing limits. Use Vercel function logs and Supabase request/error metrics to monitor API failures and capacity; do not log session cookies or service keys. Server responses intentionally redact provider error details.

## Public farewell messages

- `GET /api/messages` is read-only and requires no cookie. It returns `{ messages: [{ id, name, body, createdAt }], totalMessages }`, with at most the latest 30 visible messages, newest first. Hidden messages are excluded from both the list and total.
- `POST /api/messages` requires the initialized signed browser cookie, a same-origin request, and `Content-Type: application/json`. Send `{ name?, body, requestId }`, where `requestId` is a newly generated UUID for that message. The response is `{ message, added, totalMessages }`.
- Preserve the same `requestId` and content when retrying an uncertain submission. A database uniqueness constraint and transaction return the original saved message without duplicating it or consuming additional posting quota.
- Retrying a message that a maintainer has hidden returns HTTP **410** with code `MESSAGE_REMOVED`; it does not restore that message. A genuinely new farewell needs a new request ID.
- The trimmed body must contain 1–240 Unicode code points. An optional name is limited to 32 and defaults to **A fellow builder**. Body line breaks are allowed. Basic filters reject links, HTML-looking markup and other control characters; React renders message content as text. JSON requests are limited to 4 KB, including raw streamed requests and Vercel's parsed request bodies.
- New messages are visible immediately. There is no approval queue, comprehensive moderation system, account verification, or claim that all inappropriate content is detected.
- Shared database quotas allow 3 new messages per browser per fixed 10-minute window, and 20 per hashed network address per minute. Rate-limit responses include `Retry-After` and `{ error: { code, message }, retryAfterSeconds }`. Other errors use the same error shape; session, validation, origin, size, media type and unavailable-service errors return appropriate HTTP statuses.

To hide a public message, use an authorized Supabase SQL editor session. Inspect the record first, then replace the placeholder below with its reviewed ID. Keep the row so its original request cannot recreate a hidden message:

```sql
select id, name, body, created_at, hidden_at
from public.tribute_messages
where hidden_at is null
order by created_at desc
limit 100;

update public.tribute_messages
set hidden_at = now()
where id = 'REPLACE_WITH_REVIEWED_MESSAGE_UUID'::uuid
returning id;
```

The wall and visible-message total update on the next refresh. Hiding does not ban the author or prevent a new submission, but retries of the original request stay hidden. No moderator credentials or moderation actions are exposed in the public frontend.

## Photography and design

The site uses authentic, self-hosted photographs with per-image credits and licenses in its expandable credits section. The full sourcing catalogue is in `docs/photo-catalog.md`, and runtime metadata lives in `src/data/photos.json`. Photographs are resized and converted to WebP. Explore and the quiz preserve their source colors; thumbnails and puzzle tiles use documented display crops. Respect each source license when reusing or altering an image.

The current interface keeps the photographic archive in a compact Explore/Puzzle/Year Quiz workspace, with public farewells alongside the interactive content. On smaller screens, a view switch gives the photos and message wall their own usable space. The current six-view gallery is [`docs/screenshots/interactive/index.html`](docs/screenshots/interactive/index.html), with an additional tablet capture. Earlier screenshots directly inside `docs/screenshots/` represent the preceding long-form layout. The confirmed design brief is in `.impeccable.md`.

The final visual direction adds an NVIDIA-inspired green technical background and logo theme while keeping the photographs and interactions central. The project remains an independent community tribute.

The NVIDIA SVG comes from [Simple Icons](https://cdn.simpleicons.org/nvidia), whose icon assets are distributed under [CC0](https://creativecommons.org/publicdomain/zero/1.0/). The NVIDIA name and logo remain NVIDIA trademarks; their inclusion does not imply sponsorship or endorsement.

Fonts are self-hosted Fontsource distributions of Fraunces and Source Sans 3, under their bundled SIL Open Font Licenses. No generated portraits, automatic sound, accounts, or user-uploaded photographs are used.

The footer credits **Made by Ayush Pathania** and links to [Ayush's LinkedIn profile](https://www.linkedin.com/in/ayush-pathania-9a025b31b/).

## Verification boundaries

Local tests cover API sessions, origin validation, duplicate/concurrent requests, quotas, presence expiry, message validation and bounded bodies, provider error redaction, and both actual PostgreSQL migrations/RPCs using PGlite. PGlite queues work on one connection; it is not a multi-connection production load test. Current browser-check status is recorded in `docs/verification.md`. A real Supabase project, Vercel runtime, production proxy headers, and deployment environment variables still need the preview verification described above.
