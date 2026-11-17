/**
 * tests/ctry75-tax-registration-unknown.test.cjs — CTRY-75: b841 resets ONLY the tax answer migration b299 assumed, never an owner's own.
 * Reads migrations/b841_ctry75_tax_registration_unknown.sql and proves: (1) the UPDATE's WHERE needs the b299 marker on tax AND on country, registered
 * false AND no number; (2) an owner's explicit no (country confirmed, tax typed, a number, registered true, an already-NULL row) is excluded;
 * (3) it is idempotent (the second run matches nothing); (4) it is one transaction with a DRY RUN and ROLL BACK in the header; (5) the app reads
 * NULL as unknown (country-setup.registrationOf). The WHERE is evaluated by a clause table keyed to the SQL text: a clause nobody mapped fails.
 * Run: node tests/ctry75-tax-registration-unknown.test.cjs · no DB.
 * CARD      28-platform-and-operations/migrations-and-schema
 */
'use strict';
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const sql = fs.readFileSync(path.join(API, 'migrations', 'b841_ctry75_tax_registration_unknown.sql'), 'utf8').replace(/\r\n/g, '\n');
const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const update = /UPDATE entity_governance[\s\S]*?;/.exec(code);
t('one UPDATE of entity_governance, inside BEGIN/COMMIT', !!update && /^\s*BEGIN;/m.test(code) && /^\s*COMMIT;/m.test(code));
const stmt = update ? update[0] : '';
const where = (/\bWHERE\b([\s\S]*);/.exec(stmt) || [, ''])[1].replace(/\s+/g, ' ').trim();
const clauses = where.split(/ AND /);

/* each SQL clause (text as written) → what it means on a row {tax, country, reg, num} */
const MEANING = {
  "setup_source->>'tax' LIKE 'backfill b299%'": (r) => /^backfill b299/.test(r.src_tax || ''),
  "setup_source->>'country' LIKE 'backfill b299%'": (r) => /^backfill b299/.test(r.src_country || ''),
  "tax_registration->>'registered' = 'false'": (r) => !!r.stamp && r.stamp.registered === false,
  "COALESCE(tax_registration->>'number', '') = ''": (r) => !(r.stamp && r.stamp.number)
};
t('the WHERE has exactly the four clauses, each one understood', clauses.length === 4 && clauses.every((c) => MEANING[c]), clauses.join(' | '));
const matches = (r) => clauses.every((c) => (MEANING[c] ? MEANING[c](r) : false));
const B = 'backfill b299 (identities.gstn)', C = "backfill b299 (today's facts)";
const row = (o) => Object.assign({ src_tax: B, src_country: C, stamp: { number: null, scheme: null, registered: false } }, o);

t('the untouched b299 row matches', matches(row()));
t('required: no tax marker', !matches(row({ src_tax: 'typed' })));
t('required: no tax marker at all', !matches(row({ src_tax: undefined })));
t("required: owner saved Country setup (country confirmed) though the tax marker was echoed back = the owner's explicit no stays", !matches(row({ src_country: 'confirmed by the owner' })));
t('required: registered true', !matches(row({ stamp: { number: '27AAAAA0000A1Z5', scheme: 'regular', registered: true } })));
t('required: a number held', !matches(row({ stamp: { number: '27AAAAA0000A1Z5', scheme: null, registered: false } })));
t('an already-NULL (unknown) row is not matched', !matches(row({ stamp: null })));

/* apply the statement to a table the way Postgres would: matched rows get NULL stamp and lose the 'tax' source */
const table = () => [row(), row({ src_country: 'confirmed by the owner' }), row({ src_tax: 'typed', src_country: 'confirmed by the owner' }),
  row({ stamp: { number: '29ABCDE1234F1Z5', scheme: 'regular', registered: true } }), row({ stamp: null, src_tax: undefined })];
const run = (rows) => { let n = 0; rows.forEach((r) => { if (matches(r)) { r.stamp = null; r.src_tax = undefined; n++; } }); return n; };
const rows = table(), before = JSON.stringify(rows.slice(1));
t('the SET writes NULL and removes the tax source', /SET tax_registration = NULL,\s*setup_source = setup_source - 'tax'/.test(stmt));
const first = run(rows);
t('first run resets exactly the one untouched row', first === 1 && rows[0].stamp === null);
t('every other row is byte-for-byte unchanged', JSON.stringify(rows.slice(1)) === before);
t('idempotent: the second run matches nothing', run(rows) === 0);

t('header: DRY RUN, ROLL BACK, DRAFT NOT RUN', /DRY RUN FIRST/.test(sql) && /ROLL BACK/.test(sql) && /DRAFT — NOT RUN/.test(sql));
t('header: dry run counts with the same WHERE', (sql.match(/COUNTRY|LIKE 'backfill b299%'/g) || []).length >= 6 && /sample_ids/.test(sql));
t('nothing but the one UPDATE changes data (no DELETE, DROP, ALTER, TRUNCATE, INSERT)', !/\b(DELETE|DROP|ALTER|TRUNCATE|INSERT)\b/i.test(code));

/* the app side: NULL with no number reads unknown; the explicit no still reads unregistered */
const CS = require(path.join(API, 'lib', 'country-setup'));
t('app: a NULL stamp and no number reads unknown (the counter asks)', CS.registrationOf({ number: null, tax_registration: null }) === 'unknown');
t("app: the b299 {registered:false} reads unregistered (what b841 removes)", CS.registrationOf({ number: null, tax_registration: { registered: false } }) === 'unregistered');
t('app: a shop with a GSTIN reads registered whatever the stamp says', CS.registrationOf({ number: '27AAAAA0000A1Z5', tax_registration: null }) === 'regular');
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
