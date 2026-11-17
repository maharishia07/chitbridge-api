'use strict';
/* VERTICAL BOX (2026-10-18) — web side of VERT-1 / CTR-2 / CMP-1 / VERT-8. A box reads the trade the server resolved
   (api lib/govresolve.verticalOf); it never fills in a trade or a country of its own. Source-level plus the lane helpers run in node.
   Run: node tests/vertical-box.test.cjs */
const fs = require('fs'), assert = require('assert'), vm = require('vm');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };
const read = (f) => fs.readFileSync(__dirname + '/../public/' + f, 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

/* ── CMP-1 · the readiness screens ── */
const rd = read('app/cap-readiness.js');
ok(!/\|\|\s*'paint'|vertical:\s*'paint'|\|\|\s*'IN'\b|origin:\s*'IN'/.test(code(rd)), "CMP-1: cap-readiness.js has no 'paint' or 'IN' fallback left");
ok(!/vertical=paint|origin=IN/.test(read('know-your-business.html')), 'CMP-1: know-your-business asks /api/kyb/position with no paint / IN');
const lift = (name) => { const at = rd.indexOf('function ' + name + '('); return rd.slice(at, rd.indexOf('\n}', at) + 2); };
const cx = vm.createContext({ UI: {} });
vm.runInContext([lift('_laneVert'), lift('_laneOrigin'), lift('_laneQuery'), rd.slice(rd.indexOf('function _mapOrigin('), rd.indexOf('function _rdDestSelectors('))].join('\n'), cx);
const run = (s) => vm.runInContext(s, cx);
ok(JSON.stringify(run('_laneQuery({destination:"EU"})')) === '{"destination":"EU"}', 'CMP-1: nothing picked → the lane query sends no sector and no origin (the server answers)');
run('UI.laneVertical = "food"');
ok(run('_laneQuery({}).vertical') === 'food', "CMP-1: the person's sector pick still travels");
run('UI.laneVertical = null; UI.laneMatrix = { vertical: "paint", origin: "AU" }');
ok(run('_laneVert()') === 'paint' && run('_laneOrigin()') === 'AU', "CMP-1: the screen shows the server's resolved sector and stated origin");
run('UI.laneMatrix = null; UI.laneOrigin = null');
ok(run('_laneVert()') === null && run('_laneOrigin()') === null, 'CMP-1: unstated stays unstated (null), never paint / India');
ok(run('_mapOrigin("AU")') === 'AU' && run('_mapOrigin("")') === null && run('_mapOrigin("India")') === 'IN', 'CMP-1: _mapOrigin keeps another country as itself, never India');

/* ── CTR-2 · the counter ── */
const till = read('till.html');
const hs = till.slice(till.indexOf('function holdsStock(){'), till.indexOf('function modeWhy('));
ok(hs.indexOf('kotOn') < 0 && hs.indexOf('purposeHas') < 0 && /holds_stock === false/.test(hs), "CTR-2: holdsStock is the counter override, else the server's holds_stock — no kitchen / open-order branch");

/* ── VERT-8 · the Product Lab ── */
ok(/DATA\.pick \|\| DATA\.lists\[0\]\.key/.test(read('product-lab.html')), "VERT-8: the Product Lab opens on the list the server picked from the shop's trade");

console.log(n + ' checks');
