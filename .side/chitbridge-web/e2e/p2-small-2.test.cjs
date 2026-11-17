'use strict';
// @type: unit
/**
 * p2-small-2.test.cjs — two small UX fixes (2026-11-12, batch 2).
 *
 * UX-142: store.html uses the ONE shared toast (accounts-shell.js), not a copy with its own words, place and colours.
 * UX-101 (hardening only, the phone rule at offer-lab-next.html W33 already set min-width:0): the sheet floor is min(460px,100%).
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/accounts-shell
 * Run: node e2e/p2-small-2.test.cjs
 */
const fs = require('fs'), path = require('path');
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
let failed = 0;
const ok = (what, condition) => { console.log((condition ? '  ok   ' : '  FAIL ') + what); if (!condition) failed++; };

const store = pub('store.html'), shell = pub('app/accounts-shell.js');
const inline = store.slice(store.indexOf('<script>'));
const declared = (src) => new Set([...src.matchAll(/^(?:async\s+)?function\s+([\w$]+)|^(?:const|let|var)\s+([\w$]+)/gm)].map((m) => m[1] || m[2]));
const shellAt = store.indexOf('/app/accounts-shell.js'), ownScript = store.indexOf('\n<script>\n');
ok('UX-142 store.html loads the shared shell', shellAt > -1);
ok('UX-142 the shell loads before the page script that calls toast()', shellAt > -1 && shellAt < ownScript);
ok('UX-142 store.html declares no toast() of its own', !declared(inline).has('toast'));
ok('UX-142 store.html has no .toast style or #toast div of its own', !/\.toast\s*\{/.test(store) && !/id="toast"/.test(store));
ok('UX-142 the shared shell does define toast()', declared(shell).has('toast'));
const clash = [...declared(inline)].filter((n) => declared(shell).has(n));
ok('UX-142 no top-level name is declared by both (a clash would stop the page): ' + (clash.join(',') || 'none'), clash.length === 0);
ok('UX-142 the shared toast is lifted above the cart bar (body #toast bottom:74px)', /body #toast\s*\{[^}]*bottom:\s*74px/.test(store));

const sheetRule = pub('offer-lab-next.html').match(/\.sheet\{[^}]*\}/);
ok('UX-101 the lab sheet rule is found', !!sheetRule);
ok('UX-101 the sheet min-width gives way to a narrow screen (no fixed 460px)', !!sheetRule && !/min-width:\s*460px/.test(sheetRule[0]) && /min-width:\s*min\(460px,\s*100%\)/.test(sheetRule[0]));
process.exit(failed ? 1 : 0);
