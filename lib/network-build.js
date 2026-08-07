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
 * ── BUILD IS A CONVERGENCE, AND IT IS ADDITIVE ONLY ─────────────────────────────────────────────────────────────
 * Running it again does not start over and does not duplicate. It reconciles the design with what exists:
 *
 *     CREATE   an owned node that has no entity yet
 *     UPDATE   a built store whose VISIBILITY the design now disagrees with
 *     INVITE   a partner not yet asked
 *     SKIP     everything already in agreement
 *
 * It never deletes, never renames, and never re-handles. Removing a node from the drawing removes it from the
 * drawing — the store keeps existing, keeps its data and keeps its login. That asymmetry is deliberate: a design
 * screen that could destroy a live business by pressing Delete on a box is not a design screen, and there is no
 * undo for a deleted entity. Retiring a store is a separate, explicit act and is not built.
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

/**
 * visibilityOf(node) — who may see this store's catalogue.
 *
 * Athi, 2026-08-07: *"we keep the catalogue setting simple — here we have to decide only the visibility part and
 * nothing else."* So exposure is a property of the NODE, not of a storefront capability the operator also has to
 * remember to switch on. It used to require both, which meant a store marked public stayed invisible because a
 * tick three panels away was off.
 *
 * ⚠️ An ABSENT choice is `private`, and that must never change. Every other default here is recoverable; a
 * back-office node that quietly became a public shop is the one mistake that cannot be taken back.
 *
 * Behaviour-preserving for drafts written before this: the old UI only ever set `exposure` when the storefront
 * capability was ticked, so no existing node carries an exposure the old rule would have ignored.
 */
function visibilityOf(node) {
  return EXPOSURE[String((node && node.exposure) || '').toLowerCase()] || 'private';
}

/** How OPEN each tier is. Kept here rather than imported so this stays zero-dependency; visibility-cap.js agrees. */
const RANK = { private: 0, network: 1, public: 2 };

/** The narrower of two visibilities. A ceiling never opens anything — it only ever closes. */
function narrower(a, b) {
  const ra = RANK[a], rb = RANK[b];
  if (ra === undefined) return b;
  if (rb === undefined) return a;
  return ra <= rb ? a : b;
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
function plan({ rootHandle, nodes, taken, live, ceiling } = {}) {
  const out = { root: '', create: [], update: [], invite: [], skip: [], problems: [], narrowed: [], counts: {} };
  /**
   * ── THE CEILING CASCADES DOWN THE WHOLE CHAIN ─────────────────────────────────────────────────────────────
   * Athi, 2026-08-08: *"make the cascade for parent and child."*
   *
   * A store can be no more open than the thing it sits inside. Before this, the cap descended from the ROOT only
   * and never looked at the node's own parent — so "a private network cannot hold a public store" was enforced at
   * the first level and absent at every level below it. A network-only Warehouse could hold a PUBLIC Outlet: you
   * close the warehouse, believe everything under it is closed, and a sub-unit is still facing customers.
   *
   * One rule at every level is also the only version that can be explained: **the narrowest wins**.
   *
   * The escape hatch is placement, not exception — a shop that genuinely should be public belongs under the root,
   * not inside a closed warehouse. Where a node SITS is the statement about who it reports to.
   */
  const rootCeiling = RANK[String(ceiling || '').toLowerCase()] !== undefined ? String(ceiling).toLowerCase() : 'public';
  // What each already-built store is ACTUALLY set to right now, by bridge id. Absent → no updates are proposed:
  // a design cannot be allowed to change a live store on the strength of what the draft remembers.
  const liveBy = (live && typeof live === 'object') ? live : null;

  const rc = handle.check(rootHandle);
  if (!rc.ok) {
    out.problems.push({ key: null, name: rootHandle || '(none)', reason: 'The network name is not usable: ' + rc.reason });
    return finish(out);
  }
  out.root = String(rootHandle).trim().toLowerCase();

  const all = Array.isArray(nodes) ? nodes : [];
  const takenSet = new Set([...(taken || [])].map((h) => String(h).toLowerCase()));

  // Handles resolved so far, by node key. The HANDLE always comes from the root — `athi.mens`, never
  // `athi.clothing.mens` — but the tree is still walked parents-first, because PLACEMENT is hierarchical even
  // though the name is not. `null` marks a node that could not be resolved: its children are blocked, not orphaned.
  const handleOf = new Map();
  const blocked = new Set();
  // The most open a node under this one may be — its parent's EFFECTIVE visibility, not the parent's wish.
  const ceilingOf = new Map();

  /** What this node actually gets, and a record if an ancestor is the reason it is not what was asked for. */
  function effective(n, parentCeiling) {
    const want = visibilityOf(n);
    const got = narrower(parentCeiling, want);
    if (got !== want) {
      out.narrowed.push({ key: n.key, name: String(n.name || '').trim(), from: want, to: got, by: 'parent' });
    }
    return got;
  }

  // The root node of the draft IS the operator. It is not created; it is where the name comes from.
  const rootNode = all.find((n) => n.root) || null;
  const rootKey = rootNode ? rootNode.key : null;
  if (rootNode) { handleOf.set(rootNode.key, out.root); ceilingOf.set(rootNode.key, rootCeiling); }

  const childrenOf = (key) => all.filter((n) => (n.parent_key || null) === (key || null) && !n.root);

  /**
   * The namespace is FLAT, so two nodes called "Mens" — even under different parents — are one name. That is the
   * accepted cost of a handle a person can say: see the header of handle.js.
   *
   * Caught here rather than left to the DB's unique index, which would fire as a 23505 halfway through the
   * transaction and roll back a build that was mostly fine. The map keeps the other node's NAME so the operator is
   * told which two nodes clashed, not just that something did.
   */
  const claimed = new Map();   // handle → the node name that claimed it

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
      // A node's ceiling is its parent's EFFECTIVE visibility. Top-level nodes take the network's own ceiling.
      const myCeiling = ceilingOf.has(parentKey) ? ceilingOf.get(parentKey) : rootCeiling;

      const already = builtOf(n);
      if (already) {
        handleOf.set(n.key, String(already.user_id).toLowerCase());
        /**
         * ── ENHANCING AN EXISTING NETWORK ───────────────────────────────────────────────────────────────────
         * Athi, 2026-08-07: *"if we want to enhance the existing network what we need to do?"*
         *
         * Build is not a one-shot. Run it again and it CONVERGES: new nodes are created, and a store whose
         * visibility you changed in the design is brought into line. Without this, changing a built store from
         * "Network only" to "Public" would edit a drawing and nothing else — the design and the live network
         * would drift apart silently, which is the worst possible property for a governance screen.
         *
         * What is NOT converged, deliberately:
         *   · the HANDLE — people already hold it; a name that changes under them is not a name.
         *   · the DISPLAY NAME — the store's own to change, like any other business.
         *   · anything DESTRUCTIVE — removing a node from the design deletes nothing. See the header.
         *
         * The comparison is against what the store is ACTUALLY set to, read fresh, never against what the draft
         * believes it set. A draft that has drifted must not be able to assert its way back.
         */
        // The cascade governs an EXISTING store too — otherwise closing a parent would leave its already-built
        // children open, which is the exact hole this was written to close.
        const want = effective(n, myCeiling);
        ceilingOf.set(n.key, want);
        const now = liveBy && liveBy[already.bridge_id] ? String(liveBy[already.bridge_id].catalogue_visibility || '') : null;
        if (now !== null && now !== want) {
          out.update.push({ key: n.key, name, handle: already.user_id, bridge_id: already.bridge_id,
                            from: now, to: want });
        } else {
          out.skip.push({ key: n.key, name, handle: already.user_id, bridge_id: already.bridge_id,
                          visibility: now, reason: 'already built' });
        }
        walk(n.key);
        continue;
      }

      // From the ROOT, never the parent — `athi.mens`, whatever depth this node sits at.
      const made = handle.child(out.root, name);
      if (made.error) {
        out.problems.push({ key: n.key, name: name || '(unnamed)', reason: made.error });
        blocked.add(n.key);
        walk(n.key);
        continue;
      }
      if (claimed.has(made.handle)) {
        out.problems.push({ key: n.key, name,
          reason: `"${claimed.get(made.handle)}" is already using the name "${made.handle}". Store names are unique across the whole network, not just within one branch — rename one of them.` });
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

      claimed.set(made.handle, name);
      handleOf.set(n.key, made.handle);
      const vis = effective(n, myCeiling);
      ceilingOf.set(n.key, vis);
      out.create.push({
        key: n.key,
        name,
        handle: made.handle,
        /**
         * parent_key drives PLACEMENT on the tree, and it means "another node in THIS plan". A node hanging
         * directly off the root reports `null`, because the root is the OPERATOR — an entity that already exists
         * and is not part of the plan.
         *
         * ⚠️ This emitted the root DESIGN NODE's key, and every top-level store was refused at build time with
         * "its parent is not on the network tree yet". The executor looks each parent up in a map of nodes it just
         * created; the root is not one of those, so the lookup missed and the guard fired — correctly, on a
         * question that should never have been asked. Three unit tests asserted parent_key and all three passed,
         * because the planner's answer was self-consistent; only running it against a database showed that the
         * two halves meant different things by the same field. The seam, again.
         *
         * There is deliberately no `parent_handle` — the handle is not derived from the parent, and a field
         * implying it was would be read as authority sooner or later.
         */
        parent_key: (parentKey && parentKey !== rootKey) ? parentKey : null,
        visibility: vis,
        asked: visibilityOf(n),          // what the design said, so the UI can show "public → network (parent)"
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
    update: out.update.length,
    invite: out.invite.length,
    skip: out.skip.length,
    problems: out.problems.length,
    narrowed: out.narrowed.length,
  };
  return out;
}

module.exports = { plan, visibilityOf, EXPOSURE };
