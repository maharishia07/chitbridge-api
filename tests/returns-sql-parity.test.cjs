#!/usr/bin/env node
/**
 * tests/returns-sql-parity.test.cjs — the pure parts of tools/returns-sql-parity.cjs: the seeded draw replays, the windows stay inside the book, the row normaliser sees a real difference, and a non-local database is refused.
 * OWNS      the unit-per-rule proof of the fuzz tool's seeded generator, window cut, row normaliser, argument reader and refusal (the fuzz itself needs a real Postgres and is run by hand).
 * CALLED BY scripts/guards.cjs · by hand: node tests/returns-sql-parity.test.cjs
 * FLOW      require tools/returns-sql-parity.cjs ──▶ one rule per check ──▶ "<n> checks"
 * CARD      speed/returns-parity
 * No database, no network.
 */
'use strict';
const path = require('path');
const P = require(path.join(__dirname, '..', 'tools', 'returns-sql-parity.cjs'));

let passed = 0,
  failed = 0;
const ok = (label, condition) => {
  if (condition) passed++;
  else {
    failed++;
    console.log('   FAIL ' + label);
  }
};
const DAY_MS = 86400000;

/* the seeded draw: one seed replays the same questions, another seed asks others */
const drawsOf = (seed) => {
  const draw = P.seededRandom(seed);
  return [draw(), draw(), draw(), draw()];
};
ok('the same seed draws the same four numbers', JSON.stringify(drawsOf(1)) === JSON.stringify(drawsOf(1)));
ok('another seed draws other numbers', JSON.stringify(drawsOf(1)) !== JSON.stringify(drawsOf(2)));
ok('every draw is in [0, 1)', drawsOf(7).every((value) => value >= 0 && value < 1));
ok('pickOne takes an element of the list', ['a', 'b', 'c'].includes(P.pickOne(P.seededRandom(3), ['a', 'b', 'c'])));
ok('someOf keeps only elements of the list and never invents one', P.someOf(P.seededRandom(4), ['x', 'y', 'z', 'w']).every((item) => ['x', 'y', 'z', 'w'].includes(item)));

/* the window: inside the book, the whole kind is the book, the edge kind starts on its first day */
const first = Date.parse('2026-04-01'),
  last = Date.parse('2027-03-31');
const whole = P.windowFor('whole', P.seededRandom(5), first, last);
ok('a whole-book window is exactly the book', whole.from === first && whole.to === last);
const edge = P.windowFor('edge', P.seededRandom(5), first, last);
ok('an edge window starts on the first day, where the opening entries sit, and runs at most four days', edge.from === first && edge.to - first <= 4 * DAY_MS && edge.to >= first);
const day = P.windowFor('day', P.seededRandom(6), first, last);
ok('a day window ends where it starts', day.from === day.to && day.from >= first && day.from <= last);
const month = P.windowFor('month', P.seededRandom(6), first, last);
ok('a month window runs thirty days from its start', month.to - month.from === 30 * DAY_MS);
ok('dayText cuts an instant to its date', P.dayText(Date.parse('2026-09-30T18:30:00Z')) === '2026-09-30');
ok('the fuzz asks every kind of window', ['day', 'month', 'quarter', 'year', 'whole', 'edge'].every((kind) => P.WINDOW_KINDS.includes(kind)));

/* the normaliser: sorted unless the order is the answer; a changed cell is a difference; dates and null compare as text */
const rowsA = [{ id: 2, amount: '5.00' }, { id: 1, amount: '3.00' }];
ok('unordered rows compare sorted: the same rows in another order are the same', JSON.stringify(P.normalise(rowsA, false)) === JSON.stringify(P.normalise(rowsA.slice().reverse(), false)));
ok('ordered rows keep their order: the same rows reversed differ', JSON.stringify(P.normalise(rowsA, true)) !== JSON.stringify(P.normalise(rowsA.slice().reverse(), true)));
ok('one changed cell is a difference', JSON.stringify(P.normalise(rowsA, false)) !== JSON.stringify(P.normalise([{ id: 2, amount: '5.01' }, { id: 1, amount: '3.00' }], false)));
ok('key order inside a row does not matter', JSON.stringify(P.normalise([{ a: 1, b: 2 }], true)) === JSON.stringify(P.normalise([{ b: 2, a: 1 }], true)));
ok('a Date and its ISO text are the same cell', JSON.stringify(P.normalise([{ at: new Date('2026-09-30T00:00:00Z') }], true)) === JSON.stringify(P.normalise([{ at: '2026-09-30T00:00:00.000Z' }], true)));
ok('null is the text null, never the empty string', JSON.stringify(P.normalise([{ v: null }], true)) !== JSON.stringify(P.normalise([{ v: '' }], true)));

/* the arguments: read as given, and refused unless complete and local (fail closed: no usage = no run) */
const args = P.readArgs(['node', 'x', '--db', 'postgres://cb_app:pw@127.0.0.1:5432/t', '--entity', 'e1', '--old', 'old.js', '--n', '5', '--seed', '9']);
ok('the arguments are read by name', args.entity === 'e1' && args.old === 'old.js' && args.rounds === 5 && args.seed === 9);
ok('a complete local invocation is not refused', P.refusalOf(args) === null);
ok('rounds default to 60 and the seed to 1', P.readArgs(['node', 'x']).rounds === 60 && P.readArgs(['node', 'x']).seed === 1);
ok('a missing entity is refused with the usage line', /usage/.test(P.refusalOf(Object.assign({}, args, { entity: '' }))));
ok('a missing old file is refused with the usage line', /usage/.test(P.refusalOf(Object.assign({}, args, { old: '' }))));
ok('a database that is not postgres is refused', P.refusalOf(Object.assign({}, args, { db: 'mysql://root@127.0.0.1/t' })) !== null);
ok('a remote database is refused: local only', P.refusalOf(Object.assign({}, args, { db: 'postgres://cb_app:pw@db.example.supabase.co:5432/t' })) === 'local database only');
ok('localhost and the IPv6 loopback are local', ['postgres://u:p@localhost:5432/t', 'postgres://u:p@[::1]:5432/t'].every((db) => P.refusalOf(Object.assign({}, args, { db })) === null));

console.log('\n  ' + (passed + failed) + ' checks' + (failed ? ', ' + failed + ' failed' : ', all ok'));
process.exit(failed ? 1 : 0);
