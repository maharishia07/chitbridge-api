// routes/network-design.js — NETWORK DESIGN persistence: the design-first Network builder's draft, stored
// per entity so the SAME design follows the user across machines/browsers (was browser-localStorage only).
// network_design is RLS-protected (b111) -> every query runs inside withEntity(caller). One row per entity.
//
// ── AND THE BUILD ────────────────────────────────────────────────────────────────────────────────────────────────
// POST /build turns the saved design into real entities. It is the first thing on the platform that MINTS an entity
// on someone else's behalf, so read lib/network-build.js before changing it: the plan is decided there, purely, and
// this file only executes it. Owned nodes are created; partners are invited and never created.
const express = require('express');
const log = require('../lib/logger');
const router  = express.Router();
const { query, withEntity } = require('../db');
const { safeErr } = require('../lib/respond');
const auth = require('../middleware/auth');
const handleLib = require('../lib/handle');
const networkBuild = require('../lib/network-build');
const run = require('../lib/network-build-run');          // the build's steps that read and write (T2-SPLIT)
const visibilityCap = require('../lib/visibility-cap');
const devOtp = require('../lib/dev-otp');
const money = require('../lib/money');                    // a price is {amount,currency} — never a bare number
const availability = require('../lib/availability');      // a quantity is not an answer without a date
const catalogueView = require('../lib/catalogue-view');   // ONE visibility rule — stock follows the catalogue's
const membership = require('../lib/network-membership');  // who is in the network — one reader, fails loudly (T2-HONEST)

const ent = (req) => auth.entityOf(req);
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
    const prevDraft = await run.designOf(e);
    const prevNodes = (prevDraft && Array.isArray(prevDraft.nodes)) ? prevDraft.nodes : [];
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

const { newClaimCode, CLAIM_DAYS } = run;   // the claim code and its life — one minting place (lib/network-build-run.js), /reissue uses it too

/**
 * POST /api/network-design/validate   { draft?: { nodes: [...] }, root_handle?: string, ceiling?: 'public'|'network'|'private', sample?: bool }
 *
 * "What would break if I built this?" — the Network Lab and the app's Design tab ask it. It runs lib/network-build.validate (the same plan()
 * Build runs) and POSTS NOTHING: no row is written, no handle claimed, no store touched.
 *   · draft given  → that draft is checked (a sketch on a lab page, never saved); omitted → this entity's saved design is.
 *   · sample: true → a lab sketch: no database read at all (0 trips); handles are checked only against each other.
 *   · otherwise    → ONE read of the handles already taken under the root, so a name that is in use is named.
 * RLS: network_design is entity-scoped (b111) and read through withEntity(caller); the taken-handle read is the same one Build makes, and
 * returns handle strings only. No new table, no migration.
 * Trips: sample → 0 · given draft + root_handle → 1 · saved design → 2 (design, taken) + 1 (own user_id when no root_handle).
 */
router.post('/validate', auth, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const body = req.body || {};
    const sample = body.sample === true;
    let draft = body.draft;
    if (draft !== undefined && draft !== null && (typeof draft !== 'object' || Array.isArray(draft))) {
      return res.status(400).json({ error: 'Bad request', message: 'draft must be an object' });
    }
    if (draft && Buffer.byteLength(JSON.stringify(draft)) > MAX_BYTES) {
      return res.status(413).json({ error: 'Too large', message: 'design exceeds ' + MAX_BYTES + ' bytes' });
    }
    if (!draft && !sample) draft = await run.designOf(me);
    const nodes = (draft && Array.isArray(draft.nodes)) ? draft.nodes : [];
    let rootHandle = String(body.root_handle || '').trim().toLowerCase();
    if (!rootHandle && !sample) {
      const r = await query('SELECT user_id FROM identities WHERE identity_id = $1', [me]);
      rootHandle = String((r.rows[0] && r.rows[0].user_id) || '').trim().toLowerCase();
    }
    if (!rootHandle) rootHandle = 'sample';
    const taken = (!sample && handleLib.check(rootHandle).ok) ? await run.takenUnder(rootHandle) : [];
    const ceiling = visibilityCap.RANK[String(body.ceiling || '').toLowerCase()] !== undefined ? String(body.ceiling).toLowerCase() : 'public';
    res.json(Object.assign({ dry_run: true, sample }, networkBuild.validate({ rootHandle, nodes, taken, ceiling })));
  } catch (err) { res.status(500).json({ error: 'Check failed', message: safeErr(err) }); }
});

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

    const meRow = await run.meRowOf(me);
    if (!meRow) return res.status(404).json({ error: 'Not found', message: 'Your account could not be read.' });

    // ── 1 · THE ROOT NAME — every handle in the network is built from it, so it is settled first (run.rootOf)
    const root = await run.rootOf(meRow, req.body && req.body.root_handle);
    if (root.refuse) return res.status(root.refuse.status).json(root.refuse.body);
    const { rootHandle, rootClaimed } = root;

    // ── 2 · THE DESIGN
    const draft = await run.designOf(me);
    const nodes = (draft && Array.isArray(draft.nodes)) ? draft.nodes : [];
    if (!nodes.length) {
      return res.status(400).json({ error: 'Nothing designed',
        message: 'Draw the network first — add the branches and units you want, then build.' });
    }
    const taken = await run.takenUnder(rootHandle);
    const live = await run.liveOf(nodes);

    // ── 3 · THE CAP — resolved BEFORE planning: it is the top of a cascade that runs the whole depth of the tree
    const cap = await run.capOf(me, meRow);
    // ── 4 · THE PLAN ─────────────────────────────────────────────────────────────────────────────────────────
    // The cap goes IN as the root ceiling. Every node under it inherits its PARENT's effective visibility, so a
    // closed department closes its own sub-units — the same rule at every level, which is the only version of it
    // that can be explained to anyone.
    const plan = networkBuild.plan({ rootHandle, nodes, taken, live, ceiling: cap.max });
    const notes = networkBuild.narrowNotes(plan, cap);
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

    // ── 4 · DO IT — one transaction (run.execute)
    const result = await run.execute({ me, entity: auth.entityOf(req), meRow, plan, nodes, draft, rootHandle, rootClaimed });
    res.json(networkBuild.answer({ rootHandle, rootClaimed, plan, notes, result, claimDays: run.CLAIM_DAYS }));
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
  /* ⭐ one tree reader (lib/network-membership.treeOf); a failed read throws NETWORK_READ_FAILED — never "not in a network" */
  const members = await membership.treeOf(meRow.bridge_id);
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
    const me = auth.entityOf(req);
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
    if (membership.answerReadFailed(res, err)) return;
    console.error('Network stores error:', err.message);
    res.status(500).json({ error: 'Load failed', message: safeErr(err) });
  }
});

router.get('/availability', auth, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ error: 'Bad request', message: 'Search for a product — two characters or more.' });
    }

    const meRow = (await query(
      'SELECT identity_id, bridge_id, display_name, lat, lng FROM identities WHERE identity_id = $1', [me])).rows[0];
    if (!meRow) return res.status(404).json({ error: 'Not found', message: 'Your account could not be read.' });

    // Everyone under MY root, at any depth — one query, whatever the shape of the tree.
    const members = await membership.treeOf(meRow.bridge_id);
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
    if (membership.answerReadFailed(res, err)) return;
    console.error('Availability search error:', err.message);
    res.status(500).json({ error: 'Search failed', message: safeErr(err) });
  }
});

module.exports = router;
