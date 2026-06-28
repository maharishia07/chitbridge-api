# Subscription, entitlements & quotas (design + path)

How we cap usage and gate features by subscription. Settle before going hard to prod.

## ❓ OPEN QUESTIONS — decide together (Athi + Claude)  [BACKLOG]
Status: **mechanism built (`lib/plans.js`), tiers are placeholders. Parked as backlog.** Answer these together
to lock the catalogue; then Claude wires the migration + `requireQuota`/`requireFeature` middleware.

1. **Tiers** — plan names/levels? (e.g. Starter / Team / Business / Enterprise, or your own set.)
2. **Quota numbers per tier** — fill the grid: `entities` (TOTAL under the top node), `actors`,
   `chits_per_month`, `network_depth`, `suppliers`. (Numbers in `lib/plans.js` are guesses.)
3. **Chit quota period & counting** — per month / per billing cycle / lifetime? Counted as sent copies only,
   or both copies of the two-copy model?
4. **Features per tier** — which modules in each tier (`task / order / catalogue / suppliers / network /
   disputes / mis / coassists`)?
5. **Minimal viable base** — confirm `catalogue + chits + task` (vs your earlier minimal-bundle discussion).
   What is the smallest sellable unit?
6. **Dependency graph** — confirm `FEATURE_DEPS` (order→chits, disputes→chits, mis→chits, suppliers→catalogue,
   chits→catalogue). Any missing edges?
7. **Inheritance** — does the whole subtree share the root's plan, or can a child hold its own sub-allocation?
   (MVP assumes shared.)
8. **Overage behaviour** — at a quota hit: hard block / soft-warn + grace / auto-upgrade prompt?
9. **Plan assignment** — platform-admin only, or self-serve upgrade?

---

## Current state (honest)
**No plan / subscription / quota / entitlement model exists** (0 in schema). Only ad-hoc caps:
- Compose fan-out: `to 5 / cc 5 / for 1 / items 50 / attachments 10` (`chits.js:90`) — structural, not billing.
- Per-actor `max_tasks` (1–100, default 10) — workload, not billing.
**No caps** on total chits, total entities, entities-under-a-tree, actors-per-entity, network depth, or suppliers.
**No feature gating** — every panel is available to everyone.

## The model — three layers (mechanism built: `lib/plans.js`)
1. **Quotas** — hard numeric caps per resource: `entities`, `actors`, `chits_per_month`, `network_depth`, `suppliers`.
2. **Entitlements** — feature flags: which modules are on (`task`, `order`, `catalogue`, `suppliers`, `network`, `disputes`, `mis`, `coassists`).
3. **Bundles / dependencies** — a feature's prerequisites (`FEATURE_DEPS`), so a pick is always usable; plus a minimal viable base.

## Who controls it & scoping — the TOP NODE
- The **network top node (billing root)** holds the subscription. **Quotas count TOTAL across its subtree**
  (the whole tenant) — e.g. "25 entities" is the aggregate under the top node, **NOT per node** (your call).
- Children **inherit** the root's plan/entitlements. `billing_root(entity)` = root of its ltree path.
- **Platform scope** (`owner_scope='platform'`) assigns plans and owns the plan catalogue.
- Counts are tenant-scoped (subtree), consistent with the P0 isolation model — never cross-tenant.

## Data model (path)
- **Plan catalogue** = `lib/plans.js` (code, versionable, reviewable) — `PLANS[code] = { quotas, features }`,
  the `FEATURE_DEPS` graph, and pure helpers (`hasFeature`, `quota`, `withinQuota`, `resolveBundle`, `planClosed`).
  *Tier numbers there are PLACEHOLDERS — set from the real subscription model.*
- **Assignment** = `plan_code` + `subscription_status` columns on the **root identity** (migration); subtree inherits.
- **Counts** = computed on-the-fly at create time (COUNT over the subtree / per entity) for MVP; cached counters later.

## Enforcement
- **Quota guard** — `requireQuota('actors'|'entities'|'chits'|'network_depth'|'suppliers')` middleware before the
  relevant create endpoints (actor create, `netConnect`/register, `/send`, supplier add). On breach → `402/403`
  "<resource> limit reached on your plan — upgrade." (Uses `withinQuota(plan, resource, currentCount)`.)
- **Feature gate** — `requireFeature('suppliers'|'network'|'disputes'|...)` middleware on a module's routes →
  `403` "this feature isn't in your plan" when not entitled.
- **Frontend** — read entitlements from `/me` (or a new `/entitlements`); hide/disable un-entitled panels and show
  an upgrade prompt (a `MSG` tier). Demo side unaffected.

## Feature bundles / minimal viable set
- `resolveBundle(selected)` expands a selection to include dependencies — pick **disputes** → auto-adds **chits + catalogue**.
- `planClosed(features)` rejects a plan whose feature list is missing a dependency (no broken plans).
- **Proposed minimal base** (CONFIRM against the earlier minimal-bundle discussion): `catalogue + chits + task`
  — without these nothing transacts. "Just the task panel" still needs chits+catalogue underneath to be useful;
  the bundle map encodes exactly that so a customer can't buy an unusable slice.

## Phased path (held; build in order)
1. **Decide the catalogue** — tier names + quota numbers + which features per tier (PRODUCT). Confirm `FEATURE_DEPS` + minimal base.
2. **Migration** — `plan_code` + `subscription_status` on the root identity; `billing_root` resolution helper.
3. **Middleware** — `requireQuota` + `requireFeature`; wire onto create/feature routes (server-side hard checks).
4. **Frontend** — entitlement-driven panel visibility + quota/upgrade messages.
5. **Platform admin** — assign plans, view usage-vs-quota per tenant.
6. **Later** — usage metering/counters, overage policy, self-serve upgrade, per-child sub-allocation.

## Notes
- Quotas are HARD, server-enforced; client values are never trusted.
- This is a distinct layer from the generic **settings JSONB** (behaviour toggles): entitlements/quotas are
  billing-governed and queryable; settings remain for per-entity preferences.
- Cross-refs: `lib/plans.js`, `TECH-HARDENING-BACKLOG.md` (settings-future-path), `AMENDMENT-CHECKLIST.md`.
