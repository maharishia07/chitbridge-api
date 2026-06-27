# CB Test Guide

Manual + smoke test guide for the dev deployment.

- **App (task panel):** https://chitbridge-web.vercel.app/app.html — loads in **Dev** stage → live API.
- **API base:** https://chitbridge-api-production.up.railway.app
- **Sign in:** email → OTP. Use the OTP from email; if none arrives, dev OTP is **`123456`**.
- An automated smoke (`scratchpad/smoke_all.ps1`, run by CLI) covers TC-1–TC-8.

## 1. Compose — To/CC/For fan-out  (baseline-1, live)

| # | Step | Expected |
|---|---|---|
| TC-1 | Compose, add line items, one recipient as **To**, send | Sent. To copy is actionable (**pending**); sender keeps a Sent copy |
| TC-2 | Compose with one **To**, one **CC**, one **For**, send | `fan_out {to:1, cc:1, for:1}`. To = pending; CC & For = **delivered** (informational) |
| TC-3 | Add **6 To** recipients | Blocked at **5** (cap, 400) |
| TC-4 | Save a **draft** | Author copy only; `is_draft:true`, `recipients:0`; no recipient notified |

## 2. Priority  (baseline-2, live)

| # | Action | Expected |
|---|---|---|
| TC-5 | Set internal priority **high** | `priority_flag: high` |
| TC-6 | **Urgent without a reason** | Rejected (**400**) |
| TC-7 | **Urgent with a reason** | Accepted; internal **action message** logs who/when |
| TC-8 | Customer **priority-flag**, then again | First sets + locks; second **409** (write-once); both leave an action-message trail |

## 3. user_id  (feat/user-id — testable after baseline-3 deploys)

| # | Action | Expected |
|---|---|---|
| TC-9 | `PATCH /api/entities/profile` `{user_id}` (8+ chars or email) | Saved |
| TC-10 | Same `user_id` on another entity | **409** taken (case-insensitive) |
| TC-11 | `GET /api/entities/lookup?user_id=` and `GET /api/entities/me` | Lookup returns the entity; `me` shows `user_id` |

## 4. Chit actions  (baseline-4, live)

| # | Action | Expected |
|---|---|---|
| TC-12 | `GET /api/chits/sent` after sending | the sent chit appears |
| TC-13 | `POST /:id/archive` then `/unarchive` | archived hides from inbox/sent; unarchive restores |
| TC-14 | `PUT /:id/void` — no reason / non-sender / sender+reason | 400 / 403 / 200 (`status:void`, cross-edge, never deleted) |
| TC-15 | `GET /api/chits/rollup?group_by=state` (or `counterparty`) | grouped counts + totals (read-only) |
| TC-16 | counterparty acts on your chit → `GET /api/notifications` | their activity appears in your feed |
| TC-17 | `POST /api/chits/assign-bulk` to an active actor | chits reassigned (bad target → 400) |

## Notes
- **TC-1–TC-17 are all live now** (baselines 1–4). `assign-bulk` full happy-path needs an onboarded active actor.
- Auth flow: register returns `dev_otp` when `DEV_OTP` is set on Railway (fixed `123456`).
- Test entities/chits created are disposable dev data.
