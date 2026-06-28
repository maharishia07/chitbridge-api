# Technical hardening backlog (code-level)

Enterprise-grade hardening of the CB codebase — **code level only** (no cloud/infra). Reviewed 2026-06-28.
Items are tagged **[DONE]**, **[QUICK]** (safe, do soon), or **[BACKLOG]** (own slice). Held with the batch.

## Already in good shape (verified)
- Tenant isolation: `entity_id` always from the verified JWT; row-level ownership; participation gate; parameterized SQL. (P0 invariant — `feedback-tenant-isolation-invariant`.)
- `withTransaction(fn)` helper exists (`db/index.js`) and wraps the critical multi-writes: `/send` two-copy fan-out (chits.js:217) and dispute creation (916).
- Security baseline-10: JWT alg pinned HS256, CORS allowlist, error handler doesn't leak internals.

## Done now (this pass)
- **[DONE] Frontend stored-XSS in the row renderer** — `rowHTML` interpolated `${c.code}`/`${c.party}`/
  `${c.kind}` (API-supplied subject + counterparty name) into `innerHTML` without `esc()`. A malicious
  display name/subject would execute in another party's view (tokens are in `localStorage`). Now `esc()`-wrapped.
- **[DONE] Boot-time config guard** — `server.js` aborts in production (warns in dev) if `JWT_SECRET` is
  missing or < 32 chars.

## ⚠️ P0 — /api/network authority (deployed) — auth MITIGATED, writes now GATED, bridge still TODO
**MITIGATED (e6789b0):** all `src/routes/network.js` routes now require `auth` — unauthenticated access is closed
(tests updated to attach a token). **INTERIM GATE (DRAFTED — branch `feat/must-fixes`):** because `cb_entity`
is dormant (2026-06-27 ruling) and there is still no `cb_entity↔identities` bridge, the body-authority MUTATION
routes (register/claim/connect/approve/decline/suspend/resume/disconnect) are now **disabled unless
`NETWORK_WRITE_ENABLED=true`** (dev only) — they return `503 NET_WRITE_DISABLED`. Reads stay (auth required).
This removes the body-authority exposure in prod without shipping the half-built authority model.
**STILL OPEN (real fix):** authority is still taken from **`actingEntityId` in `req.body`** when writes are
enabled — a logged-in user could assert a different acting entity. Full fix below (Track B / ATH-86).
Original finding: the endpoints had **no auth** and took `actingEntityId` from the body; mounted in prod.
- **Authority cascade is ALSO absent** (the deeper half) — full per-operation gap analysis + fix spec in
  `docs/NETWORK-AUTHORITY.md`. Standouts: `approve` consent is bypassable (optional `actingEntityId`); `claim`
  is wide open (anyone takes ownership); suspend/resume/disconnect/subtree/connections have **no** authority check.
  ltree gives the cascade cheaply (`Y.path <@ X.path`). This cascade also underpins the billing-root subtree quota.
- **Scope:** the cb_* network is a SEPARATE entity space (`cb_entity`), not the core `identities`/chit data (that path
  IS JWT-scoped). So this is network-structure manipulation, not a core-tenant-data leak. The tree logic + cycle
  guard themselves are sound (tests pass).
- **Root cause:** the network module was built standalone (own `app.js`/`db`/entity space) with body-authority, never
  integrated with the JWT — the deferred "Track B" `cb_entity ↔ identities` bridge.
- **Proper fix:** add `auth`; bridge `cb_entity ↔ identities`; derive `actingEntityId` from `req.identity` (verified),
  not the body; verify the caller's authority over the edge; update `tests/network.test.js` to authenticate.
- **Note:** the frontend Network panel sends minimal bodies (e.g. `netApprove` sends `{}` — no `actingEntityId`),
  so live network ops from the panel may not work end-to-end anyway (wired mostly against demo). Awaiting decision.

## Customer flow (external, no-login) — audit 2026-06-28
Backend `catalogue.js`. **Healthy:** order is transactional (two-copy, INV-2); customers scoped per-shop
(`parent_entity_id`); public catalogue **visibility-gated** (only `visibility='public'` schemas); **my-orders
isolated per customer** (keyed on the token identity, not the path — no cross-customer leak); `business_status`
gates orders; `safeErr`. **FIXED:** `/api/catalogue` now rate-limited (7a63490).
- **[DRAFTED — branch `feat/must-fixes`] OTP attempt-counter** — `lib/otp.js` `verifyOtp()` caps wrong tries per
  account (`MAX_OTP_ATTEMPTS`, default 5) and locks the current OTP until a fresh one is issued. Wired into
  `catalogue.js` (order/confirm + login/verify) and `entities.js` (owner verify); counter resets on issue +
  success. Adds **`migration_otp_attempts.sql`** (the column was referenced in code but had no migration).
  Unit-tested (increment → lock → 429). *Note:* the internal actor-login OTP (`actors.js`, admin-shared) is left
  as a follow-up. **Fixed test OTP:** `DEV_OTP=123456` stays for dev/UAT; a boot guard now **aborts prod** if
  `DEV_OTP` is set (must be unset before production).
- **[DRAFTED — branch `feat/must-fixes`] Order price/line-item validation** — `repriceAgainstCatalogue()` in
  `catalogue.js` re-prices every customer line against the shop's active `catalogue_items` (matched by `item_id`
  or name) and recomputes totals **server-side**; fails CLOSED (422) on an unknown item, an unset price, or a bad
  quantity. A deliberate price of 0 is allowed; null/'' price is treated as "not set" → rejected. Algorithm
  unit-tested. **Confirm in dev smoke:** the real customer line-item shape (name/`item_id`) and that price lives
  in `item_data.price`.
- **[DONE — branch `feat/must-fixes`] Dual-channel customer OTP (F2 product half)** — one identifier (phone OR
  email), delivered on the same channel; `lib/notify.js` (`sendOtpEmail` extracted from `entities.js` + pluggable
  `sendOtpSms`), `identities.otp_contact` (`migration_customer_contact.sql`), full-email `.cr` key (`@`→`=`) so two
  customers never collapse. OTP never returned in a prod response.
- **[BACKLOG] F2 mechanical half — OTP-delivery boot guard** — `sendOtpSms` is a **dormant stub** (no provider
  adapter) and there is **no boot-time check** that a customer OTP channel is configured for production. Add a
  guard in `server.js` (mirroring the `JWT_SECRET` / `DEV_OTP` guards): in `NODE_ENV=production`, **abort boot** if
  neither email (`OTP_EMAIL_ENABLED=true` + `RESEND_API_KEY`) nor SMS (`SMS_PROVIDER` + `SMS_API_KEY`) is configured
  — so prod can never silently drop customer OTPs. Then implement a real SMS adapter (e.g. Twilio/MSG91) in
  `sendOtpSms` using `SMS_SENDER_ID`. (Pairs with the dual-channel product half above.)
- **[CONFIRM] Public exposure** — the public catalogue returns `gstn` + `address` (acceptable for a storefront — confirm intended).
- **[BACKLOG] Bounded read** — public catalogue `items` query has no LIMIT (folds into the max-`?limit=` cap).

## API backlog
- **[DONE] DB CHECK — direction** — `migration_check_constraints.sql` adds `CHECK (direction IN ('sent','received'))`
  NOT VALID on chit_header/status/detail. **[QUICK remaining]** add CHECK on `current_status` + `scope` after
  confirming `SELECT DISTINCT` values (don't break existing writes).
- **[DONE] Per-route error envelope** — `lib/respond.js` `safeErr(err)` logs the real error server-side and
  returns a generic client message. Swept all 71 leaks across 11 route files (0 `message: err.message` remain);
  the global handler was already sanitized.
- **[DONE] Auth-specific rate limit** — `server.js` adds a stricter limiter (30/15m, `AUTH_RATE_LIMIT_MAX`) on
  `register`/`verify`/`actors/login`/`set-pin`.
- **[DRAFTED — branch `feat/must-fixes`] Atomicity gaps** — `assign-bulk` (chits.js) now runs inside
  `withTransaction` (counts + `chit_status` + `state_log` commit together or roll back; target validated in the
  tx). No more partial assigns on a mid-loop failure.
- **[BACKLOG] Centralize enums/constants** — status (`pending|accepted|in_progress|...`), roles (`to|cc|for`/
  `Act|Info|For`), scopes, directions are string literals scattered across routes → typo risk. One `constants.js`
  shared by routes (and ideally mirrored to the frontend).
- **[BACKLOG] Validation coverage** — `express-validator` + `validate.js` used on some routes (entities/actors)
  but not uniformly (e.g. `/send` body). Audit every mutating route for input validation + length/type caps.
- **[BACKLOG] Migration discipline** — migrations are hand-run `.sql` files. Add a `schema_migrations` ledger +
  a tiny runner (or adopt a tool) so prod/UAT apply the same set in order, idempotently.
- **[BACKLOG] Remove hardcodes in `db/index.js`** — the Supabase project `ref` is hardcoded (line 30); derive it
  from `DATABASE_URL`. Region list is hardcoded too — env-drive or document.
- **[DONE→ongoing] Structured logging + request IDs** — `lib/logger.js` (leveled, `LOG_LEVEL`-toggleable, JSON,
  CRITICAL sink hook) + request-id middleware, wired into the request log / `safeErr` / global handler / boot.
  **[BACKLOG remaining]** replace the rest of `console.*`; wire `log.onCritical` → `error_log` table + alert
  channel; add max-`?limit=` cap + DB `statement_timeout`; (with connectors) circuit breaker + idempotency keys.
  Full design + risk catalogue: `docs/OBSERVABILITY-AND-SAFETY.md`.
- **[BACKLOG] Token lifecycle** — entity JWTs are 7-day, stateless, no revocation (only actors re-checked). Add a
  short access TTL + refresh, or a token-version column for server-side revoke.
- **[BACKLOG] Avoid `SELECT *`** in hot reads (chit detail) — list explicit columns (contract stability + no
  accidental new-column exposure).
- **[BACKLOG] Automated tests for the invariants** — a jest test that a second entity cannot read another's chit
  (the P0 isolation guarantee), plus core chit/auth flows; wire into CI.

## Web backlog
- **[DONE] `esc()` audit** — escaped API data in the row renderer, dispute cards, message bubbles, chit detail
  header/parties, line items, and attachment titles. (Sweep other minor render paths opportunistically.)
- **[BACKLOG] Enable a CSP** — `helmet` currently disables CSP (`contentSecurityPolicy:false`, server.js). A CSP
  is the strongest defence-in-depth against XSS; design one that allows the app's inline scripts/styles (or move
  to nonces) and turn it on.
- **[BACKLOG] De-monolith `app.html`** — ~1900 lines, one file. `core.js` started the split; continue extracting
  panels into modules. Maintainability + reviewability.
- **[BACKLOG] Token storage** — `localStorage` is XSS-reachable; evaluate httpOnly cookie auth (pairs with CSP).

## Assignment-cycle guard (design requirement — no live gap yet)
Today actor assignment is a **direct set** (`actors.js` push/pull): over-capacity is only a warning, break
returns tasks to the **pool**, and there is no `default_assignee`/delegation field — so **no cycle is possible now**.
- **[BACKLOG — mandatory when built]** If a default-assignee / delegation / auto-reroute-on-overload-or-break
  model is added (likely via the assignment `settings`), it MUST detect assignment cycles: walk the routing
  chain with a **visited-actor set + a hop cap**; if it would revisit an actor (`A→B→C→A`), stop, surface a
  clear message, and fall back to the pool (never loop). Add a test for a 3-actor cycle. This is in the
  AMENDMENT-CHECKLIST so it can't be shipped without the guard.

## Actor settings → behaviour (gaps; see ACTOR-SETTINGS-BEHAVIOUR.md)
- **[BACKLOG] Wire `entity_actor_settings`** — `assignment_model` / `default_max_tasks` / `all_task_visible` /
  `auto_return_on_short_break` are **stored but not enforced** (dead settings). Wire them, or mark "coming soon".
- **[BACKLOG] Entity-bounds-actor** — per-actor `max_tasks` is unbounded by entity policy; cap `max_tasks` ≤ the
  entity's, and apply `default_max_tasks` on create. (Subscription bounds the actor *count*.)
- **[DONE] Atomicity** — actor status-change (deactivate/remove) + break/leave task-reassignment now wrapped in
  `withTransaction` (route + count + status commit together; target validated before the tx). (`assign-bulk` still pending.)

## Consistency (ACID/BASE) — see CONSISTENCY-MODEL.md
- **[BACKLOG] MIS → server-side rollup** — MIS is computed CLIENT-SIDE from several reads (not authoritative, can
  be inconsistent). Move aggregation server-side; per metric decide live-rollup vs on-read. (Principle: business
  logic decides client vs server — no client-side computation of authoritative data.)
- **[BACKLOG] Counter drift** — `current_task_count` is soft state; increment always in the assignment's
  transaction, or compute-on-read, or add a reconcile job.
- **[BACKLOG] Universalise transactions** — wrap any remaining multi-write (e.g. `assign-bulk`) in `withTransaction`.

## Settings-level future path (document & follow)
- **[BACKLOG] Generic entity settings** — today each toggle is its own column (`self_copy_pref`,
  `dispute_handler_actor_id`). For future flags without a migration per toggle, add a single `settings JSONB`
  column on `identities` (default `{}`) + a `GET/PATCH /entities/settings` accessor, and read flags from it.
  **Convention going forward:** new per-entity behaviour toggles live in `settings` JSONB unless they need to be
  queried/indexed (then a real column). Mirror to the web `getSettings`/`saveSettings` path.
- **[BACKLOG] Subscription / entitlements / quotas** — plan-driven feature gating + hard usage caps (chits,
  entities-under-the-top-node, actors, network depth, suppliers), controlled at the billing root, with a
  feature-dependency graph (minimal-viable bundles). Mechanism built: `lib/plans.js` (placeholder tiers).
  **PARKED — 9 open product questions to decide together at the top of `docs/SUBSCRIPTION-ENTITLEMENTS.md`**;
  once answered, Claude locks the catalogue + wires migration + `requireQuota`/`requireFeature`.
  (Supersedes the simple feature-flag idea.)

## Deferred — 2026-06-28 consolidated review (do NOT do now)
- **[BACKLOG] Full Option-A write cleanup (follow-up to F3)** — natively fan `dispute_raised`/`dispute_resolved`
  to the dispute's own audience (`one_sided`→self, `targeted`→raiser+target, chit-wide→all) and drop the special
  `action IN (...)` arm from `notifications.js`. Bigger refactor; needs the self-chit dispute smoke re-run.
- **[BACKLOG] Migration discipline (interim)** — no `schema_migrations` ledger. Add a cheap **boot-time
  `information_schema` probe** that the columns the running code needs (e.g. `otp_attempts`, `otp_contact`,
  `dispute_handler_actor_id`, `direction`) actually exist, ahead of a full ledger. (See also `MANIFEST.md`.)
- **[BACKLOG] Network Track-B bridge** — `cb_entity ↔ identities`; the real fix behind the network/catalogue
  write-gate AND the F7 client-supplied-`:id` residual (derive entity from `req.identity`, not the URL).
- **[PARKED] Customer storefront** — stays parked / un-smoked this cycle; **customer social sign-in (email path)**
  is a next-cycle Track-E slice.
- **[BEFORE PROD] `fp01`** — `migration_fp01.sql` is a reconstruction of already-applied prod columns; **diff it
  against the real prod schema before any production apply**.

## How to use this
Treat **[QUICK]** items as the next small hardening slice (mostly additive, low-risk). **[BACKLOG]** items are
separate implementations — pull them as dedicated tickets. Re-check this list before UAT/Prod promotion.
