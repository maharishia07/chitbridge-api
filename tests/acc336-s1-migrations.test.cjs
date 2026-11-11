/**
 * acc336-s1-migrations.test.cjs — ACC-336 slice 1: the two database files say what the design (PM/designs/ACC-336-DESIGN.md rev 4)
 * and the engines pack (reg-in.js taxLedgers[head].advance, engines #114) say, and are safe to run twice.
 *
 * b849: journal_entry.tax_period is added only if missing, nullable (no table rewrite) and bounded 1-64 characters.
 * b850: the four IN advance ledgers carry exactly the codes and roles the engines pack names (1830-1833, tax_advance_cgst/sgst/igst/cess),
 *       the insert is ON CONFLICT DO NOTHING (per row, so a re-run adds nothing), and the file deletes nothing outside its rollback comment.
 * Offline: reads the two files only.
 * CARD      14-accounting/gst-period-close
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}
const MIG = path.join(__dirname, '..', 'migrations');
/** the file's statements with every -- comment line taken out (the rollback lives in comments only) */
function statementsOf(file) {
  return fs.readFileSync(path.join(MIG, file), 'utf8').split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
}

const b849 = statementsOf('b849_journal_entry_tax_period.sql');
check('b849 adds tax_period only if it is missing', /ADD COLUMN IF NOT EXISTS tax_period text/i.test(b849));
check('b849 leaves the column nullable (no rewrite, history stays NULL)', !/tax_period text\s+NOT NULL/i.test(b849));
check('b849 bounds the value to 1-64 characters', /char_length\(tax_period\) BETWEEN 1 AND 64/i.test(b849));

const b850 = statementsOf('b850_advance_account_backfill.sql');
const EXPECTED = { 1830: 'tax_advance_cgst', 1831: 'tax_advance_sgst', 1832: 'tax_advance_igst', 1833: 'tax_advance_cess' };
const rows = [...b850.matchAll(/\('(\d{4})',\s*'(tax_advance_[a-z]+)'/g)].map((m) => [m[1], m[2]]);
check('b850 names exactly four advance ledgers', rows.length === 4, rows.length + ' rows');
Object.entries(EXPECTED).forEach(([code, role]) => check('b850 code ' + code + ' is ' + role, rows.some(([c, r]) => c === code && r === role)));
check('b850 inserts with ON CONFLICT DO NOTHING (a re-run adds nothing)', /ON CONFLICT DO NOTHING/i.test(b850));
check('b850 deletes and drops nothing outside its comments', !/\b(DELETE|DROP|TRUNCATE)\b/i.test(b850));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
