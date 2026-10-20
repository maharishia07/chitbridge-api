'use strict';
// @stage tested
// CALLED BY routes/network-design.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
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
const { query, withEntity } = require('../db');
const { currencyRefusal } = require('./govresolve'); // may this entity price in this currency?
const handleLib = require('./handle');
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
    const r = await query('SELECT plan, params_override FROM identities WHERE identity_id = $1', [entityId]);
    if (r.rows[0]) {
      plan = r.rows[0].plan;
      paramsOverride = r.rows[0].params_override || {};
    }
  } catch (e) {
    require('./logger').warn('network-build.cap-unread', { err: e && e.message });
  } /* pre-governance schema — capOf() then reports unenforced */
  let planMenu = null;
  try {
    const c = await require('../routes/governance').loadActiveConstitution();
    planMenu = c && c.plan_menu;
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
    const rc = handleLib.check(rootHandle);
    if (!rc.ok) {
      // They already have a User ID that cannot be a network root (an email address, most likely). Changing it
      // would break every reference anyone already holds to them, so this is theirs to decide, not ours.
      return refuse(409, {
        error: 'Root name unusable',
        code: 'ROOT_HANDLE_UNUSABLE',
        message: `Your User ID "${meRow.user_id}" cannot be a network name: ${rc.reason} Change your User ID in Settings first — every store in the network is named from it.`,
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
    const rc = handleLib.check(want);
    if (!rc.ok) {
      return refuse(400, {
        error: 'Root name unusable',
        code: 'ROOT_HANDLE_NEEDED',
        message: `Choose a network name. "${want || meRow.display_name}" will not do: ${rc.reason}`
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
    const lr = await query(
      'SELECT bridge_id, catalogue_visibility, purpose, sort_order, address, city, country, currency_code, lat, lng, service_km, dispatch_days, ship_within_days, ship_beyond_days FROM identities WHERE bridge_id = ANY($1)',
      [builtBridges]
    );
    // The whole row: the planner compares visibility, purpose, order AND place against it.
    lr.rows.forEach((item) => {
      live[item.bridge_id] = item;
    });
  }
  return live;
}

/** ── 3 · THE CAP — the operator's, narrowed by the network's own choice */
async function capOf(me, meRow) {
  // Resolved BEFORE planning: it is now the top of a cascade that runs the whole depth of the tree, not a filter
  // applied to each node afterwards. Every node's ceiling is its parent's effective visibility, and the root's
  // ceiling is this.
  let cap = await operatorCap(me);
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
  if ((netVis === 'private' || netVis === 'network') && visibilityCap.RANK[cap.max] > visibilityCap.RANK.network) {
    cap = {
      max: 'network',
      by: 'network',
      enforced: true,
      reason:
        netVis === 'private'
          ? 'This network is private, so a store under it can be visible to the network or to nobody — not to the public.'
          : 'This network is visible to its own network only, so a store under it cannot be public.'
    };
  }
  return cap;
}

/** the root claims its User ID — and re-stamps its people, whose ids hang off it */
async function claimRoot(db, rootHandle, me) {
  // Unique index on lower(user_id): a concurrent second build would 23505 here and roll the whole thing back,
  // which is the correct outcome — two networks must not share a root.
  await db.query('UPDATE identities SET user_id = $1 WHERE identity_id = $2 AND user_id IS NULL', [rootHandle, me]);
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
    [rootHandle, me]
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
async function builtPaths(db, plan) {
  const pathOf = new Map();
  const builtBridges = plan.skip.map((item) => item.bridge_id).filter(Boolean);
  if (builtBridges.length) {
    const r = await db.query('SELECT bridge_id, path::text AS path FROM cb_entity WHERE bridge_id = ANY($1)', [builtBridges]);
    const byBridge = new Map(r.rows.map((x) => [x.bridge_id, x.path]));
    for (const s of plan.skip) if (byBridge.has(s.bridge_id)) pathOf.set(s.key, byBridge.get(s.bridge_id));
  }
  return pathOf;
}

/** one owned node → an identity, its place on the tree, its cap. A refusal becomes a `problem`, never a throw. */
async function createNode(db, c, x) {
  const { plan, pathOf, rootPath, me, meRow, expires, created } = x;
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
  const _wantCur = c.place && c.place.currency;
  if (_wantCur) {
    const _bad = await currencyRefusal(x.entity, _wantCur);
    if (_bad) {
      plan.problems.push({ key: c.key, name: c.name, reason: _bad.message });
      return;
    }
  }
  const parentPath = c.parent_key ? pathOf.get(c.parent_key) : rootPath;
  if (!parentPath) {
    // Its parent was built in an earlier run and is not on the tree. Creating it anyway would put a store in
    // no network at all, which is silently wrong; refusing names the repair.
    plan.problems.push({ key: c.key, name: c.name, reason: 'Its parent is not on the network tree yet. Rebuild the parent first.' });
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
      c.name,
      c.handle,
      c.visibility,
      // The provisioning cap. visibility-cap.js: "a node provisioned BY A NETWORK is not its own business —
      // the operator decided, and the entity must not be able to undo that from its own profile screen."
      JSON.stringify({ caps: { catalogue_visibility: c.visibility } }),
      // The store's own country if the design stated one, else the operator's. There is exactly ONE country
      // column and it was very nearly listed twice — Postgres refuses that outright, which is the good case.
      // GOV-AU1: neither stated → NULL (the store's Country setup asks), never India.
      (c.place && c.place.country) || meRow.country || null,
      // The store's OWN currency when the design set one — a store trading in another country is stamped
      // in ITS currency, and money is never converted afterwards. Otherwise the network's.
      // STD2 (GOV-AU1 for MONEY): neither stated → NULL; the store's Country setup asks (country-setup.MONEY_UNSTATED), never INR by name.
      (c.place && c.place.currency) || meRow.currency_code || null,
      claim,
      expires,
      me,
      // The purpose, carried onto the store itself. Empty becomes NULL rather than '' so "never said" and
      // "deliberately blank" are not the same value in the column.
      c.purpose || null,
      c.sort_order,
      // b119 — where it is. A place the design never stated stays NULL rather than becoming an empty string.
      (c.place && c.place.address) || null,
      (c.place && c.place.city) || null,
      c.place ? c.place.lat : null,
      c.place ? c.place.lng : null,
      c.place ? c.place.service_km : null,
      c.place ? c.place.dispatch_days : null,
      c.place ? c.place.ship_within_days : null,
      c.place ? c.place.ship_beyond_days : null
    ]
  );

  const myPath = parentPath + '.' + label(bridge_id);
  await db.query(
    `INSERT INTO cb_entity (bridge_id, name, mode, owner_scope, path, claimed)
     VALUES ($1, $2, 'b2b', 'entity', $3::ltree, true)`,
    [bridge_id, c.name, myPath]
  );

  pathOf.set(c.key, myPath);
  created.push({
    key: c.key,
    name: c.name,
    handle: c.handle,
    bridge_id,
    visibility: c.visibility,
    purpose: c.purpose || null,
    sort_order: c.sort_order,
    place: c.place || null,
    claim_code: claim,
    expires_at: expires,
    path: myPath
  });
}

// ── UPDATES — bring an existing store into line with the design ────────────────────────────────────────
// The cap moves WITH the choice: the operator decided, so the operator's cap is restated at the same value.
// Leaving the old cap behind would let a store that was opened to `public` be narrowed back by nobody, or a
// store closed to `private` still carry a cap that permits publishing.
async function updateNode(db, u, x) {
  const { plan, me, updated } = x;
  /* ⚠️ THE SAME COLUMN, THE SAME OMISSION. A store's place can MOVE, and the place carries a currency —
     so the update path writes currency_code as surely as the insert does. Both or neither. */
  const _uCur = u.place && u.place.to && u.place.to.currency;
  if (_uCur) {
    const _uBad = await currencyRefusal(x.entity, _uCur);
    if (_uBad) {
      plan.problems.push({ key: u.key, name: u.name, reason: _uBad.message });
      return;
    }
  }
  // Visibility and purpose move independently — a node can be in `update` for either or both — so each is
  // written only when it actually changed. COALESCE on a null parameter leaves the column untouched.
  const nextVis = u.to || null;
  const nextPurpose = u.purpose ? u.purpose.to || '' : null;
  // -1 is the sentinel for "clear it": a null parameter already means "leave the column alone", so there has
  // to be some other way to say "this store is no longer arranged".
  const nextOrder = u.order ? (u.order.to === null ? -1 : u.order.to) : null;
  /* T2-POLICY (SET4): a store's address through the ONE writer's fragment (profile.shopIdentitySql, $7) — written only when the place
     moved, with the rest of the place in this same statement (the place still moves as a unit) */
  const _uId = require('./profile').shopIdentitySql(u.place ? { address: (u.place.to && u.place.to.address) || null } : {}, 7);
  const r = await db.query(
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
      WHERE bridge_id = $2 AND created_by = $3
      RETURNING bridge_id`,
    [nextVis, u.bridge_id, me, nextPurpose, nextOrder, u.place ? JSON.stringify(u.place.to) : null].concat(_uId.params)
  );
  // `created_by = me` is the authority check, and it is in the WHERE rather than a prior SELECT so there is
  // no gap between checking and writing. A store this operator did not mint simply does not match.
  if (!r.rows.length) {
    plan.problems.push({ key: u.key, name: u.name, reason: `"${u.name}" was not changed — you did not create that store.` });
    return;
  }
  if (nextVis) await mirrorSchema(db, u, nextVis);
  updated.push({
    key: u.key,
    name: u.name,
    handle: u.handle,
    bridge_id: u.bridge_id,
    from: u.from,
    to: u.to,
    purpose: u.purpose,
    order: u.order,
    place: u.place
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
async function mirrorSchema(db, u, nextVis) {
  const { schemaVisibilityFor } = require('./schema-bootstrap');
  try {
    await db.query(
      `UPDATE entity_schemas SET visibility = $1
        WHERE entity_id = (SELECT identity_id FROM identities WHERE bridge_id = $2)
          AND status = 'active' AND is_default = true`,
      [schemaVisibilityFor(nextVis), u.bridge_id]
    );
  } catch (e) {
    /* A store with no default schema yet is not an error — ensureDefaultSchema bootstraps one at first
       sign-in and reads catalogue_visibility when it does, which is the path that already works. */
    if (!(e && (e.code === '42703' || e.code === '42P01'))) throw e;
  }
}

// ── PARTNERS — a request, never a placement ────────────────────────────────────────────────────────────
async function inviteNode(db, inv, x) {
  const { me, meRow, invited, failedInvites } = x;
  const ref = inv.ref;
  const found = await db.query(
    `SELECT identity_id, bridge_id, display_name FROM identities
      WHERE (LOWER(user_id) = LOWER($1) OR UPPER(bridge_id) = UPPER($1))
        AND identity_type = 'entity' AND status = 'active'`,
    [ref]
  );
  if (!found.rows.length) {
    failedInvites.push({ key: inv.key, name: inv.name, reason: `No business found with the handle "${ref}".` });
    return;
  }
  const them = found.rows[0];
  if (them.identity_id === me) {
    failedInvites.push({ key: inv.key, name: inv.name, reason: 'That is your own handle.' });
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
      key: inv.key,
      name: inv.name,
      handle: ref,
      bridge_id: them.bridge_id,
      status: existing.rows[0].state === 'requested' ? 'pending' : 'accepted',
      edge_id: existing.rows[0].id,
      already: true
    });
    return;
  }
  if (!partnerNode || !rootNode) {
    failedInvites.push({ key: inv.key, name: inv.name, reason: 'That business has no bridge id to invite.' });
    return;
  }
  const edge = await db.query(
    `INSERT INTO cb_edge (parent_id, child_id, type, state, requested_by)
     VALUES ($1, $2, 'commercial', 'requested', $1) RETURNING id`,
    [rootNode.id, partnerNode.id]
  );
  invited.push({ key: inv.key, name: inv.name, handle: ref, bridge_id: them.bridge_id, status: 'pending', edge_id: edge.rows[0].id });
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
async function execute(b) {
  return withEntity(b.me, async (db) => {
    const x = Object.assign({}, b, { created: [], updated: [], invited: [], failedInvites: [] });
    if (b.rootClaimed) await claimRoot(db, b.rootHandle, b.me);
    x.rootPath = await placeRoot(db, b.meRow);
    x.pathOf = await builtPaths(db, b.plan);
    x.expires = new Date(Date.now() + CLAIM_DAYS * 24 * 60 * 60 * 1000);
    for (const c of b.plan.create) await createNode(db, c, x);
    for (const u of b.plan.update) await updateNode(db, u, x);
    for (const inv of b.plan.invite) await inviteNode(db, inv, x);
    await writeBack(db, x);
    return { created: x.created, updated: x.updated, invited: x.invited, failedInvites: x.failedInvites };
  });
}

module.exports = { execute, meRowOf, rootOf, designOf, takenUnder, liveOf, capOf, operatorCap, newBridgeId, newClaimCode, label, CLAIM_DAYS };
