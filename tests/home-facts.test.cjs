/**
 * home-facts.test.cjs — GET /api/facts/:card (N18): what each Home card says, from the server, or not at all.
 *
 * Offline: the real route and lib/home-facts over a stand-in db. Held here:
 *   · each card's shape ({ lines:[{text,value?,tone?}] }; rail = { suppliers, customers, in, out, stuck })
 *   · every answer costs at most 3 database trips (the rail: overdue clock + CRM lists + chits, run together) (readBatch = 1, withEntity = 1, query = 1)
 *   · a figure the server cannot compute is OMITTED, never 0 (no summary today -> no bills line; a truncated read -> no in/out/stuck)
 *   · cost never travels: the stand-in returns hostile cost values and none reaches a body; no statement selects item_data
 *   · an actor without can_see_costs gets no no-cost line; takings are NOT cost (GET /api/till/summary never hid them) so they stay
 *   · an unknown card is 404, a key is 403
 *
 * Run: node tests/home-facts.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(78) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exports) => { require.cache[require.resolve(API + rel)] = { id: rel, filename: rel, loaded: true, exports }; };

const OWNER = { identity_id: 'e1', identity_type: 'entity' };
const BLIND = { identity_id: 'a1', identity_type: 'actor', parent_entity_id: 'e1' };
const GRANTED = { identity_id: 'a2', identity_type: 'actor', parent_entity_id: 'e1' };
let WHO = OWNER, KEY = false;
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = WHO; if (KEY) req.api_key = { scopes: ['till'] }; next(); }, {
  entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
  requireScope: () => (req, res, next) => next(),
}));

/* ── the stand-in database ── */
const SECRET = 4242.5;
let trips = 0, sent = [];
const DAYS = 86400000;
const H = require(API + '/lib/books-hooks');
const todayKey = H.dayOf(new Date(), 'IN');
const SHUT_AT = new Date().toISOString();
const F = { crmSql: [], summary: true, booksOn: true, chits: 'few', stale: false };
const summaryRow = (key) => ({ chit_id: 'c1', created_at: new Date(), business_json: { summary: { period: 'day', key, till: { id: 'C1' }, summarised_at: new Date().toISOString(), totals: { count: 12, returns: 0, gross: 4400, refunds: 79.5, expenseCount: 0, expenses: 0, total: 4320.5, by: {} } } } });
function chits() {
  if (F.chits === 'many') return Array.from({ length: 5000 }, (_, i) => ({ chit_id: 'x' + i, direction: 'received', current_status: 'completed', created_at: new Date(Date.now() - 40 * DAYS), open_disputes: 0 }));
  const d = (n) => new Date(Date.now() - n * DAYS);
  const own = F.chits === 'own' ? [   /* the shop's own chits: a counter sale (closed by the books, or not yet) and a note to self - never stuck */
    { chit_id: 'cs1', direction: 'received', sender_entity_id: 'e1', current_status: 'pending', created_at: d(20), open_disputes: 0, manual_subject: 'Counter sale C1/26-27/0001' },
    { chit_id: 'cs2', direction: 'received', sender_entity_id: 'e1', current_status: 'completed', created_at: d(20), open_disputes: 0 },
  ] : [];
  if (F.chits === 'advice') return [
    { chit_id: 'adv', direction: 'sent', sender_entity_id: 'e1', current_status: 'pending', created_at: d(1), open_disputes: 0, purpose: 'general', biz_kind: 'payment_advice', alt_value: '1', value: '0',
      counterparty_id: 'e2', counterparty_name: 'cbincroot', all_recipients: [{ display_name: 'Mayur Bhavan' }, { display_name: 'cbincroot' }], manual_subject: 'Payment advice PY/2026-27/000002' },
    { chit_id: 'exp', direction: 'received', sender_entity_id: 'e1', current_status: 'pending', created_at: d(1), open_disputes: 0, purpose: 'expense', alt_value: '90', value: '0', manual_subject: 'Expense - rent' }];
  return own.concat([
    { chit_id: 'a', direction: 'received', current_status: 'pending', created_at: d(10), open_disputes: 0 },   /* in, and stuck (7-day default) */
    { chit_id: 'b', direction: 'received', current_status: 'pending', created_at: d(1), open_disputes: 0 },    /* in */
    { chit_id: 'c', direction: 'sent', current_status: 'accepted', created_at: d(2), open_disputes: 0 },       /* out */
    { chit_id: 'd', direction: 'sent', current_status: 'completed', created_at: d(30), open_disputes: 0 },     /* closed */
  ]);
}
function answer(text, params) {
  sent.push(String(text));
  const sql = String(text);
  if (/FROM chit_header h/.test(sql) && /'summary'/.test(sql)) return { rows: F.summary ? [summaryRow(F.stale ? '2026-01-01' : todayKey)] : [] };
  if (/FROM identities WHERE identity_id = \$1/.test(sql) && /jsonb_agg/.test(sql)) {
    return { rows: [{ country: 'IN', currency_code: 'INR',
      counters: { C1: { id: 'C1', held_by: 'k1' }, C2: { id: 'C2', held_by: 'k2' } },
      keys: [{ jti: 'k1', scopes: ['till'], till: { id: 'C1', closed_at: F.allShut ? SHUT_AT : null } }, { jti: 'k2', scopes: ['till'], till: { id: 'C2', closed_at: '2026-10-01T10:00:00Z' } }] }] };
  }
  if (/can_see_costs FROM identities/.test(sql)) return { rows: [{ can_see_costs: params[0] === 'a2' }] };
  if (/FROM books_setting/.test(sql)) return { rows: [{ entity_id: 'e1', enabled: F.booksOn, last_check: { at: '2026-10-06T21:00:00Z', ok: true } }] };
  if (/FROM books_outbox/.test(sql)) return { rows: [{ n: 3 }] };
  if (/FROM catalogue_items/.test(sql)) return { rows: [{ items: 10, no_cost: 4, cost: SECRET, item_data: { cost: { value: SECRET } } }] };
  if (/FROM combo_templates/.test(sql)) return { rows: [{ n: 2 }] };
  if (/FROM definition WHERE/.test(sql)) return { rows: [{ drafts: 1, live: 5 }] };
  if (/policy_flags->'overdue_days'/.test(sql)) return { rows: [{ overdue_days: null }] };
  /* CB CRM's two list reads (lib/crm.rows) - the rail counts what CRM lists: the hidden and the merged-away rows are not parties */
  const party = (id, extra) => Object.assign({ party_id: id, display_name: 'P ' + id, user_id: 'u' + id, status: 'active', on_rail: true, same_world: true }, extra);
  if (/FROM customer_list cl JOIN identities/.test(sql)) { F.crmSql.push(sql); return { rows: [party('c1'), party('c2'), party('c3'), party('c4'), party('c5', { hidden_at: '2026-10-01' }), party('b1')] }; }
  if (/FROM supplier_list sl JOIN identities/.test(sql)) { F.crmSql.push(sql); return { rows: [party('s1'), party('s2'), party('s3', { merged_into: 's1' }), party('b1')] }; }
  if (/FROM chit_status cs/.test(sql)) return { rows: chits() };
  return { rows: [] };
}
const db = {
  query: async (s, p) => { trips++; return answer(s, p); },
  withEntity: async (_id, fn) => { trips++; return fn({ query: async (s, p) => answer(s, p) }); },
  trySavepoint: async (h, fn, fb) => { try { return await fn(h); } catch (_) { return fb; } },
  readBatch: async (_e, _a, stmts) => { trips++; return stmts.map((s) => answer(s.text, s.params)); },
  withTransaction: async (fn) => { trips++; return fn({ query: async (s, p) => answer(s, p) }); },
};
mock('/db', db);
require(API + '/lib/policy').get = async () => ({});

const get = (port, p) => new Promise((ok) => {
  trips = 0; sent = [];
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const body = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(body); } catch (_) {} ok({ status: res.statusCode, body, json, trips }); });
  });
});

(async () => {
  const app = express();
  app.use('/api/facts', require(API + '/routes/facts'));
  const srv = app.listen(0); const port = srv.address().port;
  const g = (c) => get(port, '/api/facts/' + c);
  console.log('\n-- N18 Home facts --\n');

  /* till */
  let r = await g('till');
  t('till: 200', r.status, 200);
  t('till: bills and takings on one line - the money is worded by the page ({money}), never "INR 4320.50"', [r.json.lines[0].text, r.json.lines[0].money], ['12 bills · {money}', { amount: 4320.5, currency: 'INR' }]);
  t('till: line value is the bill count', r.json.lines[0].value, 12);
  t('till: one counter open (C1 held by a live key, C2 closed)', r.json.lines[1], { text: '1 counter open', value: 1 });
  F.allShut = true; r = await g('till');
  t('till: every counter closed today -> "Counter C1 closed {time}" with the ISO moment (M144)', [r.json.lines[1].text, r.json.lines[1].at], ['Counter C1 closed {time}', SHUT_AT]);
  F.allShut = false; r = await g('till');
  t('till: figures carry the raw numbers', r.json.figures, { day: todayKey, bills: 12, takings: 4320.5, currency: 'INR', counters_open: 1 });
  t('till: at most 2 trips', r.trips <= 2, true);
  t('till: "bills not sent up" is not invented', /not sent|unsent/i.test(r.body), false);
  F.stale = true; r = await g('till');
  t('till: an older newest day is named by its date ({date}, at the day key), not called today', r.json.lines[0].text, '12 bills on {date} · {money}');
  F.stale = false; F.summary = false; r = await g('till');
  t('till: no summary at all -> no bills line (omitted, not 0)', r.json.lines.map((l) => l.text), ['1 counter open']);
  t('till: ...and no bills/takings figure', Object.keys(r.json.figures), ['counters_open']);
  F.summary = true;
  WHO = BLIND; r = await g('till');
  t('till: an actor without can_see_costs still sees takings (the old read never hid them)', /"amount":4320\.5\b/.test(r.body), true);
  WHO = OWNER;

  /* orders (M145): a live door with its count - one read, asked for orders that came to the shop, counted by lib/measure's OPEN set */
  r = await g('orders');
  t('orders: 200, one count line, the figure is a number', [r.status, r.json.lines.length, typeof r.json.figures.open, r.json.lines[0].value === r.json.figures.open], [200, 1, 'number', true]);
  t('orders: the read asks for purpose order, received', sent.some((q) => /ch.purpose = /.test(q) && /cs.direction = /.test(q)), true);
  t('orders: at most 1 trip', r.trips <= 1, true);

  /* accounts */
  r = await g('accounts');
  t('accounts: checked date + waiting (tone dn)', r.json.lines, [{ text: 'Checked {when}', at: '2026-10-06T21:00:00.000Z' }, { text: '3 posts waiting', value: 3, tone: 'dn' }]);
  t('accounts: at most 2 trips', r.trips <= 2, true);
  F.booksOn = false; r = await g('accounts');
  t('accounts: ledger off -> no lines, and it says why', [r.status, r.json.lines, typeof r.json.unavailable], [200, [], 'string']);
  F.booksOn = true;

  /* product-lab */
  r = await g('product-lab');
  t('product-lab: owner gets items + no-cost COUNT', r.json.lines, [{ text: '10 items', value: 10 }, { text: '4 items with no cost', value: 4, tone: 'dn' }]);
  t('product-lab: at most 2 trips (owner)', r.trips <= 2, true);
  t('product-lab: no cost value anywhere in the body', r.body.includes('4242'), false);
  t('product-lab: no statement selects item_data or a cost value', sent.some((s) => /SELECT[\s\S]*\bitem_data\b[\s\S]*FROM/i.test(s.replace(/\(item_data->'cost'->>'value'\) IS NULL/g, ''))), false);
  WHO = BLIND; r = await g('product-lab');
  t('product-lab: an actor WITHOUT can_see_costs gets the item count only', r.json.lines, [{ text: '10 items', value: 10 }]);
  t('product-lab: ...and no no_cost figure', 'no_cost' in r.json.figures, false);
  t('product-lab: at most 2 trips (actor: permission, then count)', r.trips <= 2, true);
  t('product-lab: no cost value in the actor body', r.body.includes('4242'), false);
  WHO = GRANTED; r = await g('product-lab');
  t('product-lab: an actor WITH can_see_costs gets the no-cost line', r.json.lines.length, 2);
  WHO = OWNER;

  /* combo-lab · offer-lab */
  r = await g('combo-lab');
  t('combo-lab: saved sets, no invented combos/modifiers split', r.json.lines, [{ text: '2 saved sets', value: 2 }]);
  t('combo-lab: 1 trip', r.trips, 1);
  r = await g('offer-lab');
  t('offer-lab: drafts waiting + live', r.json.lines, [{ text: '1 draft waiting', value: 1, tone: 'dn' }, { text: '5 offers live', value: 5 }]);
  t('offer-lab: 1 trip', r.trips, 1);

  /* rail */
  r = await g('rail');
  t('rail: { suppliers, customers, in, out, stuck } - the counts are CRM\'s (hidden and merged rows are not parties)', r.json, { suppliers: 3, customers: 5, in: 2, out: 1, stuck: 1 });
  t('rail: at most 3 trips', r.trips <= 3, true);
  t('rail: both CRM list reads leave the shop itself out (H3)', F.crmSql.length >= 2 && F.crmSql.every((q) => /<> \$1/.test(q)), true);
  F.chits = 'own'; r = await g('rail');
  t('rail: a chit the shop sent to itself is never stuck - an open one is "in", a closed one is nothing', r.json, { suppliers: 3, customers: 5, in: 3, out: 1, stuck: 1 });
  r = await get(port, '/api/facts/rail/chits');
  t('rail/chits: a note to self is listed (In tab) with stuck:false, self:true, no reason; stuck rows still number the rail', [r.json.items.filter((i) => i.stuck).map((i) => i.chit_id), r.json.items.find((i) => i.chit_id === 'cs1').self, r.json.items.find((i) => i.chit_id === 'cs1').why, r.json.items.some((i) => i.chit_id === 'cs2')], [['a'], true, null, false]);
  F.chits = 'few';
  /* small-fixes: a payment advice names the OTHER side (not the shop) and its own amount; an expense carries its amount; own chits are flagged */
  F.chits = 'advice'; r = await get(port, '/api/facts/rail/chits');
  const adv = r.json.items.find((i) => i.chit_id === 'adv'), exp = r.json.items.find((i) => i.chit_id === 'exp');
  t('rail/chits: a payment advice is To the counterparty (not the shop), with the payment amount, kind payment_advice, not own', [adv.who, adv.value, adv.kind, adv.own], ['cbincroot', 1, 'payment_advice', false]);
  t('rail/chits: an expense with no total shows its own amount and is flagged own (the list hides it by default)', [exp.value, exp.own], [90, true]);
  F.chits = 'few';
  F.chits = 'many'; r = await g('rail');
  t('rail: a truncated chit read gives no in/out/stuck (omitted, not a wrong number)', r.json, { suppliers: 3, customers: 5 });
  F.chits = 'few';

  /* the chits behind the numbers (H1/H4/H10) */
  r = await get(port, '/api/facts/rail/chits');
  t('rail/chits: 200', r.status, 200);
  t('rail/chits: only OPEN chits, stuck first', r.json.items.map((i) => [i.chit_id, i.tab, i.stuck]), [['a', 'in', true], ['b', 'in', false], ['c', 'out', false]]);
  t('rail/chits: the stuck rows number the rail\'s stuck, in/out number its in/out', [r.json.items.filter((i) => i.stuck).length, r.json.items.filter((i) => i.tab === 'in').length, r.json.items.filter((i) => i.tab === 'out').length], [1, 2, 1]);
  t('rail/chits: a stuck row says why in plain words', r.json.items[0].why, 'They sent it 10 days ago and you have not answered.');
  t('rail/chits: a row that is not stuck has no reason', r.json.items[1].why, null);
  t('rail/chits: at most 2 trips', r.trips <= 2, true);
  F.chits = 'many'; r = await get(port, '/api/facts/rail/chits');
  t('rail/chits: a truncated read lists nothing and says so', [r.json.truncated, r.json.items.length], [true, 0]);
  KEY = true; r = await get(port, '/api/facts/rail/chits');
  t('rail/chits: a key is 403', r.status, 403);
  KEY = false;
  F.chits = 'few';

  /* refusals */
  r = await g('nonsense');
  t('unknown card -> 404', r.status, 404);
  r = await g('toString');
  t('an inherited name is not a card -> 404', r.status, 404);
  KEY = true; r = await g('till');
  t('a key is not a person -> 403', r.status, 403);
  KEY = false;
  const bodies = [];
  for (const c of ['till', 'accounts', 'product-lab', 'combo-lab', 'offer-lab', 'rail']) bodies.push((await g(c)).body);
  t('no answer anywhere carries a cost value', bodies.some((b) => b.includes('4242')), false);

  srv.close();
  console.log('\n  ' + pass + ' checks · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
