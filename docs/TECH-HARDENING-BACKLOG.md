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

## ⚠️ P0 — /api/network is unauthenticated + body-authority (deployed)
The `src/routes/network.js` endpoints (register, claim, connect, approve, decline, suspend, resume, disconnect,
subtree, connections) have **NO `auth` middleware** and take **`actingEntityId` from `req.body`** (client-supplied)
as their authority. Anyone can call them and assert any acting entity → register/reparent/disconnect the tree,
read any subtree/connections. Violates the P0 isolation invariant. **It is mounted in prod** (`/api/network`).
- **Scope:** the cb_* network is a SEPARATE entity space (`cb_entity`), not the core `identities`/chit data (that path
  IS JWT-scoped). So this is network-structure manipulation, not a core-tenant-data leak. The tree logic + cycle
  guard themselves are sound (tests pass).
- **Root cause:** the network module was built standalone (own `app.js`/`db`/entity space) with body-authority, never
  integrated with the JWT — the deferred "Track B" `cb_entity ↔ identities` bridge.
- **Proper fix:** add `auth`; bridge `cb_entity ↔ identities`; derive `actingEntityId` from `req.identity` (verified),
  not the body; verify the caller's authority over the edge; update `tests/network.test.js` to authenticate.
- **Note:** the frontend Network panel sends minimal bodies (e.g. `netApprove` sends `{}` — no `actingEntityId`),
  so live network ops from the panel may not work end-to-end anyway (wired mostly against demo). Awaiting decision.

## API backlog
- **[DONE] DB CHECK — direction** — `migration_check_constraints.sql` adds `CHECK (direction IN ('sent','received'))`
  NOT VALID on chit_header/status/detail. **[QUICK remaining]** add CHECK on `current_status` + `scope` after
  confirming `SELECT DISTINCT` values (don't break existing writes).
- **[DONE] Per-route error envelope** — `lib/respond.js` `safeErr(err)` logs the real error server-side and
  returns a generic client message. Swept all 71 leaks across 11 route files (0 `message: err.message` remain);
  the global handler was already sanitized.
- **[DONE] Auth-specific rate limit** — `server.js` adds a stricter limiter (30/15m, `AUTH_RATE_LIMIT_MAX`) on
  `register`/`verify`/`actors/login`/`set-pin`.
- **[BACKLOG] Atomicity gaps** — `assign-bulk` (chits.js:~1392) loops writes on the pool (not `withTransaction`)
  → a mid-loop failure leaves a partial assign. Wrap it (and any other multi-write added later) in a transaction.
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

## How to use this
Treat **[QUICK]** items as the next small hardening slice (mostly additive, low-risk). **[BACKLOG]** items are
separate implementations — pull them as dedicated tickets. Re-check this list before UAT/Prod promotion.
