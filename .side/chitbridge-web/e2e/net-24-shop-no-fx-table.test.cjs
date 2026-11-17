/**
 * e2e/net-24-shop-no-fx-table.test.cjs — NET-24 (proof 2026-11-14): the public shop shows the seller's price unchanged, with no FX table.
 * @type regression
 * OWNS      static proof on public/shop.html: no FX / toINR / fxTable / FX_TABLE identifier in code (comments stripped), and priceVal(price) returns its
 *           argument unchanged (no viewer-region rate multiplied in).
 * MUTATION  NET24_MUTATE=1 puts a rate table and a multiplying priceVal back in memory (the pre-fix state); the test must then FAIL.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 *   node e2e/net-24-shop-no-fx-table.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
let html = fs.readFileSync(path.join(__dirname, '..', 'public', 'shop.html'), 'utf8');
if (process.env.NET24_MUTATE === '1') {
  html = html.replace(/function priceVal\(price\)\s*\{\s*return price;\s*\}/,
    'var FX = { IN: 1, US: 0.012 };\nfunction priceVal(price) { return price * FX[_REGION]; }');
}
const code = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
let fail = 0;
const ok = (name, cond) => { if (!cond) fail++; console.log((cond ? '   ok   ' : '   FAIL ') + name); };
ok('no FX / toINR / fxTable / FX_TABLE in shop.html code', !/\b(FX|toINR|fxTable|FX_TABLE)\b/.test(code));
ok('priceVal returns the seller price unchanged', /function priceVal\(price\)\s*\{\s*return price;\s*\}/.test(code));
console.log(fail ? 'FAIL net-24' : 'PASS net-24');
process.exit(fail ? 1 : 0);
