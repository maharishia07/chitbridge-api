# DEV deploy + migrations + smoke — one-page checklist

Follow top to bottom. Tick each box. This deploys the **base batch to DEV only**; `feat/must-fixes` lands
*after* the smoke (step 6). Production is a separate, later, conscious step — NOT here.
Repos now live at `C:\dev\chitbridge-api` and `C:\dev\chitbridge-web`. Detailed narrative: `DEPLOY-RUNBOOK.md`.
Detailed smoke steps: `MANUAL-TEST-SCRIPT.md`.

## 1. Pre-push sanity (1 min)
- [ ] `git -C C:\dev\chitbridge-api status` → clean, branch `feat/restore-endpoint` is the base to push.
- [ ] `git -C C:\dev\chitbridge-web status` → clean, branch `feat/panel-fixes`.
- [ ] You're in your **own terminal** (the agent shell can't authenticate the push).

## 2. Push the BASE branches (your terminal)
- [ ] `git -C C:\dev\chitbridge-api push -u origin feat/restore-endpoint`
- [ ] `git -C C:\dev\chitbridge-web push -u origin feat/panel-fixes`
- [ ] If `secondary rate limit` / 429 → wait ~1h, retry. If auth prompt → complete GCM login once.
- [ ] Open the two PRs (do **not** merge to `main`/prod yet).

## 3. Deploy to DEV (Railway = api, Vercel = web)
- [ ] Point the **Railway dev** service at `feat/restore-endpoint`; confirm it runs `npm install` (new dep
      `@anthropic-ai/sdk`) and boots (`/health` returns OK).
- [ ] Point **Vercel preview/dev** at `feat/panel-fixes`.
- [ ] **Env on Railway (DEV):**
  - [ ] `NODE_ENV=development`
  - [ ] `JWT_SECRET=<strong, ≥32 chars>`
  - [ ] `ALLOWED_ORIGINS=<the dev web origin>` (else the browser is CORS-blocked)
  - [ ] `DEV_OTP=123456` (dev/UAT testing OTP — fine here; the boot guard blocks it in prod)
  - [ ] leave `ASSIST_LLM_PROVIDER` / `ASSIST_LLM_API_KEY` **unset** → assistant runs on the free library floor
  - [ ] leave `NETWORK_WRITE_ENABLED` **unset** → network/cb_* writes return 503 (expected)

## 4. Run migrations on the DEV DB (before smoke)
Apply any not-yet-applied, in order (no `schema_migrations` ledger yet — applied state is manual).
`psql "$DATABASE_URL" -f <file>` for each:
- [ ] `migration_chit_direction.sql`
- [ ] `migration_dispute_routing.sql`
- [ ] `migration_chit_reads.sql`     ← per-actor unread breaks without this
- [ ] `migration_check_constraints.sql`
- [ ] `migration_otp_attempts.sql`   ← OTP lockout needs this column

## 5. Smoke the DEV build (use `MANUAL-TEST-SCRIPT.md` for detail)
Core lifecycle:
- [ ] Register → OTP `123456` → in.
- [ ] Compose → send → appears in **Order** (sent) and counterparty/self **Task** (received) with independent status.
- [ ] Task lifecycle: Accept → In progress → Complete; message on record; My/All toggle; **per-actor unread** shows.
- [ ] Co-assists: add A1/A2 → A1 login (PIN/OTP) → push/pull → **bulk-assign** (atomic) → A1 break returns work to pool.
- [ ] Dispute raise → (handler routing) → resolve.
- [ ] Suppliers add by user-id/email; Catalogue add product (name/price/unit).
- [ ] Notifications 🔔 real; Profile user-id + dispute handler; Settings show "not yet active".
New / security behaviours (must pass):
- [ ] **OTP lockout** — 5 wrong OTPs → 429; a fresh code unlocks (1.3 + 10.5).
- [ ] **Order price integrity** — storefront order ignores a tampered price; unknown item rejected (10.3).
- [ ] **Network write-gate** — network *writes* return 503 (11.2).
- [ ] **F1 — cb_* catalogue auth** — `GET/POST /api/network/entities/<id>/catalogue` with **no token → 401** (11.3).
- [ ] **Assistant** — 💬 + "?" answer from the library; coassists/schema contexts; no-oversell.
- [ ] **P0 isolation** — Entity B sees nothing of Entity A (13).

## 6. Land the must-fixes, then re-smoke
- [ ] After the base smoke passes, merge **`feat/must-fixes`** into the dev line (or repoint dev at it) and redeploy.
- [ ] Re-run the **new-behaviour** checks in step 5 (they live on `feat/must-fixes`).

## 7. Sign-off
- [ ] All step-5 boxes ticked, failures logged (screen / steps / expected / actual / screenshot).
- [ ] Decide go/no-go for the **production** promotion (separate runbook step; address open items first:
      network Track-B, migration ledger, OTP on actor login, unset `DEV_OTP` for prod).
