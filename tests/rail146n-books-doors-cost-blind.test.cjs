/**
 * tests/rail146n-books-doors-cost-blind.test.cjs — RAIL-146n: four more doors that carried the purchase side to a cost-blind co-assist (after RAIL-146m).
 *
 * OWNS      the proof of lib/dues-view R9 (blindBooks) and its doors in routes/books.js: GET /party/:id/statement · GET /ledger/:account · GET /cheques,
 *           and the 409 of a chit's Mark-paid (routes/chits payFailure → books.alreadyPaid, which has no body direction: the books' error carries it).
 *           Each door × four readers (the owner, a co-assist WITH can_see_costs, a co-assist WITHOUT it, and one with no can_see_costs row).
 *           ⭐ the owner and the cost-allowed co-assist answer BYTE FOR BYTE alike; the blind co-assist gets the same keys at every depth, the purchase money
 *              null, `cost_hidden: true`, and a whole-body scan with no planted figure and no ₹; a customer's side (a customer's statement, the debtors
 *              ledger, a Mark-paid on a sale) answers as the owner's, without the marker.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: routes/books.js over tests/support/books-harness.cjs (the in-memory books + the engines).
 * FLOW      child(reader) → enable · a sale bill to Ravi · a purchase bill from Anand · two cheques (in, out) → the doors → JSON → the parent compares
 * CARD      16-finance/collections
 *
 * Run: node tests/rail146n-books-doors-cost-blind.test.cjs
 */
'use strict';
const path = require('path');
let pass = 0,
  fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(100) + (ok ? '' : String(JSON.stringify(got)).slice(0, 300) + '   want ' + String(JSON.stringify(want)).slice(0, 200)));
};
/* the supplier's bill (₹42,425.00) and the cheque the shop wrote (₹31,000.00): figures nothing else in an answer could carry */
const SUP_BILL = 4242500,
  CHQ_OUT = 3100000;
const SECRET = [SUP_BILL, CHQ_OUT, SUP_BILL - CHQ_OUT].flatMap((n) => [String(n), (n / 100).toFixed(2), (n / 100).toLocaleString('en-IN')]);
const leaked = (raw) => SECRET.filter((s) => new RegExp('(^|[^0-9.,])' + s.replace(/[.,]/g, '\\$&') + '([^0-9]|$)').test(raw));
const noLeak = (label, body) => {
  const raw = JSON.stringify(body);
  t(label + ' | whole-body scan: no planted figure, no ₹', [leaked(raw), /₹/.test(raw)], [[], false]);
};
const shape = (v, at) => (Array.isArray(v) ? v.flatMap((m) => shape(m, at + '[]')) : v && typeof v === 'object' ? Object.keys(v).flatMap((k) => [at + '.' + k].concat(shape(v[k], at + '.' + k))) : []);
const shapeOf = (v) => Array.from(new Set(shape(v, ''))).sort();
const without = (v) => JSON.parse(JSON.stringify(v), (key, val) => (key === 'cost_hidden' ? undefined : val));
/* ids are minted per child process and may_set / why_not are the OWNER's switch (an actor is never the owner): neither is cost */
const plain = (v) => JSON.stringify(v).replace(/"payment_id":"[^"]*"/g, '"payment_id":"-"').replace(/"may_set":(true|false),"why_not":(null|"[^"]*")/g, '"may_set":"-","why_not":"-"');
const sameBytes = (first, second) => plain(first) === plain(second);

async function asReader(reader) {
  const http = require('http');
  const H = require('./support/books-harness.cjs');
  const SHOP = '11111111-1111-4111-8111-111111111111',
    RAVI = '77777777-7777-4777-8777-777777777777',
    ANAND = '88888888-8888-4888-8888-888888888888';
  const who = { current: { identity_id: SHOP, identity_type: 'entity' } };
  const auth = Object.assign((req, res, next) => ((req.identity = who.current), next()), { entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id, requireScope: () => (req, res, next) => next() });
  const X = H.load({ auth });
  if (!X.src.dir) return { absent: X.src.why };
  X.T.parties.push({ owner: SHOP, party_id: RAVI, party_no: 'P-00007', name: 'Ravi', customer: true });
  X.T.parties.push({ owner: SHOP, party_id: ANAND, party_no: 'P-00003', name: 'Anand Mills', supplier: true });
  let flagReads = 0;
  const realQuery = X.db.query;
  X.db.query = async (text, v) => {
    if (!/SELECT can_see_costs FROM identities/.test(String(text))) return realQuery(text, v);
    flagReads++;
    return { rows: reader === 'closed' ? [] : [{ can_see_costs: reader === 'allowed' }] };
  };
  const express = require('express'),
    app = express();
  app.use(express.json());
  const booksRouter = require(path.join(H.API, 'routes', 'books'));
  app.use('/api/books', booksRouter);
  /* the chit Mark-paid failure path: routes/chits payFailure hands the books' error to books.alreadyPaid with a body that has NO direction */
  app.post('/api/markpaid', auth, (req, res) =>
    booksRouter.alreadyPaid(
      res,
      Object.assign(new Error('You have already paid ₹42,425.00 against this bill.'), {
        code: 'ALREADY_PAID',
        status: 409,
        title: 'Already paid?',
        direction: req.query.dir,
        warnings: [{ code: 'same_again', entry_no: 'JV-1', over_minor: SUP_BILL, over_words: '₹42,425.00 more than is owed' }]
      })
    )
  );
  const srv = app.listen(0),
    port = srv.address().port;
  const q = (method, p, body, base) =>
    new Promise((done) => {
      const raw = body ? JSON.stringify(body) : '';
      const r = http.request({ host: '127.0.0.1', port, path: (base === undefined ? '/api/books' : base) + p, method, headers: { 'Idempotency-Key': 'k' + Math.random().toString(36).slice(2), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } }, (res) => {
        let got = '';
        res.on('data', (c) => (got += c));
        res.on('end', () => done({ status: res.statusCode, body: (() => { try { return JSON.parse(got || '{}'); } catch (_) { return { html: got.slice(0, 120), path: p }; } })() }));
      });
      r.end(raw);
    });
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-10-30T06:00:00Z');
  const out = {};
  try {
    await q('POST', '/enable', {});
    await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-10-09', currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-00000000000e', source_ref: 'chit:e', by_rate: [{ rate: 0, taxable: 1180, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-01', currency: 'INR', party: ANAND, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:k', by_rate: [{ rate: 0, taxable: SUP_BILL / 100, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
    out.seed = [
      (await q('POST', '/payments', { party_id: ANAND, direction: 'out', currency: 'INR', mode: 'cheque', cheque_no: '000123', cheque_date: '2026-10-29', amount_minor: CHQ_OUT, received_at: '2026-10-29', client_ref: 'n-out', allocate: 'oldest_first', acknowledge: ['excess'] })).status,
      (await q('POST', '/payments', { party_id: RAVI, direction: 'in', currency: 'INR', mode: 'cheque', cheque_no: '000456', cheque_date: '2026-10-29', amount_minor: 150000, received_at: '2026-10-29', client_ref: 'n-in', allocate: 'oldest_first', acknowledge: ['excess'] })).status
    ];
    if (reader !== 'owner') who.current = { identity_id: '55555555-5555-4555-8555-555555555555', identity_type: 'actor', parent_entity_id: SHOP, access_level: 'editor', display_name: 'Ramesh' };
    const reads = [];
    const step = async (name, method, p, body, base) => {
      flagReads = 0;
      out[name] = await q(method, p, body, base);
      reads.push(flagReads);
    };
    await step('statement.out', 'GET', '/party/' + ANAND + '/statement?from=2026-04-01&to=2026-10-30');
    await step('statement.in', 'GET', '/party/' + RAVI + '/statement?from=2026-04-01&to=2026-10-30');
    await step('ledger.creditors', 'GET', '/ledger/creditors?from=2026-04-01&to=2026-10-30');
    await step('ledger.debtors', 'GET', '/ledger/debtors?from=2026-04-01&to=2026-10-30');
    await step('ledger.creditors.paged', 'GET', '/ledger/creditors?from=2026-04-01&to=2026-10-30&limit=1');
    await step('cheques', 'GET', '/cheques?all=1');
    await step('markpaid.out', 'POST', '/markpaid?dir=out', {}, '/api');
    await step('markpaid.in', 'POST', '/markpaid?dir=in', {}, '/api');
    out.reads = reads;
    /* the books' own error carries the side (what payFailure relies on): the excess rule refuses a payment above what is owed, each way */
    const seen = [];
    const real = X.B.recordPayment;
    X.B.recordPayment = async (...args) => {
      try {
        return await real.apply(X.B, args);
      } catch (err) {
        if (err && err.code === 'ALREADY_PAID') seen.push(err.code + ':' + err.direction);
        throw err;
      }
    };
    for (const [party, direction] of [[ANAND, 'out'], [RAVI, 'in']])
      out['dup' + direction] = await q('POST', '/payments', { party_id: party, direction, currency: 'INR', mode: 'cash', amount_minor: 9000000, received_at: '2026-10-30', client_ref: 'w' + direction, allocate: 'oldest_first' });
    out.thrown = seen;
  } finally {
    srv.close();
  }
  return out;
}

function partRule() {
  const DV = require('../lib/dues-view');
  console.log('\n== RAIL-146n part 1 · lib/dues-view R9, the rule ==\n');
  if (typeof DV.blindBooks !== 'function') return t('R9 | lib/dues-view.blindBooks exists', typeof DV.blindBooks, 'function');
  const st = { opening_minor: 5, closing_minor: 6, lines: [{ what: 'x', dr_minor: 1, cr_minor: 0, running_minor: 1, unapplied_minor: null }] };
  t('R9 | a customer-only statement comes back as it is (same reference)', DV.blindBooks('statement', st, { roles: { customer: true, supplier: false } }) === st, true);
  t('R9 | a party on neither list hides (fail closed)', DV.blindBooks('statement', st, {}).closing_minor, null);
  t("R9 | the owner's object is not mutated", st.lines[0].dr_minor, 1);
  t('R9 | a sales account stands; a stock account hides', [DV.blindBooks('ledger', { opening_minor: 1, lines: [] }, { account: { role: 'debtors' } }).cost_hidden, DV.blindBooks('ledger', { opening_minor: 1, lines: [] }, { account: { role: 'stock', nature: 'asset' } }).cost_hidden], [undefined, true]);
  t('R9 | an unknown kind is refused (fail closed)', (() => { try { DV.blindBooks('nope', {}); return 'passed'; } catch (_) { return 'refused'; } })(), 'refused');
  t('R9 | null stays null', DV.blindBooks('cheques', null), null);
}

function partDoors() {
  const { spawnSync } = require('child_process');
  const run = (reader) => {
    const r = spawnSync(process.execPath, [__filename, 'reader', reader], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('ANSWERS '));
    if (!line) console.log((r.stdout || '') + (r.stderr || ''));
    return line ? JSON.parse(line.slice(8)) : null;
  };
  console.log('\n== RAIL-146n part 2 · the doors × the readers ==\n');
  const owner = run('owner');
  if (!owner || owner.absent) return t('books engines present for the harness (' + (owner && owner.absent) + ')', 'absent', 'present');
  const allowed = run('allowed'),
    blind = run('blind'),
    closed = run('closed');
  const DOORS = ['statement.out', 'statement.in', 'ledger.creditors', 'ledger.debtors', 'ledger.creditors.paged', 'cheques', 'markpaid.out', 'markpaid.in'];
  t('seed | both cheques recorded', owner.seed, [200, 200]);
  t('owner | the leak is real: the supplier statement, ledger and cheque carry figures', [owner['statement.out'].body.closing_minor !== null, owner['ledger.creditors'].body.closing_minor !== null, owner.cheques.body.cheques.some((c) => c.direction === 'out' && c.amount_minor === CHQ_OUT)], [true, true, true]);
  t('owner | the Mark-paid 409 says the figure', [owner['markpaid.out'].status, /42,425/.test(JSON.stringify(owner['markpaid.out'].body))], [409, true]);
  t("owner | the books' error carries the side", owner.thrown.filter((x, i, all) => all.indexOf(x) === i).sort(), ['ALREADY_PAID:in', 'ALREADY_PAID:out']);
  t('owner | no marker, no flag read', [JSON.stringify(owner).includes('cost_hidden'), owner.reads], [false, [0, 0, 0, 0, 0, 0, 0, 0]]);
  for (const door of DOORS) t('cost-allowed | ' + door + ': byte-identical to the owner', sameBytes(allowed[door], owner[door]), true);
  for (const door of ['statement.in', 'ledger.debtors', 'markpaid.in']) t('blind | ' + door + ': the customer side is byte-identical to the owner', sameBytes(blind[door], owner[door]), true);
  const words = (k) => !/^\.(message|detail|error)/.test(k);
  for (const door of ['statement.out', 'ledger.creditors', 'ledger.creditors.paged', 'cheques', 'markpaid.out']) {
    const mine = blind[door],
      theirs = owner[door];
    t("blind | " + door + ": same status, the owner's keys at every depth", [mine.status, shapeOf(without(mine.body)).filter(words)], [theirs.status, shapeOf(theirs.body).filter(words)]);
    t('blind | ' + door + ': cost_hidden at the root', mine.body.cost_hidden, true);
    noLeak('blind | ' + door, mine.body);
    t('fail-closed | ' + door + ': no can_see_costs row hides as for a blind reader', [closed[door].body.cost_hidden, JSON.stringify(closed[door].body) === JSON.stringify(mine.body)], [true, true]);
  }
  const s = blind['statement.out'].body;
  t('blind | statement: dates, words, refs stand; every money cell is null', [s.lines.map((l) => [l.date, l.what, l.ref]), s.lines.every((l) => l.dr_minor === null && l.cr_minor === null && l.running_minor === null), s.opening_minor, s.closing_minor], [owner['statement.out'].body.lines.map((l) => [l.date, l.what, l.ref]), true, null, null]);
  const c = blind.cheques.body.cheques;
  t('blind | cheques: the cheque paid hides its amount; the one received keeps it; numbers and status stand', [c.map((x) => [x.cheque_no, x.status, x.direction, x.amount_minor === null]), c.find((x) => x.direction === 'in').cost_hidden], [owner.cheques.body.cheques.map((x) => [x.cheque_no, x.status, x.direction, x.direction === 'out']), undefined]);
  const l = blind['ledger.creditors.paged'].body;
  t('blind | ledger paged: the count stands, the page and range figures are null', [l.total, l.totals, l.page_opening_minor, l.closing_minor], [owner['ledger.creditors.paged'].body.total, { dr_minor: null, cr_minor: null }, null, null]);
  t('blind | Mark-paid 409: the title alone is said, the warning code and entry number stand, no figure', [blind['markpaid.out'].body.message, blind['markpaid.out'].body.warnings.map((w) => [w.code, w.entry_no, w.over_minor])], [owner['markpaid.out'].body.error, [['same_again', 'JV-1', null]]]);
  t('flag | each door reads can_see_costs at most ONCE', blind.reads.every((n) => n <= 1), true);
}

(async () => {
  if (process.argv[2] === 'reader') {
    console.log('ANSWERS ' + JSON.stringify(await asReader(process.argv[3])));
    process.exit(0);
  }
  partRule();
  partDoors();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
