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
No `schema_migrations` ledger yet, so applied-state is manual — apply any not-yet-applied, in order. The ones this
session's features **depend on** (apply these for sure if absent):
- `migration_chit_reads.sql`       — per-actor unread (the unread feature breaks without it)
- `migration_dispute_routing.sql`  — entity dispute-handler routing
- `migration_chit_direction.sql`   — `direction` column
- `migration_check_constraints.sql`— `CHECK (direction IN ('sent','received'))` (NOT VALID)
Apply with `psql "$DATABASE_URL" -f <file>`. These are additive / NOT VALID, so safe on existing rows.

## 4. Verify on DEV (don't skip — nothing was integration-tested live this session)
- `TEST_URL=<dev api> node tests/run-tests.js` (needs the server up + `dev_otp`, i.e. NODE_ENV=development).
- `npx jest` (network.test.js etc. — supertest against `src/app.js`).
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
3. (Recommended same pass, NOT yet drafted) **OTP attempt-counter**; wrap **`assign-bulk`** in `withTransaction`.

## 6. Promote to PROD — separate, conscious, reviewed step
Re-check `TECH-HARDENING-BACKLOG.md` "Re-check before UAT/Prod". Set prod env (strong secret, prod CORS origin).
Apply the same migrations on the prod DB. Only after dev is green + must-fixes landed.

## Rollback
- Code: redeploy the previous Railway/Vercel build; or restore from the `Downloads/*.bundle`.
- DB: the listed migrations are additive/NOT VALID (no destructive change), so no down-migration needed for them.

## Not in this deploy (known, deferred — see TECH-HARDENING-BACKLOG.md)
Subscription/quota enforcement (+9 open product questions), dead actor-settings, MIS server rollup, CSP,
token revocation/short TTL, `error_log`/critical-alert sink, `?limit=` cap + `statement_timeout`, isolation
regression test, AI-assisted schema building, real screen clips, turning the Haiku assistant on (needs a key).
