#!/usr/bin/env node
'use strict';
/**
 * prim-homes.cjs — ONE HOME PER PRIMITIVE (T2-WEBPRIMS, 14 Oct). Read by guard-static check 19 and by tests/esc-prim.test.cjs.
 *
 * ⚠️ WHY. `esc` was written 43 times in public/ and the copies disagreed on "'" — 30 escaped it, the home (app/helpers.js) did not.
 * A private `money()` printed `'₹' + n.toLocaleString('en-IN')` on labs whatever the shop's currency, and three files carried
 * their own Jan…Dec. Each copy was right the day it was written; the drift is what the guard is for.
 *
 *   esc · escapeHtml · escHtml   → app/helpers.js `esc` (escapes & < > " ')
 *   money                        → app/helpers.js `fmtMoney` (CBLocale.money, the shop's currency) — a function NAMED money is a second formatter
 *   a Jan…Dec / January… literal → app/helpers.js `monthNames` (CBLocale's words)
 *
 * NOT HELD: vendored engine copies (an `ADOPTED` header — engines own them, rule 2) and public/vendor/. The kit pages the api vendors
 * (till.html, promo.html) run on a shop PC that does not serve /app/helpers.js, so each keeps its ONE own copy — the count below, never more.
 *
 *   node e2e/prim-homes.cjs     → lists every definition outside its home; exit 1 when any is not allowed
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'public');
const HOME = 'public/app/helpers.js';

/** a DEFINITION of the name: `function esc(` · `var esc = function` · `const esc = (s) =>` · `let money = n =>` */
const DEF = /(?:^|[^\w$.])(?:function\s+(esc|escapeHtml|escHtml|money)\s*\(|(?:var|let|const)\s+(esc|escapeHtml|escHtml|money)\s*=\s*(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))/g;
/** a month-name list typed out: ['Jan','Feb' … or ["January", "February" … */
const MONTHS = /\[\s*(['"])Jan(?:uary)?\1\s*,\s*(['"])Feb(?:ruary)?\2/g;
/** an escaper by its BODY, whatever it is called (cbDefEsc · peE · h · labEsc were all esc): a replace that writes &amp; and &lt; on one line */
const ESC_BODY = /\.replace\([^\n]*['"]&amp;['"][^\n]*['"]&lt;['"]|\.replace\([^\n]*['"]&lt;['"][^\n]*['"]&amp;['"]/g;

/** file → name → how many it may keep, and why. ⚠️ It only shrinks. */
const ALLOW = {
  'public/till.html': { esc: 1, money: 1 },   // the counter: vendored from the api kit, runs offline — its own one helper (master: api tools/tally-connector/till.html)
  'public/promo.html': { money: 1 },          // the shop screen: vendored from the kit, same reason
  'public/app/cart.js': { money: 2 },         // CBCart.money(lines, o) — the cart's TOTALS calculator, not a formatter · money(ns, n) — picks the app's fmtMoney or the cart's CBCart.fmt (both CBLocale.money); formats nothing itself
  'public/app/list-ctl.js': { esc: 1 },      // CBList is a self-contained unit — e2e/list-unit.cjs traps every host global (esc too) and fails if the file borrows one
  'public/app/barcode.js': { 'esc-body': 1 }, // the Code 128 label inside an SVG string — built where no page (and no helpers.js) exists, e.g. e2e/barcode-check
};

function vendored(src) { return /\bADOPTED\b[^\n]{0,80}chitbridge-engines/.test(src.slice(0, 400)); }

function filesOf(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'vendor' || e.name === 'node_modules' ? [] : filesOf(p);
    return /\.(js|html)$/.test(e.name) ? [p] : [];
  });
}

/** every definition outside its home in one source → [{ name, line }] */
function defsIn(src) {
  const out = [];
  const lines = src.split('\n');
  lines.forEach((ln, i) => {
    DEF.lastIndex = 0; let m;
    while ((m = DEF.exec(ln))) out.push({ name: m[1] || m[2], line: i + 1 });
    MONTHS.lastIndex = 0;
    while ((m = MONTHS.exec(ln))) out.push({ name: 'months', line: i + 1 });
    ESC_BODY.lastIndex = 0;
    if (ESC_BODY.test(ln) && !DEF.test(ln)) out.push({ name: 'esc-body', line: i + 1 });
  });
  return out;
}

function scan() {
  const found = [], bad = [];
  filesOf(WEB).concat([path.join(ROOT, 'index.html')]).forEach((f) => {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (rel === HOME) return;
    const src = fs.readFileSync(f, 'utf8');
    if (vendored(src)) return;
    const defs = defsIn(src);
    if (!defs.length) return;
    const by = {};
    defs.forEach((d) => { (by[d.name] = by[d.name] || []).push(d.line); });
    Object.keys(by).forEach((n) => {
      found.push({ file: rel, name: n, lines: by[n] });
      const may = (ALLOW[rel] || {})[n] || 0;
      if (by[n].length > may) bad.push({ file: rel, name: n, lines: by[n], may });
    });
  });
  return { found, bad };
}

module.exports = { DEF, MONTHS, ESC_BODY, ALLOW, defsIn, scan, HOME };

if (require.main === module) {
  const { found, bad } = scan();
  found.forEach((x) => console.log('  ' + (bad.find((b) => b.file === x.file && b.name === x.name) ? '✗' : '·') + ' ' + x.file + ' ' + x.name + ' ×' + x.lines.length + ' (line ' + x.lines.join(', ') + ')'));
  const n = found.reduce((s, x) => s + x.lines.length, 0);
  console.log('prim-homes: ' + n + ' definition(s) outside ' + HOME + ' · ' + bad.length + ' not allowed');
  process.exit(bad.length ? 1 : 0);
}
