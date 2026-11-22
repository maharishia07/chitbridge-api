/**
 * seat-matrix.test.cjs — AK-F-02 guard: docs/SEAT-MATRIX.md is what the code says today (tools/seat-matrix.cjs), and the books contract's declared staff seats agree with the route gates.
 * HAND-COMPUTED rows: POST /payments = owner yes, accountant yes, counter "money in", viewer no; POST /packs and POST /fx-rates = owner + accountant only; GET /trial-balance = owner + accountant (adviser and auditor read).
 * Run: node tests/seat-matrix.test.cjs   (regenerate: node tools/seat-matrix.cjs --write)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const tool = require('../tools/seat-matrix.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SEAT-MATRIX.md'), 'utf8').replace(/\r\n/g, '\n');
const built = tool.build();
ok('the doc equals what the code says (node tools/seat-matrix.cjs --write)', doc === tool.render());
ok('no unknown gate and no contract-vs-gate disagreement', built.problems.length === 0, built.problems.join('\n          '));
const row = (key) => built.rows.find((r) => r.key === key);
const cells = (key) => row(key).cells.map(String).join('|');
ok('pack and FX rates: owner + accountant (22 Nov decision item 5); revalue and the lock stay owner only', ['POST /packs', 'GET /packs', 'POST /fx-rates', 'POST /fx-rates/import'].every((key) => cells(key) === 'true|true|false|false') && ['POST /fx-revalue', 'POST /periods/:fy/:p/:act'].every((key) => cells(key) === 'true|false|false|false'));
ok('pay-out: the accountant records money in only (22 Nov decision item 5)', cells('POST /payments') === 'true|money in|money in|false');
ok('journal: owner + accountant only', cells('POST /entries') === 'true|true|false|false');
ok('trial balance: owner + accountant read, a counter and a viewer do not', /^true|(true|needs the Sees costs flag)|false|false$/.test(cells('GET /trial-balance'))); /* b1129: the report is cost-blind unless the seat Sees costs */
ok('a counter never reaches a supplier payment: propose and confirm carry the same gate', ['POST /payments/:id/propose', 'POST /payments/:id/confirm'].every((key) => row(key).cells[2] === 'money in'));
console.log((pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
