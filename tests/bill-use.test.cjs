/**
 * tests/bill-use.test.cjs — WHAT A BILL I RECEIVED IS FOR: resale · use · asset (Athi, 2026-10-01).
 *
 *   · the default comes from MY catalogue, line by line (the one matcher): a product I sell → resale, anything else → use
 *   · the buyer's choice beats it — per bill, and per line over the bill; changeable until accepted, never after
 *   · on acceptance (real tax-copy, real hooks, the in-memory ledger — no database):
 *       resale → purchase_bill (Dr Purchases 5000 + input GST · Cr Creditors · the seller)
 *       use    → expense (Dr Sundry expenses 6190 + input GST · Cr Creditors), and what was paid at the counter → payment_made
 *       mixed  → both, each its own source; asset → nothing posted, waiting with "An asset purchase needs the asset ledger…"
 *       a catalogue that cannot be read → nothing posted, waiting, named (never "all expense")
 *   · stock: a goods-in receipt against the bill moves stock only for its resale lines
 * Run: node tests/bill-use.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const IDS = {
  [SHOP]: { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', policy_flags: { price_includes_tax: 'no' } },
  [CUST]: { identity_id: CUST, gstn: '33BBBBB0000B1Z5', display_name: 'Chola Auto Care', country: 'IN', policy_flags: {} },
};
const CAT = { items: [{ name: 'Brake pad', variant: '', synonyms: ['brake shoe'] }], variantsOf: {} };
const PAD = { line_id: 'l1', particulars: 'Brake pad', quantity: 1, unit: 'piece', price: 100, total: 100, gst_rate: 18 };
const BROOM = { line_id: 'l2', particulars: 'Shop broom', quantity: 1, unit: 'piece', price: 50, total: 50, gst_rate: 12 };

(async () => {
  console.log('\n══ WHAT A BILL I RECEIVED IS FOR ══\n');
  const X = H.load();
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  for (const m of ['tax-copy', 'bill-use']) delete require.cache[require.resolve(path.join(H.API, 'lib', m))];
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const BU = require(path.join(H.API, 'lib', 'bill-use'));
  const K = require(path.join(H.API, 'lib', 'books-hooks'));

  /* ── the decision, pure ── */
  const copyOf = (lines, use, status) => ({ chit_id: 'x', sender_entity_id: SHOP, purpose: 'invoice', current_status: status || 'pending',
    business_json: Object.assign({ counter_bill: true, bill_no: 'C1/26-27/0050', till: { id: 'C1' } }, use ? { use } : {}), line_items: lines });
  const e1 = BU.effective(copyOf([PAD, BROOM]), CAT);
  eq('nothing chosen: a product my catalogue sells is resale, anything else is use', e1.lines.map((l) => [l.use, l.source]), [['resale', 'catalogue'], ['use', 'catalogue']]);
  eq('…a declared synonym counts as the catalogue\'s', BU.effective(copyOf([Object.assign({}, PAD, { particulars: 'brake shoe' })]), CAT).lines[0].use, 'resale');
  eq('the bill\'s choice beats the catalogue', BU.effective(copyOf([PAD, BROOM], { bill: 'use' }), CAT).lines.map((l) => l.use), ['use', 'use']);
  eq('…and a line\'s own choice beats the bill\'s', BU.effective(copyOf([PAD, BROOM], { bill: 'use', lines: { l1: 'resale' } }), CAT).lines.map((l) => [l.use, l.source]), [['resale', 'line'], ['use', 'bill']]);
  ok('every line chosen → the catalogue is not even read', !BU.needsCatalogue(copyOf([PAD, BROOM], { bill: 'asset' })) && BU.needsCatalogue(copyOf([PAD, BROOM], { lines: { l1: 'use' } })));
  eq('only the three words, only lines the bill has, and something must be said',
    [BU.validate({ use: 'gift' }, copyOf([PAD])).ok, BU.validate({ lines: { l9: 'use' } }, copyOf([PAD])).ok, BU.validate({}, copyOf([PAD])).ok, BU.validate({ lines: { l1: 'asset' } }, copyOf([PAD])).ok],
    [false, false, false, true]);

  /* ── set(): merge, and settled once accepted ── */
  let stored = null, wrote = [];
  const deps = (status, use) => ({ taxCopy: { copyOf: async () => copyOf([PAD, BROOM], use, status), billReceived: TC.billReceived },
    withEntity: async (e, fn) => fn({ query: async (t, p) => { wrote.push([t, p]); stored = JSON.parse(p[0]); return { rows: [] }; } }) });
  BU.catalogueOf = async () => CAT;
  const s1 = await BU.set(CUST, 'x', { lines: { l2: 'asset' } }, { name: 'Ravi' }, deps('pending', { bill: 'use' }));
  ok('a line choice is MERGED with the bill\'s (merge-patch on business_json.use, one UPDATE of my own copy)',
    s1.ok && stored.bill === 'use' && stored.lines.l2 === 'asset' && wrote.length === 1 && /COALESCE\(business_json, '\{\}'::jsonb\) \|\| jsonb_build_object\('use'/.test(wrote[0][0]) && wrote[0][1][2] === CUST,
    JSON.stringify([s1.ok, stored, wrote.map((w) => w[1])]));
  eq('…and answers what each line will now post as', s1.effective.lines.map((l) => l.use), ['use', 'asset']);
  wrote = [];
  const s2 = await BU.set(CUST, 'x', { use: 'resale' }, null, deps('accepted'));
  ok('once ACCEPTED it is settled: 409, nothing written', !s2.ok && s2.status === 409 && wrote.length === 0, JSON.stringify(s2));
  const s3 = await BU.set(SHOP, 'x', { use: 'resale' }, null, { taxCopy: { copyOf: async () => copyOf([PAD]), billReceived: TC.billReceived }, withEntity: deps().withEntity });
  ok('the SELLER cannot say what the buyer\'s goods are for (not a bill they received): 409', !s3.ok && s3.status === 409, JSON.stringify(s3));

  /* ── the posting, on acceptance ── */
  if (!X.src.dir) { console.log('   SKIP the posting checks: ' + X.src.why); }
  else {
    const COPIES = {};
    const recips = [{ entity_id: SHOP, role: 'sender' }, { entity_id: SHOP, role: 'receiver' }, { entity_id: CUST, role: 'receiver' }];
    const bill = (id, lines, parts, use) => { COPIES[id] = { chit_id: id, sender_entity_id: SHOP, all_recipients: recips, purpose: 'invoice', current_status: 'accepted',
      business_json: Object.assign({ counter_bill: true, customer: { name: 'Chola Auto Care', identity_id: CUST, entity_id: CUST }, till: { id: 'C1' }, bill_no: 'B/' + id,
        billed_at: '2026-10-01T05:00:00.000Z', payment: { parts } }, use ? { use } : {}),
      summary_json: {}, sent_at: '2026-10-01T05:00:01.000Z', created_at: '2026-10-01T05:00:01.000Z', line_items: lines, currency_code: 'INR' }; };
    TC.copyOf = async (chit_id) => COPIES[chit_id] || null;
    await X.store.saveSetting(X.db, CUST, { enabled: true }); await X.B.enable(X.db, CUST, { by: CUST, today: '2026-10-01' }); K.forget(CUST);
    X.T.parties.push({ owner: CUST, party_id: SHOP, name: 'Mayur Traders', supplier: true, credit_days: 15 });
    const ent = (src) => X.T.entries.filter((x) => x.entity_id === CUST && x.source_ref === src);
    const lines = (en) => en ? X.T.lines.filter((l) => l.entry_id === en.entry_id).map((l) => [l.code, l.dr_minor, l.cr_minor]) : [];
    const has = (ls, row) => ls.some((l) => JSON.stringify(l) === JSON.stringify(row));

    bill('r1', [PAD], [{ how: 'On credit', amount: 118 }]);
    const r1 = await K.afterChit(CUST, 'r1', CUST);
    const l1 = lines(ent('chit:r1')[0]);
    ok('RESALE (my catalogue sells it): purchase_bill — Dr Purchases 5000 100 + input GST 9 + 9 · Cr Creditors 118',
      ent('chit:r1')[0] && ent('chit:r1')[0].event_type === 'purchase_bill' && has(l1, ['5000', 10000, 0]) && has(l1, ['2100', 0, 11800]), JSON.stringify([r1, l1]));

    bill('u1', [BROOM], [{ how: 'On credit', amount: 56 }]);
    const u1 = await K.afterChit(CUST, 'u1', CUST);
    const lu = lines(ent('chit:u1')[0]);
    ok('USE (not in my catalogue): expense — Dr Sundry expenses 6190 50 + input GST 3 + 3 · Cr Creditors 56',
      ent('chit:u1')[0] && ent('chit:u1')[0].event_type === 'expense' && has(lu, ['6190', 5000, 0]) && lu.filter((l) => l[1] === 300).length === 2 && has(lu, ['2100', 0, 5600]), JSON.stringify([u1, lu]));

    bill('m1', [PAD, BROOM], [{ how: 'On credit', amount: 174 }]);
    const m1 = await K.afterChit(CUST, 'm1', CUST);
    const lmP = lines(ent('chit:m1')[0]), lmU = lines(ent('chit:m1:use')[0]);
    ok('MIXED: the pad is a purchase (chit:m1), the broom an expense (chit:m1:use) — Creditors 118 + 56',
      ent('chit:m1')[0] && ent('chit:m1')[0].event_type === 'purchase_bill' && ent('chit:m1:use')[0] && ent('chit:m1:use')[0].event_type === 'expense'
      && has(lmP, ['2100', 0, 11800]) && has(lmU, ['2100', 0, 5600]), JSON.stringify([m1, lmP, lmU]));
    const m2 = await K.afterChit(CUST, 'm1', CUST);
    ok('…fired again (Intake and goods-in): a duplicate, nothing posts twice', m2.duplicate === true && ent('chit:m1').length === 1 && ent('chit:m1:use').length === 1, JSON.stringify(m2));

    bill('o1', [PAD, BROOM], [{ how: 'On credit', amount: 174 }], { lines: { l1: 'use' } });
    await K.afterChit(CUST, 'o1', CUST);
    const lo = lines(ent('chit:o1')[0]);
    ok('a per-line OVERRIDE (the pad marked "for the shop"): both lines are one expense, 6190 150 + input GST', ent('chit:o1')[0] && ent('chit:o1')[0].event_type === 'expense'
      && has(lo, ['6190', 15000, 0]) && has(lo, ['2100', 0, 17400]) && !ent('chit:o1:use').length, JSON.stringify(lo));

    bill('c1', [BROOM], [{ how: 'Cash', amount: 56 }], { bill: 'use' });
    const c1 = await K.afterChit(CUST, 'c1', CUST);
    const lc = lines(ent('chit:c1')[0]), lp = lines(ent('chit:c1:paid:cash')[0]);
    ok('USE paid in cash at the counter: the expense on the supplier, then payment_made Dr Creditors · Cr Cash 56 — nothing left owing',
      ent('chit:c1')[0] && ent('chit:c1:paid:cash')[0] && ent('chit:c1:paid:cash')[0].event_type === 'payment_made' && has(lp, ['2100', 5600, 0]) && lp.some((l) => l[2] === 5600 && l[0] !== '2100'),
      JSON.stringify([c1, lc, lp]));

    bill('a1', [PAD], [{ how: 'On credit', amount: 118 }], { bill: 'asset' });
    const a1 = await K.afterChit(CUST, 'a1', CUST);
    const wa = X.T.outbox.filter((o) => o.entity_id === CUST && o.source_chit_id === 'a1' && !o.done_at)[0];
    ok('ASSET: nothing posted; it waits, named: "An asset purchase needs the asset ledger — not posted yet (bill B/a1 from Mayur Traders)."',
      a1.queued && !ent('chit:a1').length && wa && wa.why === 'An asset purchase needs the asset ledger — not posted yet (bill B/a1 from Mayur Traders).', JSON.stringify([a1, wa && wa.why]));

    BU.catalogueOf = async () => { throw new Error('connection reset'); };
    bill('f1', [BROOM], [{ how: 'On credit', amount: 56 }]);
    const f1 = await K.afterChit(CUST, 'f1', CUST);
    ok('a catalogue that cannot be READ: nothing posted, it waits and says why (never "all expense")', f1.queued && /Could not read your catalogue/.test(f1.why) && !ent('chit:f1').length, JSON.stringify(f1));
    BU.catalogueOf = async () => CAT;
    COPIES.p1 = Object.assign({}, COPIES.r1, { chit_id: 'p1', current_status: 'pending' });
    let reads = 0; const c0 = BU.catalogueOf; BU.catalogueOf = async () => { reads++; return c0(); };
    await K.afterChit(CUST, 'p1', null);
    ok('before acceptance the catalogue is not read at all (the bill only waits)', reads === 0, 'reads ' + reads);
    BU.catalogueOf = c0;
  }

  /* ── stock: only resale lines go on the shelf ── */
  const SF = require(path.join(H.API, 'lib', 'stock-from-chit'));
  const receipt = { chit_id: 'g1', purpose: 'receipt', business_json: { doc: 'receipt', doc_no: 'GRN/1', against: { chit_id: 'm9' } },
    line_items: [{ particulars: 'Brake pad', quantity: 1, unit: 'piece', price: 100, item_data: { item_id: 'i-pad', line_id: 'l1' } },
                 { particulars: 'Shop broom', quantity: 1, unit: 'piece', price: 50, item_data: { item_id: 'i-broom', line_id: 'l2' } }] };
  eq('a receipt with no choice behind it moves every line (unchanged)', SF.movementsFor(receipt).filter((m) => !m.skip).map((m) => m.item_id), ['i-pad', 'i-broom']);
  const we = (use) => async (e, fn) => fn({ query: async () => ({ rows: [{ use }] }) });
  const useOf = await SF.usesForReceipt(CUST, receipt, we({ lines: { l2: 'use' } }));
  const mv = SF.movementsFor(receipt, { useOf });
  eq('against a bill whose broom is "for the shop": only the pad moves; the broom is received, not stock', [mv.filter((m) => !m.skip).map((m) => m.item_id), mv.filter((m) => m.skip).map((m) => m.item_id)], [['i-pad'], ['i-broom']]);
  const useAll = await SF.usesForReceipt(CUST, receipt, we({ bill: 'asset' }));
  ok('…a bill that is an asset moves nothing, and says so', SF.movementsFor(receipt, { useOf: useAll }).every((m) => m.skip && /asset/.test(m.why)));
  ok('…nothing chosen on the bill → the receipt is what it was', (await SF.usesForReceipt(CUST, receipt, we(null))) === null);

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
