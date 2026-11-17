# Deploy runbook — dev/staging first, then fix, then prod

Chosen path (2026-06-28): **push the held batch → deploy to DEV only → run migrations + tests + smoke → fix the
must-fixes → promote to prod as a separate reviewed step.** Matches the standing rule: *live = dev env only;
nothing reaches production without a conscious review.*

## 0. Held state (what gets pushed)
- **api:** branch `feat/restore-endpoint` @ `4d3d25a` (no upstream yet — first push needs `-u`).
- **web:** branch `feat/panel-fixes` @ `52acb99` (no upstream yet).
- Full-history bundles in `Downloads/`: `cb-api-backup.bundle`, `cb-web-backup.bundle` (rollback safety net).
- Demo path verified intact (`DEMO` / `demoApi` untouched; the assistant's `askLLM` returns null in demo mode).

## 1. Push (only once the GitHub throttle has cleared)
```
# api
git -C <api>  push -u origin feat/restore-endpoint
# web
git -C <web>  push -u origin feat/panel-fixes
```
Do NOT force-push, do NOT push to `main`/`master`. Open PRs for review; do not auto-merge.

## 2. Deploy to DEV/staging only
- **API → Railway (dev service):** deploy the branch. Confirm `npm install` runs (new dep **`@anthropic-ai/sdk`**).
- **Web → Vercel (preview/dev):** deploy the branch.
- **Env (DEV):** `NODE_ENV=development`, **strong `JWT_SECRET` (≥32 chars)**, `ALLOWED_ORIGINS=<dev web origin>`.
  Leave `ASSIST_LLM_PROVIDER` / `ASSIST_LLM_API_KEY` **unset** → assistant stays on the free library floor.
  Keep web `CFG.ASSIST_LLM=false`. (Optional: `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`, `CATALOGUE_RATE_LIMIT_MAX`.)

## 3. Run migrations on the DEV DB — BEFORE smoke
Applied state: `node tools/migrate.cjs --db <url> --status` once b304 has run (HX1 ledger; `--record <file>` after each manual run — docs/HOSTING.md). Until then it is manual — apply any not-yet-applied, in order. The ones this
session's features **depend on** (apply these for sure if absent):
- `migration_chit_reads.sql`       — per-actor unread (the unread feature breaks without it)
- `migration_dispute_routing.sql`  — entity dispute-handler routing
- `migration_chit_direction.sql`   — `direction` column
- `migration_check_constraints.sql`— `CHECK (direction IN ('sent','received'))` (NOT VALID)
Apply with `psql "$DATABASE_URL" -f <file>`. These are additive / NOT VALID, so safe on existing rows.

## 4. Verify on DEV (don't skip — nothing was integration-tested live this session)
- `TEST_URL=<dev api> node tests/run-tests.js` (needs the server up + `dev_otp`, i.e. NODE_ENV=development).
- `npm run test:jest` (`tests/*.spec.js` — supertest against `src/app.js`). ⚠️ Needs a LOCAL Postgres:
  the suites TRUNCATE cb_* tables, and jest.setup.js refuses a non-local DATABASE_URL. Renamed to `.spec.js`
  2026-08-30 — jest was matching `*.test.js`, which also matched ~35 standalone node scripts whose
  `process.exit()` killed the run while jest still exited 0.
- **Manual smoke:** register/login → compose → send (two-copy) → task act → dispute raise/resolve → co-assist
  push/pull → notifications/bell → **customer storefront order** → **demo path still works** → **💬 assistant +
  "?" on each screen** (incl. new coassists/schema contexts) answer from the library floor.

## 5. Land the must-fixes — DRAFTED on branch `feat/must-fixes` (merge after dev smoke)
Both are drafted/held on `feat/must-fixes` (off `feat/restore-endpoint`). After the dev smoke on the base batch,
merge this branch and re-smoke:
1. **Order price validation** ✅ drafted — `repriceAgainstCatalogue()` in `catalogue.js` (server-authoritative
   prices, fail-closed). *Smoke check:* place a real storefront order; confirm a tampered price is ignored and an
   honest order still succeeds (verifies the line-item shape + `item_data.price` assumptions).
2. **Network body-authority** ✅ interim drafted — writes gated off via `NETWORK_WRITE_ENABLED` (default false →
   `503`). *Smoke check:* network reads work; writes return `NET_WRITE_DISABLED` unless the flag is set in dev.
   The **full** fix (derive `actingEntityId` from `req.identity` via the `cb_entity↔identities` bridge) remains
   Track B / ATH-86 — see `NETWORK-AUTHORITY.md`.
3. **OTP attempt-counter** ✅ drafted — `lib/otp.js` + wiring in `catalogue.js`/`entities.js`; needs
   **`migration_otp_attempts.sql`** applied. *Smoke check:* 5 wrong OTPs → locked (429); a fresh OTP unlocks.
4. **`assign-bulk` transactional** ✅ drafted (`chits.js` now uses `withTransaction`). *Smoke check:* bulk-assign
   several chits succeeds; counts stay consistent.

### Migrations added by this branch
Apply on the DEV DB together with the §3 list: **`migration_otp_attempts.sql`** (adds `identities.otp_attempts`).

### ⚠️ Before PROD (enforced at boot)
`DEV_OTP` pins every OTP to a fixed value for testing — on a LOCAL stack only (SEC1: DATABASE_URL host 127.0.0.1 / localhost /
::1 and `NODE_ENV=development`); on Railway it does nothing. The server **aborts boot in production if `DEV_OTP` is set**
(alongside the `JWT_SECRET` guard). **Unset `DEV_OTP` for prod** so OTPs are random.

### Testers' sign-in code (SEC1)
Set `TESTER_CODE` (8+ characters; and optionally `TESTER_NAMES`) in Railway → Variables; share it with testers privately; change it
any time — no deploy. A `{yymmdd}` in it makes it change by itself every day (SEC1b). Details: docs/HOSTING.md "Testers' sign-in code".
⚠️ TEMPORARY — testing phase only; every boot warns while it is set.

## 6. Promote to PROD — separate, conscious, reviewed step
Re-check `TECH-HARDENING-BACKLOG.md` "Re-check before UAT/Prod". Set prod env (strong secret, prod CORS origin).
Apply the same migrations on the prod DB. Only after dev is green + must-fixes landed.

**Before real users — REMOVE** (SEC1/SEC1b, temporary testing-phase arrangement):
- [ ] Railway → Variables → DELETE `TESTER_CODE`, `TESTER_NAMES`, `TESTER_CODE_TZ`.
- [ ] Web repo → Settings → Secrets → Actions → DELETE `E2E_TESTER_CODE`.
- [ ] Boot log has no "TEMPORARY: a tester sign-in code is active" line.

## Rollback
- Code: redeploy the previous Railway/Vercel build; or restore from the `Downloads/*.bundle`.
- DB: the listed migrations are additive/NOT VALID (no destructive change), so no down-migration needed for them.

## Not in this deploy (known, deferred — see TECH-HARDENING-BACKLOG.md)
Subscription/quota enforcement (+9 open product questions), dead actor-settings, MIS server rollup, CSP,
token revocation/short TTL, `error_log`/critical-alert sink, `?limit=` cap + `statement_timeout`, isolation
regression test, AI-assisted schema building, real screen clips, turning the Haiku assistant on (needs a key).

## Nightly backup (BKP1, 2026-10-14)
**Where:** the PRIVATE repo `maharishia07/chitbridge-engines`, `.github/workflows/backup-nightly.yml`, 20:30 UTC daily. It runs this repo's
`deploy/backup.sh` (pinned commit): `pg_dump | openssl aes-256-cbc -pbkdf2 -iter 200000` → `cb-YYYY-MM-DD.enc`, then decrypts it into a
throwaway Postgres and counts chit_header · journal_entry · identities · catalogue_items · books_setting. Red if any is missing or
identities is empty. The `.enc` is kept 14 days as an artifact of that private repo. This public repo only dry-runs the path (`backup-restore.yml`).
**Never set the backup secrets in this (public) repo** — `tests/backup-guard.test.cjs` fails if a workflow here reads them.

**1 · A read-only role** (Supabase → SQL editor, as `postgres`; choose the password there, never paste it anywhere else):
```sql
CREATE ROLE cb_backup LOGIN PASSWORD '<long random>' BYPASSRLS;   -- BYPASSRLS: pg_dump refuses tables with RLS otherwise
GRANT USAGE ON SCHEMA public TO cb_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cb_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO cb_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO cb_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO cb_backup;
```
If Supabase refuses `BYPASSRLS`, use the `postgres` role's URI instead and say so in the board — the job still only reads.

**2 · The two secrets** — github.com/maharishia07/chitbridge-engines → Settings → Secrets and variables → Actions:
- `BACKUP_DATABASE_URL` = Session pooler URI (IPv4; runners have no IPv6) with user `cb_backup.<project-ref>` and that password.
- `BACKUP_PASSPHRASE` = 20+ random characters (`openssl rand -base64 32`). **Athi keeps a copy OFFLINE (paper / password manager).
  Without it every backup is unreadable — by us too. Nobody can recover it.** Changing it later only affects new backups.
Missing either → the job is red and nothing is dumped. Run it once by hand: Actions → backup-nightly → Run workflow.

**3 · Restore by hand** (Postgres 17 client, a NEW empty database — never production unless that is the decision):
```bash
# download cb-YYYY-MM-DD.enc from the run's artifacts (chitbridge-engines → Actions → backup-nightly), unzip it, then:
export BACKUP_PASSPHRASE='<the offline copy>'
bash deploy/backup.sh prove cb-YYYY-MM-DD.enc "postgresql://postgres:<pw>@<host>:5432/<empty db>"   # decrypt → restore → counts
# or by hand: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in cb-….enc | pg_restore --no-owner --no-privileges -d "<url>"
```
The plaintext is never written to disk on the way; `prove` creates the Supabase roles/extensions the dump refers to first.

## Going sealed — checklist (INT7c, after the 15 Oct 20:39–21:05 outage: `NODE_ENV=production` crashed on `OTP_EMAIL_ENABLED`)
Set ALL of these on the host BEFORE you set `NODE_ENV=production`; the server lists every missing one in one log line (`boot aborted: N setting(s) to fix — …`) and exits once.
- [ ] `NODE_ENV=production` (trimmed; the last thing you set)
- [ ] `OTP_EMAIL_ENABLED=true` — with `RESEND_API_KEY` + `FROM_EMAIL` (real sign-in mail proven first)
- [ ] no `DEV_OTP*` variables at all
- [ ] `TESTER_NAMES` set to the names/patterns allowed to use the tester code (empty = every account and a WARN at boot; `*` = every account, explicit, WARN)
- [ ] `JWT_SECRET` ≥ 32 characters · `DATABASE_URL` set
- [ ] `railway.json` carries `healthcheckPath "/health"`: a failing deploy never replaces the healthy one — watch the deploy go green before leaving.
