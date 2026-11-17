# Consistency model — ACID vs BASE assessment

First assessment of the system's transactional/consistency behaviour, and where it's rigid vs customizable.
(Feeds a KB answer later. This is the engineering view.)

## TL;DR
The **core** (the chit record + its lifecycle) is **ACID / strongly consistent**; the **periphery**
(notifications, MIS, the cross-copy view, load counters) is **BASE / eventually consistent** — mostly by design.
That's the right shape for a multi-party ledger. Two soft spots to tighten: **client-side MIS aggregation** and
**drift-prone counters**. ACID transaction wrapping is **partial** (added to the key flows, not yet universal).

## Where the system is ACID (strong consistency)
- **PostgreSQL** engine: atomicity via `withTransaction`, MVCC isolation, durability, FK + `CHECK` constraints.
- **The sealed chit record** (`chit_header`/`chit_detail`) — the "frozen receipt": immutable once created.
- **Multi-write flows wrapped in a transaction:** `/send` two-copy fan-out, dispute **raise** + **resolve**,
  actor **status-change** + **break/leave** task-reassignment.
- **Tenant isolation** + participation gates — hard invariants, server-enforced.
- **Append-only audit** (`state_log`) — the durable history.

## Where the system is BASE (eventual / soft state)
- **Notifications** — DERIVED from `state_log` on read (no separate store); recomputed each call. Eventually
  consistent read-model. Fine.
- **MIS** — computed **CLIENT-SIDE** from several independent reads (`Promise.all`): a snapshot, not a
  transactional aggregate → can be momentarily inconsistent and is **not authoritative**. (Your point: this
  belongs server-side.)
- **Two-copy independent statuses** — the sender (Order) and receiver (Task) copies evolve **independently** by
  design; the cross-copy view is eventually/independently consistent, not lock-step.
- **`current_task_count`** (actor load) — an incremental counter; **soft state that can drift** from the true
  count (esp. where an increment isn't in the same transaction as the assignment).
- **Network `in_flight` flag** — explicitly "an optional cache; the truth is the open-chit query."

## The consistency boundary
- **Within one party's copy + one operation → ACID.**
- **Across copies / across derived views (notifications, MIS, counts) → BASE.**
A multi-party ledger should look exactly like this: each party's own record is strongly consistent; the shared
and aggregate views are eventually consistent.

## Soft spots to tighten (backlog)
1. **[BACKLOG] MIS → server-side rollup** — make the aggregate authoritative + consistent + one source of truth
   (no client computation). Decide per-metric what's a live server rollup vs an on-the-fly read.
2. **[BACKLOG] Counter drift** — `current_task_count`: either increment **always in the same transaction** as the
   assignment, or drop the counter and **compute-on-read**, or add a periodic reconcile job.
3. **[BACKLOG] Universalise transactions** — `assign-bulk` (and any future multi-write) still isn't wrapped.

## Rigid vs customizable (for the KB)
- **RIGID — the trust foundation (must not bend):** the sealed chit record (the receipt never changes), tenant
  isolation, the append-only audit, the two-copy principle, dispute-on-record.
- **CUSTOMIZABLE via policy (settings, once wired):** `self_copy_pref`, assignment model, dispute routing,
  schema-driven fields, subscription entitlements + quotas.
- **FLEXIBLE config / extensible:** catalogue, schema definitions, plans, per-entity preferences.

**KB one-liner:** *rigid where it must be (your record, your privacy, the audit trail — these can't be bent),
flexible where it should be (how you run your own operation — assignment, routing, fields, plan).*

Cross-refs: `TECH-HARDENING-BACKLOG.md` (atomicity), `ACTOR-SETTINGS-BEHAVIOUR.md`, `TRUST.md` (customer wording).
