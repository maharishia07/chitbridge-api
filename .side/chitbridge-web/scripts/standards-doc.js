/* scripts/standards-doc.js — emit C:\dev\CATALOGUE-STANDARDS.md FROM catalogue-model.js.
 *
 * ⚠️ GENERATED, NEVER HAND-EDITED, and that is the whole point. A standards table written twice — once in code and
 * once in a doc — is a table that disagrees with itself within a month, and the doc is the copy people quote.
 * There is one source (CBCatalogue) and this script prints it.
 *
 * ⚠️ IT READS THE GLOBAL, NOT THE EXPORT. chitbridge-web/package.json declares "type": "module", so the UMD wrapper's
 * `typeof module !== 'undefined'` guard is false and module.exports is never assigned — require() hands back an
 * EMPTY object with no error at all. The global attach still runs, so that is what we read. This is a workaround
 * for a real defect in the file's dual-target claim, not the way it should stay.
 *
 *   node scripts/standards-doc.js
 */
/*
 * OWNS      the printout of the catalogue standards table (C:/dev/CATALOGUE-STANDARDS.md) from CBCatalogue
 * CALLED BY by hand only: no package.json script or CI line runs it
 * FLOW      read the CBCatalogue global -> print the table -> write the markdown
 * CARD      06-catalogue-pim/categories-and-fields
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../public/app/catalogue-model.js');
const M = globalThis.CBCatalogue;
if (!M || !M.FIELD_STANDARDS) {
  console.error('catalogue-model.js did not attach CBCatalogue');
  process.exit(1);
}

const OUT = 'C:\\dev\\CATALOGUE-STANDARDS.md';
const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');
const L = [];

L.push('# Catalogue — standards reference');
L.push('');
L.push('> **GENERATED from `chitbridge-web/public/app/catalogue-model.js` — do not edit by hand.**');
L.push('> Regenerate: `node scripts/standards-doc.js`. The code is the source; this is a printout.');
L.push('');
L.push('Athi, 2026-08-13: *"adopt all the standards in one pass so we can reference quickly … check medusa and org standards."*');
L.push('');
L.push('Medusa field names read from the Product / ProductVariant model references; schema.org from Product and Offer.');
L.push('Vocabulary alignment only — **no Medusa code is embedded**. Reading a model to name our own fields well is not vendoring it.');
L.push('');

const byStatus = (st) => M.STANDARDS.filter((item) => item.status === st);
const group = (title, st) => {
  const rows = byStatus(st);
  if (!rows.length) return;
  L.push('## ' + title);
  L.push('');
  L.push('| standard | body | role | where |');
  L.push('|---|---|---|---|');
  rows.forEach((item) =>
    L.push('| [' + esc(item.name) + '](' + item.spec + ') | ' + esc(item.body) + ' | ' + esc(item.role) + ' | `' + esc(item.where) + '` |')
  );
  L.push('');
};
group('Implemented in code', 'in code');
group('Vocabulary alignment (naming, not an engine)', 'vocabulary');
group('Held by reference (link out, never mirror)', 'by reference');
group('On the roadmap', 'roadmap');

L.push('## Field by field — ours → theirs');
L.push('');
L.push('| ours | schema.org | Medusa | other | note |');
L.push('|---|---|---|---|---|');
Object.keys(M.FIELD_STANDARDS).forEach((item) => {
  const f = M.FIELD_STANDARDS[item];
  L.push('| `' + item + '` | ' + esc(f.s || '—') + ' | ' + esc(f.m || '—') + ' | ' + esc(f.o || '—') + ' | ' + esc(f.n || '') + ' |');
});
L.push('');

L.push('## Not carried');
L.push('');
L.push('Named so the absence is a decision with a trigger, not an oversight.');
L.push('');
M.FIELD_GAPS.forEach((item) => L.push('- **`' + item.key + '`** *(' + item.from + ')* — ' + item.why));
L.push('');

L.push('## Where we differ');
L.push('');
L.push("Recorded, not silently changed — renaming a live field is a migration, and that decision is not the code's to make.");
L.push('');
M.FIELD_CONFLICTS.forEach((item) => {
  L.push('### ' + item.ours);
  L.push('');
  L.push('- **issue** — ' + item.issue);
  L.push('- **standard** — ' + item.standard);
  L.push('- **cost** — ' + item.cost);
  L.push('- **fix** — ' + item.fix);
  L.push('');
});

writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(
  'wrote ' +
    OUT +
    '  (' +
    M.STANDARDS.length +
    ' standards · ' +
    Object.keys(M.FIELD_STANDARDS).length +
    ' fields · ' +
    M.FIELD_GAPS.length +
    ' gaps · ' +
    M.FIELD_CONFLICTS.length +
    ' conflicts)'
);
