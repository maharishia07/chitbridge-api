'use strict';
/**
 * tests/au-pin-sit-proof.cjs — PROOF ONLY (scratch/au-pin-proof-1138, never merged): the AU write-off, recovery and BAS cases on a SIT box, before and after the pack pin.
 * Runs ON the box inside the api container (tests/lib/run-target.cjs: production refused). STATE=/tmp/pin-state.json carries the shops between phases (copied out and in by the launcher).
 * Hand figures (AUD minor): invoice 2 x 1000.00 + 10% = 220,000 (GST 20,000) dated 2026-08-14; write-off #1 110,000 (pack 1.0.0: all to bad debts, no GST);
 * after the restamp: write-off #2 55,000 = GST 55,000 x 20,000 / 220,000 = 5,000 (decreasing, BAS 1B); recovery 22,000 = GST 2,000 (increasing, BAS 1A).
 *   p1  before: shop A (closed Q1) and A2 (open Q1) on 1.0.0: BAS Q1 = 1A 20,000 · 1B 0 · 9 = 20,000
 *   p2  after the deploy + b914 backfill, no restamp: the same boxes (stamped 1.0.0)
 *   p3  restamp: A from 2026-10-01 (Q1 closed, frozen): same boxes; A2 from 2026-07-01 (Q1 open): write-off #2 and the recovery, then 1A 22,000 · 1B 5,000 · 9 = 17,000
 */
const fs = require('fs');
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, bill, invoice, freshShop, finish } = H;
const PHASE = process.argv[2], STATE = process.env.STATE || '/tmp/pin-state.json';
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' } };
const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { shops: {} };
const save = () => fs.writeFileSync(STATE, JSON.stringify(st, null, 1));
const BOXES = (r) => { const m = {}; (r.b.boxes || []).forEach((b) => { m[b.code] = b.amount_minor; }); return { 1: m['1A'], 2: m['1B'], 9: m['9'], net: r.b.net_minor, payable: r.b.payable_minor, version: r.b.pack, period: r.b.period && r.b.period.label }; };
const bas = async (shop) => BOXES(ok(await j('/api/books/returns?on=2026-09-15', { token: shop.token }), 'BAS Q1'));
const login = async (email) => {
  const v = ok(await j('/api/entities/verify', { method: 'POST', body: { email, otp: H.ENTITY_OTP, device_id: process.env.CB_TEST_DEVICE } }), 'verify ' + email).b;
  return v.token;
};
const same = (a, b) => JSON.stringify([a['1A'], a['1B'], a['9']]) === JSON.stringify([b['1A'], b['1B'], b['9']]);
const BILLED = '2026-08-14T10:00:00+10:00', RUN = 'pin' + (Date.now() % 1e9).toString(36);
const rows = [[{ id: undefined, name: 'Pin item ' + RUN, unit: 'piece', price: 1000 }, 2]];
const send = (shop, body) => j('/api/chits/send', { method: 'POST', token: shop.token, body });
const wo = (shop, party, minor, ref, chit, date, path) => j(path || '/api/books/write-off', { method: 'POST', token: shop.token, body: { party_id: party, amount_minor: minor, reason: 'pin proof', client_ref: ref, against_ref: chit, date, into: 'bank' } });

(async () => {
  console.log('\n== AU pack pin proof · phase ' + PHASE + ' · ' + H.API + ' ==');
  if (PHASE === 'p1') {
    const B = await freshShop(RUN + 'b', 'Pin B', AU);
    ok(await j('/api/books/enable', { method: 'POST', token: B.token }), 'B books on');
    for (const tag of ['a', 'a2']) {
      await kase('p1-' + tag, 'shop ' + tag + ': invoice 2,200.00 (GST 200.00) on 2026-08-14, write-off 1,100.00, BAS Q1 on 1.0.0', async () => {
        const S = await freshShop(RUN + tag, 'Pin ' + tag, AU);
        ok(await j('/api/books/enable', { method: 'POST', token: S.token }), 'books on');
        const body = invoice(RUN + tag + '-inv', rows, { to: B.bridge, billedAt: BILLED });
        body.line_items.forEach((l) => { l.gst_rate = 10; });
        const sent = ok(await send(S, body), 'send invoice').b, chit = sent.chit_id || (sent.chit && sent.chit.chit_id);
        let party = null;
        for (let i = 0; i < 15 && !party; i++) {
          const d = ok(await j('/api/books/dues?side=customer', { token: S.token }), 'dues').b;
          party = ((d.parties || []).find((p) => p.balance_minor > 0) || {}).party_id;
          if (!party) await H.pause(1000);
        }
        expect(party, 'the invoice did not reach the books');
        const w = await wo(S, party, 110000, RUN + tag + '-wo1', chit, '2026-09-10');
        expect(w.status === 200, 'write-off #1: ' + w.status + ' ' + JSON.stringify(w.b).slice(0, 200));
        const boxes = await bas(S);
        expect(boxes['1'] === 20000 && boxes['2'] === 0 && boxes['9'] === 20000, 'hand 1A 20000 · 1B 0 · 9 20000, got ' + JSON.stringify(boxes));
        let closed = null;
        if (tag === 'a') { const c = await j('/api/books/gst/close', { method: 'POST', token: S.token, body: { period: '2026-Q1' } }); expect(c.status === 200, 'close Q1: ' + c.status + ' ' + JSON.stringify(c.b).slice(0, 200)); closed = true; }
        st.shops[tag] = { email: RUN + tag + '@test.chitbridge', chit, party, boxes, closed, entity: S.entity, name: S.name };
        save(); return JSON.stringify(boxes);
      });
    }
  } else if (PHASE === 'p2') {
    for (const tag of Object.keys(st.shops)) {
      await kase('p2-' + tag, 'after deploy + backfill, no restamp: BAS Q1 of ' + tag + ' reads exactly what it read before', async () => {
        const S = { token: await login(st.shops[tag].email) }, now = await bas(S);
        expect(same(now, st.shops[tag].boxes), 'before ' + JSON.stringify(st.shops[tag].boxes) + ' now ' + JSON.stringify(now));
        return JSON.stringify(now);
      });
    }
  } else if (PHASE === 'p3') {
    const a = st.shops.a, a2 = st.shops.a2;
    await kase('p3-a', 'A (Q1 closed under 1.0.0): restamp 1.0.1 from 2026-10-01; BAS Q1 is unchanged', async () => {
      const S = { token: await login(a.email) };
      const r = await j('/api/books/setting', { method: 'POST', token: S.token, body: { pack_version: '1.0.1', pack_from: '2026-10-01' } });
      expect(r.status === 200 && r.b.pack_version && r.b.pack_version.version === '1.0.1', 'restamp: ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
      const now = await bas(S); expect(same(now, a.boxes), 'before ' + JSON.stringify(a.boxes) + ' now ' + JSON.stringify(now));
      return JSON.stringify(r.b.pack_version) + ' ' + JSON.stringify(now);
    });
    await kase('p3-back', 'a restamp backward or to an unknown version, or from a day that is not a period start, is refused', async () => {
      const S = { token: await login(a.email) };
      const back = await j('/api/books/setting', { method: 'POST', token: S.token, body: { pack_version: '1.0.0', pack_from: '2027-01-01' } });
      const odd = await j('/api/books/setting', { method: 'POST', token: S.token, body: { pack_version: '1.0.1', pack_from: '2027-01-15' } });
      expect(back.status >= 400 && back.status < 500 && odd.status >= 400 && odd.status < 500, 'back ' + back.status + ' odd ' + odd.status);
      return back.status + '/' + odd.status + ' ' + String(back.b.code || back.b.type) + ' ' + String(odd.b.code || odd.b.type);
    });
    await kase('p3-a2', 'A2 (Q1 open): restamp from 2026-07-01, write-off #2 splits GST 50.00, recovery 220.00 splits 20.00; BAS Q1 = 1A 22,000 · 1B 5,000 · 9 17,000', async () => {
      const S = { token: await login(a2.email) };
      const r = await j('/api/books/setting', { method: 'POST', token: S.token, body: { pack_version: '1.0.1', pack_from: '2026-07-01' } });
      expect(r.status === 200, 'restamp: ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 240));
      const w2 = await wo(S, a2.party, 55000, RUN + '-wo2', a2.chit, '2026-09-12');
      expect(w2.status === 200, 'write-off #2: ' + w2.status + ' ' + JSON.stringify(w2.b).slice(0, 240));
      const rec = await wo(S, a2.party, 22000, RUN + '-rec', a2.chit, '2026-09-14', '/api/books/write-off/recover');
      expect(rec.status === 200, 'recovery: ' + rec.status + ' ' + JSON.stringify(rec.b).slice(0, 240));
      const now = await bas(S);
      expect(now['1'] === 22000 && now['2'] === 5000 && now['9'] === 17000, 'hand 1A 22000 · 1B 5000 · 9 17000, engine ' + JSON.stringify(now));
      return JSON.stringify(now);
    });
  }
  finish('au-pin-sit-proof-' + PHASE, process.env.PROOF_JSON);
})();
