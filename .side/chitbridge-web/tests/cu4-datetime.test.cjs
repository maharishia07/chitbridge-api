/**
 * tests/cu4-datetime.test.cjs — CU4: ONE date-time stamp. fmtDateTime and the rail `when` print through CBLocale.datetime
 * in the READER's locale (fmtDateTime used to test `CBLocale.dateTime`, which does not exist, and print the OS locale);
 * `inr_` (always ₹) is gone. Run: node tests/cu4-datetime.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
process.env.TZ = 'Asia/Kolkata';
const P = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const store = {};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.document = { createElement: () => ({ setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, documentElement: { appendChild() {} }, addEventListener() {} };
eval(P('engine/locale.js'));
eval(P('app/rail-advice.js'));
const app = P('app.html');
const src = app.match(/^function fmtDateTime\(x\) ?\{[\s\S]*?^\}$/m);
assert(src, 'fmtDateTime is declared once in app.html');
const fmtDateTime = eval('(' + src[0] + ')');
const L = globalThis.CBLocale, at = '2026-10-09T10:25:00Z';

const seen = {};
for (const loc of ['en-GB', 'de-DE', 'ar-EG']) {
  store.cb_locale = loc;
  const d = fmtDateTime(at);
  assert.strictEqual(d, L.datetime(at, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), loc + ': fmtDateTime is CBLocale.datetime');
  assert(d && d !== 'Invalid Date', loc + ': a date, got ' + d);
  assert.strictEqual(globalThis.CBAdvice.stateWords({ state: 'shared', shared_at: at }), '↗ advice shared · ' + L.datetime(at), loc + ': the rail stamp is CBLocale.datetime');
  seen[loc] = d;
}
assert.notStrictEqual(seen['en-GB'], seen['de-DE'], 'the reader\'s locale changes the stamp');
assert(/2026|٢٠٢٦/.test(seen['en-GB']), 'fmtDateTime keeps the year: ' + seen['en-GB']);
assert.strictEqual(fmtDateTime(null), '', 'a missing stamp prints nothing');

/* the copies are gone: no `dateTime` typo, no private date+time joins, no always-₹ inr_ */
for (const f of ['app.html', 'app/rail-advice.js', 'app/rail-thread.js', 'app/rail-thread-words.js', 'app/chit-sheet.js', 'app/cap-admin.js', 'app/cap-chit2.js', 'app/helpers.js']) {
  const s = P(f);
  assert(!/CBLocale\.dateTime\b/.test(s), f + ': CBLocale.dateTime does not exist');
  assert(!/\binr_\s*\(/.test(s), f + ': inr_ is retired — inr prints the shop\'s currency');
  assert(!/fmtDateTime\([^)]*\)\.split\(/.test(s), f + ': a date is CBLocale.date, not a split date-time');
}
for (const f of ['app/rail-advice.js', 'app/rail-thread-words.js', 'app/chit-sheet.js']) assert(/CBLocale\.datetime\(ts\)/.test(P(f)), f + ': when() calls CBLocale.datetime');
console.log('cu4-datetime: all ok');
