# HANDOFF — Dispute notifications & actor routing (2026-06-28)

Hand this whole file to Claude in a future session to resume. It is the change history
+ the next-cycle instruction for the "view hat" work. Everything below baseline-7 is
**built locally but NOT pushed/deployed** — see "Accumulated, unpushed" and the deploy runbook.

Repo: `chitbridge-api` (local `C:\Users\mahar\Downloads\chitbridge-mvp-v1.0\chitbridge-mvp`).
DB: Supabase project `bzacyrdrnzdbficjplcn`. API: Railway. "live" = the dev env.

---

## 1. Accumulated, UNPUSHED (as of 2026-06-28)

GitHub is under a **secondary push rate-limit** (writes fail `exit 128`, reads OK) from too
many pushes in one session. So the batch below is committed **locally only** and waits for the
throttle to lift. Nothing here is deployed; **live = baseline-7**.

| What | Where | State |
|---|---|---|
| **baseline-8** (2 commits) | `main` (`75ba6aa`) + tag `baseline-8-self-dispute` | merged local, not pushed |
| **baseline-9** (1 commit) | branch `feat/dispute-actor-routing` (`f900679`) | built local, NOT merged, not pushed |
| backup repo sync | `cb-context-backup` (memory + spine) | pending throttle |

---

## 2. Change history

### baseline-8 — self-chit dispute notifications + dispute-queue dedup
- **`routes/notifications.js`**: a dispute/void now surfaces even when **self-raised**
  (`WHERE action_by <> me OR action IN (dispute_raised,dispute_resolved,voided)`), and the
  `chit_header` join is aligned on `direction` so a self-chit yields **exactly 2** notifications
  (one per copy: `sent`/Order side + `received`/Task side), each carrying `cs.direction`.
- **`routes/chits.js`** dispute **queue** (`GET /chits/disputes/queue`): was joining
  `chit_header` AND `chit_status` on `entity_id=me`, which for a self-chit produced a **2×2 = 4-row
  cartesian** per dispute. Rewritten so `chit_disputes cd` is the sole row driver: participant
  scope via `EXISTS (chit_status …)`, header fields via scalar subqueries → **one row per dispute**.
- No migration (reuses existing `direction` column + `state_log`).
- **Honesty note:** the earlier "chit-wide disputes leak to non-parties" flag was WRONG — the join
  already scoped to participants. The real bug was the self-chit duplication. Fixed.

### baseline-9 — actor-level dispute routing + dispute team
- **`migration_dispute_routing.sql`** (additive, nullable, no backfill — safe anytime):
  `ALTER TABLE identities ADD COLUMN dispute_handler_actor_id UUID REFERENCES identities(identity_id);`
- **`routes/notifications.js`**: feed is now **actor-aware**. It still resolves the feed owner as the
  entity (`parent_entity_id || identity_id`) so actors keep seeing the entity-wide feed, but it now
  also reads `caller = req.identity.identity_id` (the actual actor) and the entity's
  `dispute_handler_actor_id`, and returns two booleans per row — **nothing is hidden**:
  - `assigned_to_me = (cs.assigned_to_actor_id = caller)` — this chit is mine to handle.
  - `dispute_for_me = (action IN (dispute_raised,dispute_resolved) AND caller = dispute_handler)` —
    disputes only (voids deliberately excluded), routed to the standing dispute desk.
  - The "exclude my own actions" filter now keys on `caller` (the actor), not the entity.
- **`routes/entities.js`**: `GET /me` returns `dispute_handler_actor_id`; `PATCH /profile` sets it,
  guarded so it must be **one of your own actors** (`identity_type='actor' AND parent_entity_id=you`),
  else `400`. No new endpoint.

### Decisions locked (product calls by Athi)
1. **Who's notified by a dispute:** every entity involved (default), PLUS actor-level routing — the
   per-chit **assignee** and a standing **dispute team** are tagged so they can filter to their lane.
2. **Routing depth:** actor-level **when assigned** (chosen over entity-only).
3. **Dispute team = single handler for now** (one `dispute_handler_actor_id`), not a list. Extending
   to a real multi-member team is a future join-table.
4. **`dispute_for_me` = disputes only**, voids dropped (a void still shows in the feed, just isn't
   routed to the dispute desk).
5. **Dispute team is notify + view, NOT act.** Being the handler grants no action rights.

---

## 3. NEXT CYCLE — the "view hat" build (NOT yet done)

**Why it's deferred & currently harmless:** chit *view* is presently **entity-wide** — any actor under
an entity can see all of that entity's chits (inbox/detail keyed on the parent entity). `actor_role`
(`routes/actors.js:122`) is a **free-text label only — there is no enforced permission/hat system**.
So today the dispute handler can already open any disputed chit; nothing blocks them.

**The build, when per-actor "view hats" are introduced:** once actors are restricted to a *subset* of
the entity's chits (a real view-permission model), the dispute team would lose sight of chits outside
their hat. So:

> When per-actor view scoping ("hats") is added, the actor named in `identities.dispute_handler_actor_id`
> must receive an **implicit view grant on any chit that has an open dispute** (`chit_disputes.status='open'`),
> even when that chit falls outside their normal hat scope — and that grant should lapse when the dispute
> closes. The grant is **view-only**: it must NOT confer act/resolve/status-change rights. Mirror the same
> implicit-view rule for the per-chit assignee (`chit_status.assigned_to_actor_id`) if assignee view is
> also scoped by hats. Add a test: a dispute-handler actor with a narrow view hat can GET a disputed chit
> they don't own, cannot mutate it, and loses GET access once the dispute resolves.

Also pending (smaller follow-ups):
- **Frontend Settings UI** to pick `self_copy_pref` (both|sent|received) and `dispute_handler_actor_id`.
- Surface `assigned_to_me` / `dispute_for_me` in the web notifications panel (filter "show only mine").
- Dispute team as a **list** (join table) if one handler isn't enough.

---

## 4. Deploy runbook (run when the push throttle lifts)

1. Run `migration_dispute_routing.sql` on Supabase `bzacyrdrnzdbficjplcn` (1 additive column).
2. Merge `feat/dispute-actor-routing` → `main`; tag `baseline-9-dispute-routing`; add a BASELINES.md row.
3. Push `main` + tags `baseline-8-self-dispute`, `baseline-9-dispute-routing` → Railway auto-deploys.
4. Sync `cb-context-backup` (memory + spine + this handoff).
5. **Smoke:** self-chit dispute → `notifications.count == 2` (one per `direction`); queue → 1 row/dispute;
   an assigned actor sees `assigned_to_me=true`; a set dispute-handler sees `dispute_for_me=true` on a
   dispute they didn't raise; a void shows but is NOT `dispute_for_me`.

Rollback points: `baseline-7-two-copy` (last deployed), or any earlier `baseline-N` tag.
