# Network authority and the parent-to-child cascade (rewritten 2026-10-19 to match the code)

**Question: who may do what on a network connection? Answer today: only the two businesses on it, and the acting business comes from the signed-in token, never from the request body.**
This file first said "essentially absent" (gap analysis, 28 Jun 2026). That was true then and is not true now. Authority was built under ATH-86 (commit f55b1591, 17 Sep 2026, "authority from the token") and hardened on 14 Oct (standing check on reads). The rule table lives in code, so this page points to it instead of copying it.

## Where the rules are (read the code, not this page, when they differ)
- `src/services/network.js` `mayAct(op, { edge, actorId, parentId, childId })` (about line 92): the pure rule table. `nodeOf()` (line 60) turns the signed-in identity into its node through the bridge (`identities.bridge_id` = `cb_entity.bridge_id`).
- `tests/network-authority.test.cjs`: parent can, child can, stranger cannot, and the side that asked cannot approve. It runs without a database.
- `lib/network-membership.js`: the membership and standing SQL (a member in standing, built under the brand or on an active commercial edge). Migration `b261_network_brand_edges.sql`.

## Per-operation authority, as built
| Op | Who may | Code |
|---|---|---|
| `register` | any signed-in business; becomes a root | `register()` |
| `requestConnect` | the parent or the child (either side may ask) | `mayAct` op `request` |
| `approve` | the side that did NOT ask (the other party consents), derived from the token | `mayAct` op `approve` |
| `decline` | the parent or the child | `mayAct` |
| `suspend`, `resume` | the parent only ("only the network can suspend or resume a member") | `mayAct` |
| `disconnect` | the parent or the child | `mayAct` |
| `subtree` | a business in the same network (same root) and in standing; a suspended member sees only its own node | `_sameRoot()` / `subtree()` |
| `connections` | the node itself or one of its ancestors (`path <@`) | `connections()` |
| `claim` | only the business the node belongs to (identity bridge match), and only while unclaimed | `claim()` |

Two kinds of edge: `governance` (the tree; one live parent; approving moves the child's subtree) and `commercial` (a brand's network of stores; many allowed; never moves the tree).

## Not built (stated, not hidden)
- **Root authority over the whole subtree.** `mayAct` allows the direct parent or child of an edge only. A root cannot suspend a grandchild's edge; it must be the parent of that edge. The ltree containment check (`path <@`) is used for reads, not for writes.
- **Cascade revoke.** On `disconnect`, grants that flowed through the edge are not revoked: the code carries `TODO: cascade-revoke grants ... when grants land` (`src/services/network.js`, in `disconnect`).
- **Quota by subtree.** The subscription quota "entities under the top node" (`SUBSCRIPTION-ENTITLEMENTS.md`) does not read this cascade yet.

History: 28 Jun 2026 gap analysis (commits ebb0a471, a73af54f); built 17 Sep 2026 (f55b1591). Checked against origin/main of this repo on 2026-10-19 by cb-docs; the cb-rail owner confirms the table.
