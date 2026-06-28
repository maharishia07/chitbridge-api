# Network authority & parent→child cascade (gap analysis + fix spec)

**Question: is the authority cascade from top-level to next level handled? — NO, essentially absent.**
The design intends "authority flows down the tree; you can only grant what you hold" (CO_HELP), but
`src/services/network.js` enforces almost no authority, and what little exists is bypassable.

## Per-operation authority — today vs. should-be
| Op | Today | Should be |
|---|---|---|
| `register` | none | any authed user; becomes a root |
| `requestConnect` | none (anyone can request any parent←child) | caller must be the parent or the child (initiator) |
| `approve` | child-consent **only if `actingEntityId` provided — OPTIONAL → bypassable; frontend omits it** | the child must consent, derived from the token (not the body) |
| `decline` | none | the child (or parent) of the edge |
| `suspend` / `resume` | **none** (any edge) | the **parent** of the edge (authority over its child) |
| `disconnect` | none (only the open-chit settle guard) | the parent **or** child of the edge |
| `subtree` | none (read ANY entity's subtree) | caller must be **at/above** that node (its own subtree) |
| `connections` | none (read ANY entity's edges) | caller = that entity (or an ancestor) |
| `claim` | **none — anyone can claim ANY unclaimed entity** | identity verification (ATH-86) |

## The missing cascade model
Nothing enforces that:
- the **top node (root) has authority over its whole subtree**,
- a **parent can act on its direct children's edges**,
- **reads are scoped to the caller's own subtree** (you see yours, not others'),
- **claim** proves ownership.
Authority is either absent or taken from the (client-supplied) body. The cascade is a design goal, not built.

## Why it matters beyond security
The **"entities under the top node" quota** (subscription, billing-root) and the **engagement / scoped-grant**
model both depend on this cascade — the top node governing its subtree. So building the cascade is foundational,
not just a security patch.

## Fix spec (with the cb_entity ↔ identities bridge — Track B)
1. **Derive the acting cb_entity from `req.identity`** (via the bridge), never from the body.
2. **Per-op authority** as the table above: parent-of-edge for suspend/resume/disconnect; child-consent for
   approve/decline (from token); subtree/connections scoped to the caller's subtree; claim via identity proof.
3. **ltree makes the cascade cheap:** "X has authority over Y" = `Y.path <@ X.path` (Y is in X's subtree). One
   containment check gives the whole top-down cascade.
4. **Immediate sub-fix (within the current model):** make `actingEntityId` **required** on `approve` so consent
   can't be bypassed by omission (still spoofable until the bridge, but closes the omit-to-bypass hole); guard
   `claim`.
5. Tests for each authority rule (parent-can/child-can/stranger-cannot).

Related: P0 item in `TECH-HARDENING-BACKLOG.md` (auth mitigated; this is the authority half),
`SUBSCRIPTION-ENTITLEMENTS.md` (billing-root subtree quota depends on this cascade).
