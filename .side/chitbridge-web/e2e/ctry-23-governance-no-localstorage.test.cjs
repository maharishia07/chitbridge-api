/**
 * e2e/ctry-23-governance-no-localstorage.test.cjs — CTRY-23 (proof 2026-11-14): the Governance card no longer writes currency / timezone / language to localStorage.
 * @type regression
 * OWNS      the proof, on the REAL public/app/cap-admin.js run whole in a vm sandbox, that govLayersBlock() for the Constitution layer (tab 0):
 *           (1) draws NO <select>/<input>/<textarea> for Currency, Timezone or Language (the three decoy controls are gone) and touches localStorage zero times;
 *           (2) shows the entity's/installation's ACTUAL currency, read-only: governed AED + entity record AED → "AED — from your installation, matched by your entity record";
 *               governed AED + entity record INR → the mismatch is SHOWN ("AED — governed. Your entity record says INR");
 *           (3) says plainly that Timezone and Language are "not stored anywhere yet", not offering a control;
 *           and that no CODE line anywhere in public/ reads or writes the key cb_govset (only comments name it).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 * FLOW      UI._me.governance.basics.currency + moneyCode() → govLayersBlock() → HTML → assertions
 *   node e2e/ctry-23-governance-no-localstorage.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadScript } = require('./lib/lift-fn.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 400) : '')); } };

function block(governed, record) {
  const touched = [];
  const ls = { getItem: (k) => { touched.push('get ' + k); return null; }, setItem: (k) => { touched.push('set ' + k); }, removeItem: (k) => { touched.push('remove ' + k); } };
  const sb = loadScript('public/app/cap-admin.js', {
    tx: (s) => s, esc: (s) => String(s), txn: (s) => s, specNote: () => '', SHOP_FIELDS: [], _CARD: '', localStorage: ls,
    UI: { _me: { governance: { basics: { currency: governed } } }, govTab: 0, nav: 'settings', govOpen: { yours: true, fixed: true, none: true } },
    moneyCode: () => record
  });
  touched.length = 0; /* only what the card itself does */
  return { html: sb.govLayersBlock(), touched };
}
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

let r = block('AED', 'AED');
const t = text(r.html);
ok('no <select>, <input> or <textarea> on the Constitution layer (the decoy controls are gone)', !/<(select|input|textarea)/i.test(r.html), (r.html.match(/<(select|input|textarea)[^>]*>/i) || [''])[0]);
ok('localStorage is not touched by drawing the card (cb_govset is not read or written)', r.touched.length === 0, JSON.stringify(r.touched));
ok('Currency shows the actual value read-only: "AED — from your installation, matched by your entity record"', t.includes('Currency AED — from your installation, matched by your entity record'), t.slice(t.indexOf('Currency'), t.indexOf('Currency') + 120));
ok('Timezone and Language say "not stored anywhere yet"', t.includes('Timezone not stored anywhere yet') && t.includes('Language not stored anywhere yet'), t);
r = block('AED', 'INR');
const t2 = text(r.html);
ok('governed AED vs entity record INR: the mismatch is SHOWN, not hidden', t2.includes('AED — governed. Your entity record says INR'), t2.slice(t2.indexOf('Currency'), t2.indexOf('Currency') + 160));

/* no code anywhere in public/ names the key */
const hits = [];
(function walk(d) {
  fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|vendor/.test(e.name)) walk(p); return; }
    if (!/\.(js|html)$/.test(e.name)) return;
    let inBlock = false;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const s = line.trim();
      if (inBlock) { if (s.includes('*/')) inBlock = false; return; }
      if (s.startsWith('/*') && !s.includes('*/')) { inBlock = true; return; }
      if (s.startsWith('/*') || s.startsWith('//') || s.startsWith('*')) return;
      if (/cb_govset/.test(s)) hits.push(path.relative(path.join(__dirname, '..'), p) + ':' + (i + 1));
    });
  });
})(path.join(__dirname, '..', 'public'));
ok('no code line in public/ reads or writes cb_govset (only comments name it)', hits.length === 0, hits.join(', '));

console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
