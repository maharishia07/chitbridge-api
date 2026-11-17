/**
 * tests/rail146m-payment-cost-blind.test.cjs — RAIL-146m: a payment to a SUPPLIER never tells a cost-blind co-assist what the shop owes or what its bills cost.
 *
 * OWNS      the proof of lib/dues-view R7 (blindPayment) and of its doors in routes/books.js: POST /payments/preview · POST /payments (outcome, allocation,
 *           advice) · its 409 ALREADY_PAID · POST /payments/:id/propose · GET /payments/:id/advice. Each door × three readers (the owner, a co-assist WITH
 *           can_see_costs, a co-assist WITHOUT it) × a customer's payment (in) and a supplier's payment (out).
 *           ⭐ the owner and the cost-allowed co-assist answer BYTE FOR BYTE alike on every door and both sides (each reader replays the same steps in a
 *              fresh child process, so the ids line up); the blind co-assist answers byte for byte alike on a CUSTOMER's payment (R1) and, on a supplier's,
 *              the same keys at every depth with the money null, `cost_hidden: true`, and a whole-body scan with no figure, no planted amount and no ₹.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: routes/books.js over tests/support/books-harness.cjs (the in-memory books + the engines).
 * FLOW      child(reader) → enable · a sale bill to Ravi · a purchase bill from Anand → the five doors, in then out → JSON → the parent compares the readers
 * CARD      16-finance/collections
 *
 * Run: node tests/rail146m-payment-cost-blind.test.cjs
 */
'use strict';
const path = require('path');
let pass = 0,
  fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(110) + (ok ? '' : JSON.stringify(got).slice(0, 300) + '   want ' + JSON.stringify(want).slice(0, 200)));
};
/* the supplier's bill (₹42,425.00), what the shop pays (₹50,000), the advance left (₹7,575) — figures nothing else in the answer could carry */
const SUP_BILL = 4242500,
  SUP_PAY = 5000000,
  SUP_ADVANCE = SUP_PAY - SUP_BILL;
const SECRET_FIG = [SUP_BILL, SUP_PAY, SUP_ADVANCE].flatMap((n) => [String(n), (n / 100).toFixed(2), (n / 100).toLocaleString('en-IN')]);
const leaked = (raw) => SECRET_FIG.filter((s) => new RegExp('(^|[^0-9.,])' + s.replace(/[.,]/g, '\\$&') + '([^0-9]|$)').test(raw));
const MONEY_KEY = /(_minor$|^minor$|^total$|^price$|^amount$|^value$)/;
const moneyKeys = (v) => (v && typeof v === 'object' ? Object.keys(v).flatMap((k) => (MONEY_KEY.test(k) && typeof v[k] === 'number' ? [k] : moneyKeys(v[k]))) : []);
const noLeak = (label, body) => {
  const raw = JSON.stringify(body);
  t(label + ' | whole-body scan: no money key with a figure, no planted figure, no ₹', [moneyKeys(body), leaked(raw), /₹/.test(raw)], [[], [], false]);
};
/** every key path of an answer (list members merged), so two answers can be compared for SHAPE without their values */
const shape = (v, at) => (Array.isArray(v) ? v.flatMap((m) => shape(m, at + '[]')) : v && typeof v === 'object' ? Object.keys(v).flatMap((k) => [at + '.' + k].concat(shape(v[k], at + '.' + k))) : []);
const shapeOf = (v) => Array.from(new Set(shape(v, ''))).sort();

/* ── the child: ONE reader replays the same steps ─────────────────────────────────────────────────────────────────────────────── */
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
  app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0),
    port = srv.address().port;
  let attempts = 0;
  const q = (method, p, body) =>
    new Promise((done) => {
      const raw = body ? JSON.stringify(body) : '';
      const r = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw), 'Idempotency-Key': 'attempt-' + ++attempts /* FIN-63: each call its own attempt */ } }, (res) => {
        let got = '';
        res.on('data', (c) => (got += c));
        res.on('end', () => done({ status: res.statusCode, body: JSON.parse(got || '{}') }));
      });
      r.end(raw);
    });
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-10-30T06:00:00Z');
  const out = {};
  try {
    await q('POST', '/enable', {});
    await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-10-09', currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-00000000000e', source_ref: 'chit:e', by_rate: [{ rate: 0, taxable: 1180, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-01', currency: 'INR', party: ANAND, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:k', by_rate: [{ rate: 0, taxable: SUP_BILL / 100, cgst: 0, sgst: 0, igst: 0 }], paid: {}, round_off: 0 });
    if (reader !== 'owner') who.current = { identity_id: '55555555-5555-4555-8555-555555555555', identity_type: 'actor', parent_entity_id: SHOP, access_level: 'editor', display_name: 'Ramesh' };
    for (const [side, party, amount] of [['in', RAVI, 200000], ['out', ANAND, SUP_PAY]]) {
      const pay = { party_id: party, direction: side, currency: 'INR', mode: 'cash', amount_minor: amount, allocate: 'oldest_first' };
      const reads = [];
      const step = async (name, method, p, body) => {
        flagReads = 0;
        out[side + '.' + name] = await q(method, p, body);
        reads.push(flagReads);
      };
      await step('preview', 'POST', '/payments/preview', pay);
      await step('record', 'POST', '/payments', Object.assign({ received_at: '2026-10-30', client_ref: 'r146j-' + side, acknowledge: ['excess'] }, pay));
      const id = out[side + '.record'].body.payment && out[side + '.record'].body.payment.payment_id;
      await step('propose', 'POST', '/payments/' + id + '/propose', {});
      await step('advice', 'GET', '/payments/' + id + '/advice');
      await step('again', 'POST', '/payments', Object.assign({ received_at: '2026-10-30', client_ref: 'r146j-' + side + '-2' }, pay));
      out[side + '.reads'] = reads;
    }
  } finally {
    srv.close();
  }
  return out;
}

/* ── the parent: compare the readers ──────────────────────────────────────────────────────────────────────────────────────────── */
function partRule() {
  const DV = require('../lib/dues-view');
  console.log('\n== RAIL-146m part 1 · lib/dues-view R7, the rule ==\n');
  const owner = { payment_id: 'p', proposal: [{ against_ref: 'b', bill_no: 'PB-1', due_date: '2026-10-01', open_minor: SUP_BILL, due_minor: SUP_BILL, apply_minor: SUP_BILL, disputed: false }], open_minor: SUP_BILL, apply_minor: SUP_BILL, on_account_minor: SUP_ADVANCE, skipped: [], why: null };
  t('R1 | a customer payment comes back as it is (same reference)', DV.blindPayment('propose', owner, 'in') === owner, true);
  const blind = DV.blindPayment('propose', owner, 'out');
  t('R7 | a supplier payment keeps every key; the money is null; the bill names and dates stay', blind, { payment_id: 'p', proposal: [{ against_ref: 'b', bill_no: 'PB-1', due_date: '2026-10-01', open_minor: null, due_minor: null, apply_minor: null, disputed: false }], open_minor: null, apply_minor: null, on_account_minor: null, skipped: [], why: null, cost_hidden: true });
  t('R7 | the owner\'s object is not mutated', owner.open_minor, SUP_BILL);
  t('R7 | null stays null; a kind with no allowlist is refused (fail-closed), never passed', [DV.blindPayment('record', null, 'out'), (() => { try { DV.blindPayment('nope', {}, 'out'); return 'passed'; } catch (_) { return 'refused'; } })()], [null, 'refused']);
  const proto = JSON.parse('{"payment_id":"p","__proto__":{"open_minor":1},"constructor":"' + SUP_BILL + '"}');
  t('R7 | a key named like the prototype finds nothing to keep (Object.hasOwn on a spec without one)', DV.blindPayment('propose', proto, 'out').constructor, null);
  t('R7 | an object under a KEEP leaf is not passed through', DV.blindPayment('propose', { payment_id: { minor: SUP_BILL } }, 'out').payment_id, null);
}

function partDoors() {
  const { spawnSync } = require('child_process');
  const run = (reader) => {
    const r = spawnSync(process.execPath, [__filename, 'reader', reader], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('ANSWERS '));
    if (!line) console.log((r.stdout || '') + (r.stderr || ''));
    return line ? JSON.parse(line.slice(8)) : null;
  };
  console.log('\n== RAIL-146m part 2 · the payment doors × three readers × in and out ==\n');
  const owner = run('owner');
  if (!owner || owner.absent) return t('books engines present for the harness (' + (owner && owner.absent) + ')', 'absent', 'present');
  const allowed = run('allowed'),
    blind = run('blind'),
    closed = run('closed');
  const DOORS = ['preview', 'record', 'propose', 'advice', 'again'];
  t('owner | the supplier record is what the brief says leaked: words, settled figure, advance and balance', [owner['out.record'].status, owner['out.record'].body.outcome.balance_minor, owner['out.record'].body.outcome.applied_minor, /₹/.test(owner['out.record'].body.outcome.words)], [200, SUP_ADVANCE, SUP_BILL, true]);
  t('owner | the second supplier payment is a 409 ALREADY_PAID (same_again)', [owner['out.again'].status, owner['out.again'].body.code], [409, 'ALREADY_PAID']);
  t('owner | no marker anywhere, and can_see_costs is never read', [JSON.stringify(owner).includes('cost_hidden'), owner['in.reads'].concat(owner['out.reads'])], [false, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]);
  for (const side of ['in', 'out'])
    for (const door of DOORS) t('cost-allowed | ' + side + ' · ' + door + ': byte-identical to the owner', JSON.stringify(allowed[side + '.' + door]) === JSON.stringify(owner[side + '.' + door]), true);
  t('cost-allowed | a customer payment reads no flag; a supplier payment reads it ONCE per request', [allowed['in.reads'], allowed['out.reads']], [[0, 0, 0, 0, 0], [1, 1, 1, 1, 1]]);
  for (const door of DOORS) t('blind | in · ' + door + ': a customer payment is byte-identical to the owner (R1)', JSON.stringify(blind['in.' + door]) === JSON.stringify(owner['in.' + door]), true);
  t('blind | a customer payment reads no flag; a supplier payment reads it ONCE per request', [blind['in.reads'], blind['out.reads']], [[0, 0, 0, 0, 0], [1, 1, 1, 1, 1]]);
  for (const door of DOORS) {
    const mine = blind['out.' + door],
      theirs = owner['out.' + door];
    /* a refused advice verdict reads in the owner's own refusal shape ({ ok: false, why, say } · share: null — GET /payments/:id/advice documents both) */
    const same = (body) => shapeOf(body).filter((k) => !/cost_hidden$|\.may\.\w+\.(why|say)$|\.share\./.test(k));
    t('blind | out · ' + door + ': same status, the owner\'s keys at every depth (a refused advice verdict aside)', [mine.status, same(mine.body)], [theirs.status, same(theirs.body)]);
    t('blind | out · ' + door + ': cost_hidden at the root', mine.body.cost_hidden, true);
    noLeak('blind | out · ' + door, mine.body);
  }
  const rec = blind['out.record'].body;
  t('blind | out · record: the outcome keeps which bill was settled; every figure and sentence is null', rec.outcome, { words: null, settled: [{ against_ref: owner['out.record'].body.outcome.settled[0].against_ref, bill_no: null, amount_minor: null }], applied_minor: null, on_account_minor: null, balance_minor: null, balance_words: null });
  t('blind | out · record: the payment and its entry number stand; the allocation keeps its count', [rec.payment, rec.posted.entry_no, rec.allocation.items, rec.allocation.allocated_minor], [owner['out.record'].body.payment, owner['out.record'].body.posted.entry_no, owner['out.record'].body.allocation.items, null]);
  t('blind | out · record + advice: neither send nor share (the advice names the bill\'s figure)', [rec.advice.may.send_advice.why, rec.advice.may.share_advice.ok, rec.advice.words, rec.advice.share, blind['out.advice'].body.may.send_advice.why, blind['out.advice'].body.body], ['cost_blind', false, null, null, 'cost_blind', null]);
  const pre = blind['out.preview'].body;
  t('blind | out · preview: the bills to settle by number and date; nothing they cost, nothing left over', [pre.proposal.map((r) => [r.against_ref, r.due_date, r.open_minor, r.apply_minor]), pre.open_minor, pre.on_account_minor, pre.words], [owner['out.preview'].body.proposal.map((r) => [r.against_ref, r.due_date, null, null]), null, null, null]);
  t('blind | out · preview: the warning codes stand, their figures and words go', pre.warnings.map((w) => [w.code, w.over_minor, w.over_words, w.words]), owner['out.preview'].body.warnings.map((w) => [w.code, null, null, null]));
  const again = blind['out.again'].body;
  t('blind | out · 409: the title alone is said; the warnings keep their codes and entry numbers', [again.detail, again.message, again.warnings.map((w) => [w.code, w.entry_no, w.words])], [owner['out.again'].body.error, owner['out.again'].body.error, owner['out.again'].body.warnings.map((w) => [w.code, w.entry_no, null])]);
  t('fail-closed | no can_see_costs row: the supplier payment hides as for a blind reader (200, not a refusal)', [closed['out.record'].status, closed['out.record'].body.outcome.balance_minor, closed['out.record'].body.cost_hidden], [200, null, true]);
}

(async () => {
  if (process.argv[2] === 'reader') {
    const answers = await asReader(process.argv[3]);
    console.log('ANSWERS ' + JSON.stringify(answers));
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
