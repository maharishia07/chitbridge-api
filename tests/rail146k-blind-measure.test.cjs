/**
 * tests/rail146k-blind-measure.test.cjs — RAIL-146k: cost travels through lib/measure — the ONE measure is blind-aware and every caller goes through it.
 *
 * OWNS      the proof, per caller (GET /api/folders/reconcile · /mis · /:id/metrics, GET /api/relationships/scorecard/:id, GET /api/marketing/came-back, Home railMeasure), that a
 *           reader without can_see_costs gets money ONLY over a set that is wholly the shop own sales (else money:null + cost_hidden, counts stay), by a whole-body scan; that no sum
 *           or difference of the shown figures recovers a purchase total (segments, reconcile vs mis, scorecard vs folder); that the reader is read ONCE and the sides ONCE per request;
 *           that the owner and a cost-allowed actor read the same bytes; that a failed side read hides; and (guard) that routes/ never call measure.measure or the scorecard themselves.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes and libs over tests/support/work-stub.cjs.
 * FLOW      world (copies · roles · flag) → real route → body → whole-text scan → counts and the sale untouched
 * CARD      01-rail-core-the-chit/measure
 *
 * Run: node tests/rail146k-blind-measure.test.cjs · MIN unit-per-rule · refusal-path · fail-closed
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const S = require('./support/work-stub.cjs');
const { D, E1, U, copy, seed, as } = S;
const API = path.join(__dirname, '..');
const stubMod = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(100) + (ok ? '' : String(JSON.stringify(got)).slice(0, 300) + '   want ' + JSON.stringify(want).slice(0, 200)));
};
const SUP = '33333333-3333-4333-8333-333333333333', CUS = '55555555-5555-4555-8555-555555555555';
const FA = '77777777-7777-4777-8777-777777777777', FB = '88888888-8888-4888-8888-888888888888';
const BLIND = { identity_id: 'A7', identity_type: 'actor', entity_id: E1 };
const OWNER = { identity_id: E1, identity_type: 'entity', entity_id: E1 };
const BUY = 7777.77, PO = 4646.5, SALE1 = 1200.5, SALE2 = 300.25, SALE3 = 99.5, INV = 2468.13;
const shapes = (n) => [String(n), n.toFixed(2), String(Math.round(n * 100))];
const SECRET = [BUY, PO, INV].flatMap(shapes);
const leaked = (raw) => SECRET.filter((s) => new RegExp('(^|[^0-9.])' + s.replace('.', '\\.') + '([^0-9]|$)').test(raw));
const noLeak = (label, body) => { const raw = JSON.stringify(body); t(label + ' | whole-body scan: no planted purchase figure', leaked(raw), []); };
const totals = (money) => (money ? money.by_currency.map((c) => c.total) : money);

const dbMod = require('../db');
const realWithEntity = dbMod.withEntity;
const SENDS = [];
const T0 = process.env.RAIL146K_DUMP ? new Date(Math.floor(Date.now() / 36e5) * 36e5 - 3600e3).toISOString() : new Date(Date.now() - 3600e3).toISOString(); /* one instant for every world, so two reads of the same world are the same bytes */
dbMod.withEntity = async (entity, fn) => realWithEntity(entity, (c) => fn({ query: async (sql, p) => {
  const text = String(sql).replace(/\s+/g, ' ');
  if (/SELECT folder_id, parent_id, name FROM folder/.test(text)) return { rows: [{ folder_id: FA, parent_id: null, name: 'Buying' }, { folder_id: FB, parent_id: null, name: 'Selling' }] };
  if (/SELECT scope FROM folder/.test(text)) return { rows: [{ scope: null }] };
  if (/FROM channel_outbound/.test(text)) return { rows: SENDS };
  return c.query(sql, p);
} }));
const select = require('../lib/select');
stubMod('lib/select.js', Object.assign({}, select, { rows: async (entity, sel = {}) => {
  D.statements.push('select.rows');
  let rows = D.copies.filter((r) => r.entity_id === entity);
  if (sel.direction) rows = rows.filter((r) => r.direction === sel.direction);
  if (sel.counterparty_id) rows = rows.filter((r) => r.counterparty_id === sel.counterparty_id);
  if (sel.counterparty_ids) rows = rows.filter((r) => sel.counterparty_ids.includes(String(r.counterparty_id)));
  if (sel.folder_id) rows = rows.filter((r) => r.folder_id === sel.folder_id);
  return rows.map((r) => Object.assign({}, r));
} }));
stubMod('lib/policy.js', Object.assign({}, require('../lib/policy'), { get: async () => ({ overdue_days: 3, came_back_days: 14 }) }));
require('../lib/schema').hasColumn = async () => true;

const express = require('express');
const app = express();
app.use('/api/folders', require('../routes/folders'));
app.use('/api/relationships', require('../routes/relationships'));
app.use('/api/marketing', require('../routes/marketing'));
const srv = http.createServer(app);
const call = (url) => new Promise((resolve, reject) => http.get({ port: srv.address().port, path: url }, (res) => {
  let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }); } catch (e) { reject(e); } });
}).on('error', reject));

/** the world: c1 a supplier bill (received, in FA) · c2 c3 two customer orders (received, sales, in FB) · c4 a PO I sent the supplier (sent) · c5 a supplier invoice a lax sale test could miss (received, unfiled) */
function world() {
  seed();
  const base = { currency: 'INR', created_at: T0, current_status: 'pending' };
  D.copies = [
    copy(1, Object.assign({ purpose: 'invoice', doc_kind: 'bill_received', sender_entity_id: SUP, counterparty_id: SUP, counterparty_name: 'Mill', value: String(BUY), folder_id: FA, direction: 'received' }, base)),
    copy(2, Object.assign({ purpose: 'order', sender_entity_id: CUS, counterparty_id: CUS, counterparty_name: 'Ravi', value: String(SALE1), folder_id: FB, direction: 'received' }, base)),
    copy(3, Object.assign({ purpose: 'order', sender_entity_id: CUS, counterparty_id: CUS, counterparty_name: 'Ravi', value: String(SALE2), folder_id: FB, direction: 'received' }, base)),
    copy(4, Object.assign({ purpose: 'order', sender_entity_id: E1, counterparty_id: SUP, counterparty_name: 'Mill', value: String(PO), folder_id: null, direction: 'sent', all_recipients: [{ entity_id: SUP }] }, base)),
    copy(6, Object.assign({ purpose: 'invoice', doc_kind: 'bill_issued', sender_entity_id: E1, counterparty_id: CUS, counterparty_name: 'Ravi', value: String(SALE3), folder_id: null, direction: 'sent', all_recipients: [{ entity_id: CUS }] }, base)),
    copy(5, Object.assign({ purpose: 'invoice', doc_kind: null, sender_entity_id: SUP, counterparty_id: SUP, counterparty_name: 'Mill', value: String(INV), folder_id: null, direction: 'received' }, base))
  ];
  D.roles = { [SUP]: { supplier: true }, [CUS]: { customer: true } };
  D.bj = { [U(1)]: {}, [U(2)]: {}, [U(3)]: {}, [U(4)]: {}, [U(5)]: {}, [U(6)]: {} };
  const at = new Date(Date.parse(T0) - 3600e3);
  SENDS.length = 0;
  [CUS, SUP].forEach((party) => SENDS.push({ party_id: party, status: 'sent', reason: null, send_ref: 'r-' + party, created_at: at.toISOString(), party_name: 'P' }));
}
const blindRead = (who) => { world(); as(who); D.canSeeCosts = false; D.statements.length = 0; };
const costReads = () => D.statements.filter((s) => /can_see_costs/.test(s)).length;
const sideReads = () => D.statements.filter((s) => /FROM chit_header h WHERE h[.]entity_id/.test(s)).length;
const COUNT_KEYS = ['count', 'open', 'closed', 'unread', 'overdue', 'by_status', 'by_direction', 'clock', 'disputes'];
const pick = (m) => COUNT_KEYS.map((k) => m[k]);

(async () => {
  await S.start();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  console.log('\n══ RAIL-146k · the one blind-aware measure, every caller ══\n');

  /* ── unit: the rule itself ── */
  const measure = require('../lib/measure');
  const rows = [{ chit_id: 'a', value: 5, currency: 'INR' }, { chit_id: 'b', value: 7, currency: 'INR' }];
  t('measure | no sides: the summary as it always was, no marker', ['cost_hidden' in measure.measure(rows), totals(measure.measure(rows).money)], [false, [12]]);
  t('measure | every row a sale: the summary stands', totals(measure.measure(rows, { sides: new Map([['a', 'sell'], ['b', 'sell']]) }).money), [12]);
  const mixed = measure.measure(rows, { sides: new Map([['a', 'sell'], ['b', 'buy']]) });
  t('measure | one purchase: money null + cost_hidden, counts stay', [mixed.money, mixed.cost_hidden, mixed.count], [null, true, 2]);
  t('measure | a row the map does not name is not a sale (fail closed)', measure.measure(rows, { sides: new Map([['a', 'sell']]) }).money, null);
  t('measure | an unknown side hides', measure.measure(rows, { sides: new Map([['a', 'sell'], ['b', 'unknown']]) }).cost_hidden, true);
  t('measure | an empty set keeps its zero money', measure.measure([], { sides: new Map() }).money.by_currency, []);
  t('measure | money:false leaves the slot out (Home prints counts)', 'money' in measure.measure(rows, { money: false }), false);
  t('measure | scorecard forwards sides', measure.scorecard(rows, { sides: new Map() }).money, null);
  const homeFacts = require('../lib/home-facts');
  t('home-facts railMeasure | money:false carries no money, the overdue count is the same', ['money' in homeFacts.railMeasure(rows, E1, { money: false }), homeFacts.railMeasure(rows, E1, { money: false }).overdue], [false, homeFacts.railMeasure(rows, E1, {}).overdue]);
  t('home-facts railMeasure | with sides a mixed set hides (the /mis path)', homeFacts.railMeasure(rows, E1, { sides: new Map([['a', 'sell']]) }).money, null);

  /* ── reconcile ── */
  const REC = '/api/folders/reconcile?scope=task';
  world(); as(OWNER); D.statements.length = 0;
  const owner = (await call(REC)).body;
  t('reconcile | the owner: overall and every segment priced, no marker, no cost read', [totals(owner.overall.money).length > 0, owner.folders.some((f) => 'cost_hidden' in f.segments), 'cost_hidden' in owner.overall, costReads()], [true, false, false, 0]);
  blindRead(BLIND);
  const blind = (await call(REC)).body;
  noLeak('reconcile | blind', blind);
  t('reconcile | blind: overall money null + cost_hidden, counts equal the owner', [blind.overall.money, blind.overall.cost_hidden, pick(blind.overall)], [null, true, pick(owner.overall)]);
  const seg = (b, id) => b.folders.find((f) => f.folder_id === id).segments;
  t('reconcile | blind: the purchase folder hides, the sales-only folder keeps its figure', [seg(blind, FA).money, seg(blind, FA).cost_hidden, totals(seg(blind, FB).money), 'cost_hidden' in seg(blind, FB)], [null, true, [SALE1 + SALE2], false]);
  t('reconcile | blind: total, filed, reconciles and the segment counts stay', [blind.total, blind.filed, blind.reconciles, seg(blind, FA).assigned, seg(blind, FB).count], [owner.total, owner.filed, owner.reconciles, seg(owner, FA).assigned, seg(owner, FB).count]);
  t('reconcile | ONE cost read and ONE side read however many segments', [costReads(), sideReads()], [1, 1]);
  world(); as(BLIND); D.canSeeCosts = true;
  t('reconcile | a co-assist WITH can_see_costs reads the owner bytes', JSON.stringify((await call(REC)).body), JSON.stringify(owner));
  world(); as(BLIND); D.canSeeCosts = false; D.roles = new Proxy({}, { get() { throw new Error('the lists are down'); } });
  const down = (await call(REC)).body;
  noLeak('reconcile | lists down (fail closed)', down);
  t('reconcile | lists down: every money hidden', [down.overall.money, down.folders.every((f) => f.segments.money === null)], [null, true]);

  /* ── mis ── */
  world(); as(OWNER); D.statements.length = 0;
  const misOwner = (await call('/api/folders/mis')).body;
  t('mis | the owner: all three priced, no marker', [totals(misOwner.all.money).length > 0, ['all', 'received', 'sent'].some((k) => 'cost_hidden' in misOwner[k])], [true, false]);
  blindRead(BLIND);
  const mis = (await call('/api/folders/mis')).body;
  noLeak('mis | blind', mis);
  t('mis | blind: all, received and sent money null + cost_hidden', ['all', 'received', 'sent'].map((k) => [mis[k].money, mis[k].cost_hidden]), [[null, true], [null, true], [null, true]]);
  t('mis | blind: the counts and the rail overdue rule equal the owner', ['all', 'received', 'sent'].map((k) => pick(mis[k]).concat(mis[k].overdue)), ['all', 'received', 'sent'].map((k) => pick(misOwner[k]).concat(misOwner[k].overdue)));
  t('mis | ONE cost read and ONE side read for the three partitions', [costReads(), sideReads()], [1, 1]);
  world(); as(BLIND); D.canSeeCosts = true;
  t('mis | a co-assist WITH can_see_costs reads the owner bytes', JSON.stringify((await call('/api/folders/mis')).body), JSON.stringify(misOwner));

  /* ── scorecard ── */
  const CARD = (id) => '/api/relationships/scorecard/' + id;
  world(); as(OWNER);
  const cardOwner = (await call(CARD(SUP))).body;
  t('scorecard | the owner reads the supplier purchase total, no marker', [totals(cardOwner.money).length > 0, 'cost_hidden' in cardOwner], [true, false]);
  blindRead(BLIND);
  const cardSup = (await call(CARD(SUP))).body;
  noLeak('scorecard | blind, the supplier', cardSup);
  t('scorecard | blind: the supplier money null + cost_hidden, counts and relationship equal the owner', [cardSup.money, cardSup.cost_hidden, pick(cardSup), cardSup.relationship, cardSup.completion], [null, true, pick(cardOwner), cardOwner.relationship, cardOwner.completion]);
  t('scorecard | ONE cost read and ONE side read', [costReads(), sideReads()], [1, 1]);
  const cardCus = (await call(CARD(CUS))).body;
  t('scorecard | blind: the customer (all sales) keeps its figure, no marker', [totals(cardCus.money), 'cost_hidden' in cardCus], [[SALE1 + SALE2 + SALE3], false]);
  t('scorecard | diff attack: the customer card minus the sales folder is a sale (the invoice), never a purchase', Math.round((totals(cardCus.money)[0] - totals(seg(blind, FB).money)[0]) * 100) / 100, SALE3);
  world(); as(BLIND); D.canSeeCosts = false; D.roles = new Proxy({}, { get() { throw new Error('the lists are down'); } });
  const cardDown = (await call(CARD(CUS))).body;
  t('scorecard | lists down: even the customer hides (fail closed)', [cardDown.money, cardDown.cost_hidden], [null, true]);
  world(); as(BLIND); D.canSeeCosts = true;
  t('scorecard | a co-assist WITH can_see_costs reads the owner bytes', JSON.stringify((await call(CARD(SUP))).body), JSON.stringify(cardOwner));

  /* ── folder metrics (folded in from #604) ── */
  const MET = '/api/folders/' + FA + '/metrics';
  world(); as(OWNER);
  const metOwner = (await call(MET)).body;
  blindRead(BLIND);
  const met = (await call(MET)).body;
  noLeak('metrics | blind', met);
  t('metrics | blind: money null + cost_hidden, counts equal the owner', [met.money, met.cost_hidden, pick(met)], [null, true, pick(metOwner)]);
  t('metrics | ONE cost read and ONE side read', [costReads(), sideReads()], [1, 1]);

  /* ── who came back ── */
  const CB = '/api/marketing/came-back';
  world(); as(OWNER);
  const cbOwner = (await call(CB)).body;
  t('came-back | the owner: both buyers priced', [cbOwner.came_back_n, totals(cbOwner.money).length > 0], [2, true]);
  blindRead(BLIND);
  const cb = (await call(CB)).body;
  noLeak('came-back | blind', cb);
  const line = (b, party) => b.customers.find((c) => c.party_id === party);
  t('came-back | blind: the overall money hides (a supplier invoice is in the set)', [cb.money, cb.cost_hidden, cb.came_back_n], [null, true, cbOwner.came_back_n]);
  t('came-back | blind: the supplier line hides, bill value null', [line(cb, SUP).money, line(cb, SUP).bills.every((b) => b.value === null)], [null, true]);
  t('came-back | ONE cost read', costReads(), 1);
  world(); as(BLIND); D.canSeeCosts = true;
  t('came-back | a co-assist WITH can_see_costs reads the owner bytes', JSON.stringify((await call(CB)).body), JSON.stringify(cbOwner));

  /* ── guard: routes/ never measure themselves ── */
  const ALLOW = { 'crm.js': 'the record reads relationship + completion only; its money never leaves (RAIL-146i is in lib/crm.js)' };
  const offenders = fs.readdirSync(path.join(API, 'routes')).filter((f) => f.endsWith('.js')).filter((f) => {
    const text = fs.readFileSync(path.join(API, 'routes', f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    return !ALLOW[f] && (/measure\.(measure|scorecard)\s*\(/.test(text) || /require\(['"]\.\.\/lib\/measure['"]\)/.test(text));
  });
  t('guard | no routes/ file calls measure.measure or measure.scorecard, or requires lib/measure', offenders, []);

  /* --compare hook: RAIL146K_DUMP=<file> writes the owner answers, so two heads can be diffed byte for byte */
  if (process.env.RAIL146K_DUMP) fs.writeFileSync(process.env.RAIL146K_DUMP, JSON.stringify({ owner, misOwner, cardOwner, metOwner, cbOwner }, null, 1));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  S.stop(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
