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
 *   GET    /api/counters               → { counters:[…], free: n, may:{ manage:{ ok, code, why } } }   (read by any signed-in person)
 *   ⚠️ every write below is OWNER only — one gate (lib/owner.gate, T3-SETTINGS 2026-10-14); a co-assist gets 403 code OWNER_ONLY
 *   POST   /api/counters               { name }        → the new counter (ONLINE by construction — this is the web)
 *   PATCH  /api/counters/:id           { name }        → renamed
 *   POST   /api/counters/:id/open                      → { key, counter } — refused while another PC holds it
 *   POST   /api/counters/:id/release                   → the holding PC's key is closed and the counter is free
 *   POST   /api/counters/:id/assign    { phone }       → M11: the label is assigned to a phone NUMBER (owner only; '' unassigns)
 *
 * ⚠️⚠️ ONE PC AT A TIME IS THE WHOLE POINT. Two PCs holding one counter is two devices issuing one series, which is
 * exactly the fault of 2026-09-17. Every open decides under a row lock.
 * ⚠️ SESSION ONLY. A key can never create, open or release a counter — a leaked counter key must not be able to
 * open more counters.
 * ⚠️ NO MIGRATION: the register rides identities.policy_flags.counters, beside the key list.
 
 * CALLED BY routes/till.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 *
 * OWNS      /api/counters: the shop's counters (create · rename · assign · open · release), and the claim and note-a-bill functions the till calls.
 * FLOW      auth → sessionOnly → owner gate → schema check (lib/orders-contract.js) → the register under a row lock → res.json | problem(req, res, said(...) | counterFault(...))
 *           (API-STANDARD S1: every refusal is a Problem that keeps the keys it always had, frozen in docs/contracts/api-legacy.json)
 * CARD      09-counter/counters-and-keys-pair-enrol-open-release
 */
'use strict';
const express = require('express');
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const { schemaValidate } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const words = require('../lib/orders-contract'); // the contract (each route's operation) and the words of a refusal
const router = express.Router();
const auth = require('../middleware/auth');
const { withTransaction } = require('../db');
const keys = require('../lib/api-keys');
const { isPending, patchCounter, readLocked, view } = require('../lib/counters-store'); // S7: the register's reads and writes live in lib/, not on this router

const sessionOnly = (req, res, next) => {
  if (req.api_key) return problem(req, res, { status: 403, ...words.sessionOnly() });
  next();
};
/** the schema check of one route (its own operation in lib/orders-contract.js) */
const checked = (route) => schemaValidate(words.counters.operationFor(route), words.schemaOptions.counters);
/* T3-SETTINGS: ONE owner gate on every counters write (lib/owner) — which PC bills under which series is the shop's call. GET says it as `may`. */
const OWNER_SAYS = 'Only the owner can change the counters.';
const ownerOnly = require('../lib/owner').gate(OWNER_SAYS);


/** every prefix that has ever appeared on a recorded counter bill — never handed to a NEW counter. ONE copy, in routes/keys.js (M11:
    claimSeries reads it for a key and for a phone alike) */
const bookedPrefixes = (db, entity_id) => keys.bookedPrefixes(db, entity_id);


router.get('/', auth, sessionOnly, async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const out = await withTransaction(async (db) => {
      const { counters, list, devices } = await readLocked(db, entity_id);
      return Object.values(counters)
        .sort((first, second) => keys.TILL_IDS.indexOf(first.id) - keys.TILL_IDS.indexOf(second.id))
        .map((item) => view(item, list, devices));
    });
    res.json({ counters: out, free: out.filter((item) => item.state === 'closed').length, may: { manage: require('../lib/owner').may(req, OWNER_SAYS) } });
  } catch (e) {
    problem(req, res, words.failed(e, req));
  }
});

/** ⭐ CREATE — online by construction (this is the web). The id is the lowest one no counter holds and nothing was billed under. */
router.post('/', auth, sessionOnly, ownerOnly, checked('POST /'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const name = String((req.body && req.body.name) || '')
      .trim()
      .slice(0, 40);
    const made = await withTransaction(async (db) => {
      const { counters, pf } = await readLocked(db, entity_id);
      const booked = await bookedPrefixes(db, entity_id);
      /* M11: nor one a phone bills under — a counter made on it would hand a PC the phone's numbers */
      const phones = keys.devicePrefixes(pf, null);
      const id = keys.TILL_IDS.find((x) => !counters[x] && !booked.has(x) && !phones.has(x));
      if (!id) {
        const e = new Error('There is no counter number left to give.');
        e.status = 400;
        throw e;
      }
      const c = { id, name: name || 'Counter ' + id, created_at: new Date().toISOString(), held_by: null };
      await patchCounter(db, entity_id, id, c);
      return c;
    });
    res.status(201).json({ counter: view(made, []) });
  } catch (e) {
    problem(req, res, words.counterFault(e, req, 'validation'));
  }
});

router.patch('/:id', auth, sessionOnly, ownerOnly, checked('PATCH /:id'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const id = String(req.params.id || '').toUpperCase();
    const name = String((req.body && req.body.name) || '')
      .trim()
      .slice(0, 40);
    if (!name) return problem(req, res, { status: 400, ...words.badRequest('A counter needs a name.') });
    const done = await withTransaction(async (db) => {
      const { counters } = await readLocked(db, entity_id);
      if (!counters[id]) return false;
      await patchCounter(db, entity_id, id, { name });
      return true;
    });
    if (!done) return problem(req, res, { status: 404, ...words.counterNotFound() });
    res.json({ ok: true, id, name });
  } catch (e) {
    problem(req, res, words.failed(e, req));
  }
});

/**
 * ── ⭐⭐ ASSIGN A COUNTER LABEL TO A PHONE NUMBER (M11, D9) ──────────────────────────────────────────────────────
 * POST /api/counters/:id/assign { phone } → policy_flags.counters[id].assigned = { phone, at, by }. `phone: ''` unassigns.
 * The phone of a person whose VERIFIED PHONE document is this number then bills as this counter (keys.claimSeries); an
 * unassigned phone bills under the next free label. OWNER only (lib/owner) — who bills under which series is the shop's call.
 * ⚠️ A label still held by another phone is NOT taken from it here: that phone may be billing under it offline right now.
 * It moves off at its next sign-in/snapshot, and the newly assigned phone takes the label after that (`held_by` says who).
 */
router.post('/:id/assign', auth, sessionOnly, require('../lib/owner').gate('Only the owner can assign a counter.'), checked('POST /:id/assign'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const id = String(req.params.id || '').toUpperCase();
    const raw = req.body && req.body.phone;
    const phone = raw == null || raw === '' ? null : require('./identity-docs').normPhone(raw);
    if (phone !== null && !/^[+]?[0-9]{10,15}$/.test(phone))
      return problem(req, res, { status: 400, ...words.badPhone('Type the mobile number with its country code — 10 to 15 digits.') });
    const out = await withTransaction(async (db) => {
      const { counters, list, devices } = await readLocked(db, entity_id);
      if (!counters[id]) return null;
      const assigned = phone ? { phone, at: new Date().toISOString(), by: (req.identity && req.identity.identity_id) || null } : null;
      await patchCounter(db, entity_id, id, { assigned });
      return view(Object.assign({}, counters[id], { assigned }), list, devices);
    });
    if (!out) return problem(req, res, { status: 404, ...words.counterNotFound() });
    res.json({ ok: true, counter: out });
  } catch (e) {
    problem(req, res, words.failed(e, req));
  }
});

/**
 * ── ⭐⭐⭐ OPEN — ONE PC AT A TIME ───────────────────────────────────────────────────────────────────────────
 * The counter is HELD under the lock first (a short-lived "pending" marker), the key is minted outside it — minting
 * writes the same row, so doing it inside the lock would wait on itself — and then the key is bound. Two people
 * pressing Open at the same moment: one gets the counter, the other is told who has it.
 */
router.post('/:id/open', auth, sessionOnly, ownerOnly, checked('POST /:id/open'), async (req, res) => {
  const entity_id = auth.entityOf(req);
  const id = String(req.params.id || '').toUpperCase();
  const nonce = 'pending:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  try {
    const got = await withTransaction(async (db) => {
      const { counters, list, devices } = await readLocked(db, entity_id);
      const nestedC = counters[id];
      if (!nestedC) return { status: 404, body: { error: 'Not found', message: 'There is no counter ' + id + ' in this shop.' } };
      const v = view(nestedC, list, devices);
      if (v.state === 'open' || v.state === 'break' || v.state === 'opening') {
        return {
          status: 409,
          body: {
            error: 'Counter already open',
            code: 'COUNTER_HELD',
            counter: v,
            message:
              'Counter ' +
              id +
              ' is already open' +
              (v.held_by ? ' on ' + v.held_by.name + (v.held_by.seen && v.held_by.seen.ip ? ' (' + v.held_by.seen.ip + ')' : '') : '') +
              '. Close it there first — or, if that PC is gone, release it.'
          }
        };
      }
      await patchCounter(db, entity_id, id, { held_by: nonce, held_at: new Date().toISOString() });
      return { status: 200, counter: nestedC };
    });
    if (got.status !== 200) return problem(req, res, words.relayed(got)); /* 404 no such counter · 409 held by another PC: the body the lock made, kept whole */

    const ua = String(req.headers['user-agent'] || '');
    const os = /Windows/.test(ua) ? 'Win32' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'device';
    let minted;
    try {
      minted = await keys.mint(entity_id, req.identity, {
        name: 'counter ' + id + ' · ' + os + ' · ' + new Date().toISOString().slice(0, 10),
        scopes: ['till']
      });
    } catch (e) {
      await withTransaction((db) => patchCounter(db, entity_id, id, { held_by: null, held_at: null }));
      throw e;
    }
    const c = got.counter;
    await withTransaction(async (db) => {
      await keys.patchKeyWith(db, entity_id, minted.jti, {
        counter: id,
        till: { id, issued: Number(c.next) > 1, at: new Date().toISOString() }
      });
      await patchCounter(db, entity_id, id, { held_by: minted.jti, held_at: new Date().toISOString(), opened_at: new Date().toISOString() });
    });
    res.json({ key: minted.key, counter: Object.assign(view(Object.assign({}, c, { held_by: minted.jti }), [minted]), { state: 'open' }) });
  } catch (e) {
    problem(req, res, words.counterFault(e, req, 'Failed'));
  }
});

/**
 * ── ⚠️⚠️ RELEASE — FOR A PC THAT CANNOT CLOSE ITSELF ─────────────────────────────────────────────────────────
 * The holding key is closed at once and the counter is free. Anything that PC had not sent is still on it, and
 * its numbers may be issued again by the next PC to open this counter — which is why the ordinary way out is
 * CLOSE, from the counter. If that PC ever comes back, its key is refused, and its bills are recovered by pairing
 * it and bringing them in (the clash guard and renumbering then keep the books unique).
 */
router.post('/:id/release', auth, sessionOnly, ownerOnly, checked('POST /:id/release'), async (req, res) => {
  try {
    const entity_id = auth.entityOf(req);
    const id = String(req.params.id || '').toUpperCase();
    const out = await withTransaction(async (db) => {
      const { counters, list } = await readLocked(db, entity_id);
      const c = counters[id];
      if (!c) return null;
      const holder = c.held_by && !isPending(c.held_by) ? list.find((item) => item && String(item.jti) === String(c.held_by)) : null;
      if (holder && !keys.isClosed(holder)) {
        await keys.patchKeyWith(db, entity_id, holder.jti, {
          till: Object.assign({}, holder.till || {}, { closed_at: new Date().toISOString(), released: true })
        });
        auth.forgetKey(holder.jti);
      }
      await patchCounter(db, entity_id, id, {
        held_by: null,
        held_at: null,
        closed_at: new Date().toISOString(),
        released: true,
        status: null,
        status_since: null,
        status_by: null
      });
      return { id, released_from: holder ? holder.name : null };
    });
    if (!out) return problem(req, res, { status: 404, ...words.counterNotFound() });
    res.json(Object.assign({ ok: true }, out));
  } catch (e) {
    problem(req, res, words.failed(e, req));
  }
});


router.openapi = { paths: words.counters.pathsOf(), schemas: {} };
/* GET /api/till/counters is signed off against its handler text, which calls this export; the sign-off is cb-api's to renew, then till.js can read lib/counters-store directly */
router.listNarrow = require('../lib/counters-store').listNarrow;

module.exports = router;
