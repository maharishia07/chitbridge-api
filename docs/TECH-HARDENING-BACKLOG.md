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

## API backlog
- **[QUICK] DB CHECK constraints** — add `CHECK (direction IN ('sent','received'))` on chit_header/status/detail,
  and CHECK on `current_status`, `scope`, `self_copy_pref` (some exist). Enforce invariants at the DB, not just code. (Additive migration.)
- **[QUICK] Per-route error envelope** — many route `catch` blocks still `res.json({ message: err.message })`,
  leaking internal/DB text (info disclosure). Add one `sendError(res, status, code, msg)` helper + a generic
  client message; keep detail in logs. (Mechanical sweep.)
- **[QUICK] Auth-specific rate limit** — global limiter exists (500/15m); add a stricter limiter on
  `register`/`verify`/`actors/login`/`set-pin` to blunt OTP/PIN brute force.
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
- **[BACKLOG] Structured logging + request IDs** — replace `console.log` with a logger (level, JSON, a per-request
  correlation id) for traceability.
- **[BACKLOG] Token lifecycle** — entity JWTs are 7-day, stateless, no revocation (only actors re-checked). Add a
  short access TTL + refresh, or a token-version column for server-side revoke.
- **[BACKLOG] Avoid `SELECT *`** in hot reads (chit detail) — list explicit columns (contract stability + no
  accidental new-column exposure).
- **[BACKLOG] Automated tests for the invariants** — a jest test that a second entity cannot read another's chit
  (the P0 isolation guarantee), plus core chit/auth flows; wire into CI.

## Web backlog
- **[QUICK] Finish the `esc()` audit** — row path is fixed; sweep the other render functions (chit detail,
  messages, disputes, network cards) for any `${apiData}` going into `innerHTML` unescaped. (Highest residual risk.)
- **[BACKLOG] Enable a CSP** — `helmet` currently disables CSP (`contentSecurityPolicy:false`, server.js). A CSP
  is the strongest defence-in-depth against XSS; design one that allows the app's inline scripts/styles (or move
  to nonces) and turn it on.
- **[BACKLOG] De-monolith `app.html`** — ~1900 lines, one file. `core.js` started the split; continue extracting
  panels into modules. Maintainability + reviewability.
- **[BACKLOG] Token storage** — `localStorage` is XSS-reachable; evaluate httpOnly cookie auth (pairs with CSP).

## Settings-level future path (document & follow)
- **[BACKLOG] Generic entity settings** — today each toggle is its own column (`self_copy_pref`,
  `dispute_handler_actor_id`). For future flags without a migration per toggle, add a single `settings JSONB`
  column on `identities` (default `{}`) + a `GET/PATCH /entities/settings` accessor, and read flags from it.
  **Convention going forward:** new per-entity behaviour toggles live in `settings` JSONB unless they need to be
  queried/indexed (then a real column). Mirror to the web `getSettings`/`saveSettings` path.
- **[BACKLOG] Feature flags** — a small server-driven flag map (env or a `feature_flags` table) so unfinished
  panels/actions can be gated cleanly instead of `todo()` placeholders.

## How to use this
Treat **[QUICK]** items as the next small hardening slice (mostly additive, low-risk). **[BACKLOG]** items are
separate implementations — pull them as dedicated tickets. Re-check this list before UAT/Prod promotion.
