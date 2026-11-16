/**
 * books-ledger-on.test.cjs — ONE answer to "are this shop's books on" (lib/books.ledgerOn, read by GET /entities/me's ledger_on and the same row the books gate reads).
 * A shop with books ON but NO books_setting row is not "on" by the gate; a shop with an ENABLED row is on; a failed read THROWS (so /me leaves ledger_on out = unknown, never "off").
 * Run: node tests/books-ledger-on.test.cjs
 */
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'lib', 'books'));
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name); } };
const dbOf = (answer) => ({ query: async (sql) => { if (/SAVEPOINT/i.test(sql)) return { rows: [] }; if (answer instanceof Error) throw answer; return { rows: answer }; } });
(async () => {
  const E = '11111111-1111-4111-8111-111111111111';
  ok('enabled setting row → on', (await B.ledgerOn(dbOf([{ entity_id: E, enabled: true }]), E)) === true);
  ok('setting row with enabled=false → off', (await B.ledgerOn(dbOf([{ entity_id: E, enabled: false }]), E)) === false);
  ok('no setting row → off (the gate 404s it too)', (await B.ledgerOn(dbOf([]), E)) === false);
  const boom = Object.assign(new Error('connection lost'), { code: '08006' });
  let threw = false; try { await B.ledgerOn(dbOf(boom), E); } catch (_) { threw = true; }
  ok('a failed read throws — unknown, never reported off', threw);
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
