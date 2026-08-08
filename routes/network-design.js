// routes/network-design.js — NETWORK DESIGN persistence: the design-first Network builder's draft, stored
// per entity so the SAME design follows the user across machines/browsers (was browser-localStorage only).
// network_design is RLS-protected (b111) -> every query runs inside withEntity(caller). One row per entity.
//
// ── AND THE BUILD ────────────────────────────────────────────────────────────────────────────────────────────────
// POST /build turns the saved design into real entities. It is the first thing on the platform that MINTS an entity
// on someone else's behalf, so read lib/network-build.js before changing it: the plan is decided there, purely, and
// this file only executes it. Owned nodes are created; partners are invited and never created.
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, withEntity } = require('../db');
const { safeErr } = require('../lib/respond');
const auth = require('../middleware/auth');
const handleLib = require('../lib/handle');
const networkBuild = require('../lib/network-build');
const visibilityCap = require('../lib/visibility-cap');
const devOtp = require('../lib/dev-otp');
const money = require('../lib/money');                    // a price is {amount,currency} — never a bare number
const availability = require('../lib/availability');      // a quantity is not an answer without a date
const catalogueView = require('../lib/catalogue-view');   // ONE visibility rule — stock follows the catalogue's

const ent = (req) => req.identity.parent_entity_id || req.identity.identity_id;
const MAX_BYTES = 2_000_000;   // a design is a modest JSON tree; cap so this never becomes a document store
// Rows returned by the single-query network search (b122). Generous enough that a real search is whole, bounded
// so one careless "a" cannot pull a 20,000-row catalogue through the API. Hitting it is REPORTED, never hidden.
const SINGLE_LIMIT = 200;

// GET /api/network-design — this entity's saved design (null if none yet).
router.get('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const r = await withEntity(e, (db) => db.query(
      `SELECT draft, updated_at FROM network_design WHERE entity_id = $1`, [e]));
    res.json({ draft: r.rows.length ? r.rows[0].draft : null, updated_at: r.rows.length ? r.rows[0].updated_at : null });
  } catch (err) { res.status(500).json({ error: 'Load failed', message: safeErr(err) }); }
});

// PUT /api/network-design — upsert the whole design draft { draft: {...} }.
router.put('/', auth, async (req, res) => {
  try {
    const e = ent(req);
    const draft = req.body && req.body.draft;
    if (draft === undefined || draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
      return res.status(400).json({ error: 'Bad request', message: 'draft must be an object' });
    }
    if (Buffer.byteLength(JSON.stringify(draft)) > MAX_BYTES) {
      return res.status(413).json({ error: 'Too large', message: 'design exceeds ' + MAX_BYTES + ' bytes' });
    }
    /**
     * ⚠️ A STALE CLIENT MUST NOT BE ABLE TO UN-RECORD WHAT WAS BUILT.
     *
     * `built` and `invited` are not design — they are the RECEIPT of something that actually happened. The rest of
     * this document is a drawing the client owns and may overwrite wholesale; those two keys are the only part the
     * server knows more about than the client does.
     *
     * Found 2026-08-07 by prove-network-mint.js: a page that had the draft open before a build, then saved, sent a
     * copy with no `built` markers. The save was accepted, and the next Build saw three existing stores as new —
     * proposing to create handles that were already taken, so the whole design became "3 not built". Nothing was
     * damaged, because the unique index refuses a duplicate handle. But the design had silently forgotten its own
     * network, and the only thing standing between that and a genuine mess was a constraint doing a job nobody had
     * asked it to do.
     *
     * Re-attached BY KEY, so "start over" — which mints fresh keys — still starts over.
     */
    const prev = await withEntity(e, (db) => db.query(
      'SELECT draft FROM network_design WHERE entity_id = $1', [e]));
    const prevNodes = (prev.rows[0] && prev.rows[0].draft && Array.isArray(prev.rows[0].draft.nodes))
      ? prev.rows[0].draft.nodes : [];
    if (prevNodes.length && Array.isArray(draft.nodes)) {
      const receipts = new Map();
      prevNodes.forEach((n) => { if (n && n.key && (n.built || n.invited)) receipts.set(n.key, n); });
      if (receipts.size) {
        draft.nodes = draft.nodes.map((n) => {
          const r = n && n.key ? receipts.get(n.key) : null;
          if (!r) return n;
          const out = Object.assign({}, n);
          if (r.built && !out.built) out.built = r.built;
          if (r.invited && !out.invited) out.invited = r.invited;
          return out;
        });
      }
    }

    const r = await withEntity(e, (db) => db.query(
      `INSERT INTO network_design (entity_id, draft, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (entity_id) DO UPDATE SET draft = EXCLUDED.draft, updated_at = now()
       RETURNING updated_at`, [e, draft]));
    res.json({ ok: true, updated_at: r.rows[0].updated_at });
  } catch (err) { res.status(500).json({ error: 'Save failed', message: safeErr(err) }); }
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
 *  THE BUILD
 *
 *  Athi, 2026-08-07: *"start with build that mints, partner as invite-only… the store name is entityid.storename…
 *  instead of bridgeid it should be user id — Athi is the root, then clothing is athi.clothing."*
 *
 *  Three things happen per owned node and they must happen together or not at all:
 *     1 · an IDENTITY   — bridge id (minted), handle (athi.clothing), display name, and a claim code
 *     2 · a PLACE       — a row on cb_entity's ltree under the operator's root, which is what makes `network`
 *                         visibility resolve. Without it the store exists and belongs to no network.
 *     3 · a CAP         — params_override.caps.catalogue_visibility, so a warehouse the operator designed as
 *                         internal cannot publish itself from its own Settings screen later.
 *
 *  All of it runs in ONE transaction, including the write-back into the design. A build that created stores and
 *  then failed to record that it had would offer to create them again.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════ */

const BRIDGE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1 — these get read out over the phone
const newBridgeId = () => 'CB' + Array.from({ length: 8 }, () => BRIDGE_CHARS[crypto.randomInt(BRIDGE_CHARS.length)]).join('');
// devOtp.fixedOtp() and NEVER process.env.DEV_OTP directly: a sealed environment must degrade to a real random
// code even if the variable somehow survived deploy. That is the whole reason lib/dev-otp.js exists.
const newClaimCode = () => devOtp.fixedOtp('entity') || String(crypto.randomInt(100000, 1000000));
const CLAIM_DAYS = 7;

/** ltree labels allow [A-Za-z0-9_] only. Bridge ids already qualify; the guard is for anything that ever won't. */
const label = (bridgeId) => String(bridgeId).toUpperCase().replace(/[^A-Z0-9_]/g, '_');

/** The cap on what the OPERATOR may choose. A minted node can never be more open than the network that minted it. */
async function operatorCap(entityId) {
  let plan = null, paramsOverride = {};
  try {
    const r = await query('SELECT plan, params_override FROM identities WHERE identity_id = $1', [entityId]);
    if (r.rows[0]) { plan = r.rows[0].plan; paramsOverride = r.rows[0].params_override || {}; }
  } catch (_) { /* pre-governance schema — capOf() then reports unenforced */ }
  let planMenu = null;
  try { const c = await require('./governance').loadActiveConstitution(); planMenu = c && c.plan_menu; } catch (_) {}
  return visibilityCap.capOf({ plan, planMenu, paramsOverride });
}

/**
 * POST /api/network-design/build   { dry_run?: bool, root_handle?: string }
 *
 * `dry_run` answers "what would this do" without doing it, and it is the same code path — a preview computed by
 * different code is a preview that can lie.
 */
router.post('/build', auth, async (req, res) => {
  try {
    // Only the entity itself mints. A co-assist acting under an entity may run the shop; creating new businesses
    // in the owner's name, holding their claim codes, is not a delegated act.
    if (req.identity.parent_entity_id) {
      return res.status(403).json({ error: 'Not permitted',
        message: 'Only the business owner can build a network. Sign in as the business itself.' });
    }
    const me = req.identity.identity_id;
    const dryRun = req.body && req.body.dry_run === true;

    const meRow = (await query(
      `SELECT identity_id, bridge_id, display_name, user_id, country, currency_code, catalogue_visibility
         FROM identities WHERE identity_id = $1`, [me])).rows[0];
    if (!meRow) return res.status(404).json({ error: 'Not found', message: 'Your account could not be read.' });

    // ── 1 · THE ROOT NAME ────────────────────────────────────────────────────────────────────────────────────
    // Every handle in the network is built from it, so it is settled before anything else is considered.
    const askedRoot = String((req.body && req.body.root_handle) || '').trim().toLowerCase();
    let rootHandle = String(meRow.user_id || '').trim().toLowerCase();
    let rootClaimed = false;

    if (rootHandle) {
      const rc = handleLib.check(rootHandle);
      if (!rc.ok) {
        // They already have a User ID that cannot be a network root (an email address, most likely). Changing it
        // would break every reference anyone already holds to them, so this is theirs to decide, not ours.
        return res.status(409).json({ error: 'Root name unusable', code: 'ROOT_HANDLE_UNUSABLE',
          message: `Your User ID "${meRow.user_id}" cannot be a network name: ${rc.reason} Change your User ID in Settings first — every store in the network is named from it.`,
          suggestion: handleLib.slug(meRow.display_name) || null });
      }
    } else {
      const want = askedRoot || handleLib.slug(meRow.display_name);
      const rc = handleLib.check(want);
      if (!rc.ok) {
        return res.status(400).json({ error: 'Root name unusable', code: 'ROOT_HANDLE_NEEDED',
          message: `Choose a network name. "${want || meRow.display_name}" will not do: ${rc.reason}` });
      }
      const clash = await query('SELECT 1 FROM identities WHERE LOWER(user_id) = $1', [want]);
      if (clash.rows.length) {
        return res.status(409).json({ error: 'Root name taken', code: 'ROOT_HANDLE_TAKEN',
          message: `"${want}" is already taken. Choose another network name.` });
      }
      rootHandle = want;
      rootClaimed = true;   // written inside the transaction below, not here
    }

    // ── 2 · THE DESIGN ───────────────────────────────────────────────────────────────────────────────────────
    const design = await withEntity(me, (db) => db.query(
      'SELECT draft FROM network_design WHERE entity_id = $1', [me]));
    const draft = design.rows.length ? design.rows[0].draft : null;
    const nodes = (draft && Array.isArray(draft.nodes)) ? draft.nodes : [];
    if (!nodes.length) {
      return res.status(400).json({ error: 'Nothing designed',
        message: 'Draw the network first — add the branches and units you want, then build.' });
    }

    // Only handles under this root can collide with a child of this root, so this stays one small query however
    // many entities exist on the platform.
    const takenRows = await query(
      `SELECT LOWER(user_id) AS h FROM identities WHERE user_id IS NOT NULL AND LOWER(user_id) LIKE $1`,
      [rootHandle + '.%']);
    const taken = takenRows.rows.map((r) => r.h);

    // What the already-built stores are ACTUALLY set to. Read fresh, never taken from the draft: a design that has
    // drifted must not be able to assert its way back over a live store. One query for all of them.
    const live = {};
    const builtBridges = nodes.map((n) => n && n.built && n.built.bridge_id).filter(Boolean);
    if (builtBridges.length) {
      const lr = await query(
        'SELECT bridge_id, catalogue_visibility, purpose, sort_order, address, city, country, currency_code, lat, lng, service_km, dispatch_days, ship_within_days, ship_beyond_days FROM identities WHERE bridge_id = ANY($1)', [builtBridges]);
      // The whole row: the planner compares visibility, purpose, order AND place against it.
      lr.rows.forEach((r) => { live[r.bridge_id] = r; });
    }

    // ── 3 · THE CAP ──────────────────────────────────────────────────────────────────────────────────────────
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
      cap = { max: 'network', by: 'network', enforced: true,
        reason: netVis === 'private'
          ? 'This network is private, so a store under it can be visible to the network or to nobody — not to the public.'
          : 'This network is visible to its own network only, so a store under it cannot be public.' };
    }
    // ── 4 · THE PLAN ─────────────────────────────────────────────────────────────────────────────────────────
    // The cap goes IN as the root ceiling. Every node under it inherits its PARENT's effective visibility, so a
    // closed department closes its own sub-units — the same rule at every level, which is the only version of it
    // that can be explained to anyone.
    const plan = networkBuild.plan({ rootHandle, nodes, taken, live, ceiling: cap.max });

    // Every narrowing is REPORTED. A store that quietly came out less open than it was drawn is the kind of
    // surprise that makes a person stop trusting the screen.
    const notes = plan.narrowed.map((n) =>
      `"${n.name}" was set to ${n.from} but is being built ${n.to}: ${cap.reason || 'what it sits inside is not that open'}`);
    /**
     * ── CLOSING SOMETHING CLOSES WHAT IS ALREADY OPEN UNDER IT ──────────────────────────────────────────────
     * Athi, 2026-08-07: *"even if they select public initially and then change to protected, need to switch
     * accordingly."* And 2026-08-08: *"make the cascade for parent and child."*
     *
     * This is now handled INSIDE the plan and there is deliberately no second pass here. The planner applies the
     * ceiling to built nodes as well as new ones, so a live store more open than what it sits inside comes back
     * in `update` on its own — which is the whole "a live shop stays public under a closed network" hole.
     *
     * There is also no re-check of the cap: `ceiling` IS cap.max and the cascade can only narrow, so nothing the
     * planner emits can exceed it. A guard that can never fire is dead code wearing a guard's clothes — the same
     * mistake as `assertPublicAllowed()`, which sat exported with zero callers looking like protection.
     */

    if (dryRun) {
      return res.json({ ok: true, dry_run: true, root: rootHandle, root_claimed: rootClaimed,
        create: plan.create, update: plan.update, invite: plan.invite, skip: plan.skip,
        problems: plan.problems, notes, counts: plan.counts });
    }
    if (!plan.create.length && !plan.update.length && !plan.invite.length) {
      return res.json({ ok: true, root: rootHandle, created: [], updated: [], invited: [], skipped: plan.skip,
        problems: plan.problems, notes,
        message: plan.problems.length ? 'Nothing could be built — see the reasons.' : 'The network already matches this design.' });
    }

    // ── 4 · DO IT — one transaction ──────────────────────────────────────────────────────────────────────────
    const result = await withEntity(me, async (db) => {
      const created = [], updated = [], invited = [], failedInvites = [];

      if (rootClaimed) {
        // Unique index on lower(user_id): a concurrent second build would 23505 here and roll the whole thing back,
        // which is the correct outcome — two networks must not share a root.
        await db.query('UPDATE identities SET user_id = $1 WHERE identity_id = $2 AND user_id IS NULL',
          [rootHandle, me]);
      }

      // The root's own place on the tree. DO NOTHING, never overwrite: if this entity already sits inside somebody
      // else's network, that placement is theirs and its children hang below wherever it actually is.
      await db.query(
        `INSERT INTO cb_entity (bridge_id, name, mode, owner_scope, path, claimed)
         VALUES ($1, $2, 'b2b', 'entity', $3::ltree, true)
         ON CONFLICT (bridge_id) DO NOTHING`,
        [meRow.bridge_id, meRow.display_name, label(meRow.bridge_id)]);
      const rootPathRow = await db.query('SELECT path::text AS path FROM cb_entity WHERE bridge_id = $1', [meRow.bridge_id]);
      const rootPath = rootPathRow.rows[0] && rootPathRow.rows[0].path;
      if (!rootPath) throw new Error('the network root could not be placed on the tree');

      // Where each node sits, by design key. Already-built nodes contribute their REAL path, read back rather than
      // recomputed — a node moved by hand stays where it was moved to.
      const pathOf = new Map();
      const builtBridges = plan.skip.map((s) => s.bridge_id).filter(Boolean);
      if (builtBridges.length) {
        const r = await db.query('SELECT bridge_id, path::text AS path FROM cb_entity WHERE bridge_id = ANY($1)', [builtBridges]);
        const byBridge = new Map(r.rows.map((x) => [x.bridge_id, x.path]));
        for (const s of plan.skip) if (byBridge.has(s.bridge_id)) pathOf.set(s.key, byBridge.get(s.bridge_id));
      }

      const expires = new Date(Date.now() + CLAIM_DAYS * 24 * 60 * 60 * 1000);

      for (const c of plan.create) {
        const parentPath = c.parent_key ? pathOf.get(c.parent_key) : rootPath;
        if (!parentPath) {
          // Its parent was built in an earlier run and is not on the tree. Creating it anyway would put a store in
          // no network at all, which is silently wrong; refusing names the repair.
          plan.problems.push({ key: c.key, name: c.name,
            reason: 'Its parent is not on the network tree yet. Rebuild the parent first.' });
          continue;
        }
        const identity_id = uuidv4();
        const bridge_id = newBridgeId();
        const claim = newClaimCode();

        await db.query(
          `INSERT INTO identities
             (identity_id, bridge_id, display_name, user_id, identity_type, status, catalogue_visibility,
              params_override, country, currency_code, otp_code, otp_expires_at, otp_attempts, created_by, purpose, sort_order,
              address, city, lat, lng, service_km, dispatch_days, ship_within_days, ship_beyond_days)
           VALUES ($1, $2, $3, $4, 'entity', 'active', $5, $6::jsonb, $7, $8, $9, $10, 0, $11, $12, $13,
                   $14, $15, $16, $17, $18, $19, $20, $21)`,
          [identity_id, bridge_id, c.name, c.handle, c.visibility,
           // The provisioning cap. visibility-cap.js: "a node provisioned BY A NETWORK is not its own business —
           // the operator decided, and the entity must not be able to undo that from its own profile screen."
           JSON.stringify({ caps: { catalogue_visibility: c.visibility } }),
           // The store's own country if the design stated one, else the operator's. There is exactly ONE country
           // column and it was very nearly listed twice — Postgres refuses that outright, which is the good case.
           (c.place && c.place.country) || meRow.country || 'IN',
           // The store's OWN currency when the design set one — a store trading in another country is stamped
           // in ITS currency, and money is never converted afterwards. Otherwise the network's.
           (c.place && c.place.currency) || meRow.currency_code || 'INR', claim, expires, me,
           // The purpose, carried onto the store itself. Empty becomes NULL rather than '' so "never said" and
           // "deliberately blank" are not the same value in the column.
           c.purpose || null, c.sort_order,
           // b119 — where it is. A place the design never stated stays NULL rather than becoming an empty string.
           (c.place && c.place.address) || null, (c.place && c.place.city) || null,
           c.place ? c.place.lat : null, c.place ? c.place.lng : null, c.place ? c.place.service_km : null,
           c.place ? c.place.dispatch_days : null, c.place ? c.place.ship_within_days : null,
           c.place ? c.place.ship_beyond_days : null]);

        const myPath = parentPath + '.' + label(bridge_id);
        await db.query(
          `INSERT INTO cb_entity (bridge_id, name, mode, owner_scope, path, claimed)
           VALUES ($1, $2, 'b2b', 'entity', $3::ltree, true)`,
          [bridge_id, c.name, myPath]);

        pathOf.set(c.key, myPath);
        created.push({ key: c.key, name: c.name, handle: c.handle, bridge_id, visibility: c.visibility,
                       purpose: c.purpose || null, sort_order: c.sort_order, place: c.place || null,
                       claim_code: claim, expires_at: expires, path: myPath });
      }

      // ── UPDATES — bring an existing store into line with the design ────────────────────────────────────────
      // The cap moves WITH the choice: the operator decided, so the operator's cap is restated at the same value.
      // Leaving the old cap behind would let a store that was opened to `public` be narrowed back by nobody, or a
      // store closed to `private` still carry a cap that permits publishing.
      for (const u of plan.update) {
        // Visibility and purpose move independently — a node can be in `update` for either or both — so each is
        // written only when it actually changed. COALESCE on a null parameter leaves the column untouched.
        const nextVis = u.to || null;
        const nextPurpose = u.purpose ? (u.purpose.to || '') : null;
        // -1 is the sentinel for "clear it": a null parameter already means "leave the column alone", so there has
        // to be some other way to say "this store is no longer arranged".
        const nextOrder = u.order ? (u.order.to === null ? -1 : u.order.to) : null;
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
                  address    = CASE WHEN $6::jsonb IS NULL THEN address    ELSE $6->>'address' END,
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
          [nextVis, u.bridge_id, me, nextPurpose, nextOrder,
           u.place ? JSON.stringify(u.place.to) : null]);
        // `created_by = me` is the authority check, and it is in the WHERE rather than a prior SELECT so there is
        // no gap between checking and writing. A store this operator did not mint simply does not match.
        if (!r.rows.length) {
          plan.problems.push({ key: u.key, name: u.name,
            reason: `"${u.name}" was not changed — you did not create that store.` });
          continue;
        }
        updated.push({ key: u.key, name: u.name, handle: u.handle, bridge_id: u.bridge_id, from: u.from, to: u.to, purpose: u.purpose, order: u.order, place: u.place });
      }

      // ── PARTNERS — a request, never a placement ────────────────────────────────────────────────────────────
      for (const inv of plan.invite) {
        const ref = inv.ref;
        const found = await db.query(
          `SELECT identity_id, bridge_id, display_name FROM identities
            WHERE (LOWER(user_id) = LOWER($1) OR UPPER(bridge_id) = UPPER($1))
              AND identity_type = 'entity' AND status = 'active'`, [ref]);
        if (!found.rows.length) {
          failedInvites.push({ key: inv.key, name: inv.name, reason: `No business found with the handle "${ref}".` });
          continue;
        }
        const them = found.rows[0];
        if (them.identity_id === me) {
          failedInvites.push({ key: inv.key, name: inv.name, reason: 'That is your own handle.' });
          continue;
        }
        const existing = await db.query(
          `SELECT status FROM connections
            WHERE (from_entity_id = $1 AND to_entity_id = $2) OR (from_entity_id = $2 AND to_entity_id = $1)`,
          [me, them.identity_id]);
        if (existing.rows.length) {
          invited.push({ key: inv.key, name: inv.name, handle: ref, bridge_id: them.bridge_id,
                         status: existing.rows[0].status, already: true });
          continue;
        }
        const connection_id = uuidv4();
        await db.query(
          `INSERT INTO connections
             (connection_id, from_entity_id, from_display_name, from_bridge_id,
              to_entity_id, to_display_name, to_bridge_id, status, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
          [connection_id, me, meRow.display_name, meRow.bridge_id,
           them.identity_id, them.display_name, them.bridge_id,
           `Invitation to join the ${rootHandle} network`]);
        invited.push({ key: inv.key, name: inv.name, handle: ref, bridge_id: them.bridge_id,
                       status: 'pending', connection_id });
      }

      // ── WRITE THE RESULT BACK INTO THE DESIGN ──────────────────────────────────────────────────────────────
      // Same transaction as the creation. This is what makes a second Build a no-op instead of a duplicate.
      const byKey = new Map(created.map((c) => [c.key, c]));
      const invByKey = new Map(invited.map((i) => [i.key, i]));
      const nextNodes = nodes.map((n) => {
        const c = byKey.get(n.key);
        // `visibility` is part of the receipt: it is what the store is ACTUALLY set to, so the design page can
        // tell a drawing that has moved from a shop that has. Without it the tree redraws and a person quite
        // reasonably assumes the live shops moved with it.
        if (c) return Object.assign({}, n, { built: { bridge_id: c.bridge_id, user_id: c.handle, visibility: c.visibility, at: new Date().toISOString() } });
        const up = updated.find((x) => x.key === n.key);
        if (up) return Object.assign({}, n, { built: Object.assign({}, n.built,
          up.to ? { visibility: up.to } : {}, { at: new Date().toISOString() }) });
        const i = invByKey.get(n.key);
        if (i) return Object.assign({}, n, { invited: { bridge_id: i.bridge_id, status: i.status, at: new Date().toISOString() } });
        return n;
      });
      const nextDraft = Object.assign({}, draft, { nodes: nextNodes, root_handle: rootHandle });
      await db.query(
        `INSERT INTO network_design (entity_id, draft, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (entity_id) DO UPDATE SET draft = EXCLUDED.draft, updated_at = now()`,
        [me, nextDraft]);

      return { created, updated, invited, failedInvites };
    });

    const problems = plan.problems.concat(result.failedInvites);
    res.json({
      ok: true,
      root: rootHandle,
      root_claimed: rootClaimed,
      created: result.created,
      updated: result.updated,
      invited: result.invited,
      skipped: plan.skip,
      problems,
      notes,
      // Said once, where the operator will read it. The codes are in `created[].claim_code` and this response is
      // the only time they are handed out in full — after this, re-issue.
      claim_note: result.created.length
        ? `Each new store signs in with its handle and the code shown here. The codes expire in ${CLAIM_DAYS} days — re-issue one from the network page if it lapses.`
        : '',
      message: `${result.created.length} store${result.created.length === 1 ? '' : 's'} created`
             + (result.updated.length ? `, ${result.updated.length} updated` : '')
             + (result.invited.length ? `, ${result.invited.length} partner invitation${result.invited.length === 1 ? '' : 's'} sent` : '')
             + (problems.length ? `, ${problems.length} not built` : ''),
    });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'Name taken',
        message: 'One of these names was taken while the network was being built. Nothing was created — try again.' });
    }
    if (err && err.code === '23514') {
      return res.status(409).json({ error: 'Migration needed', code: 'VISIBILITY_NOT_MIGRATED',
        message: 'This database does not accept "network" visibility yet — apply migration b115.' });
    }
    console.error('Network build error:', err.message);
    res.status(500).json({ error: 'Build failed', message: safeErr(err) });
  }
});

/**
 * POST /api/network-design/reissue   { user_id }
 *
 * Athi: *"he can have the password similar to actor and should be able to circulate the same like actor."* A claim
 * code that expires with no way to issue another would make every minted store permanently unreachable a week
 * later — the review's §4 lesson (a capability that exists and cannot be used) in a fresh form.
 *
 * Only for stores THIS operator minted: `created_by` is checked, not the tree, because tree membership can be
 * arranged and `created_by` cannot.
 */
router.post('/reissue', auth, async (req, res) => {
  try {
    if (req.identity.parent_entity_id) {
      return res.status(403).json({ error: 'Not permitted', message: 'Only the business owner can re-issue a store code.' });
    }
    const me = req.identity.identity_id;
    const uid = String((req.body && req.body.user_id) || '').trim();
    if (!uid) return res.status(400).json({ error: 'Bad request', message: 'Which store? Send its handle as user_id.' });

    const r = await query(
      `SELECT identity_id, display_name, user_id FROM identities
        WHERE LOWER(user_id) = LOWER($1) AND created_by = $2 AND identity_type = 'entity'`, [uid, me]);
    if (!r.rows.length) {
      return res.status(404).json({ error: 'Not found', message: `You did not create a store called "${uid}".` });
    }
    const claim = newClaimCode();
    const expires = new Date(Date.now() + CLAIM_DAYS * 24 * 60 * 60 * 1000);
    await query(
      `UPDATE identities SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0 WHERE identity_id = $3`,
      [claim, expires, r.rows[0].identity_id]);
    res.json({ ok: true, user_id: r.rows[0].user_id, display_name: r.rows[0].display_name,
      claim_code: claim, expires_at: expires,
      ...(devOtp.mayExposeOtp() && { dev_otp: claim }),
      message: `New code for ${r.rows[0].user_id}. It expires in ${CLAIM_DAYS} days.` });
  } catch (err) {
    console.error('Reissue error:', err.message);
    res.status(500).json({ error: 'Re-issue failed', message: safeErr(err) });
  }
});

/**
 * GET /api/network-design/availability?q=<text>
 *
 * "Who in my network has this, and how fast can it get here?"
 *
 * Athi, 2026-08-08: *"if there is a query about one product, how can we provide where exactly the product is and
 * how quickly this can be sent across?"*
 *
 * ── WHO MAY SEE WHOSE STOCK ─────────────────────────────────────────────────────────────────────────────────
 * The same rule as the catalogue, and deliberately not a new one: a member sees a sibling's items when that
 * sibling's catalogue resolves as readable FOR THIS VIEWER — `public`, or `network` with both on one tree. A
 * private store is absent, and absent means absent: it is not listed as "unknown", because that would confirm it
 * exists. The existence oracle closed on 2026-08-06 stays closed.
 *
 * ── ABSENT IS NOT ZERO ──────────────────────────────────────────────────────────────────────────────────────
 * A store that carries the item but has never reported a quantity comes back `qty: null` and is COUNTED as
 * unknown, all the way to the summary. Rendering that as 0 would make a silent store look empty and route the
 * network around a shelf that may be full.
 *
 * ── COST ────────────────────────────────────────────────────────────────────────────────────────────────────
 * One query for the members, then one visibility resolve + one item read per member — O(members), capped and
 * REPORTED, exactly as the network storefront does it. There is no single query that answers for all of them
 * because each store's catalogue is its own, which is the point rather than a limitation.
 */
const MAX_STORES = 40;

/**
 * Run `fn` over `items`, at most `limit` in flight. Results keep the input order.
 *
 * Deliberately not Promise.all: the connection pool is 10, and an unbounded fan-out over a large network takes
 * every client the server has. A search that is fast for one person by making the API unavailable to everyone
 * else is not fast, it is selfish.
 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The stores in MY network that I am allowed to see, resolved once.
 *
 * Shared by the availability search and the store list so the two can never disagree about who is in the network
 * or who may be looked at — two answers to "which stores?" is how one of them quietly becomes wrong.
 */
async function visibleStores(meRow) {
  let members = [];
  try {
    const r = await query(
      `SELECT e.bridge_id FROM cb_entity e
        WHERE e.path <@ (SELECT subpath(path, 0, 1) FROM cb_entity WHERE bridge_id = $1 LIMIT 1)
        ORDER BY nlevel(e.path), e.name`, [meRow.bridge_id]);
    members = r.rows.map((x) => x.bridge_id);
  } catch (_) { members = []; }
  if (!members.length) return { members: [], visible: [], truncated: null };

  const truncated = members.length > MAX_STORES ? { asked: MAX_STORES, of: members.length } : null;
  const use = members.slice(0, MAX_STORES);

  const ents = (await query(
    `SELECT identity_id, bridge_id, display_name, purpose, city, lat, lng, currency_code, service_km,
            dispatch_days, ship_within_days, ship_beyond_days, sort_order,
            catalogue_visibility, plan, params_override
       FROM identities
      WHERE bridge_id = ANY($1) AND identity_type = 'entity' AND status = 'active'`, [use])).rows;

  const visible = ents.filter((ent) => {
    const chosen = ent.catalogue_visibility;
    if (chosen !== 'public' && chosen !== 'network') return false;
    const cap = visibilityCap.capOf({ plan: ent.plan, paramsOverride: ent.params_override || {} });
    return visibilityCap.RANK[visibilityCap.effective(chosen, cap)] > 0;
  });
  return { members: use, visible, truncated };
}

/**
 * GET /api/network-design/stores — who is in my network, and where.
 *
 * Athi, 2026-08-08: *"do the browse store catalogue from network, same as supplier format."* Browsing needs a LIST
 * before it needs a catalogue, and the list must carry each store's identity so the existing supplier catalogue
 * reader can be pointed at it — the same reader, so the same speed, rather than a second one that drifts.
 */
router.get('/stores', auth, async (req, res) => {
  try {
    const me = req.identity.parent_entity_id || req.identity.identity_id;
    const meRow = (await query(
      'SELECT identity_id, bridge_id, display_name, lat, lng FROM identities WHERE identity_id = $1', [me])).rows[0];
    if (!meRow) return res.status(404).json({ error: 'Not found', message: 'Your account could not be read.' });

    const { visible, truncated } = await visibleStores(meRow);
    if (!visible.length) return res.json({ stores: [], not_in_network: true });

    const from = { lat: meRow.lat == null ? null : Number(meRow.lat), lng: meRow.lng == null ? null : Number(meRow.lng) };
    const stores = visible.map((e) => ({
      entity_id: e.identity_id, bridge_id: e.bridge_id, name: e.display_name,
      purpose: e.purpose || null, city: e.city || null, currency: e.currency_code || null,
      km: availability.distanceKm(from, { lat: e.lat == null ? null : Number(e.lat), lng: e.lng == null ? null : Number(e.lng) }),
      is_me: e.identity_id === me,
      sort_order: e.sort_order == null ? null : Number(e.sort_order),
    }));
    // The operator's arrangement (b118) first, then by name — the same order the network tree uses, so a person
    // reading both sees one network rather than two lists that happen to hold the same stores.
    stores.sort((a, b) => {
      const ao = a.sort_order == null ? Number.MAX_SAFE_INTEGER : a.sort_order;
      const bo = b.sort_order == null ? Number.MAX_SAFE_INTEGER : b.sort_order;
      return ao !== bo ? ao - bo : String(a.name).localeCompare(String(b.name));
    });
    res.json({ stores, ...(truncated && { truncated }) });
  } catch (err) {
    console.error('Network stores error:', err.message);
    res.status(500).json({ error: 'Load failed', message: safeErr(err) });
  }
});

router.get('/availability', auth, async (req, res) => {
  try {
    const me = req.identity.parent_entity_id || req.identity.identity_id;
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ error: 'Bad request', message: 'Search for a product — two characters or more.' });
    }

    const meRow = (await query(
      'SELECT identity_id, bridge_id, display_name, lat, lng FROM identities WHERE identity_id = $1', [me])).rows[0];
    if (!meRow) return res.status(404).json({ error: 'Not found', message: 'Your account could not be read.' });

    // Everyone under MY root, at any depth — one query, whatever the shape of the tree.
    let members = [];
    try {
      const r = await query(
        `SELECT e.bridge_id FROM cb_entity e
          WHERE e.path <@ (SELECT subpath(path, 0, 1) FROM cb_entity WHERE bridge_id = $1 LIMIT 1)
          ORDER BY nlevel(e.path), e.name`, [meRow.bridge_id]);
      members = r.rows.map((x) => x.bridge_id);
    } catch (_) { members = []; }
    if (!members.length) {
      return res.json({ q, rows: [], summary: 'This business is not part of a network.', not_in_network: true });
    }
    const truncated = members.length > MAX_STORES;
    const use = members.slice(0, MAX_STORES);

    const from = { lat: meRow.lat == null ? null : Number(meRow.lat), lng: meRow.lng == null ? null : Number(meRow.lng) };
    const like = '%' + q.toLowerCase() + '%';
    const rows = [];

    /**
     * ── ONE QUERY FOR THE WHOLE NETWORK (b122), WITH THE PER-STORE PATH AS A FALLBACK ────────────────────────
     * Athi, 2026-08-08: *"can we build an alternate index for the network stores as a single catalogue?"*
     *
     * `network_search` is that, without a second copy of the data: a SECURITY DEFINER function that reads the LIVE
     * rows across the network in one round trip and re-imposes the scoping it stepped outside of. Forty stores
     * stops being forty queries.
     *
     * If the migration has not been applied, this falls through to the per-store path below rather than failing —
     * the answer is identical either way, only the number of round trips differs. Code and migration can land in
     * either order, which is the same self-healing rule catalogue-view.js uses for b114.
     */
    let single = null, degraded = null;
    // A comparison switch, not a feature flag: it forces the ORIGINAL fan-out so scripts/prove-network-search.js
    // can ask the same deployment the same question both ways. It can only make the answer slower, never wider —
    // the fan-out is the stricter path, so this cannot be used to see more than the caller is entitled to.
    const forceFanout = req.get('X-CB-Force-Fanout') === '1';
    try {
      if (forceFanout) throw Object.assign(new Error('forced fan-out'), { forced: true });
      single = await query('SELECT * FROM network_search($1, $2, $3)', [meRow.bridge_id, q, SINGLE_LIMIT]);
    } catch (e) {
      /**
       * ⚠️ ANY failure of the fast path falls back to the fan-out — it does not fail the search.
       *
       * My first version rethrew anything that was not "function does not exist", which would have turned a
       * mismatched column type or a permissions slip into a 500 on the whole locator. That is the wrong trade:
       * the fan-out below produces the IDENTICAL answer by a slower route, so there is never a reason to give a
       * person an error instead of a correct answer that took longer.
       *
       * It is not silent. The failure is logged loudly and the response is marked `degraded`, so a fast path that
       * has quietly stopped working shows up rather than hiding behind results that still look right.
       */
      if (!e.forced) {
        console.error('network_search unavailable — falling back to per-store fan-out:', e.message);
        degraded = /does not exist|undefined function/i.test(e.message || '') ? null : 'search-index';
      }
    }
    if (single) {
      /**
       * THE PLAN CAP, APPLIED THROUGH THE ONE MODULE THAT OWNS IT.
       *
       * SQL narrowed to this network, to stores that CHOSE public/network, and to the text match. It deliberately
       * did not apply the plan cap — that rule lives in lib/visibility-cap.js and must have exactly one
       * implementation, or the fast path will one day show a store the slow path hides. Same predicate as
       * visibleStores(), same module, evaluated once per store rather than once per row.
       */
      const capOk = new Map();
      const allowed = single.rows.filter((r) => {
        if (!capOk.has(r.entity_id)) {
          const cap = visibilityCap.capOf({ plan: r.plan, paramsOverride: r.params_override || {} });
          capOk.set(r.entity_id, visibilityCap.RANK[visibilityCap.effective(r.catalogue_visibility || 'private', cap)] > 0);
        }
        return capOk.get(r.entity_id);
      });
      for (const r of allowed) {
        const d = r.item_data || {};
        const av = (d.avail && typeof d.avail === 'object') ? d.avail : null;
        const amt = money.amountOfLoose(d.price);
        rows.push({
          store: r.store_name, bridge_id: r.bridge_id, city: r.city || null, entity_id: r.entity_id,
          price: Number.isFinite(amt) ? amt : null,
          price_currency: (money.isMoney(d.price) && d.price.currency) || r.currency_code || null,
          lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
          service_km: r.service_km == null ? null : Number(r.service_km),
          dispatch_days: r.dispatch_days == null ? null : Number(r.dispatch_days),
          ship_within_days: r.ship_within_days == null ? null : Number(r.ship_within_days),
          ship_beyond_days: r.ship_beyond_days == null ? null : Number(r.ship_beyond_days),
          item_id: r.item_id, name: d.name || d.code || '(unnamed)', code: d.code || d.sku || null,
          currency: r.currency_code || null,
          qty: av && av.qty !== undefined && av.qty !== null ? Number(av.qty) : null,
          source: av ? av.source : null,
          as_of: av ? av.as_of : null,
          is_me: r.entity_id === me,
        });
      }
      const out1 = availability.answer(rows, { from });
      return res.json({
        q, from: { city: meRow.display_name, lat: from.lat, lng: from.lng },
        rows: out1.rows, summary: out1.summary, total: out1.total,
        stores_with_stock: out1.stores_with_stock, stores_unknown: out1.stores_unknown,
        one_query: true,
        // The cap is SAID, not silently applied. A capped answer that looks complete is worse than a slow one —
        // the same rule the per-store path below follows when it has to leave members unasked.
        ...(single.rows.length >= SINGLE_LIMIT && { truncated: { shown: SINGLE_LIMIT, note: 'narrow the search' } }),
      });
    }

    /**
     * ⚠️ ONE ROUND TRIP PER STORE, NOT THREE — AND THEY GO TOGETHER.
     *
     * Athi, 2026-08-08: *"just only one product in each store, takes long time to find."* It did, and the reason
     * was shape rather than data: this ran THREE sequential queries per store — the entity row, then
     * catalogueVisibility's own read, then the items — so five stores meant fifteen round trips to a database on
     * the other side of the internet, one after another. The work was tiny and the waiting was all latency.
     *
     * Now: every entity row in ONE query, visibility resolved IN MEMORY, and the item reads fired in parallel. The
     * wall clock becomes two round trips instead of fifteen.
     *
     * Resolving visibility in memory is exact here rather than a shortcut: `network` means "on the same tree as the
     * viewer", and every store in this list came FROM the viewer's own subtree — that is how it was found. So the
     * membership test is already answered and re-asking the database would be paying for a fact we hold.
     */
    const ents = (await query(
      `SELECT identity_id, bridge_id, display_name, city, lat, lng, currency_code, service_km,
              dispatch_days, ship_within_days, ship_beyond_days,
              catalogue_visibility, plan, params_override
         FROM identities
        WHERE bridge_id = ANY($1) AND identity_type = 'entity' AND status = 'active'`, [use])).rows;

    const visible = ents.filter((ent) => {
      const chosen = ent.catalogue_visibility;
      if (chosen !== 'public' && chosen !== 'network') return false;   // private, or unset → absent
      // The operator cap still binds: a store capped to private is closed even if it chose otherwise.
      const cap = visibilityCap.capOf({ plan: ent.plan, paramsOverride: ent.params_override || {} });
      return visibilityCap.RANK[visibilityCap.effective(chosen, cap)] > 0;
    });

    /**
     * ⚠️ BOUNDED CONCURRENCY — the pool is 10 and each read takes a client for a transaction.
     *
     * Firing forty stores at once would take every connection the server has, queue the rest, and stall EVERY OTHER
     * REQUEST on the API for the duration. One person's search must not be able to do that. Four at a time keeps
     * the search fast — the cost is dominated by round-trip latency, not by the database — while leaving most of
     * the pool for everyone else.
     *
     * This is the difference between "fast for me" and "fast for the platform", and only the second one survives
     * more than one user.
     */
    const perStore = await mapLimit(visible, 4, (ent) =>
      withEntity(ent.identity_id, (db) => db.query(
        `SELECT item_id, item_data FROM catalogue_items
          WHERE entity_id = $1 AND is_active = true
            AND (LOWER(item_data->>'name') LIKE $2 OR LOWER(item_data->>'code') LIKE $2 OR LOWER(item_data->>'sku') LIKE $2)
          LIMIT 5`, [ent.identity_id, like]))
        .then((r) => ({ ent, rows: r.rows }))
        .catch(() => ({ ent, rows: [] })));   // one unreadable store must not fail the whole answer

    for (const { ent, rows: itemRows } of perStore) {
      for (const it of itemRows) {
        const d = it.item_data || {};
        const av = (d.avail && typeof d.avail === 'object') ? d.avail : null;
        // The PRICE, as the holding store stamped it — its own currency, never converted. `money.amountOfLoose`
        // reads both shapes: a stamped {amount,currency} and a legacy bare number.
        const rawPrice = d.price;
        const amt = money.amountOfLoose(rawPrice);
        rows.push({
          store: ent.display_name, bridge_id: ent.bridge_id, city: ent.city || null,
          // identity_id so a request can be addressed. Not a secret: this store's catalogue is already readable by
          // this viewer, and the supplier route hands out the same field for exactly the same reason.
          entity_id: ent.identity_id,
          price: Number.isFinite(amt) ? amt : null,
          price_currency: (money.isMoney(rawPrice) && rawPrice.currency) || ent.currency_code || null,
          lat: ent.lat == null ? null : Number(ent.lat), lng: ent.lng == null ? null : Number(ent.lng),
          service_km: ent.service_km == null ? null : Number(ent.service_km),
          dispatch_days: ent.dispatch_days == null ? null : Number(ent.dispatch_days),
          ship_within_days: ent.ship_within_days == null ? null : Number(ent.ship_within_days),
          ship_beyond_days: ent.ship_beyond_days == null ? null : Number(ent.ship_beyond_days),
          item_id: it.item_id, name: d.name || d.code || '(unnamed)', code: d.code || d.sku || null,
          currency: ent.currency_code || null,
          // null when the store has never said. NEVER 0 — see the header.
          qty: av && av.qty !== undefined && av.qty !== null ? Number(av.qty) : null,
          source: av ? av.source : null,
          as_of: av ? av.as_of : null,
          is_me: ent.identity_id === me,
        });
      }
    }

    const out = availability.answer(rows, { from });
    res.json({
      q, from: { city: meRow.display_name, lat: from.lat, lng: from.lng },
      rows: out.rows, summary: out.summary,
      total: out.total, stores_with_stock: out.stores_with_stock, stores_unknown: out.stores_unknown,
      // Said out loud rather than silently cut — a capped answer that looks complete is worse than a slow one.
      ...(truncated && { truncated: { asked: use.length, of: members.length } }),
      // The answer is correct either way; this only says it arrived the slow way because the fast path broke.
      ...(degraded && { degraded }),
    });
  } catch (err) {
    console.error('Availability search error:', err.message);
    res.status(500).json({ error: 'Search failed', message: safeErr(err) });
  }
});

module.exports = router;
