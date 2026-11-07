/**
 * tests/books-reconcile.test.cjs — ACC-266: A SAVED BILL IS NEVER LEFT WITHOUT ITS LEDGER ENTRY (plan + critic C1–C6, M1–M6).
 *
 * OWNS      the proof of lib/books-reconcile.js (the 30 s derived-outbox pass), the C3 postEntry duplicate answer, the C1 predicate, the /health figures, the C5 dropped copy.
 * CALLED BY the test library (api T1). Needs the books engines: BOOKS_ENGINES_SRC=C:/dev/chitbridge-engines/src. Run: node tests/books-reconcile.test.cjs
 * ⚠️ The store here is the in-memory one; its journal REFUSES a second source_ref with code 23505 + constraint journal_entry_src_uq, exactly as the real index does.
 *    The SQL itself is proved structurally (the predicate's clauses, the tender words against modeOf); the integration job runs it on Postgres.
 * CARD      14-accounting/books-health-to-do-outbox
 */
'use strict';
const path = require('path');
const fs = require('fs');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
async function section(title, fn) { console.log('\n── ' + title + ' ──'); try { await fn(); } catch (e) { fail++; console.log('   FAIL threw: ' + (e && e.stack || e)); } }
const SHOP = '11111111-1111-4111-8111-111111111111';
const MALA = '22222222-2222-4222-8222-222222222222';
const inv = (taxable, tax) => ({ currency: 'INR', ItemList: [{ GstRt: 18, AssAmt: taxable, CgstAmt: tax / 2, SgstAmt: tax / 2, IgstAmt: 0, CesAmt: 0 }], ValDtls: { TotInvVal: taxable + tax } });
let seq = 0;
const cid = () => 'e0000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
const NOW = Date.now();
const ago = (ms) => new Date(NOW - ms).toISOString();

/** a switched-on shop, the hooks, a tax-copy that reads the chits we hand it, and a reconciler wired to the in-memory store */
async function shop(grain) {
  const X = H.load({});
  X.T.parties.push({ owner: SHOP, party_id: MALA, party_no: 'P-00001', name: 'Mala', customer: true, credit_days: 10 });
  await X.B.enable(X.db, SHOP, { by: SHOP, today: '2026-09-29', walkin_grain: grain || 'day' });
  X.T.setting.get(SHOP).enabled_at = '2026-09-29T00:00:00.000Z';
  const K = require(path.join(H.API, 'lib', 'books-hooks')); K.forget(SHOP);
  const R = require(path.join(H.API, 'lib', 'books-reconcile')); R.reset();
  const TC = require(path.join(H.API, 'lib', 'tax-copy'));
  const chits = new Map();
  TC.copyOf = async (id) => chits.get(String(id)) || null;
  TC.entryFor = async (c) => (c.business_json && c.business_json.bill_no ? { sells: true, invoice: inv(100, 18) } : {});
  const put = (c) => { chits.set(String(c.chit_id), c); return c; };
  const expense = (age) => put({ chit_id: cid(), purpose: 'expense', created_at: ago(age), business_json: { expense: { what: 'tea', mode: 'Cash', amount: 40 } } });
  const walkin = (age) => put({ chit_id: cid(), purpose: 'order', created_at: ago(age), currency_code: 'INR', walkin: true,
    business_json: { bill_no: 'C1-' + seq, till: { id: 'C1' }, billed_at: ago(age), payment: { parts: [{ how: 'Cash', amount: 118 }] } } });
  const party = (age) => put({ chit_id: cid(), purpose: 'order', created_at: ago(age), currency_code: 'INR',
    business_json: { bill_no: 'P-' + seq, till: { id: 'C1' }, billed_at: ago(age), customer: { party_id: MALA }, payment: { parts: [{ how: 'Cash', amount: 118 }] } } });
  /* the predicate, as the SQL says it: no entry of its own, no open waiting row, inside [from, to), not in skipIds, open-day walk-ins left out when asked */
  const calls = [];
  const pred = (e, from, to, opt) => Array.from(chits.values()).filter((c) => {
    const o = opt || {};
    if ((c.entity_id || SHOP) !== e) return false; /* the SQL's h.entity_id = $1: a chit_id is per shop copy */
    if (!(c.created_at >= from && c.created_at < to)) return false;
    if (X.T.entries.some((x) => x.entity_id === e && (x.source_ref === 'chit:' + c.chit_id || x.source_ref === 'bill:' + c.chit_id || (x.source_chit_ids || []).indexOf(c.chit_id) >= 0))) return false;
    if (X.T.outbox.some((x) => x.done_at == null && x.source_chit_id === c.chit_id)) return false;
    if ((o.skipIds || []).indexOf(c.chit_id) >= 0) return false;
    if (o.skipWalkin && c.walkin) return false;
    return true;
  }).sort((p, q) => String(p.created_at).localeCompare(String(q.created_at)));
  X.store.unpostedInWindow = async (db, e, from, to, limit, opt) => { calls.push({ fn: 'list', from, to, opt }); return pred(e, from, to, opt).slice(0, limit).map((c) => ({ chit_id: c.chit_id })); };
  X.store.unpostedCount = async (db, e, from, to, opt) => { calls.push({ fn: 'count', from, to, opt }); const l = pred(e, from, to, opt); return { count: l.length, oldest: l.length ? l[0].created_at : null }; };
  let lockFree = true;
  Object.assign(R._D, {
    now: () => Date.now(),
    shops: async () => [SHOP],
    withEntity: async (s, fn) => fn({ query: async (t, v) => (/pg_try_advisory_xact_lock/.test(t) ? { rows: [{ got: lockFree }] } : X.db.query(t, v)) }),
    busy: () => false
  });
  const entriesOf = (c) => X.T.entries.filter((x) => x.source_ref === 'chit:' + c.chit_id || x.source_ref === 'bill:' + c.chit_id);
  return { X, K, R, TC, chits, expense, walkin, party, calls, entriesOf, setLock: (v) => { lockFree = v; }, openOutbox: () => X.T.outbox.filter((x) => x.done_at == null) };
}
const quiet = () => { const L = require(path.join(H.API, 'lib', 'logger')); const w = L.warn, i = L.info; L.warn = () => {}; L.info = () => {}; return () => { L.warn = w; L.info = i; }; };

(async () => {
  console.log('\n══ ACC-266 — the reconciler: a saved bill is never left without its ledger entry ══');
  if (!H.enginesSrc().dir) { console.log('\n   SKIP: ' + H.enginesSrc().why + '\n'); process.exit(1); }

  await section('T1 · the hook dies before postChit (pool timeout on the switch): no row, then the pass posts it once', async () => {
    const S = await shop(); const back = quiet();
    const c = S.expense(10 * 60000);
    const real = S.X.store.setting; S.X.store.setting = async () => { throw new Error('timeout exceeded when trying to connect'); };
    const r = await S.K.afterChit(SHOP, c.chit_id);
    S.X.store.setting = real;
    ok('afterChit swallowed it: { off | failed }, no entry, no waiting row', (r.off || r.failed) && S.entriesOf(c).length === 0 && S.openOutbox().length === 0, JSON.stringify(r));
    ok('…and the swallow is COUNTED (books_switch_unread), no longer only a log line', S.R.health().books_switch_unread === 1, JSON.stringify(S.R.health()));
    const out = await S.R.tick();
    ok('one pass posts it, exactly one entry', out.posted === 1 && S.entriesOf(c).length === 1, JSON.stringify(out));
    ok('…and /health says 0 unposted, a pass has completed (age is a number)', S.R.health().books_unposted === 0 && typeof S.R.health().books_reconcile_age_s === 'number', JSON.stringify(S.R.health()));
    const again = await S.R.tick();
    ok('a second pass finds nothing and posts nothing more', again.posted === 0 && S.entriesOf(c).length === 1);
    back();
  });

  await section('T2 · postChit throws AND the park throws (both pool timeouts): nothing parked; the pass still posts it (the 72-bill case)', async () => {
    const S = await shop(); const back = quiet();
    const c = S.expense(10 * 60000);
    const postReal = S.X.B.postEntry, queueReal = S.X.store.queue;
    S.X.B.postEntry = async () => { throw new Error('timeout exceeded when trying to connect'); };
    S.X.store.queue = async () => { throw new Error('timeout exceeded when trying to connect'); };
    const r = await S.K.afterChit(SHOP, c.chit_id);
    S.X.B.postEntry = postReal; S.X.store.queue = queueReal;
    ok('the bill has no entry and NO waiting row (the hole)', S.entriesOf(c).length === 0 && S.openOutbox().length === 0 && r.queued, JSON.stringify(r));
    ok('…the lost park is counted (books_outbox_lost)', S.R.health().books_outbox_lost === 1, JSON.stringify(S.R.health()));
    const before = await S.X.store.unpostedCount(null, SHOP, ago(86400000), ago(120000), { skipWalkin: true });
    ok('…the count sees it', before.count === 1);
    const out = await S.R.tick();
    ok('the pass posts it, one entry, count back to 0', out.posted === 1 && S.entriesOf(c).length === 1 && S.R.health().books_unposted === 0, JSON.stringify(out));
    back();
  });

  await section('T3 · RACE (M4): the inline post and the pass on one chit, 200 interleavings, against a journal that enforces the unique index', async () => {
    const S = await shop(); const back = quiet();
    const ES = S.X.store.entryBySource; let dupSeen = 0;
    S.X.store.entryBySource = async (...a) => { const v = await ES(...a); await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3))); return v; };
    const postReal = S.X.B.postEntry;
    S.X.B.postEntry = async (...a) => { const v = await postReal(...a); if (v && v.duplicate) dupSeen++; return v; };
    let bad = 0;
    for (let i = 0; i < 200; i++) {
      const c = S.expense(10 * 60000);
      await Promise.all([S.K.postChit(SHOP, c.chit_id, {}), S.R.tick(), S.K.postChit(SHOP, c.chit_id, {})]);
      if (S.entriesOf(c).length !== 1) bad++;
    }
    ok('200 chits: every one has exactly ONE entry (journal_entry_src_uq)', bad === 0, 'bad ' + bad);
    ok('…and ZERO open books_outbox rows (the loser of the race answered duplicate, it did not park "duplicate key")', S.openOutbox().length === 0, JSON.stringify(S.openOutbox().slice(0, 2)));
    ok('…the race really happened (the test bites): duplicates were answered', dupSeen > 0, 'dupSeen ' + dupSeen);
    back();
  });

  await section('T4 · grace, rolling 24 h window, and what the pass hands the finder', async () => {
    const S = await shop(); const back = quiet();
    const young = S.expense(60000), old = S.expense(23 * 3600000 + 50 * 60000), beyond = S.expense(25 * 3600000);
    await S.R.tick();
    ok('a chit younger than the 120 s grace is not touched (the inline post may still be on its way)', S.entriesOf(young).length === 0);
    ok('a bill 23 h 50 m old is the pass\'s (rolling 24 h, not "today")', S.entriesOf(old).length === 1);
    ok('a bill older than 24 h is the nightly\'s, not this pass\'s', S.entriesOf(beyond).length === 0);
    const list = S.calls.find((x) => x.fn === 'list');
    ok('the window handed to the finder is [now-24h, now-120s)', Math.abs((Date.parse(list.to) - (Date.now() - 120000))) < 5000 && Math.abs((Date.parse(list.from) - (Date.now() - 86400000))) < 5000, JSON.stringify(list));
    back();
  });

  await section('T5 · C1 / M5: 60 open-day walk-ins and ONE lost party bill, cap 50 — the party bill posts on the FIRST pass', async () => {
    const S = await shop('day'); const back = quiet();
    for (let i = 0; i < 60; i++) S.walkin(30 * 60000 - i * 1000); /* older than the party bill: oldest-first would fill the cap with them */
    const lost = S.party(5 * 60000);
    const out = await S.R.tick();
    ok('the party bill is in the books after ONE pass', S.entriesOf(lost).length === 1, JSON.stringify(out));
    ok('…the finder was told to leave the open-day walk-ins out (skipWalkin) and /health does not count them', S.calls.every((x) => x.opt && x.opt.skipWalkin === true) && S.R.health().books_unposted === 0, JSON.stringify(S.R.health()));
    back();
  });

  await section('T5b · C1 belt and braces: if the SQL missed them, `answered` reads each waiting walk-in ONCE', async () => {
    const S = await shop('day'); const back = quiet();
    const real = S.X.store.unpostedInWindow;
    S.X.store.unpostedInWindow = async (db, e, f, t, l, opt) => real(db, e, f, t, l, Object.assign({}, opt, { skipWalkin: false })); /* the walk-in clause "failed" */
    const real2 = S.X.store.unpostedCount;
    S.X.store.unpostedCount = async (db, e, f, t, opt) => real2(db, e, f, t, Object.assign({}, opt, { skipWalkin: false }));
    for (let i = 0; i < 60; i++) S.walkin(30 * 60000 - i * 1000);
    const lost = S.party(5 * 60000);
    const p1 = await S.R.tick();
    ok('pass 1 spends its cap on the 50 oldest (waiting for the day close), the party bill is not reached yet', p1.waiting === 50 && S.entriesOf(lost).length === 0, JSON.stringify(p1));
    const p2 = await S.R.tick();
    ok('pass 2 does NOT read those 50 again: the last 10 and the party bill are reached', p2.waiting === 10 && S.entriesOf(lost).length === 1, JSON.stringify(p2));
    back();
  });

  await section('T6 · pool guard BEFORE EVERY CHIT, global cap 50, round-robin across shops (C4)', async () => {
    const S = await shop(); const back = quiet();
    for (let i = 0; i < 30; i++) S.expense(10 * 60000 + i);
    let n = 0; S.R._D.busy = () => n++ >= 4; /* free for the shop's gate and 3 chits, busy from the 5th look */
    const calls0 = []; const pc = S.R._D.postChit; S.R._D.postChit = (...a) => { calls0.push(a[1]); return pc(...a); };
    const out = await S.R.tick();
    ok('the pass stops the moment the pool is busy: only the chits looked at while free were posted', calls0.length === 3 && out.skipped_busy === 1, JSON.stringify([calls0.length, out]));
    ok('…a pass the guard cut short is NOT a completed pass (books_reconcile_age_s stays null)', S.R.health().books_reconcile_age_s === null, JSON.stringify(S.R.health()));
    back();
    /* the cap and the rotation: three shops, 40 lost bills each, stubbed store and poster */
    S.R.reset();
    const shops = ['s1', 's2', 's3'], left = { s1: 40, s2: 40, s3: 40 }, order = [];
    Object.assign(S.R._D, {
      busy: () => false, shops: async () => shops, now: () => Date.now(),
      withEntity: async (s, fn) => fn({ query: async () => ({ rows: [{ got: true }] }), _s: s }),
      settingOf: async () => ({ enabled: true, walkin_grain: 'bill', enabled_at: '2020-01-01T00:00:00Z' }),
      store: () => ({
        unpostedCount: async (h) => ({ count: left[h._s], oldest: null }),
        unpostedInWindow: async (h, s, f, t, limit) => Array.from({ length: Math.min(limit, left[h._s]) }, (_, i) => ({ chit_id: h._s + '-' + i }))
      }),
      postChit: async (s, id) => { order.push(s); left[s]--; return { ok: true, entry_no: 'X' }; }
    });
    // per-shop handle carries its own shop: the stub withEntity above passes the shop through _s
    const p1 = await S.R.tick();
    ok('pass 1: the GLOBAL cap is 50 (40 from s1 + 10 from s2), s3 not reached', order.length === 50 && order.filter((x) => x === 's1').length === 40 && order.filter((x) => x === 's2').length === 10 && p1.capped, JSON.stringify([order.length, p1]));
    order.length = 0;
    await S.R.tick();
    ok('pass 2 starts where pass 1 stopped (s3 first): no shop is starved', order[0] === 's3' && order.filter((x) => x === 's3').length === 40, JSON.stringify(order.slice(0, 3)));
  });

  await section('T7 · advisory lock (M6): a shop another instance is sweeping is skipped, and posts nothing', async () => {
    const S = await shop(); const back = quiet();
    const c = S.expense(10 * 60000);
    S.setLock(false);
    const out = await S.R.tick();
    ok('lock not free → skipped_locked, no chit read, no entry', out.skipped_locked === 1 && S.entriesOf(c).length === 0 && S.calls.length === 0, JSON.stringify(out));
    S.setLock(true);
    const out2 = await S.R.tick();
    ok('lock free → posted', out2.posted === 1 && S.entriesOf(c).length === 1);
    const src = fs.readFileSync(path.join(H.API, 'lib', 'books-reconcile.js'), 'utf8');
    ok('the lock is the per-shop pg_try_advisory_xact_lock(hashtext(books-reconcile:<shop>))', /pg_try_advisory_xact_lock\(hashtext\(\$1\)\)/.test(src) && /'books-reconcile:' \+ shop/.test(src));
    back();
  });

  await section('T8 · M1: the sweep never runs — /health says so (books_reconcile_age_s: null → a number) and start() really starts it', async () => {
    const S = await shop(); const back = quiet();
    ok('before any pass: books_reconcile_age_s is null (SIT fails on null or > 90)', S.R.health().books_reconcile_age_s === null);
    ok('start() is off in a test run and with BOOKS_RECONCILE=0', S.R.start() === false);
    ok('start({force}) starts it', S.R.start({ force: true, first: 5, interval: 20 }) === true);
    for (let i = 0; i < 40 && S.R.health().books_reconcile_age_s === null; i++) await new Promise((r) => setTimeout(r, 25));
    S.R.stop();
    ok('after the timer fired once the age is a number — a pass really ran', typeof S.R.health().books_reconcile_age_s === 'number', JSON.stringify(S.R.health()));
    const srv = fs.readFileSync(path.join(H.API, 'server.js'), 'utf8');
    ok('server.js starts it at boot', /require\('\.\/lib\/books-reconcile'\)\.start\(\)/.test(srv));
    back();
  });

  await section('T9 · M2: sendBooks throws after the commit — the bill is still found; the swallowed hook is counted', async () => {
    const S = await shop(); const back = quiet();
    const c = S.expense(10 * 60000);
    const real = S.X.B.postEntry; S.X.B.postEntry = async () => { throw new Error('boom after commit'); };
    const r = await S.K.afterChit(SHOP, c.chit_id); S.X.B.postEntry = real;
    ok('the hook parked it or lost it; the chit never failed', !!r);
    S.X.T.outbox.length = 0; /* the crash left no row at all */
    const out = await S.R.tick();
    ok('the next pass posts it', S.entriesOf(c).length === 1 && out.posted === 1, JSON.stringify(out));
    const chits = require('../tools/chits-files.cjs').read(H.API); /* the ONE list of chits files */
    ok('routes/chits.js still schedules the hook after the commit and never awaits it (the bill\'s write is untouched)', /setImmediate\(/.test(chits.slice(chits.indexOf('hooks.afterChit(sender_id') - 400, chits.indexOf('hooks.afterChit(sender_id'))) && !/await hooks\.afterChit/.test(chits));
    back();
  });

  await section('T10 · the predicate (SQL): every clause the plan and the critic name, and the tender words equal modeOf', async () => {
    const src = fs.readFileSync(path.join(H.API, 'lib', 'books-store.js'), 'utf8');
    const shared = src.slice(src.indexOf('const TENDER_FOUR'), src.indexOf('async function cancelledStillPosted')); /* the predicate only: the next function also says 'cancelled', 'rejected' and hid a deleted clause */
    ok('one predicate: unpostedInWindow and unpostedCount both select FROM the same UNPOSTED_FROM', (src.match(/\$\{UNPOSTED_FROM\}|\$\{UNPOSTED_FROM\}/g) || []).length >= 0 && /SELECT h\.chit_id \$\{UNPOSTED_FROM\}/.test(src) && /count\(\*\)::int AS count, min\(h\.created_at\) AS oldest \$\{UNPOSTED_FROM\}/.test(src));
    ok('the clauses: own entry · day listing · payment · OPEN outbox row · cancelled/rejected · skipIds · walk-in', ['j.source_ref IN', 'source_chit_ids @>', 'books_payment', 'o.done_at IS NULL', "'cancelled', 'rejected'", '<> ALL ($5::uuid[])', '$4::boolean AND h.sender_entity_id = h.entity_id'].every((x) => shared.indexOf(x) >= 0));
    /* the walk-in tender words, run as JS regexes (\y → \b), against modeOf: a part is "ok" iff modeOf says a known non-credit mode */
    const four = new RegExp(/const TENDER_FOUR = '(.*)';/.exec(src)[1].replace(/\\\\y/g, '\\b')), credit = new RegExp(/const TENDER_CREDIT = '(.*)';/.exec(src)[1]);
    const okPart = (how) => { const w = String(how || '').toLowerCase().trim(); return four.test(w) || (!credit.test(w) && /cash/.test(w)); };
    const K = require(path.join(H.API, 'lib', 'books-hooks'));
    const words = ['Cash', 'cash', ' CASH ', 'UPI', 'GPay', 'Google Pay', 'PhonePe', 'card', 'Credit card', 'Visa', 'POS', 'pos machine', 'QR', 'qr code', 'cheque', 'Check', 'NEFT', 'bank transfer', 'credit', 'Udhaar', 'khata', 'on account', 'due', 'later', 'cash on delivery', 'cash due', 'barter', 'coupon', '', 'Paytm', 'bhim', 'posture', 'squirrel'];
    const bad = words.filter((w) => { const m = K.modeOf ? K.modeOf(w) : null; return okPart(w) !== (!!m && m !== 'credit'); });
    ok('the SQL tender words agree with books-hooks modeOf for ' + words.length + ' tenders', bad.length === 0 && typeof K.modeOf === 'function', JSON.stringify(bad) + ' modeOf exported: ' + typeof K.modeOf);
  });

  await section('T11 · C3a: postEntry answers the unique-index loser as duplicate:true (not an error)', async () => {
    const S = await shop();
    const ev = { type: 'sale_bill', date: '2026-09-30', currency: 'INR', party: MALA, source_ref: 'chit:race-1', source_chit_id: 'c0000000-0000-4000-8000-00000000000a', by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 };
    const ES = S.X.store.entryBySource; let first = true;
    S.X.store.entryBySource = async (...a) => { if (first) { first = false; return null; } return ES(...a); }; /* the read-before-insert saw nothing … */
    const a = await S.X.B.postEntry(S.X.db, SHOP, ev);
    const b = await S.X.B.postEntry(S.X.db, SHOP, ev); /* … and the second insert hits the unique index */
    S.X.store.entryBySource = ES;
    ok('the first posts; the one that loses the race answers { ok, duplicate: true } with the winner\'s entry_no', a.ok && !a.duplicate && b.ok && b.duplicate === true && b.entry_no === a.entry_no, JSON.stringify([a, b]));
    ok('…and exactly one entry exists', S.X.T.entries.filter((x) => x.source_ref === 'chit:race-1').length === 1);
  });

  await section('T12 · C5 / ACC-268: ledgerFor names the copy it could not read, and the GSTR route and the pack say so', async () => {
    const src = fs.readFileSync(path.join(H.API, 'lib', 'tax-copy.js'), 'utf8');
    ok('ledgerFor pushes the failed chit into `dropped` and returns it', /dropped\.push\(h\.chit_id\)/.test(src) && /ledger: monthLedger, dropped/.test(src));
    for (const [file, re, what] of [['routes/tax.js', /\(dropped \|\| \[\]\)\.length\) return problem/, 'GET /tax/gstr refuses a short month (422 GSTR_REFUSED)'], ['routes/tax.js', /dropped: dropped/, 'GET /tax/ledger carries `dropped`'], ['lib/books-pack.js', /led\.dropped && led\.dropped\.length\) pending\.push/, 'the pack puts a short GSTR-1 on `pending`, no half file'], ['routes/books.js', /ledgerCopy\.dropped \|\| \[\]/, 'the GSTR-3B comparison does not compare a short month']])
      ok(what, re.test(fs.readFileSync(path.join(H.API, file), 'utf8')));
    /* behaviour: the REAL ledgerFor on a fresh copy of the module, its db stubbed; copies the reader cannot build are named, not dropped in silence */
    const dbPath = require.resolve(path.join(H.API, 'db')), tcPath = require.resolve(path.join(H.API, 'lib', 'tax-copy'));
    const saved = [require.cache[dbPath], require.cache[tcPath]];
    const A = cid(), Bc = cid();
    const hdr = (id) => ({ chit_id: id, entity_id: SHOP, sender_entity_id: SHOP, purpose: 'order', created_at: ago(3600000), sent_at: ago(3600000), line_items: [], get business_json() { throw new Error('timeout exceeded when trying to connect'); } });
    require.cache[dbPath] = { exports: { query: async () => ({ rows: [{ gstn: '33AAAAA0000A1Z5', display_name: 'S', timezone: 'Asia/Kolkata', country: 'IN', policy_flags: {} }] }), withEntity: async (e, fn) => fn({ query: async () => ({ rows: [hdr(A), hdr(Bc)] }) }) } };
    delete require.cache[tcPath];
    const restoreLog = quiet();
    let r, why = null;
    try { r = await require(tcPath).ledgerFor(SHOP, new Date(NOW).toISOString().slice(0, 7)); } catch (e) { why = e.message; }
    restoreLog();
    require.cache[dbPath] = saved[0]; if (saved[1]) require.cache[tcPath] = saved[1]; else delete require.cache[tcPath];
    ok('copies the reader could not build come back in `dropped`, by chit id (ledger.count + dropped.length = copies read)', !why && Array.isArray(r.dropped) && r.dropped.length === 2 && r.dropped.indexOf(A) >= 0 && r.ledger.count === 0, why || JSON.stringify([r && r.dropped, r && r.ledger && r.ledger.count]));
  });



  await section('T13 · cross-shop (review 1): two shops hold the SAME chit_id — one shop\'s answer must not hide the other\'s copy', async () => {
    const R = require(path.join(H.API, 'lib', 'books-reconcile'));
    const keep = Object.assign({}, R._D); const back = quiet();
    R.reset();
    const A = 'a0000000-0000-4000-8000-00000000000a', B = 'b0000000-0000-4000-8000-00000000000b', X = cid();
    const copies = [{ entity_id: A, chit_id: X }, { entity_id: B, chit_id: X }]; /* chit_header PK (chit_id, entity_id, direction): sender and buyer share the id */
    const found = (e, opt) => copies.filter((c) => c.entity_id === e && (((opt || {}).skipIds || []).indexOf(c.chit_id) < 0)); /* the SQL: entity = $1 AND chit_id <> ALL(skipIds) */
    const posts = [];
    Object.assign(R._D, {
      now: () => Date.now(), shops: async () => [A, B], busy: () => false,
      withEntity: async (s, fn) => fn({ query: async () => ({ rows: [{ got: true }] }), _s: s }),
      settingOf: async () => ({ enabled: true, walkin_grain: 'bill', enabled_at: '2020-01-01T00:00:00Z' }),
      store: () => ({
        unpostedCount: async (h, e, f, t, opt) => ({ count: found(e, opt).length, oldest: null }),
        unpostedInWindow: async (h, e, f, t, limit, opt) => found(e, opt).slice(0, limit)
      }),
      postChit: async (e, id) => { posts.push(e); return e === A ? { waiting: true } : { queued: true }; } /* A: classify says "wait" (remembered); B: still not in the books */
    });
    await R.tick(); await R.tick();
    ok('B\'s copy is posted on EVERY pass (A\'s remembered `waiting` does not hide it), A\'s is read once', posts.filter((e) => e === B).length === 2 && posts.filter((e) => e === A).length === 1, JSON.stringify(posts.map((e) => e.slice(0, 1))));
    ok('…and /health COUNTS B\'s missing bill (books_unposted 1, not 0)', R.health().books_unposted === 1, JSON.stringify(R.health()));
    R.reset(); Object.assign(R._D, keep); back();
  });

  await section('T14 · C5 (review 3): the 422 names the bills it could not read, and says they need repair — no "try again"', async () => {
    const TC = require(path.join(H.API, 'lib', 'tax-copy')); const authPath = require.resolve(path.join(H.API, 'middleware', 'auth')), taxPath = require.resolve(path.join(H.API, 'routes', 'tax'));
    const savedAuth = require.cache[authPath], savedTax = require.cache[taxPath], realLedger = TC.ledgerFor;
    const passAuth = new Proxy((req, res, next) => next(), { get: (fn, key) => (key === 'entityOf' ? () => SHOP : typeof fn[key] === 'undefined' ? () => (req, res, next) => next() : fn[key]) });
    require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: passAuth }; delete require.cache[taxPath];
    const express = require('express'), http = require('http');
    const app = express(); app.use('/api/tax', require(taxPath));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const get = (p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: server.address().port, path: p }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, text: b })); }).on('error', reject));
    const ids = [1, 2, 3, 4, 5, 6, 7].map(() => cid());
    try {
      TC.ledgerFor = async () => ({ bounds: { period: '102026' }, me: {}, ledger: {}, dropped: ids });
      const r = await get('/api/tax/gstr?month=2026-10&form=gstr1');
      ok('422 with code GSTR_REFUSED', r.status === 422 && /GSTR_REFUSED/.test(r.text), r.status + ' ' + r.text.slice(0, 200));
      ok('…it names the first five dropped bills and counts the rest', ids.slice(0, 5).every((x) => r.text.indexOf(x) >= 0) && ids.slice(5).every((x) => r.text.indexOf(x) < 0) && /and 2 more/.test(r.text), r.text.slice(0, 400));
      ok('…it says they need repair and does NOT promise a retry', /need repair/.test(r.text) && !/try again in a minute/i.test(r.text), r.text.slice(0, 400));
    } finally {
      TC.ledgerFor = realLedger; server.close();
      if (savedAuth) require.cache[authPath] = savedAuth; else delete require.cache[authPath];
      if (savedTax) require.cache[taxPath] = savedTax; else delete require.cache[taxPath];
    }
  });

  await section('T15a · review 4: the cancelled/rejected clause of the SQL, applied by a fake — a cancelled copy is never handed to postChit', async () => {
    const S = await shop(); const back = quiet();
    const storeSrc = fs.readFileSync(path.join(H.API, 'lib', 'books-store.js'), 'utf8'); /* the harness swaps the store module, so the predicate is read as written: the UNPOSTED_FROM template only */
    const predicate = storeSrc.slice(storeSrc.indexOf('const UNPOSTED_FROM'), storeSrc.indexOf('async function cancelledStillPosted'));
    const clause = /FROM chit_status cs WHERE[^)]*current_status IN \(([^)]*)\)/.exec(predicate); /* the status list the predicate ACTUALLY carries */
    const excluded = clause ? clause[1].split(',').map((x) => x.replace(/['\s]/g, '')) : [];
    const was = S.X.store.unpostedInWindow, wasCount = S.X.store.unpostedCount;
    const keepOpen = (list) => list.filter((row) => excluded.indexOf((S.chits.get(String(row.chit_id)) || {}).status) < 0);
    S.X.store.unpostedInWindow = async (db, e, f, t, l, opt) => keepOpen(await was(db, e, f, t, l, opt));
    S.X.store.unpostedCount = async (db, e, f, t, opt) => { const rows = keepOpen(await was(db, e, f, t, 200, opt)); return { count: rows.length, oldest: null }; };
    const dead = S.expense(10 * 60000), rej = S.expense(11 * 60000), live = S.expense(12 * 60000);
    dead.status = 'cancelled'; rej.status = 'rejected';
    const asked = []; const pc = S.R._D.postChit; S.R._D.postChit = (s, id, o) => { asked.push(id); return pc(s, id, o); };
    await S.R.tick();
    ok('the SQL excludes cancelled and rejected (read from the text it sends)', excluded.indexOf('cancelled') >= 0 && excluded.indexOf('rejected') >= 0, JSON.stringify(excluded));
    ok('postChit is asked for the live bill only, never the cancelled or rejected copy', asked.length === 1 && asked[0] === live.chit_id, JSON.stringify(asked));
    S.R._D.postChit = pc; S.X.store.unpostedInWindow = was; S.X.store.unpostedCount = wasCount; back();
  });

  /* a handle that behaves like Postgres inside a transaction: after a failed statement every query is refused until ROLLBACK TO SAVEPOINT */
  const strictHandle = (S) => {
    const h = { aborted: false, log: [] };
    h.query = async (text, v) => {
      h.log.push(String(text));
      if (/^ROLLBACK TO SAVEPOINT/.test(text)) { h.aborted = false; return { rows: [] }; }
      if (/SAVEPOINT/.test(text)) return { rows: [] };
      if (h.aborted) throw new Error('current transaction is aborted, commands ignored until end of transaction block');
      return S.X.db.query(text, v);
    };
    return h;
  };
  const raceEvent = (ref) => ({ type: 'sale_bill', date: '2026-09-30', currency: 'INR', party: MALA, source_ref: ref, source_chit_id: 'c0000000-0000-4000-8000-0000000000b' + ref.length, by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 });

  await section('T15b · review 4: a unique violation on ANOTHER constraint is an error, not "duplicate"', async () => {
    const S = await shop(); const back = quiet();
    const ev = raceEvent('chit:other-uq');
    await S.X.B.postEntry(S.X.db, SHOP, ev); /* the source now has an entry, so a wrong "any 23505 is a duplicate" would find a winner and answer duplicate */
    const ES = S.X.store.entryBySource, IE = S.X.store.insertEntry; let first = true;
    S.X.store.entryBySource = async (...a) => { if (first) { first = false; return null; } return ES(...a); };
    S.X.store.insertEntry = async () => { throw Object.assign(new Error('duplicate key value violates unique constraint "journal_entry_no_uq"'), { code: '23505', constraint: 'journal_entry_no_uq' }); };
    let got = null, threw = null;
    try { got = await S.X.B.postEntry(S.X.db, SHOP, ev); } catch (e) { threw = e; }
    S.X.store.entryBySource = ES; S.X.store.insertEntry = IE;
    ok('a 23505 on journal_entry_no_uq is rethrown (never answered as duplicate)', !!threw && !got, JSON.stringify(got));
    back();
  });

  await section('T15c · review 4: after a duplicate the transaction is still usable (ROLLBACK TO SAVEPOINT ran)', async () => {
    const S = await shop(); const back = quiet();
    const ev = raceEvent('chit:sp-1'); const h = strictHandle(S);
    const ES = S.X.store.entryBySource, IE = S.X.store.insertEntry; let skipRead = false;
    S.X.store.entryBySource = async (...a) => { if (h.aborted) throw new Error('current transaction is aborted'); if (skipRead) { skipRead = false; return null; } return ES(...a); };
    S.X.store.insertEntry = async (...a) => { try { return await IE(...a); } catch (e) { h.aborted = true; throw e; } };
    const a = await S.X.B.postEntry(h, SHOP, ev);
    skipRead = true; /* the read-before-insert sees nothing, the insert hits journal_entry_src_uq and aborts the transaction */
    let b = null, why = null;
    try { b = await S.X.B.postEntry(h, SHOP, ev); } catch (e) { why = e.message; }
    S.X.store.entryBySource = ES; S.X.store.insertEntry = IE;
    ok('the loser reads the winner AFTER the rollback: { duplicate: true } with the winner\'s number', !why && b && b.duplicate === true && b.entry_no === a.entry_no, why || JSON.stringify(b));
    ok('…it opened a savepoint and rolled back to it', h.log.indexOf('SAVEPOINT books_post_src') >= 0 && h.log.indexOf('ROLLBACK TO SAVEPOINT books_post_src') >= 0, JSON.stringify(h.log));
    back();
  });
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
