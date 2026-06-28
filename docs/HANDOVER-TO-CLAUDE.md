# HANDOVER → reviewing Claude — read this first

You are receiving a **held, not-yet-deployed** snapshot of **Chit & Bridge** (a B2B platform where businesses
exchange orders/deals as shared, tamper-evident records called *chits*). You are being asked to **review the code
and the recent updates and give honest, critical feedback** before this batch is pushed and deployed. This file
tells you what's here, the rules you must respect, exactly what to review, and how to return feedback.

## What you are looking at (in this zip)
- **`chitbridge-api/`** — Node/Express API (Postgres on Supabase). Branch `feat/must-fixes` (includes the base
  batch + the 4 "must-fixes"). `node_modules`/`.git` are intentionally excluded; `package.json`/`package-lock.json`
  define dependencies.
- **`chitbridge-web/`** — the web SPA. The app is a large **monolith: `public/app.html`** (~220 KB inline JS) plus
  `public/app/core.js`. Branch `feat/panel-fixes`.
- **`claude-memory/`** — the standing invariants/preferences captured across sessions (read these; they are rules).
- **Start with `chitbridge-api/docs/CB-SYNC.md`** — the *spine*. It links to every other doc. Then this file's
  "What to review" list.

## Current state (so you don't misread it)
- **Nothing is deployed.** Everything is on branches, held. Live/deployed is an older baseline-7. So "it works on
  screen" is **not** yet true — it becomes testable only after a dev deploy + migrations (see `DEPLOY-RUNBOOK.md`).
- **The AI assistant's real model is dormant** by design (`CFG.ASSIST_LLM=false`; `/api/assist` returns 503 with
  no key → the client uses a deterministic library "floor"). This is intended, not a bug.
- **Fixed test OTP** `DEV_OTP=123456` is deliberate for dev/UAT; a boot guard blocks it in production.

## Rules you MUST respect while reviewing (these are hard constraints)
1. **P0 tenant isolation** — *no entity may ever see another entity's data except via an explicit, permissioned
   share.* Every data query must scope on `req.identity` (the verified JWT), **never** a client-supplied
   `entity_id`, and filter by `entity_id`. **If you find any cross-entity leak, flag it as the #1 issue.**
2. **Demo vs dev/prod segregation** — the web has a **demo** side (`DEMO`/`STORE`/`demoApi()`, no-login mock) that
   must NOT be wired to real APIs and is stripped at UAT/prod. Only the real `api()` path is the working model.
   Don't propose changes that entangle them.
3. **Keep TRUST/KB claims TRUE** — `docs/TRUST.md`, `lib/assist-kb.js`, the assistant library must never assert a
   capability that isn't actually built. If you see an over-claim, flag it.
4. **Don't recommend pushing/deploying to production** with open security gaps; the agreed path is dev-first.

## What to review (please cover each, in order)
1. **The 4 must-fixes** (branch `feat/must-fixes`, newest 2 commits):
   - **Order price integrity** — `routes/catalogue.js` `repriceAgainstCatalogue()`. Is the server truly
     authoritative on price? Are the line-item **match** (by `item_id`/name) and the `item_data.price` assumptions
     safe? Any way to still place an arbitrary/zero-price order? Fail-closed correct?
   - **Network write-gate** — `src/routes/network.js`. Is gating the body-authority mutation routes behind
     `NETWORK_WRITE_ENABLED` an acceptable interim, given `cb_entity` is dormant? Anything still exposed?
   - **OTP attempt-counter** — `lib/otp.js` + wiring in `catalogue.js`/`entities.js` + `migration_otp_attempts.sql`.
     Lockout logic, reset points, off-by-one. Should `actors.js` also be covered?
   - **`assign-bulk` transactional** — `routes/chits.js`. Is the whole batch correctly all-or-nothing now?
2. **The AI assistant** — `routes/assist.js`, `lib/assist-kb.js`, and in `app.html`: `answer()` / `matchLibrary` /
   `askLLM` / `helpBoxFromLib`. Is the **tiered fallback** sound (LLM → library → static; never breaks)? Key stays
   server-side? Any honesty/over-sell risk in the KB or matcher?
3. **Tenant isolation spot-check** — sample a few mutating routes (chits, catalogue, actors, relationships) and
   confirm rule #1 holds.
4. **`docs/MANUAL-TEST-SCRIPT.md`** — does the 13-section script match the actual routes/screens? Missing steps?
5. **Deploy readiness** — `docs/DEPLOY-RUNBOOK.md` + `docs/TECH-HARDENING-BACKLOG.md`. Is the dev-first sequence
   complete? Right migrations listed (note: there is **no `schema_migrations` ledger** — flag the risk)? What's
   the single biggest thing still missing before a *production* deploy?

## How to return feedback (the loop)
Produce a single markdown file named **`FEEDBACK-FROM-CLAUDE.md`** with these sections. Be specific
(`file:line`), be honest, and don't rubber-stamp — finding real problems is the point.

```
# Feedback — Chit & Bridge held batch review (<date>)
## 1. Verdict
   One line: SAFE to dev-deploy as-is / dev-deploy with noted fixes / do-not-deploy — and why.
## 2. Correctness issues   (bugs / logic errors — file:line, impact, suggested fix)
## 3. Security & P0 isolation   (anything touching cross-entity access, auth, price/OTP/network)
## 4. The must-fixes   (per fix: sound? gaps? edge cases?)
## 5. AI assistant   (fallback integrity, key safety, honesty)
## 6. Test script gaps   (missing lifecycle steps / wrong expectations)
## 7. Deploy readiness   (migrations, ledger risk, biggest pre-prod blocker)
## 8. Anything missed   (things not on our radar)
## 9. Questions back to the building Claude
```

**Return path:** the human (Athi) will paste your `FEEDBACK-FROM-CLAUDE.md` back to the building Claude session,
which will reconcile each point (accept + fix, or push back with reasoning). There is no automated channel — the
human carries the loop. So write for a human to read and a Claude to action.

## A good review will independently surface at least these (sanity check on your own thoroughness)
- The **no migration-ledger** risk (applied-state is manual; code can ship ahead of its schema).
- The network **full fix is deferred** (Track B / `cb_entity↔identities` bridge) — the gate is only interim.
- The order-price **match/price-field assumptions** need the dev smoke to confirm against real data shapes.
If you don't independently raise these, re-read more carefully.
