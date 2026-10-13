# Hosting coupling — every place ChitBridge is bound to Railway, Vercel or Supabase

Audit by reading code, 2026-10-13 (round HX0). Scope: api runtime (`server.js`, `lib/`, `routes/`, `middleware/`,
`db/`, `src/`), the migrations, the ops scripts/workflows the team depends on, and the web (`index.html`, `public/`,
`vercel.json`). The configuration contract (every env var, required or not) is `docs/HOSTING.md`.

Marks: 🔴 works on ONE platform only, or silently fails / misbehaves elsewhere · 🟡 works elsewhere but needs config ·
no mark = neutral. "Product" = a deliberate third-party choice of the product (not hosting); "Platform" = an accident of
where it runs today.

**Headline.** The api is mostly env-driven; the hard couplings are (1) the database connect path (`db/index.js`: SSL forced on
any non-loopback host, then a Supabase pooler fallback that sends the DB password to `*.pooler.supabase.com`), (2) the object
store (named S3, speaks Supabase Storage REST only), and (3) the web, which names the Railway host as a literal in 28 files.
No migration uses a Supabase-only role or schema.

**HX1 (2026-10-13) — the 🔴 rows below are removed in code** (each row keeps its HX0 text as the record of what was):
DB connect = `DATABASE_URL` then an explicit `DB_POOLER_URL`, TLS from `sslmode`/`PGSSLMODE`/the env (`db/connect-config.js`; the
password goes only to configured URLs — `tests/hosting-neutral.test.cjs` records the sockets) · object store = real S3 API, SigV4,
proved on MinIO (`lib/storage-object.js`; Supabase REST kept for `S3_KEY`) · ONE api base: web `public/config.js`, counter `connector.json`
via till.js `/config.js`, `lib/public-base.js` for the api's own links, seeded pictures relative or `PUBLIC_WEB_BASE`, workflows
`vars.API_URL` (patch in `docs/patches/`, the token could not push workflows) · `/.well-known/` excluded from both web rewrites ·
migration ledger `schema_migrations` (b304, `tools/migrate.cjs`). Named exceptions left (guarded): `public/config.js`'s value, till.html
cbHome's fallback for pre-HX1 kits, the CORS default (🟡). Prod env values: `docs/HOSTING.md` › Production stays identical.

---

## Database

| Binding | Where (file:line) | Env var or code? | Default | Platform-specific or product? | Neutral replacement |
|---|---|---|---|---|---|
| Connection string | `db/index.js:70` | `DATABASE_URL` | none (throws `Invalid DATABASE_URL`) | neutral | — |
| 🔴 SSL forced on every non-loopback host | `db/index.js:48` `sslForHost` → `{rejectUnauthorized:false}` for anything but localhost/127.0.0.1/::1 | code | SSL on | Platform (Supabase) — a plain Postgres on a docker host `db` is tried with SSL and fails ("server does not support SSL") | `?sslmode=disable` in `DATABASE_URL` **wins** — see note T1. Proper fix: honour `sslmode`/`PGSSLMODE` only, no host guess |
| 🔴 Supabase pooler fallback | `db/index.js:27-33` (5 hard-coded regions), `:93` ref `bzacyrdrnzdbficjplcn`, `:96` `<region>.pooler.supabase.com:6543`, users `postgres.<ref>` / `postgres` | code; ref via `SUPABASE_REF`; off via `DB_POOLER_FALLBACK=off` (`:89`) | **ON** | Platform (Supabase). On any other host a failed direct connect sends the DB password, TLS-unverified, to 10 Supabase endpoints | Default it OFF; make it opt-in (`DB_POOLER_FALLBACK=on`) or delete it |
| TLS verification off | `db/index.js:48`, `:94` | code | `rejectUnauthorized:false` | Platform (Supabase CA not in Node's store) | `sslmode=verify-full` + `sslrootcert` |
| Second pool (network/catalogue cb_*) | `src/db.js:2-5` | `DATABASE_URL`, `PGSSL` | SSL on unless `PGSSL=disable` | 🟡 same SSL assumption; no pooler fallback, no UTC pin | `sslmode=disable` in the URL also wins here; fold into `db/index.js` |
| Boot wait for cold start | `db/index.js:111-145` (comment: "On Railway the container SLEEPS") | `DB_BOOT_WAIT_MS` | 15000 | neutral (written for Railway sleep, harmless elsewhere) | — |
| Error text names Railway | `db/index.js:124` `NOT_CONNECTED` | code | "check DATABASE_URL in Railway environment variables" | Platform (cosmetic) | "check DATABASE_URL" |
| Statement deadline via SET LOCAL (for Supabase's transaction pooler) | `db/index.js:57-67`, `lib/limits.js:47` | `DB_STATEMENT_TIMEOUT_MS` | 15000 | neutral (works direct or pooled) | — |
| Session TZ pinned to UTC | `db/index.js:24`, `:63` | code | UTC | neutral | — |
| App DB role | `migrations/migration_b48_cb_app_role.sql:22-36` | `DATABASE_URL` user | whatever the URL names | 🟡 RLS bites only for a NOSUPERUSER NOBYPASSRLS role (`cb_app`). The compose api logs in as `cb_app` (`deploy/compose.yml` `x-app-url`; the migrate job sets its password) — proved: the stack walk is green with RLS holding. Production's role is not visible from code | `npm run db:role` (`scripts/check-db-role.js`) on each platform |
| Unused driver | `package.json` `mysql2` | — | — | dead dependency (no `require` anywhere) | drop |

**T1 — does `?sslmode=disable` win? Yes.** `node_modules/pg@8.22.0/lib/connection-parameters.js:59-60` does
`config = Object.assign({}, config, parse(config.connectionString))` — values parsed from the URL **override** the explicit
`ssl` option. `pg-connection-string@2.14.0/index.js:77-78` sets `config.ssl = {}` whenever `sslmode` is present, then `:139-142`
`case 'disable': config.ssl = false`. So `postgres://…@db:5432/x?sslmode=disable` connects in clear on the first try and the
pooler is never reached. ⚠️ The same override bites the other way: `?sslmode=require` yields `ssl = {}` (verify-full in
2.14, with a deprecation warning, `:144-150`) and **replaces** the code's `rejectUnauthorized:false` — a server with a private CA
then fails verification and falls to the pooler. For "TLS, don't verify" use `?sslmode=no-verify` (`:153-155`).

## Auth / OTP / mail

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| JWT HS256 secret (+ rotation) | `server.js:17`, `lib/jwt-verify.js:18-29` | `JWT_SECRET`, `JWT_SECRET_PREV` | boot aborts in a sealed env if <32 chars | neutral | — |
| Sealed-env OTP posture | `lib/dev-otp.js:39`, `:98-111`, called `server.js:39-47` | `NODE_ENV`, `DEV_OTP`, `OTP_EMAIL_ENABLED`, `RESEND_API_KEY`, `FROM_EMAIL` | dev | neutral | — |
| 🟡 E-mail = Resend SDK | `lib/notify.js:25-28`, `:85-87`; `routes/simulator.js:22-25`; `lib/employee-code.js:20` | `RESEND_API_KEY`, `FROM_EMAIL` | `noreply@chitandbridge.com` | Product (Resend); the only mail transport — sign-in in production depends on it | Resend SDK honours `RESEND_BASE_URL` (`node_modules/resend/dist/index.js:319`) → any Resend-compatible relay (compose `mailsink` uses it). SMTP adapter = debt |
| SMS OTP | `lib/notify.js:56-69` | `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID` | stub, never delivers | Product (not built) | — |
| Inbound e-mail webhook (Mailgun-style HMAC) | `routes/capture.js:150-152` | `EMAIL_INBOUND_SECRET` | inert | 🟡 Product; the provider must be pointed at this api's public URL | — |
| Admin door | `routes/channels.js:66` | `CB_ADMIN_KEY` | disabled (503) | neutral | — |
| Vault field encryption | `lib/vaultcrypto.js:15` | `VAULT_ENC_KEY` | null → refuses to store | neutral | — |

## Messaging (SMS / WhatsApp)

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| WhatsApp Cloud API out | `lib/whatsapp-out.js:18`, `:114` | `WHATSAPP_GRAPH_BASE`, `WHATSAPP_TOKEN` | `https://graph.facebook.com/v21.0` | Product (Meta) | — |
| WhatsApp media fetch | `lib/whatsapp-media.js:14-38` | same + `WHATSAPP_MEDIA_MAX_BYTES` | 5 MB | Product | — |
| 🟡 WhatsApp webhook in | `routes/capture.js:82-91` | `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | inert | Product; Meta's app config holds the Railway URL — moving hosts = re-register the callback | — |
| Auto-raise calls the api over HTTP (self) | `lib/autoraise.js:50`, `:85`, `:105` | `CB_SELF_URL` | `http://127.0.0.1:$PORT` | neutral (loopback) | — |
| SSE bell | `lib/events.js:25-27`, `:77-80` | code | heartbeat 25 s | 🟡 subscribers live in process memory → one replica only, or sticky sessions; proxy must not buffer `text/event-stream` | a shared bus (LISTEN/NOTIFY) |

## AI

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| Anthropic Messages API (fetch, hard-coded URL) | `lib/ai.js:330-332`, model `:12` | `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_*` | `claude-haiku-4-5-20251001` | Product; URL not overridable | an `AI_BASE_URL` |
| Assist (Anthropic SDK) | `routes/assist.js:75-95`, `:161-165`, `:220-224` | `ASSIST_LLM_PROVIDER` (`anthropic` only), `ASSIST_LLM_API_KEY`, `ASSIST_LLM_MODEL` | off | Product | — |
| Speech → OpenAI Whisper (hard-coded URL) | `lib/speech.js:31`, `:71` | `SPEECH_PROVIDER`, `OPENAI_API_KEY`, `SPEECH_MODEL`, `SPEECH_TIMEOUT_MS` | off | Product | — |
| Self-hosted whisper | `lib/transcribe.js:41`, `:51` | `WHISPER_URL` | off (audio kept) | neutral | — |
| Forms AI/ERP/IoT providers | `lib/forms.js:95-97` | `FORMS_*_PROVIDER/_KEY`, `OPENAI_API_KEY` | inert flags | Product | — |

## KYB / third-party APIs

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| Sandbox.co.in (GST/PAN/IEC) | `lib/verify.js:31-56` | `SANDBOX_BASE`, `SANDBOX_API_KEY/SECRET`, `SANDBOX_*_PATH`, `SANDBOX_*_VERSION` | `https://api.sandbox.co.in` | Product | — |
| Generic KYB provider | `lib/verify.js:74-104` | `CB_KYB_PROVIDER`, `CB_KYB_BASE`, `CB_KYB_KEY` | off | Product | — |
| Field-market provider | `lib/kyb.js:228`, `:273` | `KYB_FIELD_PROVIDER`, `KYB_FIELD_KEY` | inert (TODO) | Product | — |
| Zoho Books template | `routes/integrations.js:165` | code (per-shop config) | `https://www.zohoapis.in` | Product | — |
| Public base for downloads / OpenAPI / media URLs | `routes/integrations.js:150`, `routes/openapi.js:9`, `routes/products.js:1392` | `PUBLIC_API_BASE`, `PUBLIC_API_URL` (two names) | `req.protocol://host` | 🟡 correct only when `trust proxy` matches the hop count (http vs https) | one name |

## Storage

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| Attachments in Postgres | `lib/storage.js:4`, `:57-69`, `:187-188` | `STORAGE_ADAPTER` (`db` · `object`) | `db` (bytes in `cb_attachment.data`; media in `media_blobs`) | neutral | — |
| 🔴 "S3" object store = Supabase Storage REST | `lib/storage-object.js:33-35`, URL `/storage/v1/object/<bucket>/<key>` `:82`, headers `Authorization: Bearer` + `apikey` `:85`, fetch `:96`/`:112`/`:127` | `S3_ENDPOINT`, `S3_KEY`, `S3_BUCKET` | unset → database fallback | Platform (Supabase) despite the S3 names — no SigV4; AWS S3 / R2 / MinIO will reject it | a SigV4 sibling selected by `STORAGE_ADAPTER=s3`; rename vars |
| Inconsistent switch | product media `routes/products.js:1380` and books packs `lib/books-pack.js:115-116` use the object store whenever `S3_ENDPOINT`+`S3_KEY` are set; attachments additionally need `STORAGE_ADAPTER=object` (`lib/storage.js:69`) | env | — | 🟡 | one switch |
| Local disk | none: no `fs.write*`, `/tmp` or spool dir in runtime code (grep) | — | — | neutral — the container is stateless | — |
| Connector spool `/opt/chitbridge/spool` | `public/app/cap-connector.js:279` (installer for the customer's box, not the api) | code | — | neutral | — |

## Timers

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| Books nightly check | `lib/books-nightly.js:136-139`, started `server.js:479` | `BOOKS_NIGHTLY=0` off | every 6 h (+10 min) | 🟡 in-process `setInterval(...).unref()`: does not run while a sleeping container sleeps; runs once per replica (no lock) | external scheduler hitting an endpoint, or `pg_try_advisory_lock` |
| CRM follow-up sweep | `lib/crm-followups.js:224-227`, started `server.js:481` | `CRM_SWEEP=0` off | every 6 h (+12 min) | 🟡 same | same |
| Retention sweep | `lib/retention.js:13-17` | `RETENTION_*` | **no scheduler** — called only from scripts/tests | neutral (unrun) | — |
| Uptime probe | `.github/workflows/uptime.yml:32`, `:41`, `:49` | code | hourly cron | 🔴 hard-coded `chitbridge-api-production.up.railway.app` | a repo variable `API_URL` |
| Backup | `.github/workflows/backup-restore.yml:9-57` | secret `BACKUP_DATABASE_URL` | — | neutral (`pg_dump` of `public`) | — |
| pg_cron | `migrations/purge_test_entities_ROUTINE.sql:18` (comment only) | — | — | neutral | — |

## Network / TLS / proxy / CORS

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| 🟡 `trust proxy` = 1 hop | `server.js:52` ("Trust Railway's proxy") | code | 1 | Platform assumption: exactly one proxy. With none, `req.ip` takes a client-forged `X-Forwarded-For`; with two (CDN + LB) every user shares the LB's IP → per-IP rate limits collapse | `TRUST_PROXY` env |
| 🟡 Raw `X-Forwarded-For` read | `lib/signin-events.js:84`, `routes/signin.js:497` (before `req.ip`) | code | — | spoofable on any host; correct only behind a proxy that overwrites it | use `req.ip` |
| 🟡 CORS allowlist | `server.js:57-58` | `ALLOWED_ORIGINS` | `https://chitbridge-web.vercel.app,http://localhost:5173,http://localhost:3000` | Platform default (Vercel); another web origin gets 403 `ORIGIN_NOT_ALLOWED` until set | no default in a sealed env |
| Listen | `server.js:13`, `:473` | `PORT`, `HOST` | 3000, all interfaces | neutral | — |
| Rate limits in memory | `server.js:224-275`, `routes/till.js:49-72`, `routes/ctp.js:38` | `*_RATE_LIMIT_MAX` | express-rate-limit MemoryStore | 🟡 per replica | shared store |
| Static `public/` from the api | `server.js:406` | code | — | neutral | — |
| Platform headers | none: no `x-vercel-*`, `cf-*`, `x-real-ip` reads (grep) | — | — | neutral | — |

## Observability / platform metadata

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| 🟡 `/health` commit + region | `server.js:426-427` | `RAILWAY_GIT_COMMIT_SHA` → `SOURCE_COMMIT`; `RAILWAY_REPLICA_REGION` → `RAILWAY_REGION` | null | Platform (Railway sets them); `SOURCE_COMMIT` is the neutral fallback, region has none | `SOURCE_COMMIT`, `REGION` set by the image/build |
| Logs | `lib/logger.js:3`, `:42-50` | `LOG_LEVEL` | JSON lines to stdout | neutral | — |
| Slow-query / trips | `lib/dbwatch.js:20`, `lib/trips.js:95`, `db/index.js:235` | `DB_SLOW_MS`, `CB_TRIPS`, `DB_QUERY_LOG` | 500 ms / off / off | neutral | — |
| Installation row says where it runs | `migrations/b74_platform_governance.sql:25-26` | data | `cloud_provider='railway+vercel+supabase'`, `domain='chitandbridge.com'` | data only, nothing reads `cloud_provider` | — |

## Web front-end (chitbridge-web)

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| 🔴 API host literal | `https://chitbridge-api-production.up.railway.app` — **33 occurrences in 28 files** under `public/` (`index.html`: 0; it calls `CBShell.apiBase()` `index.html:108`). E.g. `public/app/shell.js:58-61`, `public/store.html:56`, `public/tasks.html:82`, `public/app.html:1723` | code | Railway | Platform (Railway). Vercel serves files as-is: no build step injects a base | one `/config.js` (or `<meta>`) every page reads; today the container swaps the literal at start (`deploy/40-cb-api-base.sh`, `CB_API_BASE`) |
| API base resolution | `public/app/shell.js:57-62`: `localStorage.cb_api_base` (`'stage'` = Railway) → `localhost`/`127.0.0.1` ⇒ `http://localhost:3000` → else Railway | code + per-browser override | Railway | 🔴 a per-browser override is not a deploy setting | as above |
| Stage ladder | `public/app.html:1722-1726` dev = Railway, uat/live = `""` (TODO) | code | dev | 🔴 | as above |
| 🔴 Installer scripts embed the endpoint | `public/app/cap-connector.js:279`, `public/app/cap-workforce.js:287` (`endpoint:'https://chitbridge-api-production…'`) | code | Railway | Platform — a customer's box installed from another deploy phones Railway | use `CBShell.apiBase()` |
| 🔴 Till cloud host | `public/till.html:6411` `CloudHost.api = ls.cb_till_api ‖ (localhost ? Railway : window.CB_API ‖ Railway)` — vendored from api `tools/tally-connector/till.html:6411` | code + `localStorage.cb_till_api` / `window.CB_API` | Railway (even on localhost) | Platform | same config |
| SPA rewrite | `vercel.json` `/(.*)` → `/index.html`; `ignoreCommand` on `VERCEL_GIT_COMMIT_REF` | Vercel config | — | Platform (mirrored by `deploy/nginx.conf` `try_files $uri /index.html`) | nginx conf exists |
| 🟡 Service worker `cb-sw.js` | `public/cb-sw.js:50-61` network-first caches **every same-origin GET**; the API is assumed cross-origin (`:6-8`, `:61`) | code | — | if a deploy puts the api on the same origin (`/api` behind one proxy) authenticated API responses land in the SW cache | exclude `/api/` explicitly |
| Service worker `till-sw.js` | `public/till-sw.js:8-11` same-origin GET, `KEEP` list only | code | — | neutral | — |
| Google Fonts | 14 files incl. `index.html:14`; cached cross-origin by `cb-sw.js:57` | code | — | 🟡 external CDN (privacy / offline first-load) | self-host fonts |
| cdnjs (qrcode) | `public/app.html:1687`, `public/shop.html:70` | code | — | 🟡 external CDN; the api already depends on `qrcode-generator` | vendor it |
| Catalogue pictures from the Vercel host (api side) | `lib/catalogue-blueprint.js:795` `PICS='https://chitbridge-web.vercel.app/pics/'` | code | Vercel | 🔴 Platform; seeded item images point at Vercel forever | relative `/pics/` or a `PUBLIC_WEB_BASE` |
| IoT connector endpoint shown to users (api side) | `routes/connectors.js:445` | code | Railway literal | 🔴 | `PUBLIC_API_BASE` |
| Tally connector / counter defaults (api `tools/`) | `tools/tally-connector/setup.js:27`, `index.js:11`, `counter.cmd:46`, `prove.js:19`, `promo.html:193`, `connector.example.json:2` | code | Railway | 🔴 shipped to customers' PCs | prompt for the api, no default |

## Migrations

No migration references a Supabase-only object: grep for `anon`, `authenticated`, `service_role`, `supabase_admin`,
`authenticator`, `auth.uid()`, `auth.*`, `storage.*`, `realtime.*`, `pgsodium`, `vault.`, `cron.schedule` finds nothing in
executable SQL (only a comment in `purge_test_entities_ROUTINE.sql:18`). Roles used are the product's own.

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| Extensions `pgcrypto`, `ltree`, `pg_trgm` | `000_baseline.sql:19-20`, `b121_product_search_index.sql:35` | SQL | — | neutral (Postgres contrib; present in `postgres:16-alpine`) | — |
| `cb_app` role | `migration_b48_cb_app_role.sql:22-36` creates it LOGIN without a password; ~60 later files `GRANT … TO cb_app` unguarded (e.g. `b104_capture.sql:27`) | SQL | — | neutral; fails on any DB if b48 has not run first (the sim-load chain sorts it first) | — |
| `cb_metrics` must pre-exist | `b151_metrics_schema.sql:35-44` RAISEs; `b154_metrics_work.sql:98` | SQL | — | 🟡 fails on every fresh DB (Supabase too) until created out of band | — |
| `cb_ops` created with placeholder password | `b224_ops_accounts.sql:72` | SQL | `CHANGE-ME-<uuid>` | 🟡 | set a real password |
| "Run as postgres in the Supabase SQL editor" | `b272_books_ledger.sql:6`, `b273_books_journal.sql:5`, `b198_VERIFY.sql:17` | comment | — | Platform habit only: means "a role that bypasses RLS" — any superuser psql works | psql |
| No migration ledger | `tools/sim-load.cjs:130-153` applies 000_baseline → part2 (≤6 passes) → every `bNNN` once, skips a non-empty DB (`:131`); `migrations/MANIFEST.md` | tooling | — | 🟡 a second deploy does not migrate; CI (`.github/workflows/ci.yml:147-162`) applies the legacy `db/schema*.sql` + `net0*` chain, not `000_baseline`+`bNNN` | a migration table |

## CTP (cross-instance exchange, `bridge_id@domain`)

Design: `docs/CTP-DESIGN.md` (§5.1 addressing, §6 envelope, §8.1 trust, §6.5 return path), `docs/NAMESPACE.md:57`
(`CBM5P72HB7@in.example`). `docs/NETWORK-AUTHORITY.md` is about the parent→child authority cascade inside one database
(not CTP) and says the cascade "is a design goal, not built". Every `lib/ctp*.js` is `@stage poc`: loaded, reachable only
when some `installation.hosted_locally = false`, which no row is.

| Binding | Where | Env var or code? | Default | Platform or product? | Neutral replacement |
|---|---|---|---|---|---|
| Discovery document | `routes/ctp.js:89` `GET /.well-known/ctp.json`, mounted at `/` and `/api/ctp` (`server.js:313-315`); peers fetch `https://<domain>/.well-known/ctp.json` (`lib/ctpdirectory.js:58-60`, `:82` `redirect:'error'`, 5 s timeout `:38`, 15 min cache `:37`); http only for loopback (`:56`) | code | — | neutral, **but** see next row | — |
| 🔴 Which host answers `<domain>/.well-known/ctp.json` | `installation.domain` seeded `chitandbridge.com` (`b74_platform_governance.sql:26`); the manifest is served by the **api** host | data | — | if the domain points at the web (Vercel `vercel.json` `/(.*)`→`/index.html`, or `deploy/nginx.conf` `try_files`) the peer gets `index.html` and discovery fails; `redirect:'error'` forbids a redirect to the api | set `installation.domain` to the api's own DNS name, or proxy `/.well-known/ctp.json` from the web host to the api |
| Signing key (Ed25519, PKCS#8 PEM) | `lib/ctpkeys.js:38-42`, `signer()` `:68`, keygen helper `:92` | `CTP_PRIVATE_KEY` | unset → envelopes `alg:'none'`, no key published | neutral (env only, never in DB) | — |
| Installation identity | `routes/ctp.js:64`, `:76`; `lib/mint.js:307`; `lib/ctpquery.js:131` | `INSTALLATION_KEY` | `platform-0` | neutral | — |
| Peer registry | `installation.domain`, `hosted_locally`, `ctp_endpoint` (`b257_where_an_installation_runs.sql:43-44`, check `:66`); default-deny peers per population (`routes/ctp.js:177-186`, b258) | data | all local | neutral | — |
| Receiving door | `routes/ctp.js:100` `POST /api/ctp/deliver`, own limiter `:38` | code | — | needs a public DNS name + a publicly trusted TLS cert (peers use Node `fetch`, default CA store) | — |
| Send / query | `lib/ctptransport.js:60` (no retry, no queue), `lib/ctpquery.js:116-138` | code | — | neutral | — |
| Reserved root handle | `lib/handle.js:90` | `PLATFORM_ROOT_HANDLE` | none | neutral (white-label) | — |
| Self URL | `lib/autoraise.js:50` | `CB_SELF_URL` | loopback | not CTP — the auto-raise path calling its own api | — |
| `PUBLIC_API_BASE` / `PUBLIC_API_URL` | see KYB table | env | request host | not read by CTP | — |

**What a cross-instance exchange needs:** a public DNS name for the api; a TLS certificate from a public CA on it; that name in
`installation.domain` (and `ctp_endpoint`) on both sides; `/.well-known/ctp.json` reachable on that exact name without a
redirect; `CTP_PRIVATE_KEY` + `INSTALLATION_KEY` set on each side; the peer row with `hosted_locally=false` and the population's
`ctp_peers` naming it. **Exists:** manifest route, deliver route, envelope + seal (conformance test), Ed25519 keys, directory
fetch/cache, transport, catalogue/resolve query. **Design only:** status flowing back across the boundary (CTP-DESIGN §6.5,
"None of this is built"), retry/queue (`lib/ctptransport.js` header), handle→bridge translation for a typed foreign address
(NAMESPACE §5, 🟡), any installation actually remote.

---

## Tech debt we leave with each platform

**Railway**
- The web, the Tally/counter connector, the IoT installer, the uptime workflow and `routes/connectors.js:445` all name `chitbridge-api-production.up.railway.app`; moving the api breaks every installed customer connector that kept the default.
- `trust proxy = 1` (`server.js:52`) encodes Railway's single edge hop; rate limits and sign-in IPs depend on it.
- Cold-start wait (`db/index.js:111-145`) and in-process 6-hourly timers (`server.js:479-481`) were shaped around a sleeping single container; replicas would double-run them and split SSE/rate-limit memory.
- `/health` commit/region read `RAILWAY_*` (`server.js:426-427`); WhatsApp/e-mail webhooks are registered at the Railway URL with Meta / the mail provider.
- No migration runner on deploy: Railway boots `node server.js`; schema changes are run by hand.

**Vercel**
- No build step for config: the API base cannot be injected per deploy, which is why it is a literal in 28 files.
- `vercel.json` SPA catch-all would swallow `/.well-known/*` on the web domain (CTP discovery) — and the CORS default (`server.js:58`) trusts only `chitbridge-web.vercel.app`.
- `lib/catalogue-blueprint.js:795` serves seeded catalogue pictures from `chitbridge-web.vercel.app/pics/` — those image URLs are stored in shops' data.
- `ignoreCommand` on `VERCEL_GIT_COMMIT_REF` is the only branch gate; previews are off, so nothing but `main` is ever served.

**Supabase**
- Pooler fallback with a hard-coded project ref and regions (`db/index.js:27-33`, `:93-96`) is ON by default and leaks the DB password off-platform on any failed direct connect.
- SSL is guessed from the hostname (`db/index.js:48`, `src/db.js:4`) with verification off; `sslmode` in the URL silently overrides it either way.
- `lib/storage-object.js` speaks Supabase Storage REST under S3 names; books packs and product media switch to it on `S3_ENDPOINT`+`S3_KEY` alone.
- Operational habit "run as postgres in the SQL editor" (`b272`, `b273`, `b198`) and `cb_metrics`/`cb_ops`/`cb_app` passwords set by hand there; production connects as whichever role the URL names (verify with `npm run db:role`).
- Statement deadline via `SET LOCAL` per transaction exists for the transaction pooler (`db/index.js:57-67`); harmless elsewhere but it is two code paths for one setting.

---

## Per platform — what is native, what is portable (HX2: the spin scripts, `deploy/<platform>/`)

The api and the web are the SAME two images everywhere (`Dockerfile`, web `Dockerfile`); the schema is the same ledger chain
(`tools/migrate.cjs`); the env is ONE list (`deploy/spin-lib.sh` `spin_api_env`, names from `docs/HOSTING.md`). What changes per
platform is only the wiring below — that wiring is the tech debt we carry, one row per platform. ✅ portable (config only) ·
🟡 works, platform-flavoured · 🔴 a gap (code or a manual step needed).

| Concern | AWS (ap-south-1) | Azure (centralindia) | GCP (asia-south1) | Railway (no India region) |
|---|---|---|---|---|
| Postgres | 🟡 RDS 16; `postgres` is `rds_superuser`, not a superuser; public endpoint (App Runner has no fixed egress) | 🟡 Flexible Server 16; admin not superuser; **extensions must be allow-listed** (`azure.extensions`); "Azure services" firewall | 🟡 Cloud SQL 16; `cloudsqlsuperuser`; the api via the Cloud Run socket (`?host=/cloudsql/…` in `DATABASE_URL`) | ✅ plain Postgres container (real superuser); private network host `postgres.railway.internal` |
| Migrations needing a superuser | 🔴 listed by migrate, not recorded | 🔴 same | 🔴 same | ✅ |
| Object store | ✅ S3, SigV4 (`S3_PATH_STYLE=false`); 🟡 a static IAM-user key (no instance-role support in `lib/storage-object.js`) | 🔴 **none** — Blob is not S3; attachments in Postgres (`STORAGE_ADAPTER=db`) or an external S3 (R2) | ✅ GCS XML API + HMAC key (`S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`); 🟡 HMAC keys are a service-account secret, not workload identity | 🔴 none native (same as Azure) |
| Containers | 🟡 App Runner (min 1 instance, no jobs) | ✅ Container Apps | ✅ Cloud Run (`--min-instances` for the in-process timers) | ✅ Railway builds the Dockerfile itself |
| Registry | ECR | ACR (admin user — 🟡 a managed identity is the native way) | Artifact Registry | none (Railway builds from source) |
| TLS + DNS | ✅ `*.awsapprunner.com`; custom domain not scripted | ✅ `*.azurecontainerapps.io`; custom domain + managed cert not scripted | ✅ `*.run.app`; domain mapping / LB not scripted | ✅ Railway's generated https domain; custom domain not scripted |
| Scheduler (books nightly, CRM sweep) | 🟡 in-process timers (`server.js:479-481`): run per instance — keep the api at ONE instance, or move them to EventBridge Scheduler → an endpoint (debt, unchanged from HX0) | 🟡 same (Container Apps jobs would be native) | 🟡 same (Cloud Scheduler) | 🟡 same (Railway cron services) |
| Logs (CERT-In: 180 days, in India) | 🟡 App Runner → CloudWatch Logs in ap-south-1; default retention = never expire — set 180 d | 🟡 Log Analytics in centralindia; default retention 30 d — raise to 180 | 🟡 Cloud Logging, `_Default` bucket = 30 d and global — a regional asia-south1 bucket with 180 d is needed | 🔴 Railway's log window is short and not in India — ship logs out (debt) |
| Backups (Companies Act: daily, in India) | ✅ RDS automated backups in-region (the TEST spin turns them off) | ✅ Flexible Server backups in-region (7 d on the spin) | ✅ Cloud SQL backups (the TEST spin turns them off) | 🔴 not in India — `backup-restore.yml` `pg_dump` to an India bucket |
| Secrets | 🟡 plain env on App Runner (Secrets Manager refs are native) | 🟡 plain env (`secretref:` is native) | 🟡 plain env (Secret Manager is native) | ✅ variables are Railway's secret store |
| Mail (sign-in codes) | ✅ Resend over `RESEND_API_KEY` everywhere; the test spin points `RESEND_BASE_URL` at its token-guarded sink | ✅ same | ✅ same | ✅ same |
| Teardown handle | tag `cb-spin=<id>` (Tagging API) + IAM tags | the resource group (tagged) | labels + the service account's display name | the project's name |

Offline proof of the scripts: `bash deploy/spin-check.sh` (shellcheck + every aws/az/gcloud command parsed by its own CLI with no
credentials) and `node tests/spin-scripts.test.cjs` (in the guards). Not proved until the owner's accounts exist: anything a cloud
decides at run time (quotas, org policies, a migration a non-superuser cannot run, the Railway CLI's flags).
