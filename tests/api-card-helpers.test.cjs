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
    'async function lookB(db) { return shared(db); }',
    // shared is called from lookB AND from other(): not private, and beyond the depth: its write must NOT leak to a read-only route
    'async function shared(db) { await db.query(`INSERT INTO cog (id) VALUES (1)`); }',
    'async function other(db) { return shared(db); }',
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

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
