/**
 * tests/esc-prim.test.cjs — T2-WEBPRIMS: the ONE esc, the ONE money formatter, the ONE month list (app/helpers.js), and the guard that keeps them one.
 * Run: node tests/esc-prim.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const PUB = path.join(__dirname, '..', 'public');
const cx = vm.createContext({ localStorage: { getItem: () => null, setItem() {} }, document: { documentElement: { setAttribute() {}, style: {} }, addEventListener() {} }, navigator: { language: 'en-IN' } });
cx.window = cx; cx.self = cx;
vm.runInContext(fs.readFileSync(path.join(PUB, 'app', 'helpers.js'), 'utf8'), cx);
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

/* ── esc: & < > " ' — text and either quote of an attribute ── */
ok(cx.esc('&') === '&amp;', 'esc: & → &amp;');
ok(cx.esc('<b>') === '&lt;b&gt;', 'esc: < > → &lt; &gt;');
ok(cx.esc('"') === '&quot;', 'esc: " → &quot;');
ok(cx.esc("'") === '&#39;', "esc: ' → &#39; (the copies disagreed here; the home did not escape it)");
ok(cx.esc(`<a href="x" title='O'Brien'>&</a>`) === '&lt;a href=&quot;x&quot; title=&#39;O&#39;Brien&#39;&gt;&amp;&lt;/a&gt;', 'esc: all five in one string');
ok(cx.esc('&amp;') === '&amp;amp;', 'esc: escapes once per call (no double-guessing what is already escaped)');
ok(cx.esc(null) === '' && cx.esc(undefined) === '', 'esc: null / undefined → empty, never "null"');
ok(cx.esc(0) === '0' && cx.esc(12.5) === '12.5', 'esc: numbers as text');

/* ── fmtMoney: the empty word (widened, additive) and the no-engine fallback ── */
ok(cx.fmtMoney(null, 'INR', '—') === '—' && cx.fmtMoney('', 'INR', '') === '' && cx.fmtMoney('abc', 'INR', '—') === '—', 'fmtMoney: a missing amount reads as the given empty word');
ok(/₹\s?0\.00/.test(cx.fmtMoney(null, 'INR')), 'fmtMoney: two arguments — a missing amount still formats as zero, as before');
ok(/\$\s?12\.50/.test(cx.fmtMoney(12.5, 'USD')), 'fmtMoney: no locale engine on the page → the currency\'s own symbol from Intl, never ₹');
vm.runInContext(fs.readFileSync(path.join(PUB, 'app', 'locale.js'), 'utf8'), cx);
ok(cx.fmtMoney(123456.5, 'INR') === cx.CBLocale.money(123456.5, 'INR'), 'fmtMoney: with the engine it IS CBLocale.money');

/* ── monthNames: CBLocale's words, twelve, January first ── */
const s = cx.monthNames('short'), l = cx.monthNames('long');
ok(s.length === 12 && l.length === 12, 'monthNames: twelve');
ok(/^Jan/.test(s[0]) && /^Dec/.test(s[11]) && l[0] === 'January' && l[3] === 'April', 'monthNames: January first, in the reader\'s words (English here)');
ok(l.every((m, i) => m === cx.CBLocale.date(Date.UTC(2000, i, 15, 12), { month: 'long', timeZone: 'UTC' })), 'monthNames: the words are CBLocale.date\'s');

/* ── the guard sees every shape of a second copy (mutation) ── */
const G = require(path.join(__dirname, '..', 'e2e', 'prim-homes.cjs'));
const names = (src) => G.defsIn(src).map((d) => d.name);
[
  ['function esc(s){ return s; }', 'esc'], ['  var esc = function (s) { return s; };', 'esc'], ['const esc = (s) => s;', 'esc'],
  ['let escapeHtml = s => s;', 'escapeHtml'], ['function escHtml(s){}', 'escHtml'], ['function money(n){ return "₹"+n; }', 'money'],
  ["var M = ['Jan', 'Feb', 'Mar'];", 'months'], ['var M = ["January","February"];', 'months'],
  ["function h(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }", 'esc-body'],
  ["var t = String(x).replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; });", 'esc-body'],
].forEach(([src, want]) => ok(names(src).indexOf(want) >= 0, 'guard catches ' + want + ': ' + src.slice(0, 48)));
[
  'esc(x); fmtMoney(n, cur); x.esc(y);', 'var money = inr;', "var money = (typeof c.money === 'function') ? c.money : null;", 'function escRe(s){}', "var MON = monthNames('short');",
].forEach((src) => ok(names(src).length === 0, 'guard leaves alone: ' + src.slice(0, 48)));
const r = G.scan();
ok(r.bad.length === 0, 'the repo today: every definition outside helpers.js is named in ALLOW (' + r.found.map((x) => x.file.replace('public/', '') + ' ' + x.name).join(' · ') + ')');
ok(Object.keys(G.ALLOW).every((f) => Object.values(G.ALLOW[f]).every((v) => v <= 2)), 'ALLOW holds at most the counts of 14 Oct (it only shrinks)');
console.log('esc-prim: ' + n + ' passed');
