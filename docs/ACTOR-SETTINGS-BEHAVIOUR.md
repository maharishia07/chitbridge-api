# Actor (co-assist) settings, behaviour & overrides

Map of what settings exist, what behaviour each is *supposed* to drive, what it *actually* does today, the
override/bounding hierarchy, and how presence (shift/break/leave/remove) changes the system. Reviewed 2026-06-28.

## Settings inventory
- **Entity-level** (`entity_actor_settings`, set in the Settings panel): `assignment_model` (pull|push|both),
  `default_max_tasks`, `all_task_visible`, `auto_return_on_short_break`.
- **Per-actor** (`identities`): `max_tasks`, `current_task_count`, `break_status`, `break_type`, `return_date`,
  `actor_role`, `actor_type`.

## Settings → behaviour: intended vs ACTUAL (the gap)
| Setting | Intended | Actual today |
|---|---|---|
| `assignment_model` (pull/push/both) | gate HOW tasks reach actors (actors pull vs admin pushes) | **STORED, not enforced** — push *and* pull both work regardless of the value |
| `default_max_tasks` | default load cap for new actors | **Not used** — create hardcodes `max_tasks = req.body.max_tasks || 10` (`actors.js:136`) |
| `all_task_visible` | actor sees ALL entity tasks vs only their own | **Not enforced** — "My/All Task" is a frontend toggle, always available |
| `auto_return_on_short_break` | on short break, return tasks to the pool | **Not enforced** — short break ALWAYS holds tasks (`actors.js:887` hardcodes "tasks held") |
| `max_tasks` / `current_task_count` | per-actor load cap | only a **warning** on push (`overloaded`), not a hard block |

> **Headline:** the four `entity_actor_settings` are **declarative placeholders** — a user can toggle them in the
> UI but they don't change behaviour yet. Either wire them, or mark them "coming soon" so they aren't *dead settings*.

## Presence / absence / leave — this part IS wired (works)
- **active** — assignable (push requires `break_status='active'`).
- **short_break** — tasks **HELD**; nobody else can pull them (`actors.js:887`).
- **leave** — tasks must be **routed first**: `task_action: pool` (back to entity) or `actor` (to a colleague);
  blocks the leave until routed; `current_task_count` reset (`actors.js:904-964`). Good guard.
- **deactivated** — login **revoked** (auth revalidation) + `return_date` (`:798`).
- **removed** — login revoked + hidden from lists (`break_status != 'removed'`) (`:809`).
- Remove/deactivate carry the same `task_action` reassignment (pool | colleague).
- ⚠️ **Atomicity:** the break/leave/remove handlers do several writes via `query` (not `withTransaction`) — a
  mid-way failure leaves partial state. Wrap them (same gap as `assign-bulk`).

## Override / bounding hierarchy (the "actor within entity limits" point)
Intended chain: **subscription (max actors @ billing root) → entity policy (`default_max_tasks`, `assignment_model`,
`all_task_visible`) → actor (`max_tasks` ≤ entity)**.
- **Today:** per-actor `max_tasks` is a flat 1–100; there is **NO enforcement that it's ≤ the entity policy**, and
  `default_max_tasks` is ignored. So an actor is **not bounded by the entity** — the gap you flagged.
- Subscription bounds the actor **count** per entity (designed: `lib/plans.js` quota `actors`).

## Network → actor behaviour
- **Today: none.** Actors attach to an entity via `parent_entity_id` (identities), which is **separate** from the
  `cb_entity` network tree. The network governs entity↔entity relationships, not actors.
- **Future (ATH-118 engagement / scoped grants):** an actor's access/scope is meant to flow **down the network
  tree** from the entity's node ("you can only grant what you hold"). That is where network will bound actor
  behaviour — not built; ties to the "view-hat" + entitlements work.

## Gaps to address (QUEUE)
1. **Wire the `entity_actor_settings`** (or mark "coming soon"): `assignment_model` → gate push/pull; `default_max_tasks`
   → new-actor default; `all_task_visible` → server-side task visibility; `auto_return_on_short_break` → branch the
   short-break handler (hold vs return-to-pool).
2. **Entity-bounds-actor** — cap per-actor `max_tasks` ≤ entity policy; validate on create/update.
3. **Atomicity** — wrap break/leave/remove task-reassignment in `withTransaction`.
4. **(Future)** network-derived actor scope (engagement model).

Cross-refs: `SUBSCRIPTION-ENTITLEMENTS.md` (actor-count quota), `AMENDMENT-CHECKLIST.md` (atomicity, entitlement),
`TECH-HARDENING-BACKLOG.md`.
