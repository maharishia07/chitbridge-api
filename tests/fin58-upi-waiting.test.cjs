/**
 * tests/fin58-upi-waiting.test.cjs — FIN-58: A UPI PART THE SHOP HAS NOT YET SEEN ARRIVE IS A RECEIVABLE, NOT CASH IN THE UPI ACCOUNT.
 *
 *   DECISIONS.md:137 "Until then it is a receivable from the walk-in." A counter bill's tender part with confirmed === false (UPI only) posts the bill as a
 *   sale_bill to the shop's ONE system party "UPI waiting": Dr Debtors[UPI waiting] / Cr Sales / Cr Output tax, paid = the confirmed parts only. The flip
 *   ("it arrived") goes through recordPayment: Dr UPI / Cr Debtors[UPI waiting] on the FLIP's date, key chitpay:<chit>:<ref>, and stamps parts[i].confirmed.
 *   A part with no `confirmed` field (the till sets none yet — CTR-156) or confirmed true behaves exactly as before.
 *
 * Hand figures (bill E, PM/LIFECYCLE-B3-CHECKS.md): 50.00 incl. 5% GST = Sales 47.62 + CGST 1.19 + SGST 1.19 = 5000 minor.
 * In-memory twin (tests/support/books-harness) — offline. The real-Postgres side (jsonb_set stamp, party_item reads) is for a SIT run.
 * Run: node tests/fin58-upi-waiting.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOP = '11111111-1111-4111-8111-111111111111', OTHER_SHOP = '99999999-9999-4999-8999-999999999999';
const CUST = '22222222-2222-4222-8222-222222222222';
const DAY = '2026-11-05', AT = DAY + 'T05:00:00Z', FLIP_DAY = '2026-11-07';
const INVOICE = { currency: 'INR', ItemList: [{ GstRt: 5, AssAmt: 47.62, CgstAmt: 1.19, SgstAmt: 1.19, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: 50 } };

(async () => {
  console.log('\n══ FIN-58 · an unconfirmed UPI part waits as a receivable ══\n');
  const who = { current: { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' } };
  const auth = Object.assign((req, res, next) => { req.identity = who.current; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
  const X = H.load({ auth });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  let UW = null;
  try { UW = require(path.join(H.API, 'lib', 'upi-waiting')); } catch (_) { /* red on main: the module is the fix */ }

  const world = { copy: null, entry: null };
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  TC.copyOf = async () => world.copy; TC.entryFor = async () => world.entry;
  X.T.identities.push({ identity_id: SHOP, gstn: '33ABCDE1234F1Z5', display_name: 'IN shop', country: 'IN', policy_flags: { gst_registration: 'regular' } });
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi', customer: true, credit_days: 10 });
  const SETTING = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };
  await X.store.saveSetting(X.db, SHOP, SETTING);
  await X.B.enable(X.db, SHOP, { by: SHOP, today: DAY }); K.forget(SHOP);

  const bill = (id, parts, customer) => ({ chit_id: id, purpose: 'order', currency_code: 'INR', created_at: AT, current_status: 'delivered', sender_entity_id: null,
    business_json: Object.assign({ bill_no: 'C1-' + id, till: { id: 'C1' }, billed_at: AT, payment: { parts } }, customer ? { customer } : {}) });
  const use = (copy) => { world.copy = copy; world.entry = { sells: true, invoice: INVOICE, me: { entity_id: SHOP } }; X.T.chits.push(Object.assign({ entity_id: SHOP }, copy)); };
  const entryOf = (id) => X.T.entries.find((e) => e.entity_id === SHOP && e.source_ref === 'chit:' + id);
  const linesOf = (e) => X.T.lines.filter((l) => l.entry_id === e.entry_id).map((l) => ({ role: (X.T.accounts.find((a) => a.account_id === l.account_id) || {}).role, dr: Number(l.dr_minor), cr: Number(l.cr_minor), party: l.party_id || null }));
  const drOf = (lines, role) => lines.filter((l) => l.role === role).reduce((total, l) => total + l.dr, 0);
  const crOf = (lines, role) => lines.filter((l) => l.role === role).reduce((total, l) => total + l.cr, 0);
  const classify = (copy, setting) => K.classify({ chit: copy, entry: { sells: true, invoice: INVOICE, me: { entity_id: SHOP } }, setting: setting || SETTING });

  /* ── (a) the posting ── */
  const WAIT = 'UPI';
  use(bill('w1', [{ how: WAIT, amount: 50, confirmed: false }]));
  const posted = await K.postChit(SHOP, 'w1', {});
  const e1 = entryOf('w1'), l1 = e1 ? linesOf(e1) : [];
  ok('(a) the waiting-UPI walk-in bill posts at once as a sale_bill (not left for the day close, not queued)', !!posted.ok && !!e1 && e1.event_type === 'sale_bill', JSON.stringify(posted));
  eq('(a) Dr Debtors 5000 / Cr Sales 4762 / Cr CGST 119 / Cr SGST 119, and NO Dr UPI', [drOf(l1, 'debtors'), crOf(l1, 'sales'), crOf(l1, 'output_cgst'), crOf(l1, 'output_sgst'), drOf(l1, 'upi')], [5000, 4762, 119, 119, 0]);
  const waitingId = UW ? UW.partyIdOf(SHOP) : null;
  ok('(a) the debtor line names the shop\'s system party "UPI waiting"', !!waitingId && l1.filter((l) => l.role === 'debtors').every((l) => l.party === waitingId), JSON.stringify(l1));

  /* ── (b) a part with no confirmed field, or confirmed true, is exactly what it was ── */
  const same = (parts) => JSON.stringify(classify(bill('b', parts)).kind === 'walkin' ? Object.assign({}, classify(bill('b', parts)), { bill: classify(bill('b', parts)).bill }) : classify(bill('b', parts)));
  for (const parts of [[{ how: 'UPI', amount: 50 }], [{ how: 'Cash', amount: 20 }, { how: 'UPI', amount: 30 }], [{ how: 'Card', amount: 50 }]]) {
    const plain = same(parts), withTrue = same(parts.map((p) => Object.assign({}, p, { confirmed: true })));
    eq('(b) ' + JSON.stringify(parts) + ' : confirmed absent == confirmed true', withTrue, plain);
  }
  eq('(b) a no-field UPI walk-in still waits for the day close', classify(bill('b2', [{ how: 'UPI', amount: 50 }])).kind, 'walkin');
  eq('(b) confirmed:false on CASH is not a waiting part (UPI only)', classify(bill('b3', [{ how: 'Cash', amount: 50, confirmed: false }])).kind, 'walkin');
  eq('(b) the waiting verdict is a post with paid = {} and the system party', (() => { const v = classify(bill('b4', [{ how: 'UPI', amount: 50, confirmed: false }])); return [v.kind, v.event && v.event.type, v.event && v.event.paid]; })(), ['post', 'sale_bill', {}]);

  const gb = classify(bill('g1', [{ how: 'UPI', amount: 50, confirmed: false }]), Object.assign({}, SETTING, { walkin_grain: 'bill' }));
  eq('(a) at BILL grain too: a sale_bill to the system party, not a walkin_day with Dr UPI (red on main)', [gb.kind, gb.event && gb.event.type, gb.event && gb.event.modes], ['post', 'sale_bill', undefined]);

  eq('(b) a QR-paid part with confirmed:false waits too (the SQL mirror reads it as UPI)', classify(bill('q1', [{ how: 'QR', amount: 50, confirmed: false }])).event.party, require(path.join(H.API, 'lib', 'upi-waiting')).partyIdOf(SHOP));
  const wp = require('fs').readFileSync(path.join(H.API, 'lib', 'books-store.js'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('const WAITING_PART'));
  ok('(b) WAITING_PART escapes its word edges as a template (two backslashes before y), like TENDER_FOUR', wp.indexOf('\\\\yqr\\\\y') > 0, wp);

  /* ── (c) split: cash 20 + waiting UPI 30 ── */
  use(bill('w2', [{ how: 'Cash', amount: 20 }, { how: 'UPI', amount: 30, confirmed: false }]));
  await K.postChit(SHOP, 'w2', {});
  const l2 = linesOf(entryOf('w2'));
  eq('(c) Dr Cash 2000 + Dr Debtors[UPI waiting] 3000 = 5000; no Dr UPI', [drOf(l2, 'cash'), drOf(l2, 'debtors'), drOf(l2, 'upi')], [2000, 3000, 0]);
  eq('(c) the day fold leaves the bill out (it posted on its own: nothing for the day close to add)', (() => { const v = classify(bill('w2', [{ how: 'Cash', amount: 20 }, { how: 'UPI', amount: 30, confirmed: false }])); return v.kind; })(), 'post');
  use(bill('w3', [{ how: 'On credit', amount: 20 }, { how: 'UPI', amount: 30, confirmed: false }]));
  eq('(c) credit + waiting with nobody named still asks "who owes it?" (queue, as before)', classify(world.copy).kind, 'queue');
  use(bill('w4', [{ how: 'UPI', amount: 50, confirmed: false }], { name: 'Ravi', party_id: CUST }));
  eq('(c) a NAMED customer keeps the receivable on themselves, not on the system party', classify(world.copy).event.party, CUST);

  /* ── (d) the flip ── */
  const flip = (ref, day, chit) => UW.confirmArrived(X.db, SHOP, { chit_id: chit || 'w2', part: 1, client_ref: ref, received_at: day, by: SHOP });
  if (!UW) ok('(d) lib/upi-waiting exists', false, 'module missing');
  else {
    const f1 = await flip('r1', FLIP_DAY);
    const pay = X.T.payments.filter((p) => p.client_ref === 'chitpay:w2:r1');
    const flipEntry = X.T.entries.find((e) => pay[0] && e.source_ref === 'pay:' + pay[0].payment_id);
    const lf = flipEntry ? linesOf(flipEntry) : [];
    eq('(d) one payment under key chitpay:w2:r1, mode upi, 3000, party = UPI waiting', [pay.length, pay[0] && pay[0].mode, pay[0] && Number(pay[0].amount_minor), pay[0] && pay[0].party_id], [1, 'upi', 3000, waitingId]);
    eq('(d) Dr UPI 3000 / Cr Debtors 3000 on the FLIP date', [drOf(lf, 'upi'), crOf(lf, 'debtors'), flipEntry && String(flipEntry.posting_date).slice(0, 10)], [3000, 3000, FLIP_DAY]);
    const chitW2 = X.T.chits.find((c) => c.chit_id === 'w2');
    ok('(d) parts[1].confirmed is stamped true, with confirmed_at; the cash part untouched', chitW2.business_json.payment.parts[1].confirmed === true && !!chitW2.business_json.payment.parts[1].confirmed_at && chitW2.business_json.payment.parts[0].confirmed === undefined, JSON.stringify(chitW2.business_json.payment));
    const again = await flip('r1', FLIP_DAY);
    eq('(d) the same client_ref again = the first payment, no second entry', [X.T.payments.filter((p) => p.client_ref === 'chitpay:w2:r1').length, !!f1 && !!again], [1, true]);
    let refused = null; try { await flip('r2', '2026-11-08'); } catch (e) { refused = e.message; }
    ok('(d) a DIFFERENT ref on an already-confirmed part is refused in words (no second receipt)', /already/i.test(String(refused)), String(refused));
    await flip('r3', '2026-11-09', 'w1').catch(() => null);
    use(bill('w5', [{ how: 'UPI', amount: 50, confirmed: false }])); await K.postChit(SHOP, 'w5', {});
    const f5 = await UW.confirmArrived(X.db, SHOP, { chit_id: 'w5', part: 0, client_ref: 'r5', received_at: '2026-11-09', by: SHOP });
    const e5 = X.T.entries.find((e) => f5.payment && e.source_ref === 'pay:' + f5.payment.payment_id);
    eq('(d) a different bill flipped on a different date lands on its own day', e5 && String(e5.posting_date).slice(0, 10), '2026-11-09');
    let notWaiting = null; try { await UW.confirmArrived(X.db, SHOP, { chit_id: 'w2', part: 0, client_ref: 'rx', received_at: FLIP_DAY, by: SHOP }); } catch (e) { notWaiting = e.message; }
    ok('(d) a part that was never waiting (the cash part) cannot be "arrived"', !!notWaiting, 'no refusal');
    eq('(d) the two shops\' system parties differ; one shop\'s is stable', [UW.partyIdOf(SHOP) === UW.partyIdOf(SHOP), UW.partyIdOf(SHOP) !== UW.partyIdOf(OTHER_SHOP), /^[0-9a-f-]{36}$/.test(UW.partyIdOf(SHOP))], [true, true, true]);
    ok('(d) the stranger rule knows the system party (no list row needed)', await X.B.partyOnList(X.db, SHOP, waitingId).then(() => true, () => false), 'refused');
    ok('(d) …and still refuses an unknown uuid', await X.B.partyOnList(X.db, SHOP, '55555555-5555-4555-8555-555555555555').then(() => false, () => true), 'accepted');
  }

  /* ── (e) dues: shown once in the ageing, never reminded, charged interest or limited ── */
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  const q = (p) => new Promise((done) => { http.get({ host: '127.0.0.1', port, path: '/api/books' + p }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); }); });
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-12-20T06:00:00Z');
  try {
    const got = await q('/dues?finance=1&side=customer');
    const rows = (got.body.parties || []).filter((p) => UW && p.party_id === waitingId);
    eq('(e) ONE ageing row for the system party, named "UPI waiting", flagged system', [got.status, rows.length, rows[0] && rows[0].name, rows[0] && rows[0].system], [200, 1, 'UPI waiting', 'upi_waiting']);
    ok('(e) it carries the balance (w5 flipped, w1 open 5000)', rows[0] && rows[0].balance_minor === 5000, JSON.stringify(rows[0]));
    ok('(e) no reminder row, no interest, no limit, not over a limit', rows[0] && rows[0].follow_up == null && rows[0].interest_minor == null && rows[0].credit_limit_minor == null && rows[0].over_limit === false, JSON.stringify(rows[0]));
    const tot = got.body.follow_up_total || {};
    eq('(e) the page\'s follow_up_total does not add it', Object.keys(tot).filter((k) => typeof tot[k] === 'number').reduce((total, k) => total + tot[k], 0), 0);
    eq('(e) the page total still counts it (one honest ageing)', got.body.total_minor, 5000);
  } finally { srv.close(); }

  /* ── (h) the flip's SQL names only columns the REAL tables have (SIT part 16: currency_code is on chit_detail, not chit_header; the twin hid it) ── */
  {
    const fs = require('fs'), baseline = fs.readFileSync(path.join(H.API, 'migrations', '000_baseline_2026-10-21.sql'), 'utf8');
    const columnsOf = (table) => {
      const start = baseline.indexOf('CREATE TABLE public.' + table + ' (');
      const body = baseline.slice(start, baseline.indexOf(');', start));
      return body.split(/\r?\n/).slice(1).map((line) => (line.trim().match(/^([a-z_]+) /) || [])[1]).filter((word) => word && !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK)$/i.test(word));
    };
    const cols = { h: columnsOf('chit_header'), d: columnsOf('chit_detail') };
    const storeFile = require.resolve(path.join(H.API, 'lib', 'books-store.js')), twin = require.cache[storeFile];
    delete require.cache[storeFile]; /* the harness put the in-memory twin there: this check needs the REAL statements */
    const real = require(storeFile), sent = [];
    require.cache[storeFile] = twin;
    const spy = { query: async (text) => { sent.push(text); return { rows: [] }; } };
    await real.chitForFlip(spy, SHOP, 'c1'); await real.stampConfirmed(spy, SHOP, 'c1', 0, '2026-11-07T00:00:00Z');
    const used = []; sent.forEach((text) => text.replace(/\b([hd])\.([a-z_]+)/g, (all, alias, col) => used.push([alias, col])));
    ok('(h) the baseline tables were read (chit_header and chit_detail have columns)', cols.h.length > 5 && cols.d.length > 3, JSON.stringify([cols.h.length, cols.d.length]));
    const missing = used.filter(([alias, col]) => cols[alias].indexOf(col) < 0).map((x) => x.join('.'));
    eq('(h) every h.* / d.* column in the flip statements exists in the baseline', missing, []);
    const bare = sent.join(' ').match(/UPDATE chit_header SET business_json/) ? ['business_json'] : [];
    ok('(h) the UPDATE sets a real chit_header column', bare.every((col) => cols.h.indexOf(col) >= 0), 'business_json missing');
  }

  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
