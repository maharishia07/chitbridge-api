/**
 * tests/books-todo-unposted.test.cjs — ACC-342: A BILL THE BOOKS DID NOT TAKE REACHES THE OWNER'S TO DO IN WORDS (kind bills_not_in_books).
 *
 * OWNS      the proof of the to-do kind bills_not_in_books (lib/books-todo.js) and its count, books-reconcile unpostedOf (the /health predicate).
 * CALLED BY the test library (api T1). Needs the books engines: BOOKS_ENGINES_SRC=C:/dev/chitbridge-engines/src. Run: node tests/books-todo-unposted.test.cjs
 * ⚠️ The store is the in-memory one; the predicate is twinned from books-reconcile.test.cjs (the SQL itself is proved there and on Postgres in the integration job).
 * CARD      14-accounting/books-health-to-do-outbox
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
async function section(title, fn) { console.log('\n── ' + title + ' ──'); try { await fn(); } catch (e) { fail++; console.log('   FAIL threw: ' + (e && e.stack || e)); } }
const SHOP = '11111111-1111-4111-8111-111111111111';
let seq = 0;
const cid = () => 'e1000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
const NOW = Date.now();
const ago = (ms) => new Date(NOW - ms).toISOString();
const KIND = 'bills_not_in_books';

/** a switched-on shop, the hooks, and a chit store whose "no entry, no open waiting row, past the window" predicate is the SQL's, as books-reconcile.test twins it */
async function shop() {
  const X = H.load({});
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-09-29', walkin_grain: 'day' });
  X.T.setting.get(SHOP).enabled_at = '2026-09-29T00:00:00.000Z';
  const K = require(path.join(H.API, 'lib', 'books-hooks')); K.forget(SHOP);
  const R = require(path.join(H.API, 'lib', 'books-reconcile')); R.reset();
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const chits = new Map();
  TC.copyOf = async (id) => chits.get(String(id)) || null;
  TC.entryFor = async () => ({});
  const expense = (age) => { const c = { chit_id: cid(), purpose: 'expense', created_at: ago(age), business_json: { expense: { what: 'tea', mode: 'Cash', amount: 40 } } }; chits.set(c.chit_id, c); return c; };
  const pred = (e, from, to, opt) => Array.from(chits.values()).filter((c) => {
    if (!(c.created_at >= from && c.created_at < to)) return false;
    if (X.T.entries.some((x) => x.entity_id === e && (x.source_ref === 'chit:' + c.chit_id || x.source_ref === 'bill:' + c.chit_id))) return false;
    if (X.T.outbox.some((x) => x.done_at == null && x.source_chit_id === c.chit_id)) return false;
    return ((opt || {}).skipIds || []).indexOf(c.chit_id) < 0;
  });
  X.store.unpostedInWindow = async (db, e, from, to, limit, opt) => pred(e, from, to, opt).slice(0, limit).map((c) => ({ chit_id: c.chit_id }));
  X.store.unpostedCount = async (db, e, from, to, opt) => { const l = pred(e, from, to, opt); return { count: l.length, oldest: l.length ? l[0].created_at : null }; };
  Object.assign(R._D, {
    now: () => Date.now(), shops: async () => [SHOP],
    withEntity: async (s, fn) => fn({ query: async (t, v) => (/pg_try_advisory_xact_lock/.test(t) ? { rows: [{ got: true }] } : X.db.query(t, v)) }),
    busy: () => false
  });
  const setting = await X.B.settingOf(X.db, SHOP);
  const BT = require(path.join(H.API, 'lib', 'books-todo'));
  const row = async () => (await BT.todo(SHOP, setting)).find((x) => x.kind === KIND);
  return { X, K, R, BT, expense, row, entries: (c) => X.T.entries.filter((x) => x.source_ref === 'chit:' + c.chit_id), openOutbox: () => X.T.outbox.filter((x) => x.done_at == null) };
}
const quiet = () => { const L = require(path.join(H.API, 'lib', 'logger')); const w = L.warn, i = L.info; L.warn = () => {}; L.info = () => {}; return () => { L.warn = w; L.info = i; }; };

(async () => {
  console.log('\n══ ACC-342 — a bill the books did not take reaches the owner\'s To do ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }

  await section('T1 · the kind exists, and a clean shop shows no row', async () => {
    const S = await shop();
    ok('KINDS names bills_not_in_books', S.BT.KINDS.indexOf(KIND) >= 0);
    ok('nothing missing → the row is left out (never "0")', (await S.row()) === undefined);
  });

  await section('T2 · a bill past the grace with no entry and no waiting row → one row, in words, and no button', async () => {
    const S = await shop();
    S.expense(10 * 60000);
    const r = await S.row();
    ok('count 1, singular words, no jargon', r && r.count === 1 && /^1 bill is not in your books yet\./.test(r.words) && !/outbox|reconcil|journal|ledger/i.test(r.words), JSON.stringify(r));
    ok('no button: this kind carries no action (the outbox retry walks parked rows only; the 30 s pass is the retry)', r && r.action === undefined && !/press|button/i.test(r.words) && /tell support/.test(r.words), JSON.stringify(r));
    S.expense(10 * 60000);
    const two = await S.row();
    ok('two bills → plural words', two.count === 2 && /^2 bills are not in your books yet/.test(two.words), JSON.stringify(two));
  });

  await section('T3 · a bill younger than the grace is not counted; a bill with a Waiting row is not counted twice', async () => {
    const S = await shop();
    S.expense(30 * 1000);
    ok('30 s old (inside the 120 s grace) → no row', (await S.row()) === undefined);
    const c = S.expense(10 * 60000);
    ok('past grace → 1', (await S.row()).count === 1);
    await S.X.store.queue(S.X.db, SHOP, { source_chit_id: c.chit_id, source_ref: 'chit:' + c.chit_id, event: { job: 'chit', chit_id: c.chit_id, todo: 'record' }, why: 'The month is locked' });
    ok('the same bill now shown as a Waiting row → 0 for this kind (counted once)', (await S.row()) === undefined);
  });

  await section('T4 · after a reconcile pass the row is gone (the bill is posted)', async () => {
    const S = await shop(); const back = quiet();
    const c = S.expense(10 * 60000);
    ok('before: 1', (await S.row()).count === 1);
    const out = await S.R.tick();
    ok('the pass posts it once', out.posted === 1 && S.entries(c).length === 1, JSON.stringify(out));
    ok('after: the row is gone', (await S.row()) === undefined);
    back();
  });

  await section('T5 · afterChit throws (postChit rejects) and the park fails too: the owner hears of it, the pass ends it posted', async () => {
    const S = await shop(); const back = quiet();
    const c = S.expense(10 * 60000);
    const postReal = S.X.B.postEntry, queueReal = S.X.store.queue;
    S.X.B.postEntry = async () => { throw new Error('timeout exceeded when trying to connect'); };
    S.X.store.queue = async () => { throw new Error('timeout exceeded when trying to connect'); };
    await S.K.afterChit(SHOP, c.chit_id);
    S.X.B.postEntry = postReal; S.X.store.queue = queueReal;
    ok('no entry and NO waiting row — the silent hole', S.entries(c).length === 0 && S.openOutbox().length === 0);
    ok('…and the To do now says it', (await S.row()).count === 1);
    await S.R.tick();
    ok('one pass later: posted, row gone', S.entries(c).length === 1 && (await S.row()) === undefined);
    back();
  });

  await section('T6 · afterChit throws but the park succeeds: it ends PARKED (a Waiting row), not in this kind', async () => {
    const S = await shop(); const back = quiet();
    const c = S.expense(10 * 60000);
    const postReal = S.X.B.postEntry;
    S.X.B.postEntry = async () => { throw new Error('boom'); };
    await S.K.afterChit(SHOP, c.chit_id);
    S.X.B.postEntry = postReal;
    ok('a named Waiting row exists for the chit, no entry', S.openOutbox().some((x) => x.source_chit_id === c.chit_id) && S.entries(c).length === 0, JSON.stringify(S.openOutbox()));
    ok('…and this kind is 0 (it is the Waiting row that speaks)', (await S.row()) === undefined);
    back();
  });

  await section('T7 · the row fits the closed output shape of GET /api/books/todo (a kind with no button must not break it)', async () => {
    const S = await shop();
    S.expense(10 * 60000);
    const shape = require(path.join(H.API, 'lib', 'output-allowlist.js')).shapeOf('GET /api/books/todo');
    ok('the shape is closed, rows list their keys', shape && shape.schema.items.additionalProperties === false, JSON.stringify(shape && shape.schema.items));
    const fits = require(path.join(H.API, 'middleware', 'validate.js')).bodyEngine.compile(shape.schema);
    const rows = await S.BT.todo(SHOP, await S.X.B.settingOf(S.X.db, SHOP));
    const wire = JSON.parse(JSON.stringify(rows));
    ok('the bills_not_in_books row (no action key at all) fits the output shape', wire.some((x) => x.kind === KIND && !('action' in x)) && fits(wire), JSON.stringify(fits.errors));
    const required = shape.schema.items.required || [];
    ok('action is not required (kind, count, words are), so a kind without a button stays inside the shape', !required.includes('action') && ['kind', 'count', 'words'].every((key) => required.includes(key)), JSON.stringify(required));
    ok('every row produced is a listed KIND and fits (a future kind that breaks the shape goes red here)', wire.every((x) => S.BT.KINDS.includes(x.kind)) && fits(wire));
  });

  console.log('\n' + (fail ?'  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
