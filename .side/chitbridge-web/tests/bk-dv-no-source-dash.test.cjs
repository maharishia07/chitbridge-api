'use strict';
/* 17 Nov (first-impression, Fable fab1424b): the owner/adviser Day book shows a quiet dash for an entry whose Evidence state is "No source" (nothing to attach, not a fault), as the firm Day book does;
   "No tax invoice", "No file" and "Evidence n" keep their chip. The state is CBEvidence.stateOf's (the chip's own), never re-decided in cap-books.js.
   Run: node tests/bk-dv-no-source-dash.test.cjs */
const fs = require('fs'), assert = require('assert'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/../public/app/cap-books.js', 'utf8');
const ev = fs.readFileSync(__dirname + '/../public/app/cap-evidence.js', 'utf8');
const win = { document: { addEventListener() {}, getElementById: () => null, head: {}, createElement: () => ({ style: {}, setAttribute() {} }) }, tx: (s) => s };
vm.createContext(win);
vm.runInContext(ev, Object.assign(win, { window: win }));
const E = win.CBEvidence;
const a = src.indexOf('function bkDvEvState'), b = src.indexOf('function bkDvEvRank', a);
const ctx = { CBEvidence: E, BK: { ev: { chip: (e) => '<chip ' + e.id + '>' } } };
vm.createContext(ctx);
vm.runInContext(src.slice(a, b), ctx);
const line = src.split('\n').find((l) => l.includes("key: 'evidence', sort: 'evidence'"));
assert(line && line.includes("s.key === 'nodoc' ? '—' : BK.ev.chip(e)"), 'the evidence cell paints a dash for nodoc');
const cell = vm.runInContext('(function (e) { var s = bkDvEvState(e); return s && s.key === \'nodoc\' ? \'—\' : BK.ev.chip(e); })', ctx);
const states = {
  nodoc: { id: 'a', evidence: { doc: null, count: 0 } },
  none: { id: 'b', evidence: { doc: 'INV-1', count: 0 } },
  held: { id: 'c', evidence: { doc: 'INV-2', count: 2 } }
};
const keyOf = (e) => E.stateOf(e.evidence).key;
assert.strictEqual(keyOf(states.nodoc), 'nodoc');
assert.strictEqual(cell(states.nodoc), '—', 'No source: a dash');
assert.strictEqual(cell(states.none), '<chip b>', 'No file keeps its chip');
assert.strictEqual(cell(states.held), '<chip c>', 'a held file keeps its chip');
assert.strictEqual(cell({ id: 'd' }), '<chip d>', 'no evidence from the server: the chip decides');
console.log('PASS bk-dv-no-source-dash');
