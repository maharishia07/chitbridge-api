/**
 * /api/counters — THE SHOP'S COUNTERS, AS STANDING IDENTITIES (2026-09-17).
 *
 * Athi: *"it has to be like a co-assist, so I know the counter number, and I should be able to open and close the
 * counter again and again — but in only one PC."*
 *
 * A COUNTER is a thing the shop owns — C1 "Front desk", C2 "Office" — created once, online, and kept. A PC does not
 * own a counter; it HOLDS one while it is open. Opening mints a till key bound to the counter; closing (from the
 * counter, POST /api/till/close) or releasing (from here, for a PC that died) lets it go. The counter's own series
 * carries on across every open and close: the cloud keeps where it stopped (`next`, per `period`), and the next PC
 * to open it continues from there.
 *
 *   GET    /api/counters               → { counters:[…], free: n }
 *   POST   /api/counters               { name }        → the new counter (ONLINE by construction — this is the web)
 *   PATCH  /api/counters/:id           { name }        → renamed
 *   POST   /api/counters/:id/open                      → { key, counter } — refused while another PC holds it
 *   POST   /api/counters/:id/release                   → the holding PC's key is closed and the counter is free
 *
 * ⚠️⚠️ ONE PC AT A TIME IS THE WHOLE POINT. Two PCs holding one counter is two devices issuing one series, which is
 * exactly the fault of 2026-09-17. Every open decides under a row lock.
 * ⚠️ SESSION ONLY. A key can never create, open or release a counter — a leaked counter key must not be able to
 * open more counters.
 * ⚠️ NO MIGRATION: the register rides identities.policy_flags.counters, beside the key list.
 */
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { query, withTransaction } = require('../db');
const keys = require('./keys');

const sessionOnly = (req, res, next) => {
  if (req.api_key) return res.status(403).json({ error: 'Forbidden', message: 'Counters are managed by a signed-in person, not by a key.' });
  next();
};
const PENDING_MS = 2 * 60 * 1000;
const isPending = (h) => typeof h === 'string' && h.indexOf('pending:') === 0;
const pendingLive = (c) => isPending(c && c.held_by) && (Date.now() - new Date(c.held_at || 0).getTime()) < PENDING_MS;

/** set one counter's record in one statement — shallow merge into policy_flags.counters[id] */
async function patchCounter(db, entity_id, id, patch) {
  await db.query(
    `UPDATE identities
        SET policy_flags = jsonb_set(COALESCE(policy_flags, '{}'::jsonb), '{counters}',
              COALESCE(policy_flags->'counters', '{}'::jsonb)
              || jsonb_build_object($2::text, COALESCE(policy_flags->'counters'->$2, '{}'::jsonb) || $3::jsonb))
      WHERE identity_id = $1`,
    [entity_id, String(id), JSON.stringify(patch)]);
}
router.patchCounter = patchCounter;

/** every prefix that has ever appeared on a recorded counter bill — never handed to a NEW counter */
async function bookedPrefixes(db, entity_id) {
  const out = new Set();
  await db.query('SAVEPOINT booked');
  try {
    await db.query("SELECT set_config('app.current_entity', $1, true)", [String(entity_id)]);
    const r = await db.query(
      `SELECT DISTINCT upper(business_json->'till'->>'id') AS id FROM chit_header
        WHERE entity_id = $1 AND business_json->>'client_ref' IS NOT NULL AND business_json->'till'->>'id' IS NOT NULL`,
      [entity_id]);
    r.rows.forEach((x) => { if (x.id) out.add(x.id); });
    await db.query('RELEASE SAVEPOINT booked');
  } catch (_) { try { await db.query('ROLLBACK TO SAVEPOINT booked'); } catch (__) {} }
  return out;
}

/**
 * ⭐ THE REGISTER, READ UNDER A LOCK — and the pairings that predate it adopted into it.
 * A key that already numbers under a prefix (claimTill, earlier today) and is not closed becomes the holder of a
 * counter of that id. Nothing a shop has already billed under is renamed or orphaned by the arrival of the register.
 */
async function readLocked(db, entity_id) {
  const r = await db.query('SELECT policy_flags FROM identities WHERE identity_id = $1 FOR UPDATE', [entity_id]);
  const pf = (r.rows[0] && r.rows[0].policy_flags) || {};
  const counters = Object.assign({}, pf.counters || {});
  const list = Array.isArray(pf.api_keys) ? pf.api_keys : [];
  const tills = list.filter((k) => k && Array.isArray(k.scopes) && k.scopes.indexOf('till') >= 0);
  for (const k of tills) {
    const id = k.till && k.till.id ? String(k.till.id).toUpperCase() : null;
    if (!id || keys.isClosed(k)) continue;
    if (!counters[id]) {
      counters[id] = { id, name: 'Counter ' + id, created_at: k.created_at || new Date().toISOString(),
                       held_by: k.jti, held_at: (k.till && k.till.at) || new Date().toISOString(), adopted: true };
      await patchCounter(db, entity_id, id, counters[id]);
    }
    if (!k.counter) await keys.patchKeyWith(db, entity_id, k.jti, { counter: id });
  }
  return { counters, list, tills };
}

/** the shop-facing view of one counter: who holds it now, from where, and where its series stands */
function view(c, list) {
  const holder = c.held_by && !isPending(c.held_by) ? list.find((k) => k && String(k.jti) === String(c.held_by)) : null;
  const open = !!(holder && !keys.isClosed(holder));
  return {
    id: c.id, name: c.name || ('Counter ' + c.id), created_at: c.created_at || null,
    state: open ? (c.status === 'break' ? 'break' : 'open') : (pendingLive(c) ? 'opening' : 'closed'),
    break_since: open && c.status === 'break' ? (c.status_since || null) : null,
    break_by: open && c.status === 'break' ? (c.status_by || null) : null,
    held_by: open ? { name: holder.name, last4: holder.last4, since: c.held_at || null, seen: holder.seen || null,
                      diag: holder.diag || null } : null,
    next: c.next || null, period: c.period || null, last_no: c.last_no || null,
    last_at: c.last_at || null, closed_at: c.closed_at || null,
  };
}

/**
 * ⭐ NARROW READ FOR A TILL KEY (routes/till.js GET /counters — b262, 2026-09-18, decision 3: the "also mark
 * sold out on Counter 2, Counter 3...?" prompt needs to name the shop's other counters). Deliberately not the
 * full view() above: id and name only, none of held_by/status/series — a stolen till key learns nothing about
 * who is working where, matching the "narrow on purpose" rule every other till-scoped read follows.
 */
router.listNarrow = async (entity_id) => {
  const r = await query('SELECT policy_flags FROM identities WHERE identity_id = $1', [entity_id]);
  const counters = (r.rows[0] && r.rows[0].policy_flags && r.rows[0].policy_flags.counters) || {};
  return Object.keys(counters).map((id) => ({ id, name: (counters[id] && counters[id].name) || ('Counter ' + id) }));
};

router.get('/', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const out = await withTransaction(async (db) => {
      const { counters, list } = await readLocked(db, entity_id);
      return Object.values(counters).sort((a, b) => keys.TILL_IDS.indexOf(a.id) - keys.TILL_IDS.indexOf(b.id))
        .map((c) => view(c, list));
    });
    res.json({ counters: out, free: out.filter((c) => c.state === 'closed').length });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/** ⭐ CREATE — online by construction (this is the web). The id is the lowest one no counter holds and nothing was billed under. */
router.post('/', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const name = String((req.body && req.body.name) || '').trim().slice(0, 40);
    const made = await withTransaction(async (db) => {
      const { counters } = await readLocked(db, entity_id);
      const booked = await bookedPrefixes(db, entity_id);
      const id = keys.TILL_IDS.find((x) => !counters[x] && !booked.has(x));
      if (!id) { const e = new Error('There is no counter number left to give.'); e.status = 400; throw e; }
      const c = { id, name: name || ('Counter ' + id), created_at: new Date().toISOString(), held_by: null };
      await patchCounter(db, entity_id, id, c);
      return c;
    });
    res.status(201).json({ counter: view(made, []) });
  } catch (e) { res.status(e.status || 500).json({ error: e.status ? 'validation' : 'Failed', message: String(e && e.message) }); }
});

router.patch('/:id', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const id = String(req.params.id || '').toUpperCase();
    const name = String((req.body && req.body.name) || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'validation', message: 'A counter needs a name.' });
    const done = await withTransaction(async (db) => {
      const { counters } = await readLocked(db, entity_id);
      if (!counters[id]) return false;
      await patchCounter(db, entity_id, id, { name });
      return true;
    });
    if (!done) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, id, name });
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ── ⭐⭐⭐ OPEN — ONE PC AT A TIME ───────────────────────────────────────────────────────────────────────────
 * The counter is HELD under the lock first (a short-lived "pending" marker), the key is minted outside it — minting
 * writes the same row, so doing it inside the lock would wait on itself — and then the key is bound. Two people
 * pressing Open at the same moment: one gets the counter, the other is told who has it.
 */
router.post('/:id/open', auth, sessionOnly, async (req, res) => {
  const entity_id = auth.entityOf(req);
  const id = String(req.params.id || '').toUpperCase();
  const nonce = 'pending:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  try {
    const got = await withTransaction(async (db) => {
      const { counters, list } = await readLocked(db, entity_id);
      const c = counters[id];
      if (!c) return { status: 404, body: { error: 'Not found', message: 'There is no counter ' + id + ' in this shop.' } };
      const v = view(c, list);
      if (v.state === 'open' || v.state === 'break' || v.state === 'opening') {
        return { status: 409, body: { error: 'Counter already open', code: 'COUNTER_HELD', counter: v,
          message: 'Counter ' + id + ' is already open' + (v.held_by ? ' on ' + v.held_by.name
            + (v.held_by.seen && v.held_by.seen.ip ? ' (' + v.held_by.seen.ip + ')' : '') : '')
          + '. Close it there first — or, if that PC is gone, release it.' } };
      }
      await patchCounter(db, entity_id, id, { held_by: nonce, held_at: new Date().toISOString() });
      return { status: 200, counter: c };
    });
    if (got.status !== 200) return res.status(got.status).json(got.body);

    const ua = String(req.headers['user-agent'] || '');
    const os = /Windows/.test(ua) ? 'Win32' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'device';
    let minted;
    try {
      minted = await keys.mint(entity_id, req.identity, {
        name: 'counter ' + id + ' · ' + os + ' · ' + new Date().toISOString().slice(0, 10), scopes: ['till'] });
    } catch (e) {
      await withTransaction((db) => patchCounter(db, entity_id, id, { held_by: null, held_at: null }));
      throw e;
    }
    const c = got.counter;
    await withTransaction(async (db) => {
      await keys.patchKeyWith(db, entity_id, minted.jti, {
        counter: id, till: { id, issued: Number(c.next) > 1, at: new Date().toISOString() } });
      await patchCounter(db, entity_id, id, { held_by: minted.jti, held_at: new Date().toISOString(), opened_at: new Date().toISOString() });
    });
    res.json({ key: minted.key, counter: Object.assign(view(Object.assign({}, c, { held_by: minted.jti }), [minted]), { state: 'open' }) });
  } catch (e) { res.status(e.status || 500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ── ⚠️⚠️ RELEASE — FOR A PC THAT CANNOT CLOSE ITSELF ─────────────────────────────────────────────────────────
 * The holding key is closed at once and the counter is free. Anything that PC had not sent is still on it, and
 * its numbers may be issued again by the next PC to open this counter — which is why the ordinary way out is
 * CLOSE, from the counter. If that PC ever comes back, its key is refused, and its bills are recovered by pairing
 * it and bringing them in (the clash guard and renumbering then keep the books unique).
 */
router.post('/:id/release', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const id = String(req.params.id || '').toUpperCase();
    const out = await withTransaction(async (db) => {
      const { counters, list } = await readLocked(db, entity_id);
      const c = counters[id];
      if (!c) return null;
      const holder = c.held_by && !isPending(c.held_by) ? list.find((k) => k && String(k.jti) === String(c.held_by)) : null;
      if (holder && !keys.isClosed(holder)) {
        await keys.patchKeyWith(db, entity_id, holder.jti, {
          till: Object.assign({}, holder.till || {}, { closed_at: new Date().toISOString(), released: true }) });
        auth.forgetKey(holder.jti);
      }
      await patchCounter(db, entity_id, id, { held_by: null, held_at: null, closed_at: new Date().toISOString(), released: true,
                                              status: null, status_since: null, status_by: null });
      return { id, released_from: holder ? holder.name : null };
    });
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json(Object.assign({ ok: true }, out));
  } catch (e) { res.status(500).json({ error: 'Failed', message: String(e && e.message) }); }
});

/**
 * ⭐ THE CLOUD'S HIGH-WATER MARK, from a counter bill that was just accepted (called by POST /api/chits/send).
 * Athi: *"as it is an offline capability, the system should be updated with the next seq number whenever the sync
 * completes."* Only a REGISTERED counter is tracked; a bill from an older period never drags a newer one back.
 * ⚠️ Fire-and-forget by its caller: a missed update is recovered by the counter's own count and by its close.
 */
router.noteBill = async (entity_id, series, billedAt, no) => {
  if (!series || !series.prefix || !(Number(series.seq) > 0)) return;
  const id = String(series.prefix).toUpperCase();
  const period = series.period != null ? String(series.period) : null;
  await withTransaction(async (db) => {
    const r = await db.query(`SELECT policy_flags->'counters'->$2 AS c FROM identities WHERE identity_id = $1 FOR UPDATE`, [entity_id, id]);
    const c = r.rows[0] && r.rows[0].c;
    if (!c) return;
    const at = billedAt ? String(billedAt) : new Date().toISOString();
    const nextSeq = Number(series.seq) + 1;
    let patch = null;
    if (c.period === period) {
      if (!(Number(c.next) >= nextSeq)) patch = { next: nextSeq };
    } else if (!c.hw_at || at >= String(c.hw_at)) {
      patch = { period, next: nextSeq };
    }
    if (patch) await patchCounter(db, entity_id, id, Object.assign(patch, { last_no: no || null, last_at: at, hw_at: at }));
  });
};

module.exports = router;
