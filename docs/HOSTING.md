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
| `PUBLIC_API_BASE` | optional | `https://api.example.com` | no | Public api URL for OpenAPI and connector downloads. |
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
| `DATABASE_URL` | always | `postgres://cb_app:<password>@db.example:5432/chitbridge?sslmode=disable` | yes | The Postgres DSN; `sslmode` in it overrides the code's SSL guess. |
| `DB_POOLER_FALLBACK` | in production (off-Supabase) | `off` | no | `off` stops the Supabase pooler retry on connect failure. |
| `SUPABASE_REF` | optional | `<supabase project ref>` | no | Project ref used by the pooler fallback. |
| `PGSSL` | optional | `disable` | no | `disable` turns SSL off for the `src/` network pool. |
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
| `S3_ENDPOINT` | optional | `https://<ref>.supabase.co` | no | Object store base — Supabase Storage REST only today. |
| `S3_KEY` | optional | `<service key>` | yes | Object store bearer key. |
| `S3_BUCKET` | optional | `cb-attach` | no | Object store bucket. |
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
| **Dev/test only — never in production** | | | | |
| `DEV_OTP` | never in production | `123456` | no | Fixes entity OTPs; sealed env refuses to boot with it. |
| `DEV_OTP_CUSTOMER` / `DEV_OTP_CONNECTOR` | never in production | `123123` / `654321` | no | Fixed customer / connector OTPs while `DEV_OTP` armed. |
| `DEV_OTP_IN_RESPONSE` | never in production | `true` | no | Echoes the fixed code in API responses (non-sealed only). |
| `SHOP_CLOCK_ALLOW` | never in production | `1` | no | Lets tests move the shop clock. |
| `BOOKS_DEV_ENGINES` | never in production | `1` | no | Loads books engines from a sibling checkout. |
| `TEST_BOARD_ENTITY` | never in production | `<entity uuid>` | no | Shared test-result board entity. |
| `TEST_BOARD_WRITERS` | never in production | `<uuid>,<uuid>` | no | Entities allowed to write the test board. |

Not read anywhere: `mysql2` is a dependency with no `require`. The `/health` `environment` field echoes `NODE_ENV`.

## web — how a deploy points the site at its api

| Mechanism | Where | Today | Notes |
|---|---|---|---|
| Hard-coded literal | `https://chitbridge-api-production.up.railway.app` in 28 files / 33 places under `public/` (e.g. `public/app/shell.js:58-61`, `public/store.html:56`, `public/tasks.html:82`, `public/app.html:1723`, `public/app/cap-connector.js:279`) | the only deploy-wide setting | Vercel serves files as-is; there is no build-time injection. |
| `CB_API_BASE` (container only) | `deploy/40-cb-api-base.sh`, `Dockerfile` | rewrites the literal in every `.html`/`.js` at container start | unset = pages keep Railway. Not available on Vercel. |
| `localStorage.cb_api_base` | `public/app/shell.js:57-62` | per-browser override (`'stage'` = Railway) | a person's setting, not a deploy setting. |
| `localhost` / `127.0.0.1` | `public/app/shell.js:60` | ⇒ `http://localhost:3000` | dev only. |
| Counter (till) | `public/till.html:6411` (vendored from api `tools/tally-connector/till.html`) | `localStorage.cb_till_api` → `window.CB_API` → Railway | `window.CB_API` is not set by any page. |
| api side | `ALLOWED_ORIGINS` must list the web origin | — | otherwise browser calls get 403 `ORIGIN_NOT_ALLOWED`. |

## Running it anywhere — deploy/compose.yml

<!-- compose section: filled by the round -->
