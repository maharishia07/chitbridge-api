// OWNS      the network build, run as named steps on one transaction (execute · updateNode: claim root · place root · create node · invite node · write back)
'use strict';
// @stage tested
// CALLED BY routes/network-design.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
// FLOW      plan (lib/network-build.js, pure) → execute: claimRoot · placeRoot · createNode · updateNode · inviteNode · writeBack, one transaction
// CARD      04-network/network-design-builder
// @stage-note EXECUTES a network build plan — the steps that read and write. The plan itself is decided, purely, in
// lib/network-build.js; this file only carries it out, in one transaction (routes/network-design.js POST /build).
/**
 * network-build-run.js — THE BUILD, AS NAMED STEPS (round T2-SPLIT, 2026-10-14).
 *
 * POST /api/network-design/build was one 507-line handler. It is now:
 *
 *   rootOf        the root name — the User ID, or a stated one that is free (refuses in words, never guesses)
 *   designOf      the saved design (also /validate and PUT's receipt guard read it here — one reader)
 *   takenUnder    the handles already taken under the root (also /validate — one query, one rule)
 *   liveOf        what the already-built stores are ACTUALLY set to
 *   capOf         the operator's cap, narrowed by the network's own visibility
 *   execute       ONE transaction: claimRoot · placeRoot · builtPaths · createNode · updateNode (mirrorSchema) ·
 *                 inviteNode · writeBack
 *
 * ⚠️ lib/network-build.js stays Tier A — no DB, its only require is ./handle (tests/network-build.test.js). Every step
 * that touches the database lives here; the pure ones (narrowNotes, receipts, answer) live beside the planner.
 * Proof that nothing moved: tests/network-build-golden.test.cjs, frozen from the handler before the split.
 */
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, withEntity } = require('../db'); const { CREATOR_MAY_EDIT_SQL, creatorRefusal } = require('./creator-edit'); // F13: what the minting shop may still change
const { currencyRefusal } = require('./govresolve'); // may this entity price in this currency?
const { currencyLockRefusal } = require('./country-setup'); // SET-80: has the store traded? then its money is fixed
const handleLib = require('./handle');
const { boundRead } = require('./bound-read'); /* SEC-185: identities are read under their own binding */
const networkBuild = require('./network-build');
const visibilityCap = require('./visibility-cap');

const BRIDGE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — these get read out over the phone
const newBridgeId = () => 'CB' + Array.from({ length: 8 }, () => BRIDGE_CHARS[crypto.randomInt(BRIDGE_CHARS.length)]).join('');
// devOtp.fixedOtp() and NEVER process.env.DEV_OTP directly: a sealed environment must degrade to a real random
// code even if the variable somehow survived deploy. That is the whole reason lib/dev-otp.js exists.
const newClaimCode = () => require('./otp').generateOTP('entity'); /* SH-OTP1 (T2-WRITERS): the one generator */
const CLAIM_DAYS = 7;

/** ltree labels allow [A-Za-z0-9_] only. Bridge ids already qualify; the guard is for anything that ever won't. */
const label = (bridgeId) =>
  String(bridgeId)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_');

/** a step's refusal — the route answers it as it stands */
const refuse = (status, body) => ({ refuse: { status, body } });

/** The cap on what the OPERATOR may choose. A minted node can never be more open than the network that minted it. */
async function operatorCap(entityId) {
  let plan = null,
    paramsOverride = {};
  try {
    const planResult = await query('SELECT plan, params_override FROM identities WHERE identity_id = $1', [entityId]);
    if (planResult.rows[0]) {
      plan = planResult.rows[0].plan;
      paramsOverride = planResult.rows[0].params_override || {};
    }
  } catch (e) {
    require('./logger').warn('network-build.cap-unread', { err: e && e.message });
  } /* pre-governance schema — capOf() then reports unenforced */
  let planMenu = null;
  try {
    const constitution = await require('../routes/governance').loadActiveConstitution();
    planMenu = constitution && constitution.plan_menu;
  } catch (e) {
    require('./logger').warn('network-build.plan-menu-unread', { err: e && e.message });
  } /* capOf() then reports the plan cap unenforced */
  return visibilityCap.capOf({ plan, planMenu, paramsOverride });
}

/** the operator's own row — what the build reads about the business doing it */
async function meRowOf(me) {
  return (
    await query(
      `SELECT identity_id, bridge_id, display_name, user_id, country, currency_code, catalogue_visibility
       FROM identities WHERE identity_id = $1`,
      [me]
    )
  ).rows[0];
}

/** ── 1 · THE ROOT NAME — { rootHandle, rootClaimed } or { refuse } */
async function rootOf(meRow, askedRootRaw) {
  // Every handle in the network is built from it, so it is settled before anything else is considered.
  const askedRoot = String(askedRootRaw || '')
    .trim()
    .toLowerCase();
  let rootHandle = String(meRow.user_id || '')
    .trim()
    .toLowerCase();
  let rootClaimed = false;

  if (rootHandle) {
    const handleCheck = handleLib.check(rootHandle);
    if (!handleCheck.ok) {
      // They already have a User ID that cannot be a network root (an email address, most likely). Changing it
      // would break every reference anyone already holds to them, so this is theirs to decide, not ours.
      return refuse(409, {
        error: 'Root name unusable',
        code: 'ROOT_HANDLE_UNUSABLE',
        message: `Your User ID "${meRow.user_id}" cannot be a network name: ${handleCheck.reason} Change your User ID in Settings first — every store in the network is named from it.`,
        suggestion: handleLib.slug(meRow.display_name) || null
      });
    }
  } else {
    /**
     * ⭐⭐ CLAIMING A USER ID IS A DECISION, NOT A SIDE EFFECT OF DESIGNING A NETWORK.
     *
     * Athi, 2026-08-19: *"where from key@platform-of-platform — this platform came from? This is the name I
     * gave in network screen while trying to design the network. The original user id for this network is
     * mytest."*
     *
     * ⚠️⚠️ HE HAD FOUND A REAL ONE. With no User ID set, this branch took the DESIGN LABEL he typed on the
     * network screen — or, failing that, a slug of his display name — and wrote it to identities.user_id as
     * his permanent platform identity. `slug("Platform of Platform")` → `platform-of-platform`, which is
     * exactly what he saw. The disclosure existed, as one clause mid-sentence in a confirm dialog.
     *
     * ⚠️ AND ONCE STORES EXIST IT CANNOT BE TAKEN BACK. Every store below is named `<root>.<store>`, so
     * changing the User ID afterwards orphans them from their root. Athi had NOT built when he reported this
     * — nothing was written, and the value he saw was the SCREEN'S GUESS. That is the narrower and more
     * interesting version of the bug: the guess is displayed in enough places to read as a fact, and this
     * branch is where a fact is what it would have become.
     *
     * ⭐ A value that cannot be taken back must not be inferred from a label someone typed while sketching a
     * diagram — whether or not anyone has reached that point yet.
     *
     * ⭐ SO IT NOW REFUSES AND ASKS. A slug of the display name is offered as a SUGGESTION — never applied —
     * because display_name is not unique and is not an identifier; it is a name, and the two are the
     * distinction this whole area keeps getting wrong.
     *
     * ⚠️ EXPLICIT INTENT STILL WORKS: a caller that sends `root_handle` has chosen. What is refused is the
     * INFERENCE — a build with no User ID and no stated root.
     */
    if (!askedRoot) {
      return refuse(409, {
        error: 'User ID needed',
        code: 'ROOT_HANDLE_NEEDED',
        message:
          'Set your User ID before building a network. Every store below is named from it ' +
          '(<your-user-id>.store), and it cannot be changed afterwards without orphaning them — so it is ' +
          'yours to choose, not ours to guess from a diagram label.',
        suggestion: handleLib.slug(meRow.display_name) || null,
        where: 'Profile › IAM'
      });
    }
    const want = askedRoot;
    const handleCheck = handleLib.check(want);
    if (!handleCheck.ok) {
      return refuse(400, {
        error: 'Root name unusable',
        code: 'ROOT_HANDLE_NEEDED',
        message: `Choose a network name. "${want || meRow.display_name}" will not do: ${handleCheck.reason}`
      });
    }
    const clash = await query('SELECT 1 FROM identities WHERE LOWER(user_id) = $1', [want]);
    if (clash.rows.length) {
      return refuse(409, { error: 'Root name taken', code: 'ROOT_HANDLE_TAKEN', message: `"${want}" is already taken. Choose another network name.` });
    }
    rootHandle = want;
    rootClaimed = true; // written inside the transaction below, not here
  }
  return { rootHandle, rootClaimed };
}

/** ── 2 · THE DESIGN — this entity's saved draft, or null (RLS: network_design is entity-scoped, read through withEntity) */
async function designOf(me) {
  const design = await withEntity(me, (db) => db.query('SELECT draft FROM network_design WHERE entity_id = $1', [me]));
  return design.rows.length ? design.rows[0].draft : null;
}

// Only handles under this root can collide with a child of this root, so this stays one small query however
// many entities exist on the platform.
async function takenUnder(rootHandle) {
  const takenRows = await query(`SELECT LOWER(user_id) AS h FROM identities WHERE user_id IS NOT NULL AND LOWER(user_id) LIKE $1`, [rootHandle + '.%']);
  return takenRows.rows.map((item) => item.h);
}

// What the already-built stores are ACTUALLY set to. Read fresh, never taken from the draft: a design that has
// drifted must not be able to assert its way back over a live store. One query for all of them.
async function liveOf(nodes) {
  const live = {};
  const builtBridges = nodes.map((item) => item && item.built && item.built.bridge_id).filter(Boolean);
  if (builtBridges.length) {
    const lookupResult = await query(
      'SELECT bridge_id, catalogue_visibility, purpose, sort_order, address, city, country, currency_code, lat, lng, service_km, dispatch_days, ship_within_days, ship_beyond_days FROM identities WHERE bridge_id = ANY($1)',
      [builtBridges]
    );
    // The whole row: the planner compares visibility, purpose, order AND place against it.
    lookupResult.rows.forEach((item) => {
      live[item.bridge_id] = item;
    });
  }
  return live;
}

/** ── 3 · THE CAP — the operator's, narrowed by the network's own choice */
async function capOf(caller, meRow) {
  // Resolved BEFORE planning: it is now the top of a cascade that runs the whole depth of the tree, not a filter
  // applied to each node afterwards. Every node's ceiling is its parent's effective visibility, and the root's
  // ceiling is this.
  let capacity = await operatorCap(caller);
  /**
   * ── A PRIVATE NETWORK CANNOT CONTAIN A PUBLIC STORE ─────────────────────────────────────────────────────
   * Athi, 2026-08-07: *"what if the network is private? Then each store can have only network or private
   * options."*
   *
   * Right, and nothing enforced it. The cap was read from the operator's params_override — what somebody ELSE
   * capped the operator at — and ignored the operator's OWN choice. So a network that had declared itself
   * closed could still mint public shops under it, and `/api/catalogue/network/:root` would front them on a
   * public page the operator never meant to have.
   *
   * `network` narrows it too: an operator that is itself only visible to its own network cannot put a member
   * in front of the public either.
   *
   * ⚠️ This bounds only what the NETWORK BUILD may set. An entity that publishes itself directly is unaffected
   * — that is its own business, and this is a cascade from an operator to the nodes it provisions.
   */
  const netVis = String(meRow.catalogue_visibility || '').toLowerCase();
  if ((netVis === 'private' || netVis === 'network') && visibilityCap.RANK[capacity.max] > visibilityCap.RANK.network) {
    capacity = {
      max: 'network',
      by: 'network',
      enforced: true,
      reason:
        netVis === 'private'
          ? 'This network is private, so a store under it can be visible to the network or to nobody — not to the public.'
          : 'This network is visible to its own network only, so a store under it cannot be public.'
    };
  }
  return capacity;
}

/** the root claims its User ID — and re-stamps its people, whose ids hang off it */
async function claimRoot(db, rootHandle, caller) {
  // Unique index on lower(user_id): a concurrent second build would 23505 here and roll the whole thing back,
  // which is the correct outcome — two networks must not share a root.
  await db.query('UPDATE identities SET user_id = $1 WHERE identity_id = $2 AND user_id IS NULL', [rootHandle, caller]);
  /**
   * ── ⭐⭐⭐ AND RE-STAMP THIS BUSINESS'S PEOPLE, because their ids hang off the name it just claimed ───────
   *
   * Athi, 2026-09-15, on the stored employee id: *"which cannot be drifted."*
   *
   * ⚠️ THIS IS THE ONLY PLACE A BUSINESS GAINS A HANDLE AFTER IT WAS CREATED. An entity registered before
   * b170 has a NULL `user_id`, so every employee minted under it was stored as `ravi@CBZQK5DAH9.br` — the
   * bridge-id fallback. The line above gives the business a readable name; without this the next line,
   * its people would keep pointing at the old one for ever, and the two would disagree about who they
   * work for. That is exactly the drift he named.
   *
   * ⚠️ ONLY ROWS THAT STILL CARRY THE OLD FORM. An employee whose id already names the new handle is left
   * alone, and `WHERE user_id IS NOT NULL` keeps this from inventing ids for actors the backfill has not
   * reached — b260 owns that, and doing it twice in two places is how two rules appear.
   */
  /* ⚠️ THE FORM IS NOT SPELLED HERE. `ops.f_employee_user_id()` (b260) is SQL's one builder, exactly as
     lib/mintuserid is JavaScript's — so this says WHICH rows to re-stamp and never WHAT an employee id
     looks like. tests/namespace.test.cjs fails any file outside the grammar modules that writes ".br". */
  await db.query(
    `UPDATE identities a
        SET user_id = ops.f_employee_user_id(a.actor_key, $1, e.bridge_id)
      FROM identities e
     WHERE a.parent_entity_id = $2 AND a.identity_type = 'actor'
       AND a.actor_key IS NOT NULL AND a.user_id IS NOT NULL
       AND e.identity_id = $2
       AND a.user_id = ops.f_employee_user_id(a.actor_key, NULL, e.bridge_id)`,
    [rootHandle, caller]
  );
}

// The root's own place on the tree. DO NOTHING, never overwrite: if this entity already sits inside somebody
// else's network, that placement is theirs and its children hang below wherever it actually is.
async function placeRoot(db, meRow) {
  await db.query(
    `INSERT INTO cb_entity (bridge_id, name, mode, owner_scope, path, claimed)
     VALUES ($1, $2, 'b2b', 'entity', $3::ltree, true)
     ON CONFLICT (bridge_id) DO NOTHING`,
    [meRow.bridge_id, meRow.display_name, label(meRow.bridge_id)]
  );
  const rootPathRow = await db.query('SELECT path::text AS path FROM cb_entity WHERE bridge_id = $1', [meRow.bridge_id]);
  const rootPath = rootPathRow.rows[0] && rootPathRow.rows[0].path;
  if (!rootPath) throw new Error('the network root could not be placed on the tree');
  return rootPath;
}

// Where each node sits, by design key. Already-built nodes contribute their REAL path, read back rather than
// recomputed — a node moved by hand stays where it was moved to.
async function builtPaths(db, plan, caller) {
  const pathOf = new Map();
  const builtBridges = plan.skip.map((item) => item.bridge_id).filter(Boolean);
  if (builtBridges.length) {
    /* LENS-SEC (1129): only a store THIS operator minted gives a path to hang children on (created_by, as updateNode); another business's bridge id has none, so its child is refused as "parent not on the tree" */
    const builtRows = await boundRead((text, params) => db.query(text, params), caller,
      'SELECT c.bridge_id, c.path::text AS path FROM cb_entity c JOIN identities i ON i.bridge_id = c.bridge_id WHERE c.bridge_id = ANY($1) AND i.created_by = $2',
      [builtBridges, caller]
    );
    const byBridge = new Map(builtRows.rows.map((x) => [x.bridge_id, x.path]));
    for (const s of plan.skip) if (byBridge.has(s.bridge_id)) pathOf.set(s.key, byBridge.get(s.bridge_id));
  }
  return pathOf;
}

/**
 * receiptsOnly(prevNodes, nodes) → nodes with `built`/`invited` taken from the SAVED draft by key, never from the caller.
 * A `built: {bridge_id}` is the receipt of a store this server minted; a client that writes one could name another business's store.
 */
function receiptsOnly(prevNodes, nodes) {
  const receipts = new Map();
  (Array.isArray(prevNodes) ? prevNodes : []).forEach((item) => {
    if (item && item.key && (item.built || item.invited)) receipts.set(item.key, item);
  });
  return nodes.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const out = Object.assign({}, item);
    delete out.built;
    delete out.invited;
    const saved = item.key ? receipts.get(item.key) : null;
    if (saved && saved.built) out.built = saved.built;
    if (saved && saved.invited) out.invited = saved.invited;
    return out;
  });
}

/** one owned node → an identity, its place on the tree, its cap. A refusal becomes a `problem`, never a throw. */
async function createNode(db, createRequest, x) {
  const { plan, pathOf, rootPath, me: caller, meRow, expires, created } = x;
  /**
   * ⚠⚠ THE SECOND PLACE THAT SETS currency_code, AND IT HAD NO ENVELOPE CHECK. PATCH /entities/profile
   * validated against the constitution; this route — added later — wrote whatever the design plan said. A
   * network operator could therefore mint a store in a currency the same platform refused one screen away.
   * Not a loophole anyone opened: a new write path that did not inherit the old one's guard.
   *
   * ⚠️ CHECKED AGAINST THE OPERATOR'S ENTITY, because the store does not exist yet and has no governance
   * of its own — it will inherit the operator's. Checking the store would mean creating it first and
   * asking afterwards, which is the wrong order for a refusal.
   *
   * ⚠️ auth.entityOf(req), NOT the local `me`. `me` is req.identity.identity_id, which for a co-assist is
   * the ACTOR's row — it carries no governance stamp, so the lookup would quietly resolve `base` instead of
   * the business's own constitution. `me` is the right answer for created_by and the wrong one for whose
   * rules apply; the same variable cannot be both.
   *
   * ⭐ IT BECOMES A `problem`, NOT A THROWN ERROR. The build is a batch: one bad currency must not abandon
   * the other nodes, and the operator needs a repair naming the store, exactly like an absent parent above.
   */
  const _wantCur = createRequest.place && createRequest.place.currency;
  if (_wantCur) {
    const _bad = await currencyRefusal(x.entity, _wantCur);
    if (_bad) {
      plan.problems.push({ key: createRequest.key, name: createRequest.name, reason: _bad.message });
      return;
    }
  }
  const parentPath = createRequest.parent_key ? pathOf.get(createRequest.parent_key) : rootPath;
  if (!parentPath) {
    // Its parent was built in an earlier run and is not on the tree. Creating it anyway would put a store in
    // no network at all, which is silently wrong; refusing names the repair.
    plan.problems.push({ key: createRequest.key, name: createRequest.name, reason: 'Its parent is not on the network tree yet. Rebuild the parent first.' });
    return;
  }
  const identity_id = uuidv4();
  const bridge_id = newBridgeId();
  const claim = newClaimCode();

  await db.query(
    `INSERT INTO identities
       (identity_id, bridge_id, display_name, user_id, identity_type, status, catalogue_visibility,
        params_override, country, currency_code, otp_code, otp_expires_at, otp_attempts, created_by, purpose, sort_order,
        address, city, lat, lng, service_km, dispatch_days, ship_within_days, ship_beyond_days, entity_kind)
     VALUES ($1, $2, $3, $4, 'entity', 'active', $5, $6::jsonb, $7, $8, $9, $10, 0, $11, $12, $13,
             $14, $15, $16, $17, $18, $19, $20, $21, 'network')`,
    [
      identity_id,
      bridge_id,
      createRequest.name,
      createRequest.handle,
      createRequest.visibility,
      // The provisioning cap. visibility-cap.js: "a node provisioned BY A NETWORK is not its own business —
      // the operator decided, and the entity must not be able to undo that from its own profile screen."
      JSON.stringify({ caps: { catalogue_visibility: createRequest.visibility } }),
      // The store's own country if the design stated one, else the operator's. There is exactly ONE country
      // column and it was very nearly listed twice — Postgres refuses that outright, which is the good case.
      // GOV-AU1: neither stated → NULL (the store's Country setup asks), never India.
      (createRequest.place && createRequest.place.country) || meRow.country || null,
      // The store's OWN currency when the design set one — a store trading in another country is stamped
      // in ITS currency, and money is never converted afterwards. Otherwise the network's.
      // STD2 (GOV-AU1 for MONEY): neither stated → NULL; the store's Country setup asks (country-setup.MONEY_UNSTATED), never INR by name.
      (createRequest.place && createRequest.place.currency) || meRow.currency_code || null,
      claim,
      expires,
      caller,
      // The purpose, carried onto the store itself. Empty becomes NULL rather than '' so "never said" and
      // "deliberately blank" are not the same value in the column.
      createRequest.purpose || null,
      createRequest.sort_order,
      // b119 — where it is. A place the design never stated stays NULL rather than becoming an empty string.
      (createRequest.place && createRequest.place.address) || null,
      (createRequest.place && createRequest.place.city) || null,
      createRequest.place ? createRequest.place.lat : null,
      createRequest.place ? createRequest.place.lng : null,
      createRequest.place ? createRequest.place.service_km : null,
      createRequest.place ? createRequest.place.dispatch_days : null,
      createRequest.place ? createRequest.place.ship_within_days : null,
      createRequest.place ? createRequest.place.ship_beyond_days : null
    ]
  );

  const myPath = parentPath + '.' + label(bridge_id);
  await db.query(
    `INSERT INTO cb_entity (bridge_id, name, mode, owner_scope, path, claimed)
     VALUES ($1, $2, 'b2b', 'entity', $3::ltree, true)`,
    [bridge_id, createRequest.name, myPath]
  );

  pathOf.set(createRequest.key, myPath);
  created.push({
    key: createRequest.key,
    name: createRequest.name,
    handle: createRequest.handle,
    bridge_id,
    visibility: createRequest.visibility,
    purpose: createRequest.purpose || null,
    sort_order: createRequest.sort_order,
    place: createRequest.place || null,
    claim_code: claim,
    expires_at: expires,
    path: myPath
  });
}

/**
 * currencyMoveRefusal(db, move, x) → the sentence that stops a store's place move from changing its money, or null. Two asks, one each: may the
 * operator's constitution price in it (govresolve.currencyRefusal, SET-81 included) and has the STORE already traded (SET-80,
 * country-setup.currencyLockRefusal — the one lock). No currency in the move: nothing to ask.
 */
async function currencyMoveRefusal(db, move, x) {
  const wanted = move.place && move.place.to && move.place.to.currency;
  if (!wanted) return null;
  const refused = await currencyRefusal(x.entity, wanted);
  if (refused) return refused.message;
  const store = (await db.query('SELECT identity_id FROM identities WHERE bridge_id = $1', [move.bridge_id])).rows[0];
  /* the STORE's rows are visible only AS the store (rls_entity on chit_header, journal_entry, catalogue_items): read its constitution on its own withEntity handle, never the operator's — a traded store would look untraded and the lock fail open */
  const locked = store && (await withEntity(store.identity_id, (asStore) => currencyLockRefusal(asStore, store.identity_id, wanted)));
  return locked ? locked.message : null;
}

// ── UPDATES — bring an existing store into line with the design ────────────────────────────────────────
// The cap moves WITH the choice: the operator decided, so the operator's cap is restated at the same value.
// Leaving the old cap behind would let a store that was opened to `public` be narrowed back by nobody, or a
// store closed to `private` still carry a cap that permits publishing.
async function updateNode(db, updateRequest, x) {
  const { plan, me: caller, updated } = x;
  /* ⚠️ THE SAME COLUMN, THE SAME OMISSION. A store's place can MOVE, and the place carries a currency —
     so the update path writes currency_code as surely as the insert does. Both or neither. */
  const _uBad = await currencyMoveRefusal(db, updateRequest, x);
  if (_uBad) {
    plan.problems.push({ key: updateRequest.key, name: updateRequest.name, reason: _uBad });
    return;
  }
  // Visibility and purpose move independently — a node can be in `update` for either or both — so each is
  // written only when it actually changed. COALESCE on a null parameter leaves the column untouched.
  const nextVis = updateRequest.to || null;
  const nextPurpose = updateRequest.purpose ? updateRequest.purpose.to || '' : null;
  // -1 is the sentinel for "clear it": a null parameter already means "leave the column alone", so there has
  // to be some other way to say "this store is no longer arranged".
  const nextOrder = updateRequest.order ? (updateRequest.order.to === null ? -1 : updateRequest.order.to) : null;
  /* T2-POLICY (SET4): a store's address through the ONE writer's fragment (profile.shopIdentitySql, $7) — written only when the place
     moved, with the rest of the place in this same statement (the place still moves as a unit) */
  const _uId = require('./profile').shopIdentitySql(updateRequest.place ? { address: (updateRequest.place.to && updateRequest.place.to.address) || null } : {}, 7);
  const updateResult = await db.query(
    `UPDATE identities
        SET catalogue_visibility = COALESCE($1, catalogue_visibility),
            params_override = CASE WHEN $1::text IS NULL THEN params_override ELSE
                              COALESCE(params_override, '{}'::jsonb)
                              || jsonb_build_object('caps',
                                   COALESCE(params_override->'caps', '{}'::jsonb)
                                   || jsonb_build_object('catalogue_visibility', $1::text)) END,
            purpose = CASE WHEN $4::text IS NULL THEN purpose
                           WHEN $4::text = '' THEN NULL ELSE $4::text END,
            sort_order = CASE WHEN $5::int IS NULL THEN sort_order
                              WHEN $5::int = -1 THEN NULL ELSE $5::int END,
            -- b119 · PLACE. One jsonb parameter rather than six scalars: the place moves as a unit, and six
            -- independent COALESCEs would let a half-applied place through if one ever went missing.
            ${_uId.sql ? _uId.sql + ',' : ''}
            city       = CASE WHEN $6::jsonb IS NULL THEN city       ELSE $6->>'city' END,
            country    = CASE WHEN $6::jsonb IS NULL THEN country    ELSE COALESCE($6->>'country', country) END,
            lat        = CASE WHEN $6::jsonb IS NULL THEN lat        ELSE ($6->>'lat')::numeric END,
            lng        = CASE WHEN $6::jsonb IS NULL THEN lng        ELSE ($6->>'lng')::numeric END,
            service_km = CASE WHEN $6::jsonb IS NULL THEN service_km ELSE ($6->>'service_km')::int END,
            dispatch_days    = CASE WHEN $6::jsonb IS NULL THEN dispatch_days    ELSE ($6->>'dispatch_days')::smallint END,
            ship_within_days = CASE WHEN $6::jsonb IS NULL THEN ship_within_days ELSE ($6->>'ship_within_days')::smallint END,
            ship_beyond_days = CASE WHEN $6::jsonb IS NULL THEN ship_beyond_days ELSE ($6->>'ship_beyond_days')::smallint END,
            currency_code = CASE WHEN $6::jsonb IS NULL THEN currency_code
                                 ELSE COALESCE($6->>'currency', currency_code) END
      WHERE bridge_id = $2 AND created_by = $3 AND ${CREATOR_MAY_EDIT_SQL}
      RETURNING bridge_id, identity_id`,
    [nextVis, updateRequest.bridge_id, caller, nextPurpose, nextOrder, updateRequest.place ? JSON.stringify(updateRequest.place.to) : null].concat(_uId.params)
  );
  // `created_by = me` is the authority check, and it is in the WHERE rather than a prior SELECT so there is
  // no gap between checking and writing. A store this operator did not mint simply does not match.
  if (!updateResult.rows.length) {
    plan.problems.push({ key: updateRequest.key, name: updateRequest.name, reason: creatorRefusal(updateRequest.name) });
    return;
  }
  if (nextVis) await mirrorSchema(updateResult.rows[0].identity_id, nextVis);
  updated.push({
    key: updateRequest.key,
    name: updateRequest.name,
    handle: updateRequest.handle,
    bridge_id: updateRequest.bridge_id,
    from: updateRequest.from,
    to: updateRequest.to,
    purpose: updateRequest.purpose,
    order: updateRequest.order,
    place: updateRequest.place
  });
}

/**
 * ⭐⭐ AND THE SAME ANSWER ON THE SCHEMA — the second half of the publish act, which this route was
 * missing. There are two visibility fields and the storefront reads the OTHER one:
 *   · `identities.catalogue_visibility` — the publish act, written above, and the b114 gate
 *   · `entity_schemas.visibility`       — what buildPublicView requires, and what the b49 RLS policy on
 *                                         catalogue_items keys off with no tenant context
 *
 * ⚠️ PATCH /profile has mirrored these since 2026-08-18. THIS ROUTE NEVER DID, so flipping a store to
 * public from the Network builder left its schema private and the store went on hiding every product it
 * owned — serving its ADOPTED catalogue to the world while its own shelf stayed dark, with no error.
 * b193 measured it live on 2026-09-01: 129 of 182 public shops mis-aligned, and the affected list is
 * full of Cascade / Depot / Outlet / North — the names this route mints.
 *
 * ⭐ schemaVisibilityFor, not a third copy of the rule. Two places deciding this differently is the bug
 * one layer down, and writing the expression out again here would have been the same mistake a third
 * time. Only when the visibility actually moved: `nextVis` is null when this node changed for some
 * other reason, and a null must leave the schema alone exactly as the COALESCE above leaves the column.
 */
async function mirrorSchema(shopId, nextVis) {
  const { schemaVisibilityFor } = require('./schema-bootstrap');
  try {
    /* SEC-75: the schema is the STORE's row, so it is written bound to the store (the id the UPDATE above just returned; no read of identities, which is row-secured too) —
       the operator's own handle is bound to the operator and would change 0 rows. Same pattern as currencyLockRefusal above. No new door, no BYPASSRLS. */
    await withEntity(shopId, (asStore) =>
      asStore.query(
        `UPDATE entity_schemas SET visibility = $1
          WHERE entity_id = $2 AND status = 'active' AND is_default = true`,
        [schemaVisibilityFor(nextVis), shopId]
      )
    );
  } catch (e) {
    /* A store with no default schema yet is not an error — ensureDefaultSchema bootstraps one at first
       sign-in and reads catalogue_visibility when it does, which is the path that already works. */
    if (!(e && (e.code === '42703' || e.code === '42P01'))) throw e;
  }
}

// ── PARTNERS — a request, never a placement ────────────────────────────────────────────────────────────
async function inviteNode(db, inviteRequest, x) {
  const { me: caller, meRow, invited, failedInvites } = x;
  const ref = inviteRequest.ref;
  const found = await db.query(
    `SELECT identity_id, bridge_id, display_name FROM identities
      WHERE (LOWER(user_id) = LOWER($1) OR UPPER(bridge_id) = UPPER($1))
        AND identity_type = 'entity' AND status = 'active'`,
    [ref]
  );
  if (!found.rows.length) return void failedInvites.push({ key: inviteRequest.key, name: inviteRequest.name, reason: `No business found with the handle "${ref}".` });
  const them = found.rows[0],
    remote = await require('./network-invite-guard').remoteReason(them.identity_id); /* reviews4 M3: the NET-77 refusal an ask gets */
  if (remote) return void failedInvites.push({ key: inviteRequest.key, name: inviteRequest.name, reason: remote });
  if (them.identity_id === caller) {
    failedInvites.push({ key: inviteRequest.key, name: inviteRequest.name, reason: 'That is your own handle.' });
    return;
  }
  /**
   * ⭐ THE INVITATION IS THE NETWORK'S OWN (2026-09-17). It used to be a row in `connections`, which nothing reads as
   * membership — a partner who accepted was still outside the network. It is now a `commercial` edge from this root
   * to the partner (src/services/network.js): the partner accepts it, and lib/network-membership counts it.
   */
  const netsvc = require('../src/services/network');
  const partnerNode = await netsvc.nodeOf(them.identity_id, { ensure: true }, db);
  const rootNode = (await db.query('SELECT * FROM cb_entity WHERE bridge_id = $1', [meRow.bridge_id])).rows[0];
  const existing =
    partnerNode && rootNode
      ? await db.query(
          `SELECT id, state FROM cb_edge WHERE parent_id = $1 AND child_id = $2 AND type = 'commercial'
       AND state IN ('requested', 'active', 'suspended')`,
          [rootNode.id, partnerNode.id]
        )
      : { rows: [] };
  if (existing.rows.length) {
    invited.push({
      key: inviteRequest.key,
      name: inviteRequest.name,
      handle: ref,
      bridge_id: them.bridge_id,
      status: existing.rows[0].state === 'requested' ? 'pending' : 'accepted',
      edge_id: existing.rows[0].id,
      already: true
    });
    return;
  }
  if (!partnerNode || !rootNode) {
    failedInvites.push({ key: inviteRequest.key, name: inviteRequest.name, reason: 'That business has no bridge id to invite.' });
    return;
  }
  const edge = await db.query(
    `INSERT INTO cb_edge (parent_id, child_id, type, state, requested_by)
     VALUES ($1, $2, 'commercial', 'requested', $1) RETURNING id`,
    [rootNode.id, partnerNode.id]
  );
  invited.push({ key: inviteRequest.key, name: inviteRequest.name, handle: ref, bridge_id: them.bridge_id, status: 'pending', edge_id: edge.rows[0].id });
}

// ── WRITE THE RESULT BACK INTO THE DESIGN ──────────────────────────────────────────────────────────────
// Same transaction as the creation. This is what makes a second Build a no-op instead of a duplicate.
async function writeBack(db, x) {
  const nextNodes = networkBuild.receipts(x.nodes, x, () => new Date().toISOString());
  const nextDraft = Object.assign({}, x.draft, { nodes: nextNodes, root_handle: x.rootHandle });
  await db.query(
    `INSERT INTO network_design (entity_id, draft, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (entity_id) DO UPDATE SET draft = EXCLUDED.draft, updated_at = now()`,
    [x.me, nextDraft]
  );
}

/**
 * ── 4 · DO IT — one transaction. Every step below writes through the same client, so a build that created stores and
 * then failed to record that it had rolls back whole (the header of routes/network-design.js THE BUILD).
 *   b = { me, entity, meRow, plan, nodes, draft, rootHandle, rootClaimed }   entity = auth.entityOf(req): whose rules apply
 */
async function execute(body) {
  return withEntity(body.me, async (db) => {
    const x = Object.assign({}, body, { created: [], updated: [], invited: [], failedInvites: [] });
    if (body.rootClaimed) await claimRoot(db, body.rootHandle, body.me);
    x.rootPath = await placeRoot(db, body.meRow);
    x.pathOf = await builtPaths(db, body.plan, body.me);
    x.expires = new Date(Date.now() + CLAIM_DAYS * 24 * 60 * 60 * 1000);
    for (const c of body.plan.create) await createNode(db, c, x);
    for (const u of body.plan.update) await updateNode(db, u, x);
    for (const inv of body.plan.invite) await inviteNode(db, inv, x);
    await writeBack(db, x);
    return { created: x.created, updated: x.updated, invited: x.invited, failedInvites: x.failedInvites };
  });
}

module.exports = { execute, receiptsOnly, builtPaths, updateNode, currencyMoveRefusal, meRowOf, rootOf, designOf, takenUnder, liveOf, capOf, operatorCap, newBridgeId, newClaimCode, label, CLAIM_DAYS };
