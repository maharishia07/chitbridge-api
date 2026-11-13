/**
 * tests/rail146o-books-reports-cost-blind.test.cjs — RAIL-146o (batch B4, SEC-119 / SEC-150): the books' REPORT reads are cost-blind.
 *
 * OWNS      the proof that lib/dues-view.blindBooks is WIDENED (not a fifth guard, no new 403) with pl · trial_balance · bs · daybook, mounted through the one
 *           forBooksDoor in routes/books.js; SEC-119 (lib/cost.canRead spends no trip when middleware/auth already carries can_see_costs); SEC-150 (a co-assist's
 *           Idempotency-Key is its own: the owner's key replayed by a cost-blind editor does not return the owner's answer).
 *           Expected shapes are WRITTEN BY HAND below, not computed by the code under test.
 * NOT       POST /supplies/purchase: the web goods-in (public/app/cap-supplies.js supBuy) always sends `cost` (null when blank), so a key-presence 403 would break every
 *           blind clerk's purchase. No 403 is added; reported to the owner of the decision.
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * CARD      16-finance/collections
 *
 * Run: node tests/rail146o-books-reports-cost-blind.test.cjs
 */
'use strict';
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-for-auth-guards';
let pass = 0,
  fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(96) + (ok ? '' : String(JSON.stringify(got)).slice(0, 300) + '   want ' + String(JSON.stringify(want)).slice(0, 300)));
};

function partRule() {
  const DV = require('../lib/dues-view');
  console.log('\n== RAIL-146o part 1 · lib/dues-view.blindBooks, the four new kinds (hand-written expected) ==\n');
  const pl = { currency: 'INR', from: '2026-04-01', to: '2026-10-30', income: [{ code: '4000', name: 'Sales', amount_minor: 118000, line: 'Revenue' }], expense: [{ code: '5000', name: 'Purchases', amount_minor: 4242500, line: 'Cost' }], total_income_minor: 118000, total_expense_minor: 4242500, profit_minor: -4124500, by_line: { income: [{ label: 'Revenue', amount_minor: 118000, accounts: [{ code: '4000', amount_minor: 118000 }] }], expense: [] } };
  t('pl | every _minor at any depth is null, the words stand, cost_hidden', DV.blindBooks('pl', pl), {
    currency: 'INR', from: '2026-04-01', to: '2026-10-30',
    income: [{ code: '4000', name: 'Sales', amount_minor: null, line: 'Revenue' }], expense: [{ code: '5000', name: 'Purchases', amount_minor: null, line: 'Cost' }],
    total_income_minor: null, total_expense_minor: null, profit_minor: null,
    by_line: { income: [{ label: 'Revenue', amount_minor: null, accounts: [{ code: '4000', amount_minor: null }] }], expense: [] }, cost_hidden: true
  });
  t("pl | the owner's object is not mutated", pl.profit_minor, -4124500);
  t('trial_balance | rows and totals null, balanced stands', DV.blindBooks('trial_balance', { asOf: '2026-10-30', rows: [{ code: '1000', name: 'Cash', group: 'a', dr_minor: 5, cr_minor: 0 }], total_dr_minor: 5, total_cr_minor: 5, balanced: true }), {
    asOf: '2026-10-30', rows: [{ code: '1000', name: 'Cash', group: 'a', dr_minor: null, cr_minor: null }], total_dr_minor: null, total_cr_minor: null, balanced: true, cost_hidden: true
  });
  t('bs | schedule_iii heads and difference_minor null too', DV.blindBooks('bs', { asOf: 'x', assets: [{ amount_minor: 1 }], total_assets_minor: 1, balanced: true, schedule_iii: { assets: { heads: [{ line: 'a', total_minor: 1, ledgers: [{ amount_minor: 1 }] }], total_minor: 1 }, balanced: true, difference_minor: 0 } }), {
    asOf: 'x', assets: [{ amount_minor: null }], total_assets_minor: null, balanced: true, schedule_iii: { assets: { heads: [{ line: 'a', total_minor: null, ledgers: [{ amount_minor: null }] }], total_minor: null }, balanced: true, difference_minor: null }, cost_hidden: true
  });
  const day = {
    entries: [
      { entry_no: 'SB-1', event_type: 'sale_bill', lines: [{ code: '4000', dr_minor: 0, cr_minor: 1000, rate: 12 }] },
      { entry_no: 'PB-1', event_type: 'purchase_bill', lines: [{ code: '5000', dr_minor: 4242500, cr_minor: 0, rate: 12 }] },
      { entry_no: 'XX-1', event_type: 'a_new_kind', lines: [{ code: '1', dr_minor: 7, cr_minor: 0 }] }
    ], count: 3, totals: { dr_minor: 4242507, cr_minor: 1000 }
  };
  t('daybook | sales entry stands; purchase and unknown event types null (fail closed); totals null', DV.blindBooks('daybook', day), {
    entries: [
      { entry_no: 'SB-1', event_type: 'sale_bill', lines: [{ code: '4000', dr_minor: 0, cr_minor: 1000, rate: 12 }] },
      { entry_no: 'PB-1', event_type: 'purchase_bill', lines: [{ code: '5000', dr_minor: null, cr_minor: null, rate: 12 }] },
      { entry_no: 'XX-1', event_type: 'a_new_kind', lines: [{ code: '1', dr_minor: null, cr_minor: null }] }
    ], count: 3, totals: { dr_minor: null, cr_minor: null }, cost_hidden: true
  });
  t('daybook | a PAGED sales-only page still nulls the range totals', DV.blindBooks('daybook', { entries: [{ event_type: 'sale_bill', lines: [{ dr_minor: 1, cr_minor: 0 }] }], count: 1, totals: { dr_minor: 4242507, cr_minor: 4242507 } }).totals, { dr_minor: null, cr_minor: null });
  const todoRows = [{ kind: 'advices_to_send', count: 2, words: 'w', items: [{ payment_id: 'p1', direction: 'out', amount_minor: 3100000 }, { payment_id: 'p2', direction: 'in', amount_minor: 150000 }] }, { kind: 'months_not_locked', count: 1, words: 'm', items: [{ month: '2026-10' }] }];
  t('todo | the supplier payment advice loses its amount (hand-written), the receipt and the other rows stand', DV.blindBooks('todo', todoRows), [{ kind: 'advices_to_send', count: 2, words: 'w', items: [{ payment_id: 'p1', direction: 'out', amount_minor: null, cost_hidden: true }, { payment_id: 'p2', direction: 'in', amount_minor: 150000 }] }, todoRows[1]]);
  const gstRow = [{ kind: 'gst_due', count: 1, words: 'g', items: [{ fy: '2026-27', month: '2026-10', due: '2026-11-20', overdue: false, owed_minor: 777700 }] }];
  t('todo | the GST row owed_minor (output less input credit) goes null with cost_hidden on that item', DV.blindBooks('todo', gstRow), [{ kind: 'gst_due', count: 1, words: 'g', items: [{ fy: '2026-27', month: '2026-10', due: '2026-11-20', overdue: false, owed_minor: null, cost_hidden: true }] }]);
  t("todo | the owner's rows are not mutated", gstRow[0].items[0].owed_minor, 777700);
  const salesOnly = { entries: [{ event_type: 'sale_bill', lines: [{ dr_minor: 1, cr_minor: 0 }] }], count: 1 };
  t('daybook | a day of sales only comes back as it is (same reference)', DV.blindBooks('daybook', salesOnly) === salesOnly, true);
}

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
  const realQuery = X.db.query;
  X.db.query = async (text, v) => (/SELECT can_see_costs FROM identities/.test(String(text)) ? { rows: [{ can_see_costs: reader === 'allowed' }] } : realQuery(text, v));
  const express = require('express'),
    app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0),
    port = srv.address().port;
  const q = (method, p, body) =>
    new Promise((done) => {
      const raw = body ? JSON.stringify(body) : '';
      const r = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method, headers: { 'Idempotency-Key': 'k' + Math.random().toString(36).slice(2), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } }, (res) => {
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
    await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-10-09', currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-00000000000e', source_ref: 'chit:e', by_rate: [{ rate: 0, taxable: 118000, cgst: 0, sgst: 0, igst: 0 }] });
    await X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-10-09', currency: 'INR', party: ANAND, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:k', by_rate: [{ rate: 0, taxable: 4242500, cgst: 0, sgst: 0, igst: 0 }] });
    if (reader !== 'owner') who.current = { identity_id: '55555555-5555-4555-8555-555555555555', identity_type: 'actor', parent_entity_id: SHOP, access_level: 'editor', display_name: 'Ramesh' };
    out.pl = await q('GET', '/pl?from=2026-04-01&to=2026-10-30');
    out.tb = await q('GET', '/trial-balance?asOf=2026-10-30');
    out.bs = await q('GET', '/bs?asOf=2026-10-30');
    out.day = await q('GET', '/daybook?from=2026-10-09&to=2026-10-09');
    out.dayPaged = await q('GET', '/daybook?from=2026-10-09&to=2026-10-09&limit=1');
  } finally {
    srv.close();
  }
  return out;
}

function partDoors() {
  const { spawnSync } = require('child_process');
  const run = (reader) => {
    const r = spawnSync(process.execPath, [__filename, 'reader', reader], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('ANSWERS '));
    if (!line) console.log((r.stdout || '') + (r.stderr || ''));
    return line ? JSON.parse(line.slice(8)) : null;
  };
  console.log('\n== RAIL-146o part 2 · the doors x owner / cost-allowed / cost-blind ==\n');
  const owner = run('owner');
  if (!owner || owner.absent) return t('books engines present for the harness (' + (owner && owner.absent) + ')', 'absent', 'present');
  const allowed = run('allowed'),
    blind = run('blind');
  const moneyKeys = (v) => (Array.isArray(v) ? v.flatMap(moneyKeys) : v && typeof v === 'object' ? Object.keys(v).flatMap((k) => (/_minor$/.test(k) && v[k] !== null ? [k] : moneyKeys(v[k]))) : []);
  for (const door of ['pl', 'tb', 'bs']) {
    t('owner | ' + door + ': 200 and carries figures, no marker', [owner[door].status, moneyKeys(owner[door].body).length > 0, 'cost_hidden' in owner[door].body], [200, true, false]);
    t('cost-allowed | ' + door + ': byte-identical to the owner', JSON.stringify(allowed[door].body) === JSON.stringify(owner[door].body), true);
    t('blind | ' + door + ': still 200, every money key null, cost_hidden', [blind[door].status, moneyKeys(blind[door].body), blind[door].body.cost_hidden], [200, [], true]);
    t('blind | ' + door + ': no planted figure (the 4,242,500.00 bill) anywhere', /4242500|42,425|42425\.00/.test(JSON.stringify(blind[door].body)), false);
  }
  t('blind | trial balance keeps its rows and codes', blind.tb.body.rows.map((r) => r.code), owner.tb.body.rows.map((r) => r.code));
  const entry = (a, ev) => a.day.body.entries.find((e) => e.event_type === ev);
  t('owner | daybook purchase entry carries 424250000 (the bill of 4,242,500.00 in minor units)', entry(owner, 'purchase_bill').lines.some((l) => l.dr_minor === 424250000 || l.cr_minor === 424250000), true);
  t("blind | daybook sale entry is byte-identical to the owner's", JSON.stringify(entry(blind, 'sale_bill')) === JSON.stringify(entry(owner, 'sale_bill')), true);
  t('blind | daybook purchase entry: lines null, entry_no stands', [entry(blind, 'purchase_bill').lines.every((l) => l.dr_minor === null && l.cr_minor === null), entry(blind, 'purchase_bill').entry_no], [true, entry(owner, 'purchase_bill').entry_no]);
  t('blind | daybook: cost_hidden, same entry count, no planted figure', [blind.day.body.cost_hidden, blind.day.body.count, /424250000/.test(JSON.stringify(blind.day.body))], [true, owner.day.body.count, false]);
  t('owner | a paged daybook carries range totals (the purchase included)', [owner.dayPaged.body.totals !== undefined && owner.dayPaged.body.totals.dr_minor !== null, 'cost_hidden' in owner.dayPaged.body], [true, false]);
  t('blind | a paged daybook: totals null (they cover the whole range), cost_hidden, no planted figure', [blind.dayPaged.body.totals, blind.dayPaged.body.cost_hidden, /424250000/.test(JSON.stringify(blind.dayPaged.body))], [{ dr_minor: null, cr_minor: null }, true, false]);
  t('cost-allowed | daybook byte-identical to the owner', JSON.stringify(allowed.day.body) === JSON.stringify(owner.day.body), true);
}

async function partCanRead() {
  console.log('\n== SEC-119 · lib/cost.canRead uses the row auth already read ==\n');
  const cost = require('../lib/cost');
  const mk = (flag) => ({ identity: { identity_id: 'a', identity_type: 'actor', can_see_costs: flag } });
  t('a boolean true is answered with no trip to the database (none is stubbed)', await cost.canRead(mk(true), 'e').then((v) => v, (e) => 'threw:' + e.message), true);
  t('a boolean false is answered false, still no trip', await cost.canRead(mk(false), 'e').then((v) => v, (e) => 'threw:' + e.message), false);
  t('an owner always may', await cost.canRead({ identity: { identity_type: 'entity' } }, 'e'), true);
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'middleware', 'auth.js'), 'utf8');
  t('middleware/auth puts the row it read on req.identity', /identity\.can_see_costs = actor\.can_see_costs === true/.test(src) && /attachActorRow\(req\.identity, judged\.actor\)/.test(src), true);
}

async function partIdempotency() {
  console.log("\n== SEC-150 · a co-assist's Idempotency-Key is its own ==\n");
  const jwt = require('jsonwebtoken');
  const API = path.join(__dirname, '..');
  const stub = (rel, exports) => { const id = path.join(API, rel); require.cache[require.resolve(id)] = { id, filename: id, loaded: true, exports }; };
  let dbImpl = async () => { throw Object.assign(new Error('no table'), { code: '42P01' }); };
  stub('db', { query: async () => ({ rows: [{ break_status: 'active', hat: 'act', policy_flags: {} }] }), withEntity: (e, fn) => dbImpl(e, fn), withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }) });
  stub('lib/schema', { hasColumn: async () => false, has: async () => true, columns: async () => [], table: async () => ({}) });
  stub('lib/logger', { warn() {}, info() {}, debug() {}, error() {}, critical() {}, fellBack() {} });
  const idem = require(path.join(API, 'middleware', 'idempotency'));
  const SHOP = 'shop-1', ACTOR = 'actor-1';
  const tok = (claims) => 'Bearer ' + jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: 3600 });
  const ownerTok = tok({ identity_id: SHOP, identity_type: 'entity' }), actorTok = tok({ identity_id: ACTOR, identity_type: 'actor', parent_entity_id: SHOP });
  const send = (authorization, answer) => {
    const req = { id: 'r', method: 'POST', path: '/api/supplies/purchase', originalUrl: '/api/supplies/purchase', body: { ref: 'B1' }, headers: { authorization, 'idempotency-key': 'same-key' } };
    const res = { statusCode: 200, headers: {}, body: undefined, locals: {}, status(s) { this.statusCode = s; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(b) { this.body = b; return this; } };
    return new Promise((resolve) => {
      let ran = false;
      idem(req, res, () => { ran = true; res.json(answer); setTimeout(() => resolve({ ran, body: res.body, replay: res.headers['X-Idempotent-Replay'] }), 20); });
      setTimeout(() => resolve({ ran, body: res.body, replay: res.headers['X-Idempotent-Replay'] }), 80);
    });
  };
  idem._memory.clear();
  const first = await send(ownerTok, { total_minor: 4242500 });
  t('owner | first call runs the route', [first.ran, first.body], [true, { total_minor: 4242500 }]);
  const blind = await send(actorTok, { total_minor: null });
  t("co-assist | the owner's key is NOT replayed to the editor: the route runs, its own answer", [blind.ran, blind.replay, blind.body], [true, undefined, { total_minor: null }]);
  const again = await send(ownerTok, { total_minor: 1 });
  t("owner | the owner's own retry still replays the owner's answer", [again.ran, again.replay, again.body], [false, 'true', { total_minor: 4242500 }]);
  const blindAgain = await send(actorTok, { total_minor: 2 });
  t("co-assist | the editor's own retry replays the editor's answer", [blindAgain.ran, blindAgain.replay, blindAgain.body], [false, 'true', { total_minor: null }]);
  /* the bridge: a key the co-assist used BEFORE the cutover (a plain row, same body) is replayed once, never run twice */
  const seen = [];
  const asked = { legacy: null };
  dbImpl = (e, fn) => fn({ query: async (sql, params) => {
    seen.push(sql);
    if (/req_hash = [$]3/.test(sql)) { asked.legacy = params; return { rows: [{ idem_key: params[1], req_hash: params[2], state: 'done', status: 201, response: { chit: 'old' } }] }; }
    return { rows: [] };
  } });
  const bridged = await send(actorTok, { chit: 'second run' });
  t('bridge | a co-assist retry of a pre-deploy plain key replays the old answer, the route does not run', [bridged.ran, bridged.replay, bridged.body], [false, 'true', { chit: 'old' }]);
  t('bridge | asked for the PLAIN key, this entity, one cutover, in-window', [asked.legacy && asked.legacy[0], asked.legacy && asked.legacy[1], /created_at < [$]4/.test(seen[0]), /created_at > now()/.test(seen[0])], ['shop-1', 'same-key', true, true]);
  const ownerBridge = await send(ownerTok, { chit: 'owner run' }).catch(() => null);
  t('bridge | an owner never asks for a legacy row (its key is already plain)', seen.filter((q) => /req_hash = [$]3/.test(q)).length, 1);
  dbImpl = async () => { throw Object.assign(new Error('no table'), { code: '42P01' }); };
}

(async () => {
  if (process.argv[2] === 'reader') {
    console.log('ANSWERS ' + JSON.stringify(await asReader(process.argv[3])));
    process.exit(0);
  }
  partRule();
  partDoors();
  await partCanRead();
  await partIdempotency();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
