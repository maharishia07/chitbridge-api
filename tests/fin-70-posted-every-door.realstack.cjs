'use strict';
/**
 * tests/fin-70-posted-every-door.realstack.cjs — GET /api/books/bank/log `posted[]` lists a bank line already posted WHICHEVER DOOR posted it (l16-postedfix).
 *
 * owns: the proof the stand-in cannot give — the entries as Postgres stored them: POST /events keeps the bank ref as source_ref (manual:bank:<fp>-<n>), POST /payments keeps it on
 *   books_payment.client_ref and the entry's source_ref is pay:<payment_id>. The statement page matches posted[] on bank:<fp>-<n>, so all must be listed (it showed 5 of 7 done on a re-run).
 * FLOW  fresh AU shop (GST regular, AUD), books on, one customer, one supplier → one line through each door, then the read.
 *   PD-1  events (expense) · payments IN (receipt on account) · payments OUT (supplier) → posted[] holds bank:<fp>-1, -2, -3, each once, with entry_no, posting_date, made_at, made_by (the shape: a22fd994 added by_name + by_firm (and doc_date) for the adviser's person and firm; the rest unchanged)
 *   PD-2  a replay of each client_ref answers duplicate:true and posted[] still lists each ONCE
 *   PD-3  a payment that is NOT from a bank line (no bank: client_ref) is not listed
 *   PD-4  the cross-check names the payment-door entries too (no accept mark yet): exceptions carry the same three entries
 * CARD 16-finance/bank-reconciliation-and-bank-rail
 * Run: API_BASE=http://127.0.0.1:<port> TRUTH_DB=<url> node tests/fin-70-posted-every-door.realstack.cjs   ⚠️ LOCAL STACK OR A NAMED SIT BOX ONLY, in docker (the harness refuses anything else).
 */
const H = require('./lib/truth-harness.cjs');
const { j, ok, kase, expect, freshShop, finish } = H;

const RUN = 'pd' + (Date.now() % 1e9).toString(36);
const FP = (RUN + '0'.repeat(24)).slice(0, 24).replace(/[^0-9a-f]/g, 'a');
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: true, number: '51824753556', scheme: 'regular' } };
const DAY = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
let shop = null, customer = null, supplier = null;
const call = (method, url, body) => j(url, { method, token: shop.token, body });
const ref = (n) => 'bank:' + FP + '-' + n;
const idOf = (r, key) => { const x = (r.b || {})[key] || {}; const id = x[key + '_identity_id'] || x[key + '_entity_id'] || x.party_id || x.id; if (!id) throw new Error('no ' + key + ' id in ' + JSON.stringify(r.b).slice(0, 300)); return id; };
const door = {
  events: () => call('POST', '/api/books/events', { kind: 'expense', class: 'bank_charges', date: DAY, amount_minor: 1500, narration: 'Account fee', paid_from: 'bank', client_ref: ref(1) }),
  in: () => call('POST', '/api/books/payments', { party_id: customer, direction: 'in', amount_minor: 165000, mode: 'bank', received_at: DAY, reference: ref(2), allocate: 'none', client_ref: ref(2) }),
  out: () => call('POST', '/api/books/payments', { party_id: supplier, direction: 'out', amount_minor: 88000, mode: 'bank', received_at: DAY, reference: ref(3), allocate: 'none', client_ref: ref(3) })
};
const log = async () => (await call('GET', '/api/books/bank/log?account=bank')).b;

(async () => {
  console.log('\n══ FIN-70 · posted[] from every door · ' + RUN + ' ══\n');
  shop = await freshShop(RUN, 'Posted doors', AU);
  ok(await call('POST', '/api/books/enable'), 'books on');
  customer = idOf(ok(await call('POST', '/api/relationships/customers', { name: 'Brown Electrical' }), 'customer'), 'customer');
  supplier = idOf(ok(await call('POST', '/api/relationships/suppliers', { name: 'Jones Plumbing Supplies' }), 'supplier'), 'supplier');

  await kase('PD-1', 'one line through events, payments-in and payments-out: posted[] lists all three, shape unchanged', async () => {
    for (const name of ['events', 'in', 'out']) { const r = await door[name](); expect(r.status === 200 && r.b.ok, name + ' ' + JSON.stringify([r.status, r.b])); }
    const posted = (await log()).posted || [];
    const refs = posted.map((p) => p.ref).sort();
    expect(JSON.stringify(refs) === JSON.stringify([ref(1), ref(2), ref(3)]), 'posted refs ' + JSON.stringify(refs));
    for (const p of posted) expect(JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['by_firm', 'by_name', 'doc_date', 'entry_no', 'made_at', 'made_by', 'posting_date', 'ref']) && p.entry_no && p.posting_date === DAY, 'shape ' + JSON.stringify(p));
    return refs.join(' ');
  });
  await kase('PD-2', 'a replay of each client_ref answers duplicate:true; posted[] lists each once', async () => {
    for (const name of ['events', 'in', 'out']) { const r = await door[name](); expect(r.status === 200 && (r.b.duplicate === true || (r.b.payment && r.b.payment.duplicate === true)), name + ' ' + JSON.stringify([r.status, r.b])); }
    const n = ((await log()).posted || []).length;
    expect(n === 3, 'posted ' + n);
    return 'posted ' + n;
  });
  await kase('PD-3', 'a payment with no bank ref is not listed', async () => {
    const r = await call('POST', '/api/books/payments', { party_id: customer, direction: 'in', amount_minor: 5000, mode: 'bank', received_at: DAY, allocate: 'none', client_ref: RUN + '-cash' });
    expect(r.status === 200 && r.b.ok, JSON.stringify([r.status, r.b]));
    const refs = ((await log()).posted || []).map((p) => p.ref);
    expect(refs.length === 3 && !refs.some((x) => x.includes(RUN + '-cash')), 'posted ' + JSON.stringify(refs));
    return 'posted ' + refs.length;
  });
  await kase('PD-4', 'the cross-check names the payment-door entries as well (no accept mark yet)', async () => {
    const ex = (await log()).exceptions || [];
    expect(ex.length === 3 && ex.every((x) => x.code === 'POSTED_NOT_ACCEPTED' && x.fingerprint === FP), 'exceptions ' + JSON.stringify(ex).slice(0, 400));
    return 'exceptions ' + ex.length;
  });
  finish('fin-70-posted-every-door');
})().catch((err) => { console.error(err); process.exitCode = 1; });
