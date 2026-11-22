#!/usr/bin/env node
'use strict';
/*
 * tools/seat-matrix.cjs — the one table of who may do what with the shop money (generated to docs/SEAT-MATRIX.md)
 * OWNER     cb-security
 * OWNS      the ONE table of who may do what with the shop's money (AK-F-02): every route of the books contract x the seats an owner can hand out, DERIVED from the code and written to docs/SEAT-MATRIX.md (generated, never hand-edited).
 * CALLED BY by hand (node tools/seat-matrix.cjs --write | --check | no argument prints) · tests/seat-matrix.test.cjs (a GUARD: the doc equals what the code says today; the declared seats agree with the gates)
 * FLOW      routes/books.js (each route's gate chain, in order) ──▶ each gate asked of a made-up seat with the REAL predicates (lib/owner isOwner · isInHouseAccountant, lib/access canEdit) ──▶ the row; adviser and auditor come from the contract's declared seats (lib/role-matrix, proved by tools/role-matrix-live.cjs)
 * CARD      28-platform-and-operations/api-standard
 *
 * The seats (columns): owner · accountant (a staff login with hat manager that can edit: RC-7) · counter (hat act, editor: the till seat, any plain editor) · viewer (read-only staff) · adviser and auditor (a firm under a live grant).
 * A gate the tool does not know prints "?" (and --check fails): a new gate must be taught here, in the one `passes` table, the day it is written.
 */
const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = '';
const root = path.join(__dirname, '..');
const owner = require('../lib/owner');
const access = require('../lib/access');
const matrix = require('../lib/role-matrix');
const contract = require('../lib/books-contract');

const person = (hat, level) => ({ api_key: null, identity: { identity_type: 'actor', parent_entity_id: 'shop', hat, access_level: level } });
const SEATS = [
  { key: 'owner', req: { api_key: null, identity: { identity_type: 'entity' } } },
  { key: 'accountant', level: 'manager', req: person('manager', 'editor') },
  { key: 'counter', level: 'editor', req: person('act', 'editor') },
  { key: 'viewer', level: 'viewer', req: person('view_only', 'viewer') }
];
/** each gate of a route's chain -> may this seat pass? (true | false | a sentence for a partial pass). The ONE table; the predicates are the code's own. */
const passes = (req) => ({
  owner: () => owner.isOwner(req),
  ownerOrAccountant: () => owner.isOwner(req) || owner.isInHouseAccountant(req),
  moneyReader: () => owner.isOwner(req) || owner.isInHouseAccountant(req) /* mayReadMoney also lets a live grant and the shop's auditor through: the adviser and auditor columns */,
  editor: () => owner.isOwner(req) || access.canEdit(req.identity),
  bankWriter: () => owner.isOwner(req) || owner.isInHouseAccountant(req) || false /* a firm under a live grant is the adviser column */,
  payOut: () => owner.isOwner(req) || 'money in' /* 22 Nov item 5: the accountant seat records money in only */,
  openingGate: () => owner.isOwner(req) || 'unless the owner asks to approve',
  costBlindStops: () => owner.isOwner(req) || (req.identity && req.identity.can_see_costs === true) || 'needs the Sees costs flag',
  noKey: () => true,
  on: () => true,
  onDues: () => true,
  onceOnly: () => true,
  auth: () => true,
  periodsReader: () => true
});
const KNOWN = Object.keys(passes({}));
/** the gate chain of every route of routes/books.js, in order: { 'GET /pl': ['auth', 'moneyReader', 'on'] } */
function chainOf(source) {
  const rows = {};
  const pattern = /router\.(get|post|patch|delete|put)\('([^']+)',([\s\S]*?)\.\.\.checked\('/g;
  let found;
  while ((found = pattern.exec(source))) {
    const chain = (found[3].match(/[A-Za-z]+(?:\('[^']*'\))?/g) || []).map((name) => name.replace(/\(.*$/, ''));
    const next = source.indexOf('\n});', found.index); /* a handler ends at the first closing at the start of a line */
    const body = source.slice(found.index + found[0].length, next < 0 ? undefined : next);
    if (/costBlindStops\(/.test(body)) chain.push('costBlindStops'); /* a check inside the handler: a seat without the Sees costs flag is stopped */
    if (/(byLevel\(|level: )levelOf\(req\)/.test(body) && found[1] !== 'get' && !chain.includes('editor')) chain.push('editor'); /* the handler asks the rail's level ladder itself */
    rows[found[1].toUpperCase() + ' ' + found[2]] = chain;
  }
  return rows;
}
function cellOf(chain, req) {
  let verdict = true;
  for (const gate of chain) {
    if (!KNOWN.includes(gate)) return '?' + gate;
    const answer = passes(req)[gate]();
    if (answer === false) return false;
    if (answer !== true) verdict = answer;
  }
  return verdict;
}
const WORD = { adviser: { read: 'reads', door: 'door', allow: 'yes', deny: '-' }, auditor: { read: 'reads', allow: 'yes', deny: '-' } };
const show = (cell) => (cell === true ? 'yes' : cell === false ? '-' : String(cell));

/** { rows, problems }: a row per route of the books contract; a problem is a gate the tool does not know, or a declared staff answer that disagrees with the gates */
function build() {
  const chains = chainOf(fs.readFileSync(path.join(root, 'routes', 'books.js'), 'utf8'));
  const rows = [];
  const problems = [];
  Object.entries(contract.ROUTES).forEach(([key, row]) => {
    const chain = chains[key] || row.gates || [];
    const cells = SEATS.map((seat) => cellOf(chain, seat.req));
    cells.filter((cell) => String(cell).startsWith('?')).forEach((cell) => problems.push(key + ': gate "' + String(cell).slice(1) + '" is not taught to tools/seat-matrix.cjs'));
    SEATS.slice(1).forEach((seat, index) => {
      const cell = cells[index + 1];
      if (String(cell).startsWith('needs')) return; /* a flag-dependent cell (Sees costs, switched by the owner) is the owner's choice, not a seat's right: not compared */
      const got = cell !== false && !String(cell).startsWith('?');
      const narrowed = chain.includes('bankWriter'); /* the bank write gate is narrower than the editor level the role matrix asks of the row: owner and the shop's accountant only */
      const should = !narrowed && matrix.allowedFor(row.seats, 'staff', seat.level) || ((seat.key === 'accountant' || (narrowed && seat.key === 'accountant')) && matrix.allowedFor(row.seats, 'staff', 'editor')); /* a manager hat that can edit is also an editor */
      if (should !== got) problems.push(key + ': the contract declares staff "' + row.seats.staff + '" (' + seat.key + ' ' + (should ? 'may' : 'may not') + ') but the gates say ' + (got ? 'may' : 'may not'));
    });
    rows.push({ key, summary: row.summary.replace(/\s*\(owner\)$/, ''), cells, adviser: WORD.adviser[row.seats.adviser], auditor: WORD.auditor[row.seats.auditor], chain: chains[key] ? chain.join(' > ') : '(contract) ' + chain.join(' > ') });
  });
  return { rows, problems };
}
/** the whole docs/SEAT-MATRIX.md, as the code says it today */
function render() {
  const { rows } = build();
  const out = [];
  out.push("# Seat matrix: who may do what with the shop's money", '');
  out.push('GENERATED by `node tools/seat-matrix.cjs --write` from the route gates (routes/books.js), the books contract (lib/books-contract.js) and the access predicates (lib/owner.js, lib/access.js). Never hand-edited; the guard `tests/seat-matrix.test.cjs` fails when it drifts.', '');
  out.push("Seats: **Owner** · **Accountant** = a staff login whose hat is manager and who can edit (RC-7, the shop's own accountant or bookkeeper) · **Counter** = a staff login with hat act at editor level (the till seat; any plain editor) · **Viewer** = read-only staff · **Adviser** / **Auditor** = a firm under a live books grant (reads only unless a door is named). `yes` may · `-` refused (403) · `money in` the seat may record money in, not pay a supplier. The hat gives the access; choosing the Bookkeeper or Accountant label in Add staff sets the manager hat (DECISIONS 22 Nov, item 5).", '');
  out.push('| Route | What it does | Owner | Accountant | Counter | Viewer | Adviser | Auditor | Gates in order |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  rows.forEach((row) => out.push('| `' + row.key + '` | ' + row.summary.replace(/\|/g, '/') + ' | ' + row.cells.map(show).join(' | ') + ' | ' + row.adviser + ' | ' + row.auditor + ' | ' + row.chain + ' |'));
  out.push('', rows.length + " routes. The adviser and auditor columns are the contract's declared seats (lib/role-matrix.js), proved live by tools/role-matrix-live.cjs; the first four are computed here.", '');
  return out.join('\n');
}
module.exports = { build, render, chainOf, SEATS };

if (require.main === module) {
  const file = path.join(root, 'docs', 'SEAT-MATRIX.md');
  const mode = process.argv[2];
  const { problems } = build();
  if (mode === '--write') {
    fs.writeFileSync(file, render());
    console.log('wrote docs/SEAT-MATRIX.md');
  } else if (mode === '--check') {
    const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') === render();
    if (!same) problems.push('docs/SEAT-MATRIX.md is not what the code says: node tools/seat-matrix.cjs --write');
    problems.forEach((line) => console.log('FAIL ' + line));
    process.exit(problems.length ? 1 : 0);
  } else {
    console.log(render());
    problems.forEach((line) => console.log('FAIL ' + line));
  }
}
