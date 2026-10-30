/**
 * tests/rail146i-dues-cost-blind.test.cjs — RAIL-146i: a party's supplier-side balance (what the shop owes) never reaches a cost-blind co-assist.
 *
 * OWNS      the proof of lib/dues-view (finance's rule R1-R6, design C:/dev/docs/16-finance/DESIGN-RAIL-146i-dues-cost-blind.md) and of its three doors:
 *           GET /api/crm/parties and /parties/:id (lib/crm list · one) and GET /api/books/dues. A customer's balance stays; a supplier's or a both-sides
 *           net is null + cost_hidden:true; the supplier credit limit goes; `overdue`, `oldest_due`, `open_side` and the alerts count stand; a ledger-off
 *           null stays null; the owner and a cost-allowed actor answer byte for byte as before; each route reads can_see_costs ONCE.
 * CALLED BY scripts/guards.cjs · CI. No database, no network. Part 1: the pure helper. Part 2 (child process): routes/crm.js + lib/crm over
 *           tests/support/crm-stub.cjs. Part 3 (child process): routes/books.js over tests/support/books-harness.cjs (the in-memory books + the engines).
 * FLOW      planted supplier figures → helper / route → whole-body scan (money keys with a figure, planted figures, ₹) on every purchase-side row
 * CARD      16-finance/collections
 *
 * Run: node tests/rail146i-dues-cost-blind.test.cjs
 */
'use strict';
const path = require('path');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(104) + (ok ? '' : JSON.stringify(got).slice(0, 300) + '   want ' + JSON.stringify(want).slice(0, 200)));
};
/* purchase figures no other field could carry (minor units) */
const SECRET = { sup_balance: -4242500, both_sup: -3131250, sup_limit: 7777700, sup_disputed: -1515100 };
const SECRET_FIG = Object.values(SECRET).flatMap((n) => [String(n), String(Math.abs(n)), (Math.abs(n) / 100).toFixed(2)]);
const leaked = (raw) => SECRET_FIG.filter((s) => new RegExp('(^|[^0-9.])' + s.replace('.', '\\.') + '([^0-9]|$)').test(raw));
const MONEY_KEY = /(_minor$|^minor$|^total$|^price$|^amount$|^value$)/;
/** every money-looking key holding a real number, at any depth (the customer row is priced on purpose: callers pass only what must be money-free) */
const moneyKeys = (v) => (v && typeof v === 'object' ? Object.keys(v).flatMap((k) => (MONEY_KEY.test(k) && typeof v[k] === 'number' ? [k] : moneyKeys(v[k]))) : []);
const noLeak = (label, body) => { const raw = JSON.stringify(body); t(label + ' | whole-body scan: no money key with a figure, no planted figure, no ₹', [moneyKeys(body), leaked(raw), /₹/.test(raw)], [[], [], false]); };

/* ── part 1 · the pure rule ───────────────────────────────────────────────────────────────────────────────────────────────── */
function partOne() {
  const DV = require('../lib/dues-view');
  console.log('\n== RAIL-146i part 1 · lib/dues-view, the rule ==\n');
  t('R1 | a customer-side dues object comes back as it is (same reference)', (() => { const d = { balance_minor: 118000, oldest_due: '2026-09-15', side: 'customer', open_side: true }; return DV.blindDues(d) === d; })(), true);
  t('R2 | a supplier-side figure: null + cost_hidden, the date and the flag stay', DV.blindDues({ balance_minor: SECRET.sup_balance, oldest_due: '2026-09-01', side: 'supplier', open_side: true, overdue: true }), { balance_minor: null, oldest_due: '2026-09-01', side: 'supplier', open_side: true, overdue: true, cost_hidden: true });
  t('R3 | a both-sides net hides (the customer half alone is a plausible wrong number)', DV.blindDues({ balance_minor: 500, oldest_due: null, side: 'both', open_side: true }), { balance_minor: null, oldest_due: null, side: 'both', open_side: true, cost_hidden: true });
  t('ledger off | null stays null, never an object', DV.blindDues(null), null);
  t('R5 | the supplier credit limit goes, credit_days stays; customer terms untouched', DV.blindTerms({ customer: { credit_days: 15, credit_limit_minor: 50000 }, supplier: { credit_days: 30, credit_limit_minor: SECRET.sup_limit } }), { customer: { credit_days: 15, credit_limit_minor: 50000 }, supplier: { credit_days: 30, credit_limit_minor: null, cost_hidden: true } });
  t('R5 | terms with no supplier side come back as they are (same reference)', (() => { const x = { customer: { credit_days: 15, credit_limit_minor: 50000 } }; return DV.blindTerms(x) === x; })(), true);
  t('hideParty | a party with dues null and no terms.supplier is unchanged', DV.hideParty({ party_id: 'p', dues: null, terms: {} }), { party_id: 'p', dues: null, terms: {} });
  t('hideParty | a party without a dues key gains none', DV.hideParty({ party_id: 'p' }), { party_id: 'p' });
  const page = { currency: 'INR', asOf: '2026-10-30', parties: [
    { party_id: 'b', name: 'Zed Both', side: 'both', balance_minor: SECRET.both_sup, disputed_minor: 0, buckets: { not_due: SECRET.both_sup }, oldest_due: '2026-10-01' },
    { party_id: 'c', name: 'Ravi', side: 'customer', balance_minor: 118000, disputed_minor: 0, buckets: { not_due: 118000 }, oldest_due: '2026-09-15' },
    { party_id: 's', name: 'Anand Mills', side: 'supplier', balance_minor: SECRET.sup_balance, disputed_minor: SECRET.sup_disputed, buckets: { not_due: 0, lt_6m: SECRET.sup_balance }, oldest_due: '2026-09-01', foreign: [{ currency: 'USD', balance_minor: -100000, carried_minor: -8325000 }] }
  ], total_minor: 118000 + SECRET.sup_balance + SECRET.both_sup };
  const blind = DV.blindDuesAnswer(page);
  t('/dues | priced rows first in the route\'s order, hidden rows after by name; total null + cost_hidden', [blind.parties.map((r) => r.party_id), blind.total_minor, blind.cost_hidden], [['c', 's', 'b'], null, true]);
  t('/dues | the customer row is untouched (same reference)', blind.parties[0] === page.parties[1], true);
  t('/dues | a hidden row keeps its shape: buckets keys with null values, foreign nulls, the date', blind.parties[1], { party_id: 's', name: 'Anand Mills', side: 'supplier', balance_minor: null, disputed_minor: null, buckets: { not_due: null, lt_6m: null }, oldest_due: '2026-09-01', foreign: [{ currency: 'USD', balance_minor: null, carried_minor: null }], cost_hidden: true });
  noLeak('/dues | every row but the customer one, and the total', { parties: blind.parties.slice(1), total_minor: blind.total_minor });
  const custOnly = { currency: 'INR', asOf: '2026-10-30', parties: [page.parties[1]], total_minor: 118000 };
  t('/dues | a page with no purchase side comes back as it was (same reference)', DV.blindDuesAnswer(custOnly) === custOnly, true);
  t('/dues | the owner\'s page object was not mutated', page.parties[2].balance_minor === SECRET.sup_balance && page.total_minor !== null, true);
}

/* ── part 2 · the CRM doors ─────────────────────────────────────────────────────────────────────────────────────────────── */
async function partCrm() {
  const { make, row } = require('./support/crm-stub.cjs');
  const stub = make(), D = stub.data;
  const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const CUS = P(2), SUP = P(3), BOTH = P(4);
  require('../lib/work-rows').unbilledByParty = async () => null; /* RAIL-146e's figure is its own test; here it stays off */
  console.log('\n== RAIL-146i part 2 · GET /api/crm/parties and /parties/:id ==\n');
  const cust = (id, name) => Object.assign(row({ party_id: id, display_name: name, user_id: name.toLowerCase(), party_no: 'P-' + id.slice(-4) }), { customer_type: 'entity', added_via: 'manual', txn_count: 2, last_txn_at: '2026-09-30T10:00:00Z', groups: [], segment: 'regular' });
  const sup = (id, name) => Object.assign(row({ party_id: id, display_name: name, user_id: name.toLowerCase(), party_no: 'P-' + id.slice(-4), entity_kind: 'business' }), { category: 'goods', preferred: false, added_via: 'manual' });
  D.cust = [cust(CUS, 'Ravi'), cust(BOTH, 'Mill')];
  D.sup = [sup(SUP, 'Anand'), sup(BOTH, 'Mill')];
  D.stored.customer[CUS] = { party_no: 'P-0002', balance_minor: 118000, oldest_due: '2026-01-15', credit_days: 15, credit_limit_minor: 50000 };
  D.stored.customer[BOTH] = { party_no: 'P-0004', balance_minor: 20000, oldest_due: null };
  D.stored.supplier[SUP] = { party_no: 'P-0003', balance_minor: SECRET.sup_balance, oldest_due: '2026-01-01', credit_days: 30, credit_limit_minor: SECRET.sup_limit };
  D.stored.supplier[BOTH] = { party_no: 'P-0004', balance_minor: SECRET.both_sup, oldest_due: '2026-02-01' };
  let flagReads = 0, flag = false;
  D.pre = async (sql) => { if (/SELECT can_see_costs FROM identities/.test(sql)) { flagReads++; return { rows: [{ can_see_costs: flag }] }; } return null; };
  const party = (r, id) => r.body.parties.find((p) => p.party_id === id);
  const money = (p) => ({ dues: p.dues, terms: p.terms });

  stub.as('E1');
  const ownerList = await stub.get('/parties'), ownerOne = await stub.get('/parties/' + SUP), ownerBoth = await stub.get('/parties/' + BOTH);
  t('owner | the supplier\'s balance, limit and the both-sides net are the real figures', [party(ownerList, SUP).dues.balance_minor, party(ownerList, SUP).terms.supplier.credit_limit_minor, party(ownerList, BOTH).dues.balance_minor, ownerOne.body.dues.balance_minor], [SECRET.sup_balance, SECRET.sup_limit, 20000 + SECRET.both_sup, SECRET.sup_balance]);
  t('owner | no marker anywhere, no can_see_costs read', [JSON.stringify([ownerList.body, ownerOne.body, ownerBoth.body]).includes('cost_hidden'), flagReads], [false, 0]);
  t('owner | the supplier\'s dues are late (the real figure, oldest due Jan) and the list counts it', [party(ownerList, SUP).dues.overdue, ownerList.body.alerts.dues_overdue], [true, 3]);

  stub.as('E1', { identity: { identity_id: 'A7', identity_type: 'actor', parent_entity_id: 'E1' } });
  flag = true; flagReads = 0;
  const okList = await stub.get('/parties'), okOne = await stub.get('/parties/' + SUP), okBoth = await stub.get('/parties/' + BOTH);
  /* `may.remove` is owner-only by design (crmMay), so the comparison is everything but `may` */
  const sansMay = (r) => JSON.stringify(Object.assign({}, r.body, { may: null }));
  t('cost-allowed actor | byte-identical to the owner on all three reads (everything but may)', [sansMay(okList) === sansMay(ownerList), sansMay(okOne) === sansMay(ownerOne), sansMay(okBoth) === sansMay(ownerBoth)], [true, true, true]);
  t('cost-allowed actor | can_see_costs read ONCE per request (three requests)', flagReads, 3);

  flag = false; flagReads = 0;
  const bList = await stub.get('/parties'), bOne = await stub.get('/parties/' + SUP), bBoth = await stub.get('/parties/' + BOTH), bCus = await stub.get('/parties/' + CUS);
  t('blind actor | 200 on all four reads, can_see_costs read ONCE per request', [bList.status, bOne.status, bBoth.status, bCus.status, flagReads], [200, 200, 200, 200, 4]);
  t('blind actor | list: the supplier row hides balance and limit; side, date, overdue and credit_days stay', money(party(bList, SUP)), { dues: { balance_minor: null, oldest_due: '2026-01-01', side: 'supplier', open_side: true, overdue: true, cost_hidden: true }, terms: { supplier: { credit_days: 30, credit_limit_minor: null, cost_hidden: true } } });
  t('blind actor | list: the both-sides party hides the net', [party(bList, BOTH).dues.balance_minor, party(bList, BOTH).dues.cost_hidden, party(bList, BOTH).dues.side], [null, true, 'both']);
  t('blind actor | list: the customer keeps balance, date and limit (R1), no marker', money(party(bList, CUS)), { dues: { balance_minor: 118000, oldest_due: '2026-01-15', side: 'customer', open_side: true, overdue: true }, terms: { customer: { credit_days: 15, credit_limit_minor: 50000 } } });
  t('blind actor | list: the late count is the owner\'s count (a count stands, RAIL-146 §3)', bList.body.alerts.dues_overdue, ownerList.body.alerts.dues_overdue);
  t('blind actor | record: the supplier hides balance and limit, the both-sides party hides the net, the customer is priced', [bOne.body.dues.balance_minor, bOne.body.dues.cost_hidden, bOne.body.terms.supplier.credit_limit_minor, bBoth.body.dues.balance_minor, bBoth.body.dues.cost_hidden, bCus.body.dues.balance_minor], [null, true, null, null, true, 118000]);
  noLeak('blind actor | list: every party but the customer', bList.body.parties.filter((p) => p.party_id !== CUS).map(money));
  noLeak('blind actor | record: the supplier and the both-sides party', [money(bOne.body), money(bBoth.body)]);
  t('blind actor | the record keeps the rest of the row (name, roles, may, relationship key)', [bOne.body.display_name, bOne.body.roles, typeof bOne.body.may, 'relationship' in bOne.body], ['Anand', { customer: false, supplier: true }, 'object', true]);

  D.ledgerOn = false; flag = false;
  const off = await stub.get('/parties/' + SUP);
  t('blind actor | ledger off: dues stays null (no object invented), terms.supplier limit still hidden', [off.body.dues, off.body.terms.supplier.credit_limit_minor], [null, null]);
  stub.close();
}

/* ── part 3 · the books door ─────────────────────────────────────────────────────────────────────────────────────────────── */
async function partBooks() {
  const http = require('http');
  const H = require('./support/books-harness.cjs');
  const SHOP = '11111111-1111-4111-8111-111111111111', RAVI = '77777777-7777-4777-8777-777777777777', ANAND = '88888888-8888-4888-8888-888888888888';
  const who = { current: { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' } };
  const auth = Object.assign((req, res, next) => { req.identity = who.current; next(); }, { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
  const X = H.load({ auth });
  console.log('\n== RAIL-146i part 3 · GET /api/books/dues ==\n');
  if (!X.src.dir) { t('books engines present for the harness (' + X.src.why + ')', 'absent', 'present'); return; }
  X.T.parties.push({ owner: SHOP, party_id: RAVI, party_no: 'P-00007', name: 'Ravi', customer: true, credit_days: 15, credit_limit_minor: null });
  X.T.parties.push({ owner: SHOP, party_id: ANAND, party_no: 'P-00003', name: 'Anand Mills', supplier: true, credit_days: 30 });
  let flagReads = 0, flag = false;
  const realQuery = X.db.query;
  X.db.query = async (text, v) => { if (/SELECT can_see_costs FROM identities/.test(String(text))) { flagReads++; return { rows: [{ can_see_costs: flag }] }; } return realQuery(text, v); };
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  const q = (p) => new Promise((done) => { http.get({ host: '127.0.0.1', port, path: '/api/books' + p }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); }); });
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); CLOCK.set('2026-10-30T06:00:00Z');
  try {
    await new Promise((done) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/books/enable', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => { res.resume(); res.on('end', done); }); r.end('{}'); });
    await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-10-09', currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-00000000000e', source_ref: 'chit:e', by_rate: [{ rate: 0, taxable: 1180, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-01', currency: 'INR', party: ANAND, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:k', by_rate: [{ rate: 0, taxable: 42425, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
    const rowOf = (r, id) => (r.body.parties || []).find((p) => p.party_id === id);

    who.current = { identity_id: SHOP, identity_type: 'entity' };
    const owner = await q('/dues'), ownerSup = await q('/dues?side=supplier'), ownerCus = await q('/dues?side=customer');
    t('owner | both sides priced: Ravi owes ₹1,180, the shop owes Anand ₹42,425; total is the net', [owner.status, rowOf(owner, RAVI).balance_minor, rowOf(owner, ANAND).balance_minor, owner.body.total_minor, flagReads], [200, 118000, -4242500, 118000 - 4242500, 0]);
    t('owner | no marker', JSON.stringify([owner.body, ownerSup.body]).includes('cost_hidden'), false);

    who.current = { identity_id: 'A7', identity_type: 'actor', parent_entity_id: SHOP };
    flag = true; flagReads = 0;
    const allowed = await q('/dues');
    t('cost-allowed actor | byte-identical to the owner; can_see_costs read ONCE', [JSON.stringify(allowed.body) === JSON.stringify(owner.body), flagReads], [true, 1]);

    flag = false; flagReads = 0;
    const blind = await q('/dues'), blindSup = await q('/dues?side=supplier'), blindCus = await q('/dues?side=customer');
    t('blind actor | 200; can_see_costs read ONCE per request', [blind.status, blindSup.status, blindCus.status, flagReads], [200, 200, 200, 3]);
    t('blind actor | Ravi stays priced and first; Anand hides; total null + cost_hidden', [blind.body.parties.map((p) => p.party_id), rowOf(blind, RAVI).balance_minor, rowOf(blind, ANAND).balance_minor, rowOf(blind, ANAND).cost_hidden, blind.body.total_minor, blind.body.cost_hidden], [[RAVI, ANAND], 118000, null, true, null, true]);
    t('blind actor | the hidden row keeps side, name, number and date; buckets have keys and no figures', [rowOf(blind, ANAND).side, rowOf(blind, ANAND).name, rowOf(blind, ANAND).party_no, typeof rowOf(blind, ANAND).oldest_due, Object.values(rowOf(blind, ANAND).buckets).every((v) => v === null)], ['supplier', 'Anand Mills', 'P-00003', 'string', true]);
    noLeak('blind actor | every row but Ravi, and the total', { parties: blind.body.parties.filter((p) => p.party_id !== RAVI), total_minor: blind.body.total_minor });
    noLeak('blind actor | ?side=supplier whole answer', blindSup.body);
    t('blind actor | ?side=customer is untouched (no purchase side on the page): byte-identical to the owner\'s', [JSON.stringify(blindCus.body) === JSON.stringify(ownerCus.body), ownerCus.body.total_minor], [true, 118000]);
    const fin = await q('/dues?finance=1&side=supplier');
    t('blind actor | ?finance=1 is still the owner\'s door (403 OWNER_ONLY, the sentence unchanged)', [fin.status, fin.body.code], [403, 'OWNER_ONLY']);
  } finally {
    srv.close();
  }
}

(async () => {
  const part = process.argv[2];
  if (part === 'crm') { await partCrm(); console.log('  ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  if (part === 'books') { await partBooks(); console.log('  ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }
  partOne();
  const { spawnSync } = require('child_process');
  for (const child of ['crm', 'books']) {
    const r = spawnSync(process.execPath, [__filename, child], { encoding: 'utf8' });
    process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
    const m = /(\d+) passed, (\d+) failed/.exec(r.stdout || '');
    if (!m) { fail++; console.log('  FAIL  part ' + child + ' did not report'); } else { pass += Number(m[1]); fail += Number(m[2]); }
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
