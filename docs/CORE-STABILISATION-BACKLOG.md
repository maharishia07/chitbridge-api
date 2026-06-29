# Core Stabilisation Backlog (working tracker)

**Purpose:** stabilise the core BEFORE building the next level. Grounded in the 7-round held-batch review.
**Honest framing (keep it):** the isolation *model* is sound and the must-fixes are real — but the guarantee is
enforced by **developer discipline + review, not by architecture**, and almost nothing has been run against a
database. *"Solid where examined, unproven elsewhere, one trust-layer deep."* This backlog closes that gap.

Severity: **P0** = stabilise before next level · **P1** = hardening, soon · **P2** = structural/strategic.
Status: `OPEN` · `READY` (unblocked, queued) · `PARTIAL` · `IN-PROGRESS` · `DONE` · `BLOCKED(dep)`.
Tactical sub-items that already live in `TECH-HARDENING-BACKLOG.md` are cross-referenced, not duplicated.

> **Do-first — the three tracks that change the risk profile most: A (prove it) → B (architectural isolation) →
> C (close the single point of failure).** Everything else is real but secondary to these.

## REVIEWER-APPROVED ORDER (v9 sign-off, `8d5b181`) — do the architecture EARLY so every experiment inherits the net
1. **A1/A2** — stand up a non-prod test DB; run the smoke. *Turns "should work" into "does work."*
2. **B1** — Postgres RLS isolation backstop. **THE highest-leverage item — do it BEFORE adding new endpoints.**
3. **A4** — automated tenant-isolation test suite; **A5** — wire it into CI to block merges.
4. **C1/C2** — entity-token revocation + short TTL + refresh; `JWT_SECRET` rotation / secret management.
5. **E1/E2** — migration ledger (or boot-time column probe) + diff `fp01` vs the real prod schema.
- Then **P1:** D1/D2 (per-actor hats) · F1 (monolith / CSP / token-storage) · E3/E4 (staging + off-laptop backups).
- **Already done (DB-free wins):** D3 ✓ · C3 ✓ · H1 ✓.

> **"Done" = the item's DB-backed test/smoke passes — NOT `node --check`.** Static-verify is *ready to test*, not
> done. Each item lands as its own commit, held; never push past a red; bring results back for re-verify.
> (See `docs/CB-CODING-DISCIPLINE.md`.)

---

## TRACK A — Verification & proof (HIGHEST LEVERAGE — the meta-gap)
"Static-verified, not integration-tested." Until it runs against a DB, "solid" = "reads correctly," not "behaves correctly."

| ID | Item | Sev | Status | Depends | Definition of done |
|----|------|-----|--------|---------|--------------------|
| A1 | Stand up a disposable non-prod test DB (Supabase/Postgres) | P0 | **DONE** (2026-06-28) | — | dev DB up; 6 migrations applied in MANIFEST order |
| A2 | Run `scripts/smoke-review-fixes.sh` against the dev API | P0 | **DONE** (2026-06-28) | A1, deploy | Smoke GREEN on dev → F3/F5/F6/F7 DB-proven. *(Archive the PASS/FAIL output for the reviewer.)* |
| A3 | Make the jest/DB suites actually run | P0 | **WIRED — run on CI** `0bf4329` | A1 ✓ | jest config + `npm run test:jest` + `jest.setup.js` (JWT_SECRET, NETWORK_WRITE_ENABLED, PGSSL=disable); fixed `catalogue.test.js` missing auth (F1); CI bootstraps cb_* schema (ltree+net01/02/03) + runs jest. `jest --listTests` finds both suites. **Done = GREEN on CI** (flip `CI_INTEGRATION=true`). |
| A4 | Automated tenant-isolation suite (every read+write route: B never sees/edits A) | P0 | **AUTHORED — run on dev** `5040fe8` (`scripts/isolation-suite.sh`) | A1 ✓ | B denied every read/write of A's chit (detail/messages/status/dispute/archive/void/delete/bulk-assign) + notifications/supplier-catalogue/products; positive control; `bash -n` clean. **Done = GREEN on dev** (and again with RLS forced = the B1 proof). Next: A5 wires it into CI. |
| A5 | CI runs A3+A4 on every commit; block merge on failure | P1 | **PARTIAL** `dd947c7` (`.github/workflows/ci.yml`) | A4 ✓ | **Static gate LIVE** on every push/PR (`node --check` all JS + `bash -n` + LF check — would've caught the CRLF/boot-breaker class). **Integration gate** (Postgres + smoke + isolation suites) **scaffolded**; prereq #1 (db/index.js plain `DATABASE_URL`) **DONE `ddb44ce`** — remaining: confirm the schema bootstrap on a first CI run, then set `CI_INTEGRATION=true` to make it gate merges (also unblocks A3 jest/DB suites). |

## TRACK B — Make isolation architectural, not disciplinary
The invariant currently lives in each dev's `WHERE` clause; this review found basic gaps (F1/F3/F7) in an isolation-first product.

| ID | Item | Sev | Status | Depends | Definition of done |
|----|------|-----|--------|---------|--------------------|
| B1 | Postgres Row-Level Security backstop (policies key on session entity) | P0 | **DESIGN — prereq found** (`docs/B1-RLS-DESIGN.md`) | A1 ✓ | RLS on tenant tables so a forgotten app-layer `WHERE` *cannot* leak. **Q1 ANSWERED:** API connects as `postgres` with `BYPASSRLS=true` → RLS is a no-op until the API uses a dedicated `cb_app` role (NOBYPASSRLS) — Stage-0 prerequisite documented. Q2–Q4 have recommended defaults; then build Stage-0 plumbing + A4. |
| B2 | Single audited data-access choke-point (always injects `entity_id = req.identity`) | P1 | OPEN | — | Reads/writes routed through a thin layer instead of hand-written per-route queries |
| B3 | Isolation lint/CI check (flag tenant-table queries not scoped on the verified identity) | P1 | OPEN | A5 | A static check that fails CI on an unscoped tenant query |

## TRACK C — Auth & token hardening (close the single point of failure)
Canon: "the only real attack surface is authentication compromise." There is no second layer behind it today.

| ID | Item | Sev | Status | Depends | Definition of done |
|----|------|-----|--------|---------|--------------------|
| C1 | Entity-token revocation + short access TTL + refresh | P0 | OPEN | — | Stolen/old entity token can be killed (mirror the actor `break_status` re-check); short TTL + refresh |
| C2 | `JWT_SECRET` rotation + managed secret store | P0 | OPEN | — | Documented rotation; secret in a managed store; never in repo/env dump |
| C3 | Finish the error-envelope sweep (`safeErr` universal) | P1 | **DONE** `6216298` | — | cb_* network/catalogue `h()` helper no longer leaks `err.message` on unexpected errors (deliberate service messages kept). 0 known leaks. |
| C4 | Rate-limit hardening (per-account/token, not just per-IP) on OTP/auth | P1 | OPEN | — | Per-account limits behind the OTP cap; `*_RATE_LIMIT_MAX` values revisited |

## TRACK D — Within-entity least privilege (a promised feature that isn't built)
`assist-kb.js`/TRUST market "scoped access you grant," but `actor_role` is free-text and `entity_actor_settings` are stored-not-enforced → **any co-assist sees all of the entity's chits**. Security gap + TRUE-claims gap.

| ID | Item | Sev | Status | Depends | Definition of done |
|----|------|-----|--------|---------|--------------------|
| D1 | Per-actor view-hat / permission model (+ dispute-handler implicit view-only on open disputes) | P1 | OPEN | — | Scoped per-actor view enforced; test per CB-SYNC "view hat" notes |
| D2 | Enforce `entity_actor_settings` (presence/leave already wired) | P1 | OPEN | — | The stored settings actually gate behaviour (see `ACTOR-SETTINGS-BEHAVIOUR.md`) |
| D3 | **Until D1 lands, soften the KB/TRUST "scoped access" claim so it's TRUE** | P0-doc | **DONE** api `346f443` / web `113e830` | — | `assist-kb.js` + `assist.js` hint + 4 web ASSIST_LIB/CO_HELP entries now say entity-scope only; per-actor scoping is planned/not-enforced. (`TRUST.md` had no such claim.) |

## TRACK E — Deploy & operational hardening

| ID | Item | Sev | Status | Depends | Definition of done |
|----|------|-----|--------|---------|--------------------|
| E1 | Migration ledger (or interim boot-time `information_schema` column-probe) | P0 | OPEN | — | Applied state is deterministic; boot fails fast if a needed column is missing (also in `TECH-HARDENING-BACKLOG`) |
| E2 | Diff `fp01` against the real prod schema | P0 | OPEN | — | `migration_fp01.sql` (a reconstruction) confirmed against prod before any prod apply (noted in `MANIFEST.md`) |
| E3 | Separate staging from "live" dev | P1 | OPEN | — | A real staging env distinct from dev for prod promotions |
| E4 | Off-laptop durable, automated backups | P1 | OPEN | — | Full history backed up off the `C:\dev` bundle + private repo, automatically |
| E5 | Wire observability + runaway guards (bounded reads, loop guards, alerting) | P1 | OPEN | — | The `OBSERVABILITY-AND-SAFETY.md` phased plan built; `log.onCritical` → a real sink |

## TRACK F — Web client (the ~250KB monolith `public/app.html`)

| ID | Item | Sev | Status | Depends | Definition of done |
|----|------|-----|--------|---------|--------------------|
| F1 | Security pass on the monolith (esc() coverage complete; `DEMO`/`demoApi()` can never hit a real API; token storage) | P1 | **segregation ✓** (2026-06-29) | — | Audited: demo makes 0 real API calls (`web_demo` base=null, `core.js` returns `demoApi()` before the only fetch). esc()/token-storage audit still open. |
| F2 | De-monolith `app.html` into modules | P2 | OPEN | — | Reviewable module split (core.js started it) |
| **G-demo-1** | Demo fidelity: align Network demo to dev (writes gated/503; drop per-node `cap` grants) or badge "preview" | P1 | OPEN | — | Demo no longer shows a fully-working network we haven't shipped. See `DEMO-FIDELITY.md`. |
| **G-demo-2** | Demo fidelity: actors show free-text role labels, no implied enforced view-only/audit (matches D3) | P1 | OPEN | — | Per-actor capability shown only when D1 (view-hats) ships. |
| **G-demo-3** | Demo fidelity: **"view as counterparty" perspective switch** (+ second-entity blob) to PROVE isolation + two-party message visibility | P1 | OPEN | — | The highest-value demo upgrade for proving the security/multitenancy story; needs design. |
| **G-demo-0** | **Practice:** regress the demo every milestone (`DEMO-FIDELITY.md` + amendment-checklist line) | P1 | **ADOPTED** (2026-06-29) | — | Demo is a trust artifact; its data integrity rides with each milestone. |

## TRACK G — Customer surface (parked, but listed)

| ID | Item | Sev | Status | Depends | Definition of done |
|----|------|-----|--------|---------|--------------------|
| G1 | Real OTP delivery — SMS adapter for `sendOtpSms` (+ the prod boot guard) | P1-before-customer-prod | OPEN | — | Storefront can deliver OTPs; pairs with the F2 mechanical-half guard (`TECH-HARDENING-BACKLOG`) |
| G2 | Review public exposure (`gstn`+`address`) + bounded reads on public lists | P2 | OPEN | — | Confirmed intended; public list reads capped |

## TRACK H — Process & threat model

| ID | Item | Sev | Status | Depends | Definition of done |
|----|------|-----|--------|---------|--------------------|
| H1 | One-page threat model (actors, assets, trust boundaries) | P0 | **DONE** | — | `docs/THREAT-MODEL.md` — assets, trust boundaries, 7 actors → attempt/mitigation/residual-gap (mapped to tracks), top-3 risks |
| H2 | Enforced pre-prod security checklist (a gate, not just docs) | P1 | OPEN | A4 | A pass/fail gate: isolation tests green, no OTP-in-prod, secrets managed, migrations applied, error sweep done |
| H3 | Independent security review / light pen-test before real-money onboarding | P2 | OPEN | — | External review completed |

## Carried from the code review (already scoped in `TECH-HARDENING-BACKLOG.md`)
- Full Option-A notification write-cleanup (fan disputes natively; drop the special `action IN (...)` arm).
- Network Track-B bridge (`cb_entity` ↔ `identities`) — the real fix behind the network/catalogue write-gate and the F7 client-supplied-`:id` residual.
- Re-true the KB/TRUST/backlog claims in canon once the fixes are smoke-confirmed (ties to D3 + A2).

## Reconciliation with this session's held batch
- **Done (held on `feat/must-fixes`):** F0–F7 review fixes; the smoke script (A2's tool) is authored + LF-fixed; E1/E2/G1 and the carried items are recorded in `TECH-HARDENING-BACKLOG.md`.
- **Not yet started:** everything in this tracker above (status reflects that). The gating blocker for most of TRACK A is **A1 (a non-prod DB)** + the **dev deploy** — both are Athi-side.

---

## The honest one-paragraph verdict (from the review — kept as the north star)
The bones are good: the data model scopes per entity, tokens are DB-sourced, SQL is parameterised, the critical
writes are transactional, and the must-fixes are real. But the core is **one trust-layer deep** (everything rides
on `JWT_SECRET` + app-layer `WHERE` clauses, with no RLS backstop and no entity-token revocation), the isolation
guarantee is **enforced by discipline, not architecture** (this review found basic leaks an isolation-first
product shouldn't have had), and it is **almost entirely unproven against a running database**. None of that is
unusual for an MVP at this stage — but the core is not yet stable enough to safely build a second level on.
**Tracks A (prove it) + B (make isolation architectural) + C (close the single point of failure) change the risk
profile most; do those before the next level.**
