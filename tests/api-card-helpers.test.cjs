/**
 * tests/api-card-helpers.test.cjs — THE REGISTER'S DERIVED reads/writes FOLLOW A FUNCTION SPLIT INTO SAME-FILE HELPERS (MNT-12 readability work).
 *
 * OWNS      unit checks of tools/api-card.cjs reachableText / privateHelper / functionText (no database, no server).
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      write a tiny route file and a lib file into a temp folder ──▶ reachableText from a handler ──▶ tablesOf ──▶ assert writes listed
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const card = require(path.join(__dirname, '..', 'tools', 'api-card.cjs'));

let pass = 0;
let fail = 0;
const t = (name, ok) => {
  if (ok) (pass++, console.log('  ok  ' + name));
  else (fail++, console.log('  XX  ' + name));
};
console.log('\napi card · derived reads and writes follow same-file helpers');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-card-'));
const routeFile = path.join(dir, 'route.js');
const libFile = path.join(dir, 'lib.js');
const known = new Set(['widget', 'gadget', 'sprocket', 'cog']);
fs.writeFileSync(
  libFile,
  [
    'async function enable(db, input) {',
    '  return enableOn(db, input);', // route -> enable (one hop) -> enableOn (private helper)
    '}',
    'async function enableOn(db, input) {',
    '  await seedWidgets(db, { input });', // private helper with a DESTRUCTURED parameter
    '}',
    'async function seedWidgets(db, { input }) {',
    "  await db.query(`INSERT INTO widget (id) VALUES ($1)`, [input]);",
    '}',
    'async function peek(db) {',
    '  return lookA(db);',
    '}',
    'async function lookA(db) { return lookB(db); }',
    'async function lookB(db) { return mid(db); }',
    'async function mid(db) { return shared(db); }',
    // mid is called from lookB AND other(): not private, so it costs a level, and shared (also called by other) is not private and sits beyond the depth: its write must NOT leak to a read-only route
    'async function shared(db) { await db.query(`INSERT INTO cog (id) VALUES (1)`); }',
    'async function other(db) { await mid(db); return shared(db); }',
    'module.exports = { enable, peek, other };',
    ''
  ].join('\n')
);
const handler = "async (req, res) => { await B.enable(null, req.body); res.json({}); }";
const peekHandler = "async (req, res) => { await B.peek(null); res.json({}); }";
fs.writeFileSync(routeFile, "const B = require('./lib');\nconst h = " + handler + ';\nconst p = ' + peekHandler + ';\n');
const fileText = fs.readFileSync(routeFile, 'utf8');
const writesOf = (source) => card.tablesOf(card.reachableText(source, fileText, routeFile, 2), known).writes;

t('a handler that writes through a private same-file helper chain (enable, enableOn, seedWidgets) lists the write', writesOf(handler).join() === 'widget');
t('a destructured parameter list in the helper does not hide its body', writesOf(handler).includes('widget'));
t('a shared helper beyond the depth does not leak its write onto a read-only route', writesOf(peekHandler).length === 0);
t('privateHelper: one call site is private, two are not', card.privateHelper('function a(){ b(); }\nfunction b(){}', 'b') && !card.privateHelper('function a(){ b(); b(); }\nfunction b(){}', 'b'));
t('privateHelper: a method call or a name that is not defined here is not a private helper', !card.privateHelper('function a(){ x.b(); }\nfunction b(){}', 'b') && !card.privateHelper('function a(){ c(); }', 'c'));

t('privateHelper: a call that is only in a comment is no call (one real call plus a comment mention is still private; a comment alone is not)', card.privateHelper('function a(){ b(); }\n// b(x) is also mentioned here\nfunction b(){}', 'b') && !card.privateHelper('function a(){ /* b() */ }\nfunction b(){}', 'b'));
t('privateHelper: count(*) inside an SQL string is no call, so a function called count is not followed from it', !card.privateHelper('function a(){ q(`SELECT count(*) FROM t`); }\nfunction count(){}', 'count'));
t('privateHelper: a const that merely holds a value of that name is not a function', !card.privateHelper('function a(){ list(); }\nconst list = [1, 2];', 'list') && card.privateHelper('function a(){ list(); }\nconst list = async (db) => db;', 'list'));

/* a piece reached only by a bare name (it may be a name collision) does not hand out its private helpers; a comment never names a helper */
const route2 = path.join(dir, 'route2.js');
const lonely = 'async (req, res) => { await row(); res.json({}); }'; // a bare-name call
fs.writeFileSync(route2, ['const B = require("./lib");', 'async function row() { return rowMid(); }',
  'async function rowMid() { return rowTail(); }', 'async function rowTail() { await db.query(`INSERT INTO sprocket (id) VALUES (1)`); }', 'async function enable() { await db.query(`INSERT INTO gadget (id) VALUES (1)`); }', ''].join('\n'));
const text2 = fs.readFileSync(route2, 'utf8');
const writes2 = (source) => card.tablesOf(card.reachableText(source, text2, route2, 2), known).writes;
t('a piece reached only by a bare name (it may be a name collision) hands out no free hops: row, rowMid and rowTail sit one costly hop each, so rowTail is out of depth 2', writes2(lonely).join() === '');

/* the committed register: the false facts the first version of the free hop produced stay out (a regression for each cause: a name inside an SQL string, a value called like a helper, a name inside a comment) */
const registered = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'api-register.json'), 'utf8')).routes;
const rowOf = (key) => registered.find((item) => item.key === key) || { reads: ['?'], writes: ['?'] };
t('GET /api/till/verify does not read customer_list or supplier_list (count(*) in its SQL is no call)', !rowOf('GET /api/till/verify').reads.some((table) => ['customer_list', 'supplier_list'].includes(table)));
t('GET /api/relationships/suppliers writes nothing (a `const list` is not a helper called list)', rowOf('GET /api/relationships/suppliers').writes.length === 0);
t('POST /api/till/quick-keys/hide does not read counter_hidden_item (a name in a comment is no call)', !rowOf('POST /api/till/quick-keys/hide').reads.includes('counter_hidden_item'));

/* money is a money column, not a due DATE: due_at and a count are not money; due_minor, amount_due and balance_due are */
t('moneyOf: a due date (due_at) is not money', !card.moneyOf('`SELECT due_at FROM party_followup WHERE entity_id = $1`', false));
t('moneyOf: due_minor, amount_due and balance_due are money', card.moneyOf('`SELECT due_minor FROM party_item`', false) && card.moneyOf('`SELECT amount_due FROM party_item`', false) && card.moneyOf('`SELECT balance_due FROM party_item`', false));
t('moneyOf: a bare total (a count as often as a sum) is not money; total_value, total_minor and a SUM of an amount are', !card.moneyOf('`SELECT count(*)::int AS total FROM privacy_request`', false) && !card.moneyOf('`WITH c AS (SELECT 1 AS n) SELECT total FROM c`', false) && card.moneyOf('`SELECT total_value FROM chit_header`', false) && card.moneyOf('`SELECT SUM(amount_minor) AS total FROM party_item`', false));

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
