'use strict';
/**
 * tests/idem-scope-and-ref.realstack.cjs — API-COL-15 findings 3 and 2 on REAL Postgres, through the real api (idempotency pass, books router, grant front).
 *
 * owns: the proof that (IK-1) an adviser firm's key is scoped to the client it acts for, and (IK-2) a money write whose key is lost after the commit posts ONCE on the retry.
 * FLOW  IK-1  firm F, two shops A and B with adviser_posts grants. F posts the SAME bank-page event (same body, same client_ref, same Idempotency-Key) for A, then for B.
 *             Hand-computed: each shop's books hold ONE entry (Dr bank charges 1180 / Cr cash 1180 minor). Before the fix B was answered A's recorded reply (X-Idempotent-Replay: true) and B had NO entry.
 *       IK-2  owner of A posts Dr cash 10000 / Cr sales 10000 (INR 100.00) with an Idempotency-Key and NO client_ref. The key row is then dropped, as a 5xx after the commit drops it, and the SAME
 *             request is sent again. Hand-computed trial balance after BOTH sends: cash Dr 10000, sales Cr 10000, ONE entry with that narration (before the fix: two entries, 20000 each side).
 * Run (a SIT box or local; harness allow-list in tests/lib/run-target.cjs): API_BASE=http://127.0.0.1:3100 node tests/idem-scope-and-ref.realstack.cjs
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const D = require(process.env.FIRM_DOOR || '../firm-door.cjs') /* the docs repo's toolset/sitfull/firm-door.cjs: set FIRM_DOOR, or copy it beside the api root on a SIT box */;
const { DB, j, ok, kase, expect, freshShop, finish, API } = H;
const RUN = 'ik' + (Date.now() % 1e10).toString(36);
const raw = async (method, path, token, body, headers) => {
  const r = await fetch(API + path, { method, headers: Object.assign({ 'content-type': 'application/json', authorization: 'Bearer ' + token }, headers || {}), body: body ? JSON.stringify(body) : undefined });
  let b = {}; try { b = await r.json(); } catch (_) { /* no body */ }
  return { status: r.status, b, replay: r.headers.get('x-idempotent-replay') };
};
const client = (token) => ({ get: async (p) => { const r = await j(p, { token }); return { status: r.status, body: r.b }; }, post: async (p, body) => { const r = await j(p, { method: 'POST', token, body }); return { status: r.status, body: r.b }; } });

(async () => {
  console.log('\n══ API-COL-15 · key scope under X-Books-For + a lost key after commit · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const F = await freshShop(RUN + 'f', 'Firm', { tax: { registered: false } });
    const A = await freshShop(RUN + 'a', 'Client A', { tax: { registered: false } });
    const B = await freshShop(RUN + 'b', 'Client B', { tax: { registered: false } });
    for (const s of [A, B]) {
      ok(await j('/api/books/enable', { method: 'POST', token: s.token }), 'books on');
      const link = await D.connectFirm({ firm: client(F.token), shop: client(s.token), ask: 'firm', grant: { preset: 'adviser', posting: 'adviser_posts', purpose: 'idem proof' } });
      expect(link.ok, 'firm door ' + JSON.stringify(link.steps));
    }
    const entries = async (shop, like) => Number((await pg.query("SELECT count(*) FROM journal_entry WHERE entity_id = $1 AND narration LIKE $2", [shop.entity, like])).rows[0].count);

    await kase('IK-1', 'the same key and body for client B is not client A\'s answer: each shop gets its own entry', async () => {
      const key = 'ik1-' + RUN, ev = { kind: 'expense', date: '2026-11-10', amount: 11.8, narration: 'ik1 fee ' + RUN, client_ref: 'bank:ik1-' + RUN, class: 'bank_charges', paid_from: 'cash' };
      const hdr = (s) => ({ 'x-books-for': s.entity, 'x-books-role': 'adviser', 'idempotency-key': key });
      const a = await raw('POST', '/api/books/events', F.token, ev, hdr(A));
      expect(a.status === 200, 'firm for A: ' + a.status + ' ' + JSON.stringify(a.b).slice(0, 300));
      const b = await raw('POST', '/api/books/events', F.token, ev, hdr(B));
      expect(b.status === 200 && !b.replay, 'firm for B: status ' + b.status + ' replay=' + b.replay + ' ' + JSON.stringify(b.b).slice(0, 300));
      const na = await entries(A, 'ik1 fee%'), nb = await entries(B, 'ik1 fee%');
      expect(na === 1 && nb === 1, 'entries A=' + na + ' B=' + nb + ' (hand: 1 and 1)');
      return 'A=' + na + ' B=' + nb;
    });

    await kase('IK-2', 'a money write whose key is lost after the commit posts ONCE when retried (key only, no client_ref)', async () => {
      const acc = (await pg.query("SELECT code, role FROM ledger_account WHERE entity_id = $1", [A.entity])).rows;
      const cash = acc.find((r) => r.role === 'cash').code, sales = acc.find((r) => /sales|income/.test(r.role)).code;
      const key = 'ik2-' + RUN, narr = 'ik2 sale ' + RUN, body = { narration: narr, date: '2026-11-10', lines: [{ code: cash, dr_minor: 10000 }, { code: sales, cr_minor: 10000 }] };
      const first = await raw('POST', '/api/books/entries', A.token, body, { 'idempotency-key': key });
      expect(first.status === 200, 'first: ' + first.status + ' ' + JSON.stringify(first.b).slice(0, 300));
      await pg.query("DELETE FROM idempotency_key WHERE entity_id = $1 AND idem_key = $2", [A.entity, key]); /* what a 5xx after the commit leaves: the key is gone, the journal is not */
      const again = await raw('POST', '/api/books/entries', A.token, body, { 'idempotency-key': key });
      expect(again.status === 200, 'retry: ' + again.status + ' ' + JSON.stringify(again.b).slice(0, 300));
      const n = await entries(A, narr);
      const tb = (await pg.query("SELECT coalesce(sum(l.dr_minor),0) AS dr, coalesce(sum(l.cr_minor),0) AS cr FROM journal_entry e JOIN journal_line l USING (entry_id) WHERE e.entity_id = $1 AND e.narration = $2", [A.entity, narr])).rows[0];
      expect(n === 1 && Number(tb.dr) === 10000 && Number(tb.cr) === 10000, 'entries ' + n + ' dr ' + tb.dr + ' cr ' + tb.cr + ' (hand: 1 entry, 10000 each side)');
      return 'one entry, 10000/10000';
    });
  } finally { await pg.end(); }
  finish('idem-scope-and-ref', process.env.TRUTH_JSON);
})().catch((e) => { console.error('idem-scope-and-ref could not run: ' + e.message); process.exit(1); });
