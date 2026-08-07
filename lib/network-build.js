// @stage tested
// @stage-note Turns a saved network DESIGN into a build PLAN — what would be created, invited, skipped or refused.
// Pure: no DB, no side effects. The route executes the plan; this file decides it.
'use strict';
/**
 * network-build.js — from a drawing to a decision, before anything exists.
 *
 * Athi, 2026-08-07: *"start with build that mints, partner as invite-only."*
 *
 * The design page has always ended at a wall: it draws a network and creates nothing. This is the half that
 * decides what Build would do. It is deliberately separated from the doing, because the interesting part is the
 * REFUSALS, and refusals are only trustworthy if you can test them without a database.
 *
 * ── THE ONE RULE THAT MATTERS ───────────────────────────────────────────────────────────────────────────────────
 *
 *   OWNED    → CREATE.  The operator is making a part of their own business. Nobody else's consent is involved,
 *                       because nobody else exists yet. They hold the claim code and hand it out.
 *   PARTNER  → INVITE.  Another business. It is NEVER created and NEVER placed on the tree by this plan.
 *
 * That asymmetry is not a convenience. REVIEW-2026-08-06 §6 left one question gating the whole network model:
 * *"who may add an entity to a network, and must the entity consent?"* — because `network` visibility shows a
 * member things the public cannot see (the warehouse). If a network could absorb an outsider unilaterally, then
 * "form a network, add the entity you want to read, read their warehouse" is a one-line attack, and the `network`
 * tier becomes exactly the hole that `catalogue-view.js` refuses to open for supplier links.
 *
 * So the answer this file encodes is: **an entity joins a network only by an act of its own.** An owned node is
 * created by the operator and is theirs by construction. A partner gets a connection request and has to accept.
 * There is no third path, and adding one would need the bilateral-consent note in catalogue-view.js rewritten
 * first, deliberately, by a person.
 *
 * ── WHAT A NODE BECOMES ─────────────────────────────────────────────────────────────────────────────────────────
 *
 *     name        "Clothing"              what a person reads          → display_name
 *     handle      athi.clothing           what a person types          → user_id   (see handle.js)
 *     bridge id   CBM5P72HB7              the identity                 → minted at execution, not here
 *     exposure    public/protected/off    what its catalogue shows     → catalogue_visibility
 *
 * The design page says `protected`; the platform says `network` (b115). The words are translated HERE, once, so
 * neither side has to know about the other's vocabulary. A node with no storefront is `private` — designing a
 * warehouse and getting a public shop would be the worst possible default.
 *
 * ── ZERO DEPENDENCIES EXCEPT handle.js · TIER A ─────────────────────────────────────────────────────────────────
 */
const handle = require('./handle');

/** design word → platform word. Anything unrecognised falls to `private`: the safe end of the scale. */
const EXPOSURE = { public: 'public', protected: 'network', network: 'network', private: 'private' };

function visibilityOf(node) {
  const holds = Array.isArray(node.holds) ? node.holds : [];
  if (holds.indexOf('storefront') < 0) return 'private';   // no shopfront designed → nothing to show anyone
  return EXPOSURE[String(node.exposure || '').toLowerCase()] || 'private';
}

/** Already built? The design carries the result back, so a second Build is a no-op rather than a duplicate. */
function builtOf(node) {
  const b = node && node.built;
  return b && b.bridge_id && b.user_id ? b : null;
}

/**
 * plan({ rootHandle, nodes, taken }) → { root, create, invite, skip, problems, counts }
 *
 *   rootHandle  the operator's own handle — the network's name. `athi`.
 *   nodes       the saved design draft, verbatim.
 *   taken       lowercase handles already in use by SOMEONE ELSE (the caller reads these from the DB in one query).
 *
 * Nothing here throws. A design with mistakes in it must still produce a plan for the good parts and a readable
 * reason for the rest — a build that refuses wholesale because one node is misnamed is a build nobody runs twice.
 */
function plan({ rootHandle, nodes, taken } = {}) {
  const out = { root: '', create: [], invite: [], skip: [], problems: [], counts: {} };

  const rc = handle.check(rootHandle);
  if (!rc.ok) {
    out.problems.push({ key: null, name: rootHandle || '(none)', reason: 'The network name is not usable: ' + rc.reason });
    return finish(out);
  }
  out.root = String(rootHandle).trim().toLowerCase();

  const all = Array.isArray(nodes) ? nodes : [];
  const takenSet = new Set([...(taken || [])].map((h) => String(h).toLowerCase()));

  // Handles resolved so far, by node key — a child needs its parent's handle, so order matters and the tree is
  // walked parents-first. `null` marks a node that could not be resolved: its children are blocked, not orphaned.
  const handleOf = new Map();
  const blocked = new Set();

  // The root node of the draft IS the operator. It is not created; it is where the name comes from.
  const rootNode = all.find((n) => n.root) || null;
  if (rootNode) handleOf.set(rootNode.key, out.root);

  const childrenOf = (key) => all.filter((n) => (n.parent_key || null) === (key || null) && !n.root);

  // Within one parent, two nodes called "Stores" would compose the same handle. The DB unique index would catch it
  // as a 23505 halfway through; catching it here means the operator is told BEFORE anything was created.
  const claimed = new Set();

  function walk(parentKey) {
    for (const n of childrenOf(parentKey)) {
      const parentHandle = handleOf.get(parentKey);
      const name = String(n.name || '').trim();

      if (blocked.has(parentKey) || (parentKey && !parentHandle)) {
        out.problems.push({ key: n.key, name, reason: 'Its parent could not be built, so this cannot be placed.' });
        blocked.add(n.key);
        walk(n.key);
        continue;
      }

      // ── PARTNER — invited, never created ────────────────────────────────────────────────────────────────────
      if (n.owned === false) {
        const ref = String(n.partner_ref || '').trim();
        if (!ref) {
          out.problems.push({ key: n.key, name,
            reason: 'A partner is invited, not created — add their handle or User ID (e.g. ravi.timbers) to invite them.' });
        } else {
          out.invite.push({ key: n.key, name, ref });
        }
        // A partner's own structure is the partner's business. We do not name, create or place anything under it.
        const kids = childrenOf(n.key);
        if (kids.length) {
          out.problems.push({ key: n.key, name,
            reason: `${kids.length} node${kids.length === 1 ? '' : 's'} sit under a partner. A partner's own structure is theirs to build — move them under a node you own.` });
        }
        blocked.add(n.key);
        walk(n.key);
        continue;
      }

      // ── OWNED ───────────────────────────────────────────────────────────────────────────────────────────────
      const already = builtOf(n);
      if (already) {
        handleOf.set(n.key, String(already.user_id).toLowerCase());
        out.skip.push({ key: n.key, name, handle: already.user_id, bridge_id: already.bridge_id, reason: 'already built' });
        walk(n.key);
        continue;
      }

      const made = handle.child(parentHandle || out.root, name);
      if (made.error) {
        out.problems.push({ key: n.key, name: name || '(unnamed)', reason: made.error });
        blocked.add(n.key);
        walk(n.key);
        continue;
      }
      if (claimed.has(made.handle)) {
        out.problems.push({ key: n.key, name, reason: `Two nodes here would both be called "${made.handle}". Rename one.` });
        blocked.add(n.key);
        walk(n.key);
        continue;
      }
      if (takenSet.has(made.handle)) {
        out.problems.push({ key: n.key, name, reason: `"${made.handle}" is already taken. Rename this node.` });
        blocked.add(n.key);
        walk(n.key);
        continue;
      }

      claimed.add(made.handle);
      handleOf.set(n.key, made.handle);
      out.create.push({
        key: n.key,
        name,
        handle: made.handle,
        parent_key: parentKey || null,
        parent_handle: parentHandle || out.root,
        visibility: visibilityOf(n),
      });
      walk(n.key);   // depth-first, so a parent is always earlier in `create` than its children
    }
  }

  walk(rootNode ? rootNode.key : null);
  return finish(out);
}

function finish(out) {
  out.counts = {
    create: out.create.length,
    invite: out.invite.length,
    skip: out.skip.length,
    problems: out.problems.length,
  };
  return out;
}

module.exports = { plan, visibilityOf, EXPOSURE };
