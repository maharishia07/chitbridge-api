/**
 * e2e/double-fire.cjs — a double-click on Send must create ONE chit, not two.
 *
 * ⚠️⚠️ FOUND BY CROSS-CHECKING TEST-CASES.md AGAINST THE SUITE, WHICH IS THE POINT OF THAT EXERCISE. `B11
 * Idempotency — double-click Send quickly → only ONE chit created (double-fire lock)` has been written down as
 * a case since 2026-07-28, the lock exists in `api()`, and **nothing tested it**. The word "double-fire"
 * appears in no spec and no guard.
 *
 * ⭐ IT IS A CORRECTNESS PROPERTY, NOT A CONVENIENCE. Two chits from one click are two obligations on a
 * counterparty, two rows in their Task list and two things to dispute — created by an impatient double-click on
 * a slow connection, which is exactly when it is most likely.
 *
 * ⚠️ THE LOCK IS KEYED ON ENDPOINT **+ PARAMS**, and that detail is the whole design: sending two DIFFERENT
 * chits in quick succession must both go through. A lock on the endpoint alone would block the second, which is
 * a worse bug than the one it prevents — silently refusing legitimate work.
 *
 * ⚠️ AND GETs ARE DELIBERATELY FREE. Reading twice costs a round trip; writing twice costs a record. A lock on
 * reads would break every screen that refreshes while a fetch is in flight.
 *
 * Runs the REAL api() from core.js against a stub transport — no browser, no server.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const W = path.join(__dirname, '..', 'public');

let sent = [];
let release = null;                       /* held open so the second call lands mid-flight */

const sandbox = {
  console,
  CFG: { API_BASE: '', MODE: 'dev' },
  SESSION: { token: 't' },
  EP: {
    sendChit:  { m: 'POST', p: '/api/chits' },
    saveThing: { m: 'PUT',  p: '/api/things/:id' },
    listThing: { m: 'GET',  p: '/api/things' },
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  /* ⚠️ api() TOUCHES THE DOM BEFORE IT FETCHES — the busy indicator. A stub missing createElement threw
     INSIDE the call, so fetch was never reached and every assertion read '0 requests', which looks exactly
     like the lock blocking everything. A harness gap that fails in the shape of the bug under test. */
  document: {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, setAttribute() {},
      appendChild() {}, remove() {}, addEventListener() {} }),
    head: { appendChild() {} },
    documentElement: { classList: { add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} } },
    body: { classList: { add() {}, remove() {} }, appendChild() {} },
    dispatchEvent() {}, addEventListener() {},
  },
  CustomEvent: function () {},
  navigator: { onLine: true },
  setTimeout, clearTimeout,
  /* ⚠️ core.js LEANS ON GLOBALS THAT LIVE IN app.html — tx/txf for messages, esc for markup. Absent, api()
     throws INSIDE the call and fetch is never reached, so every count reads zero and the report looks exactly
     like the lock blocking everything. Two rounds of this harness failed in the shape of the bug under test. */
  tx: (s) => s, txf: (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (v || {})[k]),
  esc: (x) => String(x == null ? '' : x),
  cblog() {}, toast() {}, renderApp() {},
  /* ⚠️ core.js now registers a window 'error' listener as it loads (core.js:829) — a sandbox window without
     addEventListener died there, before the double-fire question was ever asked (2026-09-27) */
  addEventListener() {}, removeEventListener() {},
  fetch: (url, opts) => {
    sent.push((opts && opts.method) || 'GET');
    /* hold the first request open until the test lets it finish */
    return new Promise((resolve) => { release = () => resolve({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      json: async () => ({ ok: true, data: { id: 'c1' } }), text: async () => '{}',
    }); });
  },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(W, 'app', 'core.js'), 'utf8'), ctx, { filename: 'core.js' });

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.error('  ✗ ' + name + (extra ? '   ' + extra : '')); }
};

(async () => {
  console.log('\n── the same write, twice, while the first is still in flight ──');
  sent = [];
  const first = ctx.api('sendChit', { body: { subject: 'one' } });
  first.catch(() => {});
  let refused = null;
  try { await ctx.api('sendChit', { body: { subject: 'one' } }); }
  catch (e) { refused = e; }

  t('the second is refused', !!refused, refused ? refused.message : 'it went through');
  t('  …and only ONE request reached the network', sent.length === 1, sent.length + ' request(s)');
  /* ⚠️ THE MESSAGE MATTERS: a person who double-clicked must be told to wait, not shown a failure. */
  t('  …with a message that says wait, not fail',
    !!refused && /moment|already working/i.test(refused.message), refused && refused.message);

  if (release) release();
  await first.catch(() => {});

  console.log('\n── and the lock lets go once the first finishes ──');
  sent = [];
  const again = ctx.api('sendChit', { body: { subject: 'one' } });
  again.catch(() => {});
  t('a later send of the same thing is allowed', sent.length === 1, sent.length + ' request(s)');
  if (release) release();
  await again.catch(() => {});

  /**
   * ⚠️⚠️ THE CASE THAT MAKES THE KEY DESIGN LOAD-BEARING. Two DIFFERENT records must both go through. If the
   * lock were keyed on the endpoint alone, the second would be silently refused — a worse bug than the one the
   * lock prevents, because nothing is created and nothing says so.
   */
  console.log('\n── two DIFFERENT records at once ──');
  sent = [];
  const a = ctx.api('saveThing', { params: { id: 'aaa' }, body: {} }); a.catch(() => {});
  const holdA = release;
  let blocked = null;
  const b = ctx.api('saveThing', { params: { id: 'bbb' }, body: {} });
  b.catch((e) => { blocked = e; });
  await new Promise((r) => setTimeout(r, 10));
  t('both reach the network — the lock is per record, not per endpoint',
    sent.length === 2 && !blocked, sent.length + ' request(s)' + (blocked ? ', blocked: ' + blocked.message : ''));
  if (holdA) holdA(); if (release) release();
  await Promise.allSettled([a, b]);

  /* ⚠️ READS ARE FREE ON PURPOSE — a screen that refreshes while a fetch is in flight must not be refused. */
  console.log('\n── reads are not locked ──');
  sent = [];
  const g1 = ctx.api('listThing'); g1.catch(() => {});
  const hold1 = release;
  const g2 = ctx.api('listThing'); g2.catch(() => {});
  await new Promise((r) => setTimeout(r, 10));
  /**
   * ⚠️ MOVED 2026-09-27, not deleted. This asserted TWO requests. core.js has since JOINED identical in-flight reads
   * (_apiInflight — "IN FLIGHT ONLY, THIS IS NOT A CACHE", "READS ONLY", "EVERY JOINER GETS ITS OWN COPY"). What
   * this section guards — a read is never REFUSED the way a double write is — still holds, and is now asserted as:
   * one trip for two identical reads, BOTH answered, each with its own copy; and two different reads both go.
   */
  t('two identical concurrent GETs share ONE trip (joined, not refused)', sent.length === 1, sent.length + ' request(s)');
  if (hold1) hold1(); if (release) release();
  const both = await Promise.allSettled([g1, g2]);
  t('  ...and BOTH callers get an answer', both.every((x) => x.status === 'fulfilled'), both.map((x) => x.status).join(','));
  t('  ...each its own copy, so one screen\'s edit cannot appear in another',
    both[0].value !== undefined && both[0].value !== both[1].value && JSON.stringify(both[0].value) === JSON.stringify(both[1].value));
  sent = [];
  const h1 = ctx.api('listThing', { params: { page: 1 } }); h1.catch(() => {});
  const holdH = release;
  const h2 = ctx.api('listThing', { params: { page: 2 } }); h2.catch(() => {});
  await new Promise((r) => setTimeout(r, 10));
  t('two DIFFERENT concurrent GETs both go', sent.length === 2, sent.length + ' request(s)');
  if (holdH) holdH(); if (release) release();
  await Promise.allSettled([h1, h2]);

  console.log('\n  ══ ' + pass + ' passed · ' + fail + ' failed ══\n');
  process.exit(fail ? 1 : 0);
})();
