# Hosting — the configuration contract

Everything the api reads from its environment at run time, and nothing else. Read off the code on 2026-10-13
(`grep process.env` over `server.js lib routes middleware db src`, plus the dynamic reads in `lib/dev-otp.js:57`,
`lib/namedentity.js:40`, `lib/channels.js:51`, and `RESEND_BASE_URL` read by the Resend SDK). Where each binding lives and
which ones only work on Railway / Vercel / Supabase: `docs/HOSTING-COUPLING.md`.

**Sealed environments.** `NODE_ENV` ∈ `production · uat · staging · live · prod` (trimmed; `lib/dev-otp.js:39`) is *sealed*.
In a sealed environment the server **refuses to boot** (`server.js:17-47`, `lib/dev-otp.js:98-111`) unless:
`JWT_SECRET` is ≥ 32 chars · `OTP_EMAIL_ENABLED=true` · `RESEND_API_KEY` and `FROM_EMAIL` are set · `DEV_OTP` is **unset**.
Any other `NODE_ENV` (unset = `development`) only warns.

Required: **always** = the api does not work without it · **in production** = needed in a sealed env (boot guard) or for a
public deploy to work · **optional** = has a safe default or turns a feature on. Examples are placeholders, never real values.

## api — environment variables

| Name | Required? | Example | Secret? | What it does |
|---|---|---|---|---|
| **Core** | | | | |
| `NODE_ENV` | in production | `production` | no | Sealed set enforces the OTP/mail boot guard. |
| `JWT_SECRET` | always | `<32+ random chars>` | yes | HS256 signing key for every session; ≥32 chars. |
| `JWT_SECRET_PREV` | optional | `<previous JWT_SECRET>` | yes | Still verifies tokens during a secret rotation. |
| `JWT_TTL` | optional | `7d` | no | Lifetime of simulator lead tokens. |
| `PORT` | optional | `3000` | no | Listen port (default 3000). |
| `HOST` | optional | `127.0.0.1` | no | Listen address; unset = all interfaces. |
| `ALLOWED_ORIGINS` | in production | `https://app.example.com` | no | CORS allowlist, comma-separated; default is the Vercel origin. |
| `PUBLIC_API_BASE` | optional | `https://api.example.com` | no | Public api URL for OpenAPI, connector downloads and the IoT provisioning endpoint (`lib/public-base.js`); unset = the request's own host. |
| `PUBLIC_WEB_BASE` | in production | `https://app.example.com` | no | HX1: the site people open — seeded catalogue pictures (`<base>/pics/…`; unset = relative `/pics/…`), the counter kit's `web`, `/health` `web`. |
| `PUBLIC_API_URL` | optional | `https://api.example.com` | no | Public api URL for product media links. |
| `CB_SELF_URL` | optional | `http://127.0.0.1:3000` | no | How auto-raise calls this api; default loopback. |
| `INSTALLATION_KEY` | optional | `platform-0` | no | Which `installation` row this deployment is. |
| `PLATFORM_ROOT_HANDLE` | optional | `<your-brand-handle>` | no | Reserves the operator's handle from sign-up. |
| `PLATFORM_ROOT_ENTITY` | optional | `<entity uuid>` | no | Operator entity; unset = no operator surface. |
| `PLATFORM_ROOT_ENTITY_TEST` | optional | `<entity uuid>` | no | Operator root for the test population. |
| `PLATFORM_ROOT_ENTITY_SANDBOX` | optional | `<entity uuid>` | no | Operator root for the sandbox population. |
| `CB_ADMIN_KEY` | optional | `<32+ random chars>` | yes | Enables admin channel routes (`x-cb-admin-key`); unset = disabled. |
| `VAULT_ENC_KEY` | optional | `<64 hex chars>` | yes | AES-256-GCM key for vault fields; unset = not stored. |
| `CTP_PRIVATE_KEY` | optional | `<Ed25519 PKCS#8 PEM>` | yes | Signs cross-installation envelopes; unset = unsigned. |
| `NETWORK_WRITE_ENABLED` | optional | `true` | no | `false` makes `/api/network` read-only. |
| **Database** | | | | |
| `DATABASE_URL` | always | `postgres://cb_app:<password>@db.example:5432/chitbridge?sslmode=disable` | yes | The Postgres DSN, tried first. Its `sslmode` decides TLS (`disable` · `no-verify` · `require` · `verify-full`). |
| `DB_POOLER_URL` | optional | `postgres://<user>:<password>@<pooler-host>:6543/postgres?sslmode=no-verify` | yes | HX1: a second DSN, tried only when `DATABASE_URL` fails — carries its OWN credentials; nothing else is ever tried (`db/connect-config.js`). |
| `PGSSLMODE` | optional | `no-verify` | no | TLS when the URL has no `sslmode`. Neither set: a sealed env uses TLS without verification (every host); any other env no TLS. |
| `PGSSL` | optional | `disable` | no | Old switch, still honoured: `disable` = no TLS when neither `sslmode` nor `PGSSLMODE` says otherwise. |
| `DB_BOOT_WAIT_MS` | optional | `15000` | no | How long a request waits for the pool at boot. |
| `DB_STATEMENT_TIMEOUT_MS` | optional | `15000` | no | Per-statement deadline; 0 = off. |
| `DB_SLOW_MS` | optional | `500` | no | Logs statements slower than this. |
| `DB_QUERY_LOG` | optional | `true` | no | Logs every query fingerprint (debug). |
| `RLS_GUARD` | optional | `warn` | no | Context-free tenant query: `off` · `warn` · `throw`. |
| **Sign-in & mail** | | | | |
| `OTP_EMAIL_ENABLED` | in production | `true` | no | Sends sign-in codes by e-mail; must be `true` when sealed. |
| `RESEND_API_KEY` | in production | `re_<key>` | yes | Resend key for every outgoing e-mail. |
| `FROM_EMAIL` | in production | `noreply@your-domain.example` | no | Sender address of every e-mail. |
| `RESEND_BASE_URL` | optional | `http://mailsink:8025` | no | Resend SDK endpoint override (read by the SDK, not our code). |
| `LEADS_EMAIL` | optional | `leads@your-domain.example` | no | Where simulator leads are mailed; default `FROM_EMAIL`. |
| `SIM_JWT_SECRET` | optional | `<32+ random chars>` | yes | Signs simulator lead links; default derives from `JWT_SECRET`. |
| `MAX_OTP_ATTEMPTS` | optional | `5` | no | Wrong-code tries before an OTP dies. |
| `EMAIL_INBOUND_SECRET` | optional | `<random>` | yes | HMAC for the inbound e-mail webhook; unset = inert. |
| **Messaging** | | | | |
| `WHATSAPP_TOKEN` | optional | `<Meta access token>` | yes | Sends WhatsApp replies and fetches media. |
| `WHATSAPP_APP_SECRET` | optional | `<Meta app secret>` | yes | Verifies inbound WhatsApp webhook signatures. |
| `WHATSAPP_VERIFY_TOKEN` | optional | `<random>` | yes | Answers Meta's webhook verification handshake. |
| `WHATSAPP_GRAPH_BASE` | optional | `https://graph.facebook.com/v21.0` | no | Graph API base. |
| `WHATSAPP_MEDIA_MAX_BYTES` | optional | `5000000` | no | Largest inbound media fetched. |
| `SMS_PROVIDER` | optional | `<provider>` | no | SMS OTP provider name; adapter not built (stub). |
| `SMS_API_KEY` | optional | `<key>` | yes | SMS provider key (stub). |
| `SMS_SENDER_ID` | optional | `CHITBR` | no | SMS sender id (stub). |
| `SMS_INBOUND_SECRET` | optional | `<random>` | yes | Presence marks the SMS channel configured. |
| **AI** | | | | |
| `ANTHROPIC_API_KEY` | optional | `sk-ant-<key>` | yes | Enables the AI engine (`lib/ai.js`). |
| `AI_MODEL` | optional | `claude-haiku-4-5-20251001` | no | Model for the AI engine. |
| `AI_PRICE_IN` / `AI_PRICE_OUT` | optional | `1` / `5` | no | USD per million tokens, for metering. |
| `AI_MAX_TOKENS` | optional | `4000` | no | Max output tokens per call. |
| `AI_MAX_IMAGES` / `AI_MAX_IMAGE_B64` | optional | `4` / `1400000` | no | Image count and size caps per call. |
| `AI_FREE_USD` | optional | `1.0` | no | Free AI allowance per entity. |
| `AI_RATE_PER_HOUR` / `AI_RATE_PER_DAY` | optional | `60` / `300` | no | Per-entity AI call limits. |
| `AI_GATE` | optional | `on` | no | `off` disables the AI spend gate. |
| `AI_GLOBAL_DAILY_USD` | optional | `25` | no | Platform-wide daily AI spend ceiling. |
| `AI_METER_FAIL_MAX` | optional | `20` | no | Tolerated metering failures before refusing. |
| `AI_SKILL_TTL_MS` | optional | `60000` | no | Cache life of AI skill rows. |
| `ASSIST_LLM_PROVIDER` | optional | `anthropic` | no | Assistant provider; only `anthropic` is wired. |
| `ASSIST_LLM_API_KEY` | optional | `sk-ant-<key>` | yes | Assistant provider key. |
| `ASSIST_LLM_MODEL` | optional | `claude-haiku-4-5-20251001` | no | Assistant model. |
| `OPENAI_API_KEY` | optional | `sk-<key>` | yes | Speech-to-text via OpenAI; flags forms AI available. |
| `SPEECH_PROVIDER` | optional | `openai` | no | Speech engine; default `openai` when a key exists. |
| `SPEECH_MODEL` | optional | `whisper-1` | no | Speech model. |
| `SPEECH_TIMEOUT_MS` | optional | `20000` | no | Speech request timeout. |
| `WHISPER_URL` | optional | `http://whisper:8080` | no | Self-hosted whisper server; unset = audio kept, not sent. |
| `FORMS_AI_PROVIDER` | optional | `<provider>` | no | Marks AI form-fill available. |
| `FORMS_ERP_PROVIDER` / `FORMS_ERP_KEY` | optional | `<provider>` / `<key>` | key: yes | Marks ERP form source available (inert). |
| `FORMS_IOT_PROVIDER` / `FORMS_IOT_KEY` | optional | `<provider>` / `<key>` | key: yes | Marks IoT form source available (inert). |
| `FORMS_REGISTRY` | optional | `<JSON>` | no | Overrides the forms registry. |
| **KYB / Sandbox** | | | | |
| `SANDBOX_API_KEY` / `SANDBOX_API_SECRET` | optional | `<key>` / `<secret>` | yes | Sandbox.co.in GST/PAN/IEC verification. |
| `SANDBOX_BASE` | optional | `https://api.sandbox.co.in` | no | Sandbox API base. |
| `SANDBOX_API_VERSION` / `SANDBOX_AUTH_VERSION` | optional | `1.0` / `1.0.0` | no | Sandbox API version headers. |
| `SANDBOX_GST_PATH` / `SANDBOX_PAN_PATH` / `SANDBOX_IEC_PATH` | optional | `/gst/compliance/public/gstin/search` | no | Sandbox endpoint paths. |
| `CB_KYB_PROVIDER` | optional | `sandbox` | no | Selects the KYB verifier: `sandbox` or `generic`. |
| `CB_KYB_BASE` / `CB_KYB_KEY` | optional | `https://kyb.example/verify` / `<key>` | key: yes | Generic KYB provider endpoint and bearer key. |
| `KYB_FIELD_PROVIDER` / `KYB_FIELD_KEY` | optional | `<provider>` / `<key>` | key: yes | Market-demand provider (adapter not built). |
| `KYB_FIELD_COST_USD` | optional | `0.02` | no | Metered cost per field lookup. |
| `KYB_FIELD_CACHE_HOURS` | optional | `24` | no | Field lookup cache life. |
| `KYB_EXPIRY_WINDOW_DAYS` | optional | `60` | no | Warn window before a document expires. |
| `KYB_CONCENTRATION_PCT` | optional | `40` | no | Buyer-concentration warning threshold. |
| `KYB_STRUCTURAL` | optional | `<JSON>` | no | Overrides structural KYB rules. |
| **Storage** | | | | |
| `STORAGE_ADAPTER` | optional | `db` | no | `object` sends attachments to the object store. |
| `S3_ENDPOINT` | optional | `https://s3.ap-south-1.amazonaws.com` · `https://<acct>.r2.cloudflarestorage.com` · `http://minio:9000` · `https://<ref>.supabase.co/storage/v1/s3` | no | Object store base. With the key pair below: the S3 API, SigV4 (HX1). With `S3_KEY`: Supabase Storage REST (`https://<ref>.supabase.co`). |
| `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` | optional | `<access key>` · `<secret>` | secret: yes | HX1: S3 API credentials — the secret signs requests and is never sent. |
| `S3_REGION` | optional | `us-east-1` | no | SigV4 region (R2: `auto`; MinIO: `us-east-1`; Supabase: the project's region). |
| `S3_PATH_STYLE` | optional | `true` | no | `false` = `<bucket>.<host>` (AWS virtual-hosted); default path-style (`<endpoint>/<bucket>/<key>`). |
| `S3_KEY` | optional | `<service key>` | yes | Supabase Storage REST bearer key — used only when no access key pair is set (production before HX1). |
| `S3_BUCKET` | optional | `cb-attach` | no | Object store bucket (private). |
| **Limits & tuning** | | | | |
| `RATE_LIMIT_MAX` | optional | `500` | no | General `/api` requests per window per client. |
| `AUTH_RATE_LIMIT_MAX` | optional | `30` | no | Sign-in attempts per window. |
| `CHECK_LOGIN_RATE_LIMIT_MAX` | optional | `120` | no | Login-check calls per window. |
| `CATALOGUE_RATE_LIMIT_MAX` | optional | `60` | no | Public catalogue reads per window. |
| `ASSIST_RATE_LIMIT_MAX` | optional | `40` | no | Assistant calls per window. |
| `BODY_LIMIT_DEFAULT` / `BODY_LIMIT_LARGE` | optional | `256kb` / `8mb` | no | Request body caps. |
| `REQUEST_TIMEOUT_MS` | optional | `30000` | no | Request deadline. |
| `IDEMPOTENCY_WINDOW_HOURS` | optional | `48` | no | How long an idempotency key is remembered. |
| `IMPORT_PREFLIGHT_MAX` / `IMPORT_COMMIT_MAX` / `PRODUCTS_BULK_MAX` | optional | `60` / `20` / `60` | no | Product import/bulk rate limits. |
| `TILL_CATALOGUE_MAX` / `TILL_DELTA_CAP` | optional | `20` / `20000` | no | Counter catalogue rate and delta size caps. |
| `NOTIF_FEED_DAYS` | optional | `90` | no | Notification feed look-back. |
| `WORKPATTERN_MEMO_TTL_MS` | optional | `300000` | no | Work-pattern cache life. |
| `CB_DISPUTE_WIDEN_CATEGORIES` | optional | `fraud,quality` | no | Dispute categories whose audience is widened. |
| `RETENTION_GRACE_DAYS` / `RETENTION_SOFT_DELETE_DAYS` / `RETENTION_MAX_EXTEND_DAYS` | optional | `30` / `7` / `365` | no | Retention sweep windows (sweep is not scheduled). |
| `RETENTION_MAX_ROWS_PER_RUN` / `RETENTION_MAX_PCT_PER_RUN` | optional | `1000` / `20` | no | Retention runaway guardrails. |
| `LOG_LEVEL` | optional | `info` | no | Minimum log level. |
| `CB_TRIPS` | optional | `1` | no | Counts DB round trips per request. |
| **Timers** | | | | |
| `BOOKS_NIGHTLY` | optional | `0` | no | `0` stops the 6-hourly books check. |
| `CRM_SWEEP` | optional | `0` | no | `0` stops the 6-hourly follow-up sweep. |
| **Platform metadata** | | | | |
| `SOURCE_COMMIT` | optional | `<git sha>` | no | Commit shown on `/health` (neutral name). |
| `RAILWAY_GIT_COMMIT_SHA` | optional | set by Railway | no | Commit on `/health`; wins over `SOURCE_COMMIT`. |
| `RAILWAY_REPLICA_REGION` / `RAILWAY_REGION` | optional | set by Railway | no | Region on `/health`; no neutral equivalent. |
| **Testers on a deployed api (SEC1)** | | | | |
| `TESTER_CODE` | optional | `<8+ characters, Athi's secret>` | **yes** | The one sign-in code testers use with ANY sign-in name, on as many shops as they like. Checked on verify only (never issued, e-mailed, logged or echoed; timing-safe). Unset or shorter than 8 → no tester code works. Works in a sealed env too. May carry ONE `{yymmdd}` / `{yyyymmdd}` (a daily code, SEC1b). ⚠️ TEMPORARY — remove before real users (boot warns while set). |
| `TESTER_CODE_TZ` | optional | `Australia/Sydney` | no | SEC1b, TEMPORARY: the zone whose day fills `{yymmdd}` / `{yyyymmdd}` in `TESTER_CODE` (default `Asia/Kolkata`). Remove with `TESTER_CODE` before real users. |
| `TESTER_NAMES` | optional | `*@test.chitbridge,anil-tester` | no | Comma list of exact sign-in names or `*` patterns; set → the tester code works only for those names; unset → any name. |
| **Local stack only — refused anywhere else** | | | | |
| `DEV_OTP` | local stack only | `1` | no | Arms the fixed entity / customer / connector codes (values: lib/dev-otp.js LOCAL STACK block, docs/SIM-LOAD.md). They work ONLY when DATABASE_URL's host is 127.0.0.1 / localhost / ::1 AND `NODE_ENV=development`; a sealed env refuses to boot with it. |
| `DEV_OTP_CUSTOMER` / `DEV_OTP_CONNECTOR` | local stack only | `<digits>` | no | Override the fixed customer / connector codes while `DEV_OTP` armed (local stack only). |
| `DEV_OTP_IN_RESPONSE` | local stack only | `true` | no | Echoes the fixed code in API responses (local stack only). |
| **Dev/test only — never in production** | | | | |
| `SHOP_CLOCK_ALLOW` | never in production | `1` | no | Lets tests move the shop clock. |
| `BOOKS_DEV_ENGINES` | never in production | `1` | no | Loads books engines from a sibling checkout. |
| `TEST_BOARD_ENTITY` | never in production | `<entity uuid>` | no | Shared test-result board entity. |
| `TEST_BOARD_WRITERS` | never in production | `<uuid>,<uuid>` | no | Entities allowed to write the test board. |

Not read anywhere: `mysql2` is a dependency with no `require`. The `/health` `environment` field echoes `NODE_ENV`.

## web — how a deploy points the site at its api (HX1: ONE runtime config)

| Mechanism | Where | Notes |
|---|---|---|
| `/config.js` → `window.CB_API` | `public/config.js`; loaded first by every page that calls the api (e2e/guard-static.cjs §17 checks both) | THE one place. The committed value is the production api, because Vercel serves the file as it is. |
| `CB_API_BASE` (container) | `deploy/40-cb-api-base.sh` | writes `/config.js` at start; unset = the committed value. |
| Vercel | — | to point a Vercel deploy elsewhere, change `public/config.js` (one line) — or add a build step that writes it from `CB_API_BASE`. |
| `localStorage.cb_api_base` | `public/app/shell.js` `apiBase()`, app.html `CFG.API_BASE` | per-browser override (`'stage'` = `window.CB_API`); `localhost` ⇒ `http://localhost:3000` (dev). |
| Counter on a shop PC | `tools/tally-connector/till.js` serves `/config.js` from `connector.json` (`api`, `web`; `web` else the api's `/health` `web`) | the kit download writes both (`PUBLIC_API_BASE`/request host · `PUBLIC_WEB_BASE`/the page's Origin). |
| api side | `ALLOWED_ORIGINS` must list the web origin | otherwise browser calls get 403 `ORIGIN_NOT_ALLOWED`. |
| Guard | web `e2e/guard-static.cjs` §17 · api `tests/hosting-neutral.test.cjs` | fail on any new `*.railway.app` / `*.vercel.app` literal in shipped code. Named exceptions: `public/config.js` (the value), `till.html` cbHome's fallback for pre-HX1 kits, `server.js` CORS default (🟡), the two workflows until the patch below is applied. |

## Production stays identical — the values the owner sets (HX1; set BEFORE the api of round HX1 is deployed)

| Where | Name | Value | Why |
|---|---|---|---|
| Railway (api) | `DATABASE_URL` | today's value **with `sslmode=no-verify` appended** (`…/postgres?sslmode=no-verify`) | the code no longer guesses TLS from the host. (Sealed env without it also keeps TLS-unverified — this makes it explicit.) |
| Railway (api) | `DB_POOLER_URL` | the pooler the api uses today: Railway's deploy log line `DB connected via pooler: <host> as <user>` names it → `postgres://<user>:<the same password>@<host>:6543/postgres?sslmode=no-verify` (e.g. user `postgres.<project-ref>`, host `aws-1-ap-south-1.pooler.supabase.com`) | ⚠️ the hard-coded pooler retry is GONE. If the log says `DB connected via DATABASE_URL`, leave this unset. Simpler alternative: put that pooler URL in `DATABASE_URL` itself and leave `DB_POOLER_URL` unset. |
| Railway (api) | `PUBLIC_WEB_BASE` | `https://chitbridge-web.vercel.app` | seeded catalogue pictures keep their absolute address; the counter kit and `/health` name the site. |
| Railway (api) | `DB_POOLER_FALLBACK`, `SUPABASE_REF` | delete (no longer read) | — |
| Railway (api) | `S3_ENDPOINT` · `S3_KEY` · `S3_BUCKET` | unchanged | `S3_KEY` without an access key pair keeps Supabase Storage REST exactly. To move to Supabase's S3 endpoint instead: `S3_ENDPOINT=https://<ref>.supabase.co/storage/v1/s3`, `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` from Supabase › Storage › S3 access keys, `S3_REGION=<project region>`. |
| Supabase | run `migrations/b304_schema_migrations.sql` (as postgres), then once: `node tools/migrate.cjs --db "<owner url>" --record-through b304` | — | the ledger, backfilled with what production already has. Each later manual run: `--record <file>`. `--status` lists pending files. |
| GitHub (api repo) | apply `docs/patches/HX1-workflows-api-url.patch` (this round's token may not push workflows) · Settings › Variables › `API_URL` = `https://chitbridge-api-production.up.railway.app` | — | uptime/governance read the api from the variable; uptime fails loudly while it is unset. |
| Vercel (web) | nothing | — | `public/config.js` already names the production api. |

## CTP — what a cross-installation exchange needs (HX1)

The manifest `GET /.well-known/ctp.json` is served by the **api** (`routes/ctp.js`, mounted at `/`, before any static or 404); the web
never answers it — `vercel.json` rewrites everything EXCEPT `/.well-known/`, and `deploy/nginx.conf` returns the file or 404 there
(deploy/proof.sh checks both: api 200 JSON · web 404). Peers fetch `https://<installation.domain>/.well-known/ctp.json` with no redirect
(`lib/ctpdirectory.js`, `redirect:'error'`), so:
- **DNS**: a public name for the API (e.g. `api.your-domain`) — not the web's name. That name goes in `installation.domain` (and `ctp_endpoint`) on both sides.
- **TLS**: a certificate from a public CA on that name (peers use Node's default CA store; http only for loopback).
- **Keys**: `CTP_PRIVATE_KEY` (Ed25519 PKCS#8 PEM — `lib/ctpkeys.js` has the keygen helper) and `INSTALLATION_KEY` on each side; the manifest publishes the public key.
- **Peer row**: the other installation with `hosted_locally = false`, and the population's `ctp_peers` naming it (default-deny).
- If the domain must stay on the web's name: proxy `/.well-known/ctp.json` (only) from the web host to the api — never a redirect.

## The migration ledger (HX1)

`schema_migrations` (b304) — one row per `migrations/` file a database has had: `filename · sha256 · applied_at · applied_by · source`
(`migrate` = the tool ran it · `recorded` = `--record` · `manual` = a hand INSERT). `tools/migrate.cjs` (moved from sim-load's schema
step): `--db <url>` applies an empty database's chain or only what the ledger lacks, recording each file; a populated database with an
EMPTY ledger is left alone. `--status` reads; `--record <file…>` / `--record-through bNNN` write rows without running SQL. Nothing runs
it on production: the owner runs the SQL, then records it.

## Running it anywhere — deploy/compose.yml

The stack (HX0): `db` Postgres 16 · `migrate` one shot (`tools/migrate.cjs` = `000_baseline` → `part2` → every `bNNN` on an empty
database, only the unrecorded ones later — HX1 ledger; then `cb_app`'s password) · `api` this repo's `Dockerfile` (`node:20-alpine`, user `node`, `/health` healthcheck,
`NODE_ENV=production`) · `web` chitbridge-web's `Dockerfile` (unprivileged nginx, the `vercel.json` rewrite) · `mailsink` (profile
`proof` only: a Resend stand-in so a walk can read the sign-in code) · `minio` + `minio-bucket` (profiles `minio`/`proof`: an
S3-compatible store; the api reaches it over SigV4). Ports bind to 127.0.0.1 — put TLS in front for anything public.

```
cp deploy/env.example deploy/.env      # fill it (the variables below)
docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build --wait
bash deploy/proof.sh                    # or: up → load a shop → /health → web → stack walk → down -v (≈ 90 s on a runner)
```

What a platform script fills (`deploy/.env`; the compose file maps them onto the api variables above):

| Name | Required? | Example | Secret? | Goes to |
|---|---|---|---|---|
| `POSTGRES_PASSWORD` | always | `<long random>` | yes | the `postgres` owner (schema, migrate, the loader) |
| `CB_APP_PASSWORD` | always | `<long random>` | yes | the api's `DATABASE_URL` as `cb_app` — NOSUPERUSER NOBYPASSRLS, so row-level security holds |
| `JWT_SECRET` | always | `<64 random chars>` | yes | api `JWT_SECRET` |
| `RESEND_API_KEY` · `FROM_EMAIL` | always (sealed) | `re_<key>` · `noreply@your-domain.example` | key: yes | api sign-in mail |
| `RESEND_BASE_URL` | proof only | `http://mailsink:8025` | no | the Resend SDK endpoint |
| `WEB_ORIGIN` | always | `https://app.your-domain.example` | no | api `ALLOWED_ORIGINS` |
| `CB_API_BASE` | always | `https://api.your-domain.example` | no | web container: the api the pages call |
| `S3_ENDPOINT` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` · `S3_BUCKET` · `S3_REGION` | optional | `http://minio:9000` · … | secret: yes | object store (SigV4); with profile `minio` the same key pair is MinIO's root login. `STORAGE_ADAPTER=object` puts attachments there too |
| `NODE_ENV` | optional | `production` | no | api; default `production` |
| `DB_PORT` · `API_PORT` · `WEB_PORT` | optional | `5432` · `3000` · `8080` | no | host ports (127.0.0.1) |
| `CB_WEB_DIR` | optional | `../../chitbridge-web` | no | where the web checkout is, for its image build |

Fixed in `compose.yml` (not inputs): `DATABASE_URL` ends `?sslmode=disable` (the compose network is private; use
`sslmode=no-verify`/`verify-full` for a managed database) · `OTP_EMAIL_ENABLED=true` · `PUBLIC_WEB_BASE` = `WEB_ORIGIN`.
`migrate` records every file in `schema_migrations`; a second `up` runs only new files (and retries the ones that failed — ops roles,
one-off data scripts — which are listed, not recorded).

## Cloud spins — AWS · Azure · GCP · Railway (HX2)

`deploy/<platform>/spin.sh` makes one isolated ChitBridge (Postgres, the api image, the web image, an object store where the platform
has an S3 API, TLS on the platform's own name, a mail sink for the test) — `test.sh` runs `deploy/spin-test.sh` (migrate twice, the sim
shop, `/health`, CTP manifest, the stack walk) — `teardown.sh` deletes what carries the spin's tag and prints the cost. The api's
environment is `deploy/spin-lib.sh` `spin_api_env`: only names from the table above (`tests/spin-scripts.test.cjs` holds that). The
owner's secrets, cost per day and limits: `deploy/<platform>/README.md`. Native vs portable per platform: `docs/HOSTING-COUPLING.md`.
CI: `.github/workflows/spin-test.yml` (manual only) — `docs/patches/HX2-spin-test.patch`, the coordinator applies it.

| Name | Where | What |
|---|---|---|
| `CB_SPIN_ID` | the scripts; `tools/sim-load.cjs` | the spin (`s` + 7 hex). sim-load accepts a remote host ONLY when it is set and the database is `cbspin_<id>` |
| `CB_SPIN_COUNTRY` | the scripts (`deploy/spin-lib.sh` spin_installation) | GOV-SPIN: ISO-2 (e.g. `AU`) — the spin's own `installation` row (`cbspin-<id>`) STATES this country (b382), so registration offers it first and the registrant accepts it. Unset → no country stated (registration asks) |
| `MAIL_SINK_TOKEN` | `deploy/mail-sink.cjs` | a public sink answers only to `authorization: Bearer <token>`; the spin sets it = the api's `RESEND_API_KEY` |
| `PLAN=1` · `PARSE=1` | every spin/test/teardown | print the commands · let aws/az/gcloud parse each one with no credentials (`deploy/spin-check.sh`) |
| `SIM_YEARS` · `CTP_PEER_API` | `deploy/spin-test.sh` | years of the sim shop (1) · another spin's api for the CTP check |

## Testers' sign-in code (SEC1, 14 Oct)
Set `TESTER_CODE` (and optionally `TESTER_NAMES`) in Railway → Variables; share the code with testers privately (never in a chat
that is logged, a ticket or the repo); change it any time — no deploy, the api reads it on every sign-in. Testers keep today's ease:
any sign-in name, one remembered code, as many shops as they like. Choose 8+ DIGITS: phones open the number pad on the code box
(letters work on a keyboard). The fixed local codes no longer work on Railway. A sign-in answer never
says whether a tester code exists (the boot log says one is active — the TEMPORARY warning below — never its value); guessing is capped by the sign-in rate limiter (30 tries / 15 min per IP,
`AUTH_RATE_LIMIT_MAX`) and by 5 wrong codes per account (`MAX_OTP_ATTEMPTS`). The cloud e2e reads it from the GitHub secret
`E2E_TESTER_CODE` (web repo) and skips with a warning while that is unset.

**A code that changes by itself every day (SEC1b — TEMPORARY, testing phase only).** Put ONE date placeholder in the code:
`{yymmdd}` (261014) or `{yyyymmdd}` (20261014), e.g. `TESTER_CODE=<your word>{yymmdd}`. The api fills it with TODAY in India
(`TESTER_CODE_TZ` — an IANA zone like `Australia/Sydney` — overrides), and also takes yesterday's code until 06:00, so a tester who
signed in near midnight is not locked out. Testers work out the day's code themselves — nobody needs to log in to e-mail. Put the
SAME template in `E2E_TESTER_CODE`; the cloud e2e fills it the same way. The code after filling must be 8+ characters, else no tester
code works and the boot log says why. ⚠️ Weaker than a random code: anyone who learns the fixed part knows every future day's code —
keep the fixed part private and change it if it leaks. Every boot logs at WARN *"TEMPORARY: a tester sign-in code is active (testing
phase). Remove TESTER_CODE before real users."*

### Before real users — REMOVE
- [ ] Railway → Variables → DELETE `TESTER_CODE`, `TESTER_NAMES`, `TESTER_CODE_TZ`; web repo → Secrets → DELETE `E2E_TESTER_CODE`.
- [ ] Boot log shows no "TEMPORARY: a tester sign-in code is active" line. (The cutover checklist at the top of lib/dev-otp.js, item 4.)
