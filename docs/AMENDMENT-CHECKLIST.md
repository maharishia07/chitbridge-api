# Amendment checklist (verify before any change ships)

Run this for **every** code amendment (API or web), before merge/deploy. It encodes the hardening
behaviours we've established. **This is a living list — add a new line whenever we find a better way.**

## Security
- [ ] **Tenant scoping** — any new query scopes on `req.identity` (NEVER a client-supplied `entity_id`) and
      filters by `entity_id`. (P0 invariant — a cross-tenant leak is drop-everything.)
- [ ] **Output escaping (XSS)** — every API/user value interpolated into `innerHTML` goes through `esc()`
      (web). No raw `${apiData}` in templates.
- [ ] **Parameterized SQL** — only `$1..$n` placeholders; never string-concatenate user input into SQL.
- [ ] **Error envelope** — 500s use `safeErr(err)` (api/`lib/respond.js`); no `err.message` reaches the client.
- [ ] **Secrets/hardcodes** — no secrets or live-path hardcoded ids/counts; config from env (boot-guarded).

## Correctness
- [ ] **Atomicity** — any multi-row write wraps in `withTransaction(fn)` (api). No partial-write paths.
- [ ] **Void / terminal-state validation** — actions respect terminal states (void/cancelled/completed):
      can't mutate a voided chit, can't delete with an open dispute, can't double-advance past final.
- [ ] **Circular reference** — for tree/graph writes (network reparent), keep the cycle guard
      (`parent <@ child` ltree check). For new modules, no `require` cycles (keep the DAG one-directional).
- [ ] **Idempotency / double-fire** — mutations tolerate a retry; the web `api()` double-fire lock covers UI.
- [ ] **Soft-delete respected** — reads filter `deleted_at IS NULL` / `archived_at IS NULL` where applicable.

## UX & messaging
- [ ] **Appropriate message** — every action has success + failure feedback via the `MSG` catalogue
      (contextual: chit code / actor name). No silent returns. In-progress is covered by the `api()` indicator.
- [ ] **No dead clicks** — placeholders use `MSG.comingSoon(...)`, not nothing.
- [ ] **Demo vs dev/prod** — wire the real API to the **working model only**; never touch `DEMO`/`STORE`/
      `demoApi`. A hardcode is a bug only in the live path.

## Process
- [ ] **Syntax check** — `node --check` (extract inline JS for `app.html`); both repos clean.
- [ ] **Held discipline** — branch-only, commit with a clear message, refresh the `Downloads` bundle; don't
      push/deploy until reviewed.
- [ ] **Docs** — update `CB-SYNC.md` / relevant doc; if a migration is added, note it in the deploy runbook.

## Ongoing practice
Whenever a review surfaces a new failure mode or a cleaner pattern, **add it here** and apply it going forward
(e.g. this is how circular-reference, message-coverage, void-validation, and error-envelope checks were added).
Related: `TECH-HARDENING-BACKLOG.md`, memory `feedback-amendment-checklist`, `feedback-tenant-isolation-invariant`.
