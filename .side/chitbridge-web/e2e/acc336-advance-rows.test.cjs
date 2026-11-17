'use strict';
/* OWNS: proof that the vendored tax bundle (public/engine/tax.js, engines v1.85.0, ACC-336 slice 0) carries the India tax-paid-in-advance
   ledgers with exactly the codes, roles and names that api migrations/b850_advance_account_backfill.sql writes (1830-1833), and that each
   GST head names its advance role. Reads the file as text: the bundle is several modules in one file, so no require.
   CALLED BY: node e2e/acc336-advance-rows.test.cjs (exit 1 on a miss). */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'engine', 'tax.js'), 'utf8');
const rows = [['tax_advance_cgst', '1830', 'CGST paid in advance'], ['tax_advance_sgst', '1831', 'SGST paid in advance'],
  ['tax_advance_igst', '1832', 'IGST paid in advance'], ['tax_advance_cess', '1833', 'Cess paid in advance']];
let bad = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) bad++; };
for (const [role, code, name] of rows) {
  check(src.includes("{ role: '" + role + "', code: '" + code + "', name: '" + name + "', group: 'current_assets' }"), 'chart row ' + code + ' ' + role);
}
for (const h of ['cgst', 'sgst', 'igst', 'cess']) check(src.split('\n').some((l) => l.trim().startsWith(h + ': { output:') && l.includes("advance: 'tax_advance_" + h + "' }")),'head ' + h + ' names its advance role');
check(src.includes("taxAdvance: { label: 'Cash Balance as on date'"),'official label (GST portal) for the advance');
console.log(bad ? bad + ' failed' : 'all passed');
process.exit(bad ? 1 : 0);
