/**
 * /api/network-offers — A BRAND RELEASES OFFERS TO ITS STORES; A STORE TAKES THEM OR NOT (2026-09-17).
 * The rules and the reasons live in lib/network-offers.js; this file is only the doors.
 *
 *   GET  /api/network-offers                  → { brand: {policy, stores, offers[]}, store: { networks[] } }
 *   PUT  /api/network-offers/policy           { policy: 'opt_in' | 'opt_out' }              (brand)
 *   POST /api/network-offers/:id/release      { at?: iso | 'now', until?: iso }             (brand)
 *   POST /api/network-offers/:id/withdraw     { at?: iso | 'now' }                          (brand)
 *   POST /api/network-offers/:id/choice       { choice: 'in' | 'out' | null }               (store)
 *   POST /api/network-offers/catalogue/publish { source_key, at?: iso | 'now', add?: [item ids], withdraw?: [names], withdraw_at?/restore_at?: { name: [store ids] } } (brand)
 *   POST /api/network-offers/catalogue/cancel  { source_key }                               (brand)
 *   POST /api/network-offers/catalogue/price   { source_key, name, key, choice: use|keep|ok } (store)
 *   The catalogue half lives in lib/network-catalogue.js — a brand SUGGESTS prices, it never sets a store's.
 *
 * ⚠️ SESSION ONLY — a counter key never releases, withdraws or chooses. Those are decisions people take.
 * ⚠️ A release with no time takes effect at the NEXT OPENING. Athi: *"not to change in the middle of the day."* Releasing
 * now is possible, and has to be asked for in so many words.
 */
'use strict';
const express = require('express');
const log = require('../lib/logger');
const router = express.Router();
const auth = require('../middleware/auth');
const { withEntity, readBatch } = require('../db');
const net = require('../lib/network-offers');
const ncat = require('../lib/network-catalogue');
const membership = require('../lib/network-membership');
const { safeErr } = require('../lib/respond');
/** every door's catch: a member read that failed answers in its own words (503 + code); anything else, safeErr */
const failed = (res, e) => membership.answerReadFailed(res, e) || res.status(500).json({ error: 'Failed', message: safeErr(e) });

const sessionOnly = (req, res, next) => {
  if (req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'Network offers are managed by a signed-in person.' });
  next();
};

/** the brand's own live offer, or null — nobody releases an offer that is not theirs */
async function ownOffer(entity_id, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT definition_id, name, status, current_version FROM definition WHERE entity_id = $1 AND definition_id = $2 AND kind = 'offer'`,
    [entity_id, id])).catch(log.orElse('network-offers ownOffer: the read failed — answered with none', ({ rows: [] })));
  return r.rows[0] || null;
}

/**
 * ⭐ EFF-TRIPS (2026-10-15): THREE TRIPS, NOT 3 + 3 PER BRAND + 2 PER MEMBER. Every read this screen needs is batched (db readBatch):
 *   trip 1 — everything keyed by ME: my identities row (name · flags — read ONCE, it was read three times) · my own offers · my place on the
 *            tree · my roster · my adoptions WITH their source's owner and items (one join) · the brands I have an edge with · my own sources
 *            · my products (only when I author a source — an EXISTS in the statement)
 *   trip 2 — everything keyed by the brands and members found: their identities rows · the brands' catalogue titles · my standing with each
 *            brand · which brands I am IN (membership.isMemberSql)
 *   trip 3 — each brand's released offers, under THAT brand's binding (readBatch's per-statement entity — FORCE RLS on definition)
 * The answer is the same shape, row for row (tests/network-offers-shape.test.cjs). ⚠️ A batch that fails answers membership's 503 + code
 * (the reads used to degrade one by one to "none"; a half-read network is not an answer).
 */
router.get('/', auth, sessionOnly, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const actor = require('../lib/reqctx').currentActor();
    const batch = (what, stmts) => readBatch(me, actor, stmts).catch((e) => { throw membership.readFailed(e, what); });
    const [meRow, ownOffers, ownPlace, roster, ado, edged, ownSources, products] = await batch('network offers (own)', [
      { text: 'SELECT display_name, policy_flags FROM identities WHERE identity_id = $1', params: [me] },
      { text: net.OWN_OFFERS_SQL, params: [me] },
      { text: net.OWN_PLACE_SQL, params: [me] },
      { text: membership.ROSTER_SQL, params: [me] },
      /* the networks THIS shop belongs to, read from its own adoptions — with each source's owner and items in the same statement */
      { text: `SELECT a.source_key, a.commercials, s.owner_entity_id, s.items FROM catalogue_adoption a LEFT JOIN catalogue_source s ON s.source_key = a.source_key
                WHERE a.entity_id = $1 AND a.visible = true`, params: [me] },
      /* ⭐ every brand this store has a commercial edge with — invited, ASKED (NET-SRV1 G1: a store sees the request it sent even to a
         brand whose catalogue it does not sell yet), in or suspended — so standing() below is asked about all of them, never guessed */
      { text: `SELECT DISTINCT i.identity_id::text AS brand_id
                 FROM identities mi JOIN cb_entity mc ON mc.bridge_id = mi.bridge_id
                 JOIN cb_edge e ON e.child_id = mc.id AND e.type = 'commercial' AND e.state IN ('requested', 'active', 'suspended')
                 JOIN cb_entity bc ON bc.id = e.parent_id JOIN identities i ON i.bridge_id = bc.bridge_id AND i.identity_type = 'entity'
                WHERE mi.identity_id = $1`, params: [me] },
      { text: ncat.OWN_SOURCES_SQL, params: [me] },
      { text: ncat.BRAND_PRODUCTS_SQL.replace(' ORDER BY', ' AND EXISTS (SELECT 1 FROM catalogue_source WHERE owner_entity_id = $1::uuid AND active = true) ORDER BY'), params: [me] },
    ]);
    const my = meRow.rows[0] || {};
    const myFlags = my.policy_flags || {};
    const owners = [];
    ado.rows.forEach((r) => { if (r.owner_entity_id && String(r.owner_entity_id) !== String(me)) owners.push(String(r.owner_entity_id)); });
    const choices = myFlags.network_choices || {};
    const brandIds = [...new Set(owners.concat(edged.rows.map((x) => x.brand_id)))];
    const memberIds = roster.rows.map((m) => String(m.id));
    const peopleIds = [...new Set(brandIds.concat(memberIds))];
    /* ⭐ where this store stands with each — in, asked, invited, suspended, or not yet asked — and the bridge ids that link to the network */
    let standing = {}, inNetwork = new Set();
    const people = new Map();   /* id → { name, flags, title } — one identities row and one catalogue title per brand or member */
    if (peopleIds.length) {
      const stmts = [{ text: 'SELECT identity_id::text AS id, display_name, policy_flags FROM identities WHERE identity_id = ANY($1::uuid[])', params: [peopleIds] }];
      if (brandIds.length) stmts.push(
        { text: `SELECT DISTINCT ON (owner_entity_id) owner_entity_id::text AS id, title FROM catalogue_source
                  WHERE owner_entity_id = ANY($1::uuid[]) AND COALESCE(title, '') <> '' ORDER BY owner_entity_id, source_key`, params: [brandIds] },
        { text: membership.STANDING_SQL, params: [me, brandIds] },
        { text: `SELECT b FROM unnest($1::text[]) AS b WHERE ${membership.isMemberSql('b', '$2')}`, params: [brandIds, String(me)] });
      const [idRows, titles, standRows, inRows] = await batch('network offers (brands)', stmts);
      idRows.rows.forEach((r) => people.set(String(r.id), { name: r.display_name || null, flags: r.policy_flags || {}, title: null }));
      if (titles) titles.rows.forEach((r) => { const p = people.get(String(r.id)); if (p) p.title = r.title ? String(r.title) : null; });
      if (standRows) standing = membership.standingOf(standRows.rows);
      if (inRows) inNetwork = new Set(inRows.rows.map((x) => String(x.b)));
    }
    const of = (id) => people.get(String(id)) || { name: null, flags: {}, title: null };
    const names = new Map(memberIds.filter((id) => of(id).name).map((id) => [id, of(id).name]));
    const brand = await net.brandView(me, { flags: myFlags, offers: ownOffers.rows, own: ownPlace.rows, roster: roster.rows, names });
    /* trip 3 — each brand's released offers, read under that brand (only a store INSIDE the network is told of them) */
    const want = brandIds.filter((b) => (standing[b] || {}).state === 'active' && Object.keys(((of(b).flags.network_offers || {}).released) || {}).length);
    const offerRows = {};
    if (want.length) {
      const got = await batch('network offers (released)', want.map((b) => ({ entity: b, params: [b, Object.keys(of(b).flags.network_offers.released)],
        text: `SELECT definition_id, name, sub_kind, status FROM definition
                WHERE entity_id = $1 AND kind = 'offer' AND definition_id::text = ANY($2::text[])` })));
      want.forEach((b, i) => { offerRows[b] = got[i].rows; });
    }
    const networks = [];
    for (const brand_id of brandIds) {
      const st = standing[brand_id] || { state: 'none', via: null, edge_id: null, asked_by: null };
      const inside = st.state === 'active';
      const { name, flags, title } = of(brand_id);
      const no = flags.network_offers || {};
      const policy = net.POLICIES.indexOf(no.policy) >= 0 ? no.policy : 'opt_in';
      const rel = no.released || {};
      const rows = offerRows[brand_id] || [];
      networks.push({ brand_id, brand_name: title || name || null, policy,
        /* ⭐ G3: the brand's bridge id, and the network ROOT's — the network store reads by the root (GET /api/catalogue/network/:bridge_id) */
        brand_bridge_id: st.brand_bridge_id || null, root_bridge_id: st.root_bridge_id || null,
        /* in | requested (asked_by says who must answer) | suspended | none — the store half of lib/network-membership */
        membership: { state: st.state === 'requested' ? (st.asked_by === 'brand' ? 'invited' : 'asked') : st.state,
                      via: st.via, edge_id: st.edge_id || null, brand_node: st.brand_node || null },
        /* ⭐ G2: what THIS store may do on the row — the server's rule (mayAct), never re-derived on a screen */
        may: membership.mayOn(st, st.store_node || me),
        /* a store outside the network is told nothing of its offers */
        offers: (inside ? rows : []).map((d) => {
          const c = choices[d.definition_id] || null;
          return { id: d.definition_id, name: d.name, kind: d.sub_kind, live: d.status === 'live',
                   at: rel[d.definition_id].at || null, until: rel[d.definition_id].until || null,
                   choice: c, applies: policy === 'opt_in' ? c === 'in' : c !== 'out' };
        }) });
    }
    /* ⭐ the catalogue half: what the brand would publish, and the prices its stores are being asked about */
    const brandsPre = {}; brandIds.forEach((b) => { brandsPre[b] = of(b); });
    brand.catalogue = await ncat.brandView(me, { sources: ownSources.rows, products: products.rows, flags: myFlags,
      members: roster.rows.filter((m) => m.state === 'active').map((m) => m.id), names }).catch(membership.orElse('network offers: the catalogue half was not read — shown without it', null));
    if (brand.catalogue) brand.is_brand = true;
    const price_notices = await ncat.storeNotices(me, ado.rows.map((r) => ({ source_key: r.source_key, commercials: r.commercials })),
      { seen: myFlags.network_price_seen || {}, src: ado.rows.filter((r) => r.owner_entity_id).map((r) => ({ source_key: r.source_key, owner_entity_id: r.owner_entity_id, items: r.items })),
        inside: inNetwork, brands: brandsPre }).catch(membership.orElse('network offers: price notices not read — none shown', []));
    /* ⭐ may this login DESIGN a network? the same rule POST /api/network-design/build enforces (only the business itself, never a co-assist);
       the member view's Design tab shows the action either way and greys it with this sentence (no query — read off the session) */
    const may_design = (req.identity && req.identity.parent_entity_id)
      ? { ok: false, why: 'Only the business owner designs a network. Sign in as the business itself.' } : { ok: true, why: null };
    res.json({ brand, store: { networks, price_notices }, may_design });
  } catch (e) { failed(res, e); }
});

router.put('/policy', auth, sessionOnly, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const policy = String((req.body && req.body.policy) || '');
    if (net.POLICIES.indexOf(policy) < 0) return res.status(400).json({ error: 'validation', message: 'policy must be opt_in or opt_out' });
    await net.mergeFlag(me, 'network_offers', { policy });
    const pushed = await net.pushToNetwork(me, 'network offer policy');
    res.json({ ok: true, policy, pushed });
  } catch (e) { failed(res, e); }
});

const mapOf = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const who = (req) => (req.identity && (req.identity.display_name || req.identity.identity_id)) || null;
const fail = (res, out) => res.status(out.error === 'not_yours' ? 404 : (out.error === 'validation' ? 400 : 409)).json({ error: out.error, message: out.message });

router.post('/catalogue/publish', auth, sessionOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const out = await ncat.publish(auth.entityOf(req), String(b.source_key || ''), { at: b.at, add: Array.isArray(b.add) ? b.add : [], withdraw: Array.isArray(b.withdraw) ? b.withdraw : [], withdraw_at: mapOf(b.withdraw_at), restore_at: mapOf(b.restore_at), by: who(req) });
    if (out.error) return fail(res, out);
    res.json(Object.assign({ ok: true }, out));
  } catch (e) { failed(res, e); }
});

router.post('/catalogue/cancel', auth, sessionOnly, async (req, res) => {
  try {
    const out = await ncat.cancel(auth.entityOf(req), String((req.body || {}).source_key || ''));
    if (out.error) return fail(res, out);
    res.json(out);
  } catch (e) { failed(res, e); }
});

router.post('/catalogue/price', auth, sessionOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const out = await ncat.answer(auth.entityOf(req), { source_key: String(b.source_key || ''), name: String(b.name || ''), key: b.key ? String(b.key) : null, choice: b.choice });
    if (out.error) return fail(res, out);
    res.json(out);
  } catch (e) { failed(res, e); }
});

router.post('/:id/release', auth, sessionOnly, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const o = await ownOffer(me, req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found', message: 'That is not one of your offers.' });
    if (o.status !== 'live') return res.status(409).json({ error: 'Not live', message: 'Make the offer live before releasing it to your stores.' });
    const b = req.body || {};
    const at = net.whenOf(b.at, net.nextOpening());
    const until = b.until ? net.whenOf(b.until, null) : null;
    if (until && until <= at) return res.status(400).json({ error: 'validation', message: 'The offer would end before it starts.' });
    /**
     * ⭐⭐ THE RELEASE PINS THE VERSION. An edit to a released offer is a new version the stores do NOT see until it is
     * released again — otherwise "changing the offer" would reach every store in the middle of the day, which is the one
     * thing a controlled release exists to prevent. And the version already running KEEPS running until the new one's
     * moment, so a re-release never leaves a gap where neither applies.
     */
    const { flags: bf } = await net.flagsOf(me);
    const cur = ((bf.network_offers || {}).released || {})[o.definition_id] || null;
    /* ⚠️ the old version is kept only if it actually RUNS before the new one starts — re-releasing an offer that has not
       begun simply replaces it (a kept copy would have an empty window, and would show twice as "waiting") */
    const curLive = cur && cur.version && cur.at && cur.at < at && (!cur.until || cur.until > at);
    const rec = { version: Number(o.current_version) || 1, at, until, released_at: new Date().toISOString(),
                  released_by: (req.identity && (req.identity.display_name || req.identity.identity_id)) || null,
                  prev: (curLive && Number(cur.version) !== Number(o.current_version))
                    ? { version: cur.version, at: cur.at, until: at } : null };
    await net.setReleased(me, o.definition_id, rec);
    /* ⭐ the push: every member store is told, and each store's counters are the clients subscribed under it */
    const pushed = await net.pushToNetwork(me, 'network offer released');
    res.json({ ok: true, id: o.definition_id, name: o.name, release: rec, pushed });
  } catch (e) { failed(res, e); }
});

router.post('/:id/withdraw', auth, sessionOnly, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const o = await ownOffer(me, req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found', message: 'That is not one of your offers.' });
    const { flags } = await net.flagsOf(me);
    const cur = ((flags.network_offers || {}).released || {})[o.definition_id];
    if (!cur) return res.status(409).json({ error: 'Not released', message: 'That offer was never released to your stores.' });
    const until = net.whenOf((req.body || {}).at, net.nextOpening());
    await net.setReleased(me, o.definition_id, Object.assign({}, cur, { until, withdrawn_at: new Date().toISOString() }));
    const pushed = await net.pushToNetwork(me, 'network offer withdrawn');
    res.json({ ok: true, id: o.definition_id, until, pushed });
  } catch (e) { failed(res, e); }
});

router.post('/:id/choice', auth, sessionOnly, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const id = String(req.params.id || '');
    const c = (req.body || {}).choice;
    const choice = c === 'in' || c === 'out' ? c : null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'validation', message: 'Unknown offer.' });
    await net.setIn(me, 'network_choices', id, choice);
    /* ⭐ the store's own counters re-read at once */
    require('../lib/shopchanged').shopChanged(me, 'network offer choice');
    res.json({ ok: true, id, choice });
  } catch (e) { failed(res, e); }
});

module.exports = router;
