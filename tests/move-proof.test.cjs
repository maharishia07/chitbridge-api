/**
 * move-proof.test.cjs — D1 (batch 1130): the proof that a moved route handler is the same code (tools/move-proof.cjs).
 * Each PROVEN case is a real shape of a split or a tidy; each REFUSED case is a change a human must read (a call swapped, a line added,
 * a property or shorthand key renamed, a free name renamed, a declaration list that is not one).
 * Run: node tests/move-proof.test.cjs
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const proof = require('../tools/move-proof.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const same = (base, head, bf, hf) => proof.proveSame({ file: bf || 'routes/a.js', handlers: [].concat(base) }, { file: hf || 'routes/a.js', handlers: [].concat(head) });

const H = 'async (req, res) => { const a = 1; const b = req.body.x; res.json({ a, b }); }';
ok('verbatim: comments and layout only', same(H, 'async(req,res)=>{ /* note */ const a=1;\n // c\n const b=req.body.x; res.json({a,b}); }').level === 'verbatim');
ok('verbatim: a handler that moved file is the same text', same(H, H, 'routes/a.js', 'routes/b.js').level === 'verbatim');
ok('require-path: the file moved a folder down', same("async (req, res) => { const m = require('../lib/m'); res.json(m.x()); }", "async (req, res) => { const m = require('../../lib/m.js'); res.json(m.x()); }", 'routes/a.js', 'routes/sub/a.js').level === 'require-path');
ok('require-path REFUSED: another file', !same("async (req, res) => { require('../lib/m'); }", "async (req, res) => { require('../lib/n'); }").proven);
ok('declaration-join: const a; const b -> const a, b', same('async (req,res) => { const a = f(1, 2); const b = g(a); res.json(b); }', 'async (req,res) => { const a = f(1, 2), b = g(a); res.json(b); }').level === 'declaration-join');
ok('declaration-join: a comma in a call is not a declaration', !same('async (req,res) => { const a = f(1); g(2); }', 'async (req,res) => { const a = f(1, 2); }').proven);
ok('declaration-join: an inner block keeps its own declaration', same('async (req,res) => { const f = () => { const x = 1; return x; }; const g = 2; res.json(f() + g); }', 'async (req,res) => { const f = () => { const x = 1; return x; }, g = 2; res.json(f() + g); }').level === 'declaration-join');
ok('local-rename: a const and every use', same('async (req,res) => { const id = req.params.id; res.json({ n: id, m: id + 1 }); }', 'async (req,res) => { const chitId = req.params.id; res.json({ n: chitId, m: chitId + 1 }); }').level === 'local-rename');
ok('local-rename: an arrow parameter', same('async (req,res) => { const r = rows.map((row) => row.id); res.json(r); }', 'async (req,res) => { const r = rows.map((item) => item.id); res.json(r); }').level === 'local-rename');
ok('local-rename REFUSED: a property is a read, not a name', !same('async (req,res) => { res.json(req.body.id); }', 'async (req,res) => { res.json(req.body.key); }').proven);
ok('local-rename REFUSED: shorthand key would change the answer', !same('async (req,res) => { const id = 1; res.json({ id }); }', 'async (req,res) => { const key = 1; res.json({ key }); }').proven);
ok('local-rename REFUSED: object key renamed', !same('async (req,res) => { const x = 1; res.json({ id: x }); }', 'async (req,res) => { const x = 1; res.json({ key: x }); }').proven);
ok('local-rename REFUSED: a free function swapped for another', !same('async (req,res) => { res.json(isTrue(req.body.a)); }', 'async (req,res) => { res.json(isOwner(req.body.a)); }').proven);
ok('local-rename REFUSED: only some uses renamed', !same('async (req,res) => { const a = 1; res.json(a + a); }', 'async (req,res) => { const b = 1; res.json(b + a); }').proven);
ok('local-rename REFUSED: two names merged into one', !same('async (req,res) => { const a = 1; const b = 2; res.json(a + b); }', 'async (req,res) => { const c = 1; const c2 = 2; res.json(c + c); }').proven);
ok('local-rename REFUSED: destructured key is a property read', !same('async (req,res) => { const { id } = req.body; res.json(id); }', 'async (req,res) => { const { key } = req.body; res.json(key); }').proven);
ok('REFUSED: a line added', !same(H, H.replace('res.json', 'audit(); res.json')).proven);
ok('REFUSED: a status changed', !same("async (req,res) => { res.status(404).json({}); }", "async (req,res) => { res.status(422).json({}); }").proven);
ok('REFUSED: a string changed', !same("async (req,res) => { res.json({ m: 'Pick a day' }); }", "async (req,res) => { res.json({ m: 'Pick a date' }); }").proven);
ok('REFUSED: a different number of handlers', !proof.proveSame({ file: 'a.js', handlers: ['a', 'b'] }, { file: 'a.js', handlers: ['a'] }).proven);
ok('a template literal expression is read as code', same('async (req,res) => { const q = 1; res.send(`x ${q} y`); }', 'async (req,res) => { const n = 1; res.send(`x ${n} y`); }').level === 'local-rename');
ok('a template literal text change is refused', !same('async (req,res) => { res.send(`x ${1} y`); }', 'async (req,res) => { res.send(`x ${1} z`); }').proven);
ok('a regex with a slash in a class is one token', proof.tokenize('const r = /[/]x/g; const d = a / b;').filter((t) => t.t === 're').length === 1);
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
