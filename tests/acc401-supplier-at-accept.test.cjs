/**
 * acc401-supplier-at-accept.test.cjs — ACC-401 (27 Nov 2026): A SELLER CONNECTED ON THE RAIL IS LISTED AT THE BUYER'S ACCEPT AND THE BILL POSTS AT ONCE.
 * Hand figures (the AE first-invoice case, 5% tax on a 1,000.00 net bill; the in-memory books run the harness's pack, the AE pack run is the CI / sit-grund one):
 *   net 1,000.00 + tax 50.00 = 1,050.00 → buyer: Dr Purchases 1,000.00 · Dr Input tax 50.00 · Cr Suppliers 1,050.00 (named for the seller); Dr = Cr = 1,050.00.
 * Cases: accept posts at once (no waiting row, supplier listed 'transaction', one audit row, one history line) · a repeated accept makes no second row / line / entry · another party holds the same tax number
 * (not copied, NEVER merged, named in the note, supplier still listed, bill posts) · an unconnected sender still waits · a REMOVED supplier still waits · a retry never adds · a bill that parks after the add
 * leaves the supplier listed and the retry posts without adding again · waitsFor says nothing for the connected seller and the sentence for the others.
 * Run: node tests/acc401-supplier-at-accept.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const W = '11111111-1111-4111-8111-111111111111', V = '22222222-2222-4222-8222-222222222222';

(async () => {
  console.log('\n== ACC-401 · THE CONNECTED SELLER IS LISTED AT THE ACCEPT, THE BILL POSTS AT ONCE ==\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   (books engines not found: ' + X.src.why + ')'); console.log('\n  0 passed · 0 checks'); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const WT = require(path.join(H.API, 'lib', 'books-waits'));
  const PF = require(path.join(H.API, 'lib', 'party-fields'));
  const LI = require(path.join(H.API, 'lib', 'local-identity'));
  const BS = require(path.join(H.API, 'lib', 'chit-bill-step'));
  const inv = { currency: 'INR', ItemList: [{ GstRt: 5, AssAmt: 1000, CgstAmt: 25, SgstAmt: 25, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 1050 } };
  const bj = { bill_no: 'AE-INV-401', till: { id: 'C1' }, billed_at: '2026-11-21T05:00:00Z', customer: { name: 'Vee Traders', identity_id: V }, payment: { parts: [{ how: 'On credit', amount: 1050 }] }, terms: { credit_days: 15, due_date: '2026-12-06' } };
  const copy = { chit_id: 'ac1', purpose: 'order', sender_entity_id: W, currency_code: 'INR', current_status: 'accepted', business_json: bj };
  const entry = { sells: false, seller: { entity_id: W, LglNm: 'Wadi Supplies', Gstin: '27AAPFU0939F1ZV', Country: 'IN' }, buyer: { entity_id: V }, me: { entity_id: V }, invoice: inv };
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); const wasC = TC.copyOf, wasE = TC.entryFor;
  TC.copyOf = async () => copy; TC.entryFor = async () => entry;
  for (const e of [W, V]) { await X.store.saveSetting(X.db, e, { enabled: true }); await X.B.enable(X.db, e, { by: e, today: '2026-11-21' }); K.forget(e); }

  /* a mini supplier list: the few statements supplier-list asks; everything else is the harness's store */
  const rows = []; /* { owner, id, hidden, via } */
  const dbQuery = async (text, v) => {
    if (/AS hidden FROM supplier_list/.test(text)) return { rows: rows.filter((r) => r.owner === v[0] && r.id === v[1]).map((r) => ({ hidden: r.hidden })) };
    if (/SELECT 1 FROM supplier_list/.test(text)) return { rows: rows.filter((r) => r.owner === v[0] && r.id === v[1]).map(() => ({ one: 1 })) };
    if (/INSERT INTO supplier_list/.test(text)) { rows.push({ owner: v[0], id: v[1], hidden: false, via: v[7] }); X.T.parties.push({ owner: v[0], party_id: v[1], name: 'Wadi Supplies', supplier: true, credit_days: 15 }); return { rows: [] }; }
    if (/SELECT supplier_list_id FROM supplier_list/.test(text)) return { rows: rows.filter((r) => r.owner === v[0] && r.id === v[1]).map(() => ({ supplier_list_id: 'row-1' })) };
    return X.db.query(text, v);
  };
  X.dbStub.withEntity = async (e, fn) => fn(Object.assign(Object.create(X.db), { query: dbQuery }));
  let connected = true, taxHolder = null, steps = [], patched = [], nos = 0;
  LI.mayTrade = async () => (connected ? { ok: true } : { ok: false, why: 'local', say: 'not on ChitBridge' });
  PF.patch = async (h, o, side, id, body) => {
    if (taxHolder) { const e = new Error('Another party already has this tax id.'); e.code = 'DUPLICATE_PARTY'; e.holder = taxHolder; e.other = 'L-1'; throw e; }
    patched.push(body.tax_ids[0]); return { changed: ['tax_id:GSTIN'] };
  };
  PF.ensureNo = async () => { nos++; return 'P-1'; };
  BS.writeBillStep = async (e, c, step) => { steps.push(step); return 'written'; };
  const posted = () => X.T.entries.filter((x) => x.entity_id === V && x.source_ref === 'chit:ac1');
  const waits = () => X.T.outbox.filter((o) => o.entity_id === V && o.source_chit_id === 'ac1' && !o.done_at);
  const linesOf = () => X.T.lines.filter((l) => posted().some((p) => p.entry_id === l.entry_id));
  const sum = (ls, k) => ls.reduce((t, l) => t + l[k], 0);
  const audits = () => X.T.changes.filter((c) => c.field === 'added_from_invoice').length;
  const reset = () => {
    rows.length = 0; X.T.entries = X.T.entries.filter((x) => x.entity_id !== V); X.T.lines = X.T.lines.filter((l) => !posted().some((p) => p.entry_id === l.entry_id));
    X.T.outbox = X.T.outbox.filter((o) => o.entity_id !== V); X.T.parties = X.T.parties.filter((p) => p.owner !== V); X.T.changes.length = 0;
    steps = []; patched = []; nos = 0; taxHolder = null; connected = true; K.forget(V);
  };

  /* 1 · the accept of a connected seller */
  reset();
  eq('waitsFor says nothing for a connected seller who is not listed (the accept lists them and posts)', await WT.waitsFor(V, 'ac1'), null);
  const a1 = await K.postChit(V, 'ac1', { by: V });
  const vl = linesOf();
  ok('accept: posted at once, nothing waits', !!a1.ok && !a1.queued && posted().length === 1 && waits().length === 0, JSON.stringify(a1));
  eq('listed by the invoice (added_via transaction) under the seller\'s own key', [rows.length, rows[0] && rows[0].id, rows[0] && rows[0].via], [1, W, 'transaction']);
  eq('buyer books: Dr 1,050.00 = Cr 1,050.00; Cr Suppliers 1,050.00 for W; Dr Purchases 1,000.00; Dr Input tax 50.00',
    [sum(vl, 'dr_minor'), sum(vl, 'cr_minor'), vl.filter((l) => l.cr_minor === 105000 && l.party_id === W).length, vl.filter((l) => l.dr_minor === 100000).length, sum(vl.filter((l) => l.dr_minor > 0 && l.dr_minor !== 100000), 'dr_minor')],
    [105000, 105000, 1, 1, 5000]);
  eq('the tax number goes through the one writer; the party number is made', [patched, nos], [[{ scheme: 'GSTIN', value: '27AAPFU0939F1ZV' }], 1]);
  eq('one audit row and one history line "Supplier added from invoice"', [audits(), steps.map((s) => s.label)], [1, ['Supplier added from invoice']]);

  /* 2 · a repeated accept */
  const a2 = await K.postChit(V, 'ac1', { by: V });
  eq('a repeated accept: duplicate; still one entry, one supplier row, one audit row, one history line', [a2.duplicate === true, posted().length, rows.length, audits(), steps.length], [true, 1, 1, 1, 1]);

  /* 3 · another party already holds the same tax number */
  reset(); taxHolder = 'Wadi Trading (typed)';
  const a3 = await K.postChit(V, 'ac1', { by: V });
  ok('same tax number held by another party: the bill posts and the seller is listed once', !!a3.ok && posted().length === 1 && rows.length === 1, JSON.stringify(a3));
  eq('the number is NOT written twice, nothing is merged, the holder is named in the note', [patched.length, !!(steps[0] && /Wadi Trading \(typed\) already has the same tax number/.test(steps[0].label))], [0, true]);

  /* 4 · a sender not connected on the rail still waits */
  reset(); connected = false;
  ok('waitsFor says the sentence for an unconnected sender', /is not on your supplier list/.test(String(await WT.waitsFor(V, 'ac1'))));
  const a4 = await K.postChit(V, 'ac1', { by: V });
  eq('unconnected sender: parked, nothing posted, not listed, no history line', [a4.queued, posted().length, rows.length, steps.length, waits().length], [true, 0, 0, 0, 1]);

  /* 5 · a removed supplier keeps waiting even when connected */
  reset(); rows.push({ owner: V, id: W, hidden: true, via: 'manual' });
  const a5 = await K.postChit(V, 'ac1', { by: V });
  eq('a supplier the owner removed is NOT brought back by an invoice: it waits', [a5.queued, posted().length, rows.length, steps.length], [true, 0, 1, 0]);

  /* 6 · a retry never adds */
  reset();
  const r = await K.postChit(V, 'ac1', { retry: true, by: V });
  eq('a retry (nightly sweep) never adds a supplier', [r.queued, rows.length, steps.length], [true, 0, 0]);

  /* 7 · the bill parks AFTER the add: the supplier stays listed, the retry posts without adding again */
  reset();
  const real = X.B.postEntry; let fail1 = true;
  X.B.postEntry = async (...a) => { if (fail1) { fail1 = false; throw new Error('no rate for the day'); } return real.apply(X.B, a); };
  const a7 = await K.postChit(V, 'ac1', { by: V });
  eq('post fails after the add: supplier stays listed, bill parked, one audit row', [rows.length, !!a7.queued, posted().length, audits()], [1, true, 0, 1]);
  const r7 = await K.retryOutbox(V, 10);
  eq('the retry posts once and adds nothing again', [r7.posted, posted().length, rows.length, steps.length], [1, 1, 1, 1]);
  X.B.postEntry = real;

  TC.copyOf = wasC; TC.entryFor = wasE;
  console.log('\n  ' + (fail ? 'FAILED ' : 'ok ') + pass + ' passed · ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
