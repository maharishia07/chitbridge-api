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
const router = express.Router();
const auth = require('../middleware/auth');
const { query, withEntity } = require('../db');
const net = require('../lib/network-offers');
const ncat = require('../lib/network-catalogue');

const sessionOnly = (req, res, next) => {
  if (req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'Network offers are managed by a signed-in person.' });
  next();
};

/** the brand's own live offer, or null — nobody releases an offer that is not theirs */
async function ownOffer(entity_id, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const r = await withEntity(entity_id, (db) => db.query(
    `SELECT definition_id, name, status, current_version FROM definition WHERE entity_id = $1 AND definition_id = $2 AND kind = 'offer'`,
    [entity_id, id])).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

router.get('/', auth, sessionOnly, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const brand = await net.brandView(me);
    /* the networks THIS shop belongs to, read from its own adoptions */
    const ado = await withEntity(me, (db) => db.query(
      'SELECT source_key, commercials FROM catalogue_adoption WHERE entity_id = $1 AND visible = true', [me])).catch(() => ({ rows: [] }));
    const owners = [];
    if (ado.rows.length) {
      const src = await query('SELECT source_key, owner_entity_id FROM catalogue_source WHERE source_key = ANY($1::text[])',
        [ado.rows.map((r) => r.source_key)]).catch(() => ({ rows: [] }));
      src.rows.forEach((r) => { if (r.owner_entity_id && String(r.owner_entity_id) !== String(me)) owners.push(String(r.owner_entity_id)); });
    }
    const choices = ((await net.flagsOf(me)).flags.network_choices) || {};
    const networks = [];
    for (const brand_id of [...new Set(owners)]) {
      net.noteMember(brand_id, me);
      const { name, flags } = await net.flagsOf(brand_id);
      const no = flags.network_offers || {};
      const policy = net.POLICIES.indexOf(no.policy) >= 0 ? no.policy : 'opt_in';
      const rel = no.released || {};
      const ids = Object.keys(rel);
      let rows = [];
      if (ids.length) {
        const r = await withEntity(brand_id, (db) => db.query(
          `SELECT definition_id, name, sub_kind, status FROM definition
            WHERE entity_id = $1 AND kind = 'offer' AND definition_id::text = ANY($2::text[])`, [brand_id, ids])).catch(() => ({ rows: [] }));
        rows = r.rows;
      }
      networks.push({ brand_id, brand_name: await net.brandName(brand_id, name), policy,
        offers: rows.map((d) => {
          const c = choices[d.definition_id] || null;
          return { id: d.definition_id, name: d.name, kind: d.sub_kind, live: d.status === 'live',
                   at: rel[d.definition_id].at || null, until: rel[d.definition_id].until || null,
                   choice: c, applies: policy === 'opt_in' ? c === 'in' : c !== 'out' };
        }) });
    }
    /* ⭐ the catalogue half: what the brand would publish, and the prices its stores are being asked about */
    brand.catalogue = await ncat.brandView(me).catch(() => null);
    if (brand.catalogue) brand.is_brand = true;
    const price_notices = await ncat.storeNotices(me, ado.rows).catch(() => []);
    res.json({ brand, store: { networks, price_notices } });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.put('/policy', auth, sessionOnly, async (req, res) => {
  try {
    const me = auth.entityOf(req);
    const policy = String((req.body && req.body.policy) || '');
    if (net.POLICIES.indexOf(policy) < 0) return res.status(400).json({ error: 'validation', message: 'policy must be opt_in or opt_out' });
    await net.mergeFlag(me, 'network_offers', { policy });
    const pushed = await net.pushToNetwork(me, 'network offer policy');
    res.json({ ok: true, policy, pushed });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
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
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.post('/catalogue/cancel', auth, sessionOnly, async (req, res) => {
  try {
    const out = await ncat.cancel(auth.entityOf(req), String((req.body || {}).source_key || ''));
    if (out.error) return fail(res, out);
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

router.post('/catalogue/price', auth, sessionOnly, async (req, res) => {
  try {
    const b = req.body || {};
    const out = await ncat.answer(auth.entityOf(req), { source_key: String(b.source_key || ''), name: String(b.name || ''), key: b.key ? String(b.key) : null, choice: b.choice });
    if (out.error) return fail(res, out);
    res.json(out);
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
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
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
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
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
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
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

module.exports = router;
