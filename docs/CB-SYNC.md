# CB-SYNC — single source of truth for the current work block

**Read this first to resume.** One file covering every open thread: two-copy/self-chit, dispute
notifications, dispute routing, what's deployed vs. held, decisions, next-cycle, and the deploy runbook.
Detailed dispute change-log: `docs/HANDOFF-dispute-notifications-2026-06-28.md`.

- Repo `chitbridge-api` — local **`C:\dev\chitbridge-api`** (moved off `Downloads` 2026-06-28 — see hazard note)
- Web `chitbridge-web` — local **`C:\dev\chitbridge-web`** (moved off `Downloads` 2026-06-28)
- DB: Supabase `bzacyrdrnzdbficjplcn` · API: Railway · "live" = the dev env
- Backup repo: private `maharishia07/cb-context-backup`
- **Web has two sides** (one SPA, switched by `CFG.STAGE`): **demo** (`web_demo`, mock, no-login — do NOT
  touch/wire) vs **dev/uat/live** (real API, the working model). Demo is contained in `DEMO`/`STORE`/
  `demoApi()` and gets stripped at UAT/Prod. Always wire the real API to the working model, never demo.
  Hardcode = bug only if it runs in the live path. See memory `feedback-demo-vs-dev-segregation`.

---

## STATUS (2026-06-28)

**Live/deployed = baseline-7.** Everything after it is **committed locally but NOT pushed/deployed**,
held on purpose (Athi batches the push + cross-examines first) AND blocked by a GitHub **secondary
push rate-limit** (writes fail `exit 128`, reads OK — clears in up to ~1h; batch pushes to avoid it).

Safety: commits are durable on local disk; a full-history **git bundle** sits at
`C:\dev\cb-api-backup.bundle` (restore with `git clone cb-api-backup.bundle`).
Nothing is lost if GitHub stays unreachable.

| Item | Where | State |
|---|---|---|
| baseline-7 two-copy | `origin/main` `f846fa6`, tag `baseline-7-two-copy` | **DEPLOYED (live)** |
| baseline-8→10 (self-dispute, routing, security) | folded into `feat/restore-endpoint` | merged local, unpushed |
| **api base batch** (hardening + assistant backend + all docs) | branch **`feat/restore-endpoint`** `5096426` | held — push to DEV first |
| **web batch** (panel-fixes + MSG + XSS esc + "?" help + floating AI assistant) | branch **`feat/panel-fixes`** `52acb99` | held — push to DEV first |
| **api must-fixes** (4 must-fixes + assist F0 + **review fixes F1–F7**) | branch **`feat/must-fixes`** `cb88b46` | held — land AFTER dev smoke |
| backup repo sync (memory + spine + these docs) | `cb-context-backup` | pending throttle |

> **Canonical deploy steps:** `docs/DEPLOY-RUNBOOK.md` (dev-first → migrations → smoke → must-fixes → prod).
> **Manual QA script (register→full lifecycle, screen by screen):** `docs/MANUAL-TEST-SCRIPT.md`.
> **Push is blocked two ways:** the GitHub secondary throttle AND it needs Athi's interactive Git Credential
> Manager auth (the non-interactive agent shell gets `exit 128`). Athi runs the push from his own terminal.

> ⚠️ **ENVIRONMENT HAZARD — a working-tree file deleter.** Something on this machine (antivirus / OneDrive-style
> sync on `Downloads`) intermittently **deletes freshly-written `.js` files** from the working tree — it has hit
> `public/app.html` repeatedly and, on 2026-06-28, silently removed **`routes/assist.js`**; a `git add` then
> committed the *deletion* (commit `4d3d25a`, misleading message), producing an F0 boot-breaker
> (`MODULE_NOT_FOUND` for `./routes/assist`) found in review. **Recovered from `39aad4d` + re-applied the lost
> CONTEXT_HINTS, committed `fa5522a`, and PROVEN by booting the server (no MODULE_NOT_FOUND; `POST /api/assist`
> → 503).** Standing rule for any session here: after writing a file, **verify it's still on disk *and* in
> `git ls-tree HEAD` before trusting a commit**; prefer `git restore` immediately after commit.
>
> **ROOT CAUSE + RESOLUTION (2026-06-28):** the machine had a **runaway Windows Search Indexer — 150+
> `SearchProtocolHost` processes** hammering the `Downloads` tree (indexing all of `node_modules` + `.git`),
> locking files and triggering the deletions. **Both repos were moved out of `Downloads` to `C:\dev`**
> (`C:\dev\chitbridge-api`, `C:\dev\chitbridge-web`) — outside the indexed user-profile scope. Verified: git
> history + all branches intact, `npm install` clean, server boots from `C:\dev` (`POST /api/assist` → 503).
> The old `Downloads` copies are left as a fallback (delete after confirming). **Still recommended:** add a
> Windows Search **and** Defender exclusion for `C:\dev`, and restart the Search service (the 150 hosts are
> abnormal — a reboot or `Stop-Service WSearch; Start-Service WSearch` clears them).

---

## ⚠️ CRITICAL INVARIANT — tenant data isolation (P0)

**No entity may ever see another entity's records except through an explicit, permissioned share
(network architecture).** This is the platform's #1 promise. It currently holds by design:
- `entity_id` is **always** derived from the verified JWT (`req.identity`), **never** from client input
  (body/params/query) — confirmed 0/~40 endpoints take it from the client.
- Data is **physically owned per entity** (each entity has its own `chit_header/status/detail/state_log`
  rows); every read filters `entity_id = caller`. `GET /:chit_id` 404s non-participants (chits.js:491).
- All SQL is parameterized (no injection cross-tenant escape). Auth on every data route; actors confined
  to `parent_entity_id`; removed actors lose access next request.

**The only real attack surface is authentication compromise** — a leaked `JWT_SECRET` (forge any token)
or a stolen user token (XSS/device). Not a data-model hole.

> **STANDING INSTRUCTION TO CLAUDE (and to whoever updates the spine):** treat any sign of cross-entity
> data leakage as **P0 — drop everything and fix immediately.** When reviewing ANY new endpoint/query,
> verify it scopes on `req.identity` (never client input) and filters by `entity_id`. This invariant
> must be mirrored into the spine and any other canonical context doc; if a future mechanism (new route,
> join, sharing feature, raw SQL, reporting/export, admin tool) ever exposes another entity's rows,
> it is the highest-priority bug in the system. Keep `JWT_SECRET` strong, secret-managed, and rotated.

## THREAD 1 — Two-copy / self-chit (baseline-7, DEPLOYED)

Every chit is **two copies**: a `sent` (Order/sender) row and a `received` (Task/receiver) row, with
**independent statuses**. Uniform `direction` flag on `chit_header`/`chit_status`/`chit_detail`
(re-keyed to include `direction`); Task/Order filters key on it. A **self-chit gets both** copies.
Entity setting `identities.self_copy_pref` (`both` default | `sent` | `received`). No self-chit special-casing;
archive is per-copy independent. Migration: `migration_chit_direction.sql` (the 3-part split version that
actually applied on dev). This is the non-negotiable base principle.

## THREAD 2 — Self-chit dispute notifications (baseline-8)

- A dispute can be raised **chit-wide** on a self-chit; targeting your own id is blocked (400).
- `routes/notifications.js`: dispute/void surfaces even when **self-raised**; `chit_header` join aligned
  on `direction` → a self-chit dispute yields **exactly 2 notifications** (one per copy), each tagged `direction`.
- `routes/chits.js` dispute **queue**: rewritten to **one row per dispute** (was a 2×2=4 cartesian on
  self-chits) — `chit_disputes` is the row driver, participant scope via `EXISTS`, header via scalar subqueries.
- No migration.

## THREAD 3 — Actor-level dispute routing + dispute team (baseline-9)

- `migration_dispute_routing.sql`: adds `identities.dispute_handler_actor_id` (nullable, additive — safe anytime).
- `routes/notifications.js` is now **actor-aware** (hides nothing; adds 2 booleans per row):
  - `assigned_to_me = (cs.assigned_to_actor_id = caller)` — this chit is mine to handle.
  - `dispute_for_me = (action IN dispute_raised/dispute_resolved AND caller = entity's dispute_handler)`
    — **disputes only** (voids excluded). The standing dispute desk sees every dispute, even chits it
    isn't assigned. "own actions" filter now keys on the actor, not the entity.
- `routes/entities.js`: `GET /me` returns `dispute_handler_actor_id`; `PATCH /profile` sets it, guarded
  to be one of your own actors.

### Decisions locked (Athi)
1. Dispute notifies every entity involved (default) + actor-level tagging for assignee & dispute team.
2. Routing depth = actor-level **when assigned**.
3. Dispute team = **single handler** for now (not a list).
4. `dispute_for_me` = **disputes only**, voids dropped (voids still show in feed).
5. Dispute team is **notify + view, NOT act** (no act/resolve rights from being handler).

---

## THREAD 4 — Security hardening (baseline-10)

Defense-in-depth on the isolation perimeter (the model itself was already sound). Built locally, held.
- `middleware/auth.js`: JWT verify **pins `algorithms: ['HS256']`** (closes alg-confusion ambiguity).
- `server.js`: **CORS locked to an allowlist** (`ALLOWED_ORIGINS` env, default
  `https://chitbridge-web.vercel.app,http://localhost:5173,http://localhost:3000`; no-Origin
  requests like server-to-server/smoke tests still pass). Global **error handler no longer leaks
  `err.message`** to clients on any env (full detail stays in server logs).
- **Deploy note:** if the web app ever moves to a custom domain or you need Vercel preview origins,
  set `ALLOWED_ORIGINS` on Railway BEFORE deploy, else the browser frontend gets CORS-blocked.

Known follow-ups (not in this slice): per-route `catch` blocks still return `err.message` (broader
info-disclosure sweep); add a boot-time check that `JWT_SECRET` is present & strong; consider
server-side revocation/short TTL for entity tokens (only actors are re-checked per request today).

## NEXT CYCLE — "view hat" (NOT built; currently harmless)

Chit **view is entity-wide today** — any actor under an entity sees all its chits; `actor_role` is a
free-text label, **there is no enforced permission/hat system**. So the dispute handler can already see
disputed chits. When per-actor **view hats** (scoped view) are introduced:

> `dispute_handler_actor_id` (and the per-chit assignee) must get an **implicit VIEW-ONLY grant on any
> chit with an open dispute**, even outside their hat scope, lapsing when the dispute closes — never
> act/resolve rights. Add a test: a dispute-handler with a narrow view hat can GET a disputed chit they
> don't own, cannot mutate it, and loses GET access once the dispute resolves.

### Order-side (sent) workflow — READY, ~no change needed

The two-copy refactor made `sent` and `received` **structurally identical** rows in `chit_status`
(keyed by `(chit_id, entity_id, direction)`). So the Order/sent copy **already carries the same
assignment columns** as the Task side — `assigned_to_actor_id`, `assigned_to_actor_display_name`,
`assignment_type`, `assigned_at` (`db/schema.sql:209-212`). **No migration to add an order-side workflow.**

- The assign endpoint (`chits.js:1391`) filters by `(chit_id, entity_id)` with **no `direction`**, so on a
  **normal** chit the sender can already assign their single `sent` copy through the existing endpoint.
- **Self-chit caveat = the real (small) work:** a self-chit holds BOTH copies under one entity, so the
  current direction-agnostic `WHERE` would assign both sides at once. Add an **optional `direction` param**
  to the assign read/update (a few lines, no migration). This is what lets a self-chit run **independent
  workflows on the Order side vs the Task side** — different assignees/states per copy.
- To surface it: include `assigned_to_*` in the `/sent` (Order) list (the inbox query already selects
  those columns), and reuse the shared per-copy `current_status` state machine for any order-specific states.

### Web task-panel fixes + per-actor unread (spec held)

Icon audit of the task panel (2026-06-28) found 4 divergences + a new model. Full spec lives in the WEB
repo `docs/PANEL-FIXES.md`, branch `feat/panel-fixes` (held, no code yet). API-side prerequisites:
- **`baseline-11` restore endpoint** — `POST /api/chits/:id/restore` (clear `deleted_at` on caller's copy,
  mirror `/unarchive` chits.js:1307) to un-stub "Restore from Trash".
- **Per-actor unread** (Athi chose per-actor over per-entity): migration `chit_reads(chit_id, actor_id,
  direction, read_at, PK(chit_id,actor_id,direction))`; mark-read on open; clear the assignee's read row
  on (re)assignment/activity-by-others; inbox `LEFT JOIN chit_reads ON actor_id=caller` to compute unread.
  Today read_at is per-ENTITY (`chit_status.read_at`) and the panel row shows NO chit-unread colour.
- Frontend then: real 🔔 count (un-hardcode `app.html:918`), wire bulk-assign to `/chits/assign-bulk`,
  replace hardcoded actor `'a1'` with `SESSION.actorId`, wire restore, add per-actor unread row colour.

Smaller follow-ups: web Settings UI for `self_copy_pref` + `dispute_handler_actor_id`; surface
`assigned_to_me`/`dispute_for_me` in the web notifications panel; dispute team as a list (join table) later.

---

## Code-level hardening
See `docs/TECH-HARDENING-BACKLOG.md` — prioritized [QUICK]/[BACKLOG] items + the settings-level future path
(generic `settings JSONB`, feature flags). All [QUICK] wins done: XSS `esc()` (rows + dispute/message/detail/
line-items), boot-time `JWT_SECRET` guard, auth rate limiter, direction CHECK migration, error-envelope sweep
(`lib/respond.js` `safeErr`, 71 leaks closed). **Before ANY change, run `docs/AMENDMENT-CHECKLIST.md`** (living
gate: tenant scope, esc, safeErr, transactions, void/terminal, circular-ref, MSG messages, demo segregation,
leveled logging, loop/runaway guard, bounded reads).
Observability + runaway-safety design (loop-risk catalogue, severity model, sinks, phased plan):
`docs/OBSERVABILITY-AND-SAFETY.md`. Built: `lib/logger.js` (leveled, `LOG_LEVEL`) + request-id tracing.
Subscription / entitlements / quotas (plan-driven feature gating + hard caps at the billing root, feature
dependency graph): `docs/SUBSCRIPTION-ENTITLEMENTS.md`. Mechanism built: `lib/plans.js` (tiers are placeholders — set from the real plan).
Customer-facing **trust base** (plain-language "why you can trust us", every claim mapped to shipped work):
`docs/TRUST.md` (+ `docs/KB-your-data-is-safe.md`). Keep claims TRUE; extend as we harden.
**Schema-customization KB** (rigid container + your schema = your behaviour; the product pitch spine; has
[TO BE ADDED] use-case placeholders to fill with Athi): `docs/KB-SCHEMA-CUSTOMIZATION.md`.
ACID/BASE consistency assessment (rigid core / BASE periphery): `docs/CONSISTENCY-MODEL.md`.
Actor (co-assist) settings↔behaviour map + override/bounding hierarchy + gaps (entity_actor_settings are stored
but NOT enforced; actor not bounded by entity; presence/leave IS wired): `docs/ACTOR-SETTINGS-BEHAVIOUR.md`.

## THREAD 6 — consolidated review fixes (2026-06-28, all held on `feat/must-fixes`)
From the reviewing-Claude hand-off (`CB-REMAINING-FINDINGS-for-CLI.md`), each its own commit:
- **F0** `fa5522a` — restored `routes/assist.js` (lost to the deleter); server boots, `/api/assist` → 503.
- **F1** `327dd3c` — `src/routes/catalogue.js` (mounted at `/api/network`) now `auth` on all routes + `gateWrite`.
- **F2** `32d1587` (customer) + **F2-entity** `af2652b` — dual-channel OTP; OTP never returned in a prod response.
- **F3** `961f3c0` (P0) — notifications feed no longer leaks the counterparty's INTERNAL actions: `notifications.js`
  WHERE `(sl.entity_id = caller OR dispute/void)`; `assign-bulk` + 5 `actors.js` push/pull/return `state_log`
  fan-outs now write only the acting entity's row. Status-change (chits.js:692) + voided still fan (intended).
- **F4** `a2351f9` — `assign-bulk` capped at 200. **F5** `cb88b46` — actor-login OTP now uses `verifyOtp` (cap).
- **F6** `27ac4bd` — reprice prefers `item_id`, rejects ambiguous name, caps line count.
- **F7** `6c448c0` — supplier-catalogue read gated on `visibility='public'` (was any-entity full-catalogue read).
- Deferred (recorded in `TECH-HARDENING-BACKLOG.md`): full Option-A dispute-fan cleanup, `information_schema` boot
  probe, Network Track-B bridge, customer storefront parked, `fp01` prod-diff.
- **DB-dependent smokes** (F3 leak/regression, F5/OTP lockout, F6/F7 reads) verified by query-logic + `node --check`
  here; run end-to-end on dev per `DEV-DEPLOY-CHECKLIST.md` + `MANUAL-TEST-SCRIPT.md`.

## THREAD 5 — AI assistant + must-fixes + deploy prep (2026-06-28, this session)

**AI assistant (web + api):**
- Floating **💬 assistant** on every page (pre + post auth), context-sensitive, library-backed (`ASSIST_LIB`),
  honest / no-oversell, media-ready. The per-screen **"?"** renders from the SAME library (`helpBoxFromLib`) —
  one library, one render path (`assistEntryHTML`), one matcher.
- **`answer()` seam** (app.html): tiered fallback — LLM → `matchLibrary` (client-side floor) → static — so the
  assistant **degrades, never breaks**. `async` so the LLM slots in without touching callers.
- **Real Claude Haiku WIRED but DORMANT.** Web `CFG.ASSIST_LLM` (default **false**) → api **`POST /api/assist`**
  (`routes/assist.js`): model key stays SERVER-side, grounded on `lib/assist-kb.js` (honest KB, prompt-cached),
  no-oversell `SYSTEM_PROMPT`, per-screen `CONTEXT_HINTS`. No key set → **503 → client uses the library floor**
  (no cost, no behaviour change). Turn on later: set `ASSIST_LLM_PROVIDER=anthropic` + `ASSIST_LLM_API_KEY`,
  flip `CFG.ASSIST_LLM=true`. Full design: `docs/AI-ASSISTANT.md`. Contexts added: **coassists + schema**.

**Must-fixes (branch `feat/must-fixes`, drafted + held, land after dev smoke):**
1. **Order price integrity** — `catalogue.js` `repriceAgainstCatalogue()` re-prices every customer line vs the
   shop's `catalogue_items` (server-authoritative), fails CLOSED (422). Stops arbitrary/zero-price orders.
2. **Network write-gate** — `cb_entity` is DORMANT; body-authority mutation routes disabled unless
   `NETWORK_WRITE_ENABLED=true` (→ 503). The real fix (derive authority from `req.identity` via the bridge) is
   Track B / ATH-86 (`docs/NETWORK-AUTHORITY.md`).
3. **OTP attempt-counter** — `lib/otp.js` `verifyOtp()` caps wrong tries (`MAX_OTP_ATTEMPTS`, default 5) + locks;
   wired into `catalogue.js` + `entities.js`. Needs **`migration_otp_attempts.sql`**.
4. **`assign-bulk` transactional** — wrapped in `withTransaction` (no partial assigns).
5. **`server.js` boot guard** — aborts PROD if `DEV_OTP` is set. Fixed test OTP `123456` stays for dev/UAT;
   must be unset before prod (so OTPs become random).

**Migrations to apply on DEV before smoke:** `chit_reads`, `dispute_routing`, `chit_direction`,
`check_constraints`, **`otp_attempts`** (new). No `schema_migrations` ledger yet — applied state is manual.

## DEPLOY RUNBOOK (when the push throttle lifts) — see `docs/DEPLOY-RUNBOOK.md` for the full current sequence

1. Run `migration_dispute_routing.sql` on Supabase `bzacyrdrnzdbficjplcn` (1 additive column).
2. Merge `feat/dispute-actor-routing` → `main`; tag `baseline-9-dispute-routing`; add a BASELINES.md row.
3. Push `main` + tags `baseline-8-self-dispute`, `baseline-9-dispute-routing` → Railway auto-deploys.
4. Sync `cb-context-backup` (memory + spine + docs/).
5. **Smoke:** self-chit dispute → `notifications.count == 2` (per `direction`); queue → 1 row/dispute;
   assigned actor → `assigned_to_me=true`; set dispute-handler → `dispute_for_me=true` on a dispute it
   didn't raise; a void shows but is NOT `dispute_for_me`.

Rollback: `baseline-7-two-copy` (last deployed) or any earlier `baseline-N` tag.
