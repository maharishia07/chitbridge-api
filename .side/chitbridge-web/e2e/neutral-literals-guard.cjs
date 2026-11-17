#!/usr/bin/env node
/**
 * e2e/neutral-literals-guard.cjs — NEUTRAL-CORE N1 (2026-10-17): NO PAGE GUESSES INDIA'S MONEY, ZONE OR LOCALE.
 *
 * Athi, 2026-10-17: "a record states its own country/currency/zone/language; a reader that finds none says so — never guesses India."
 * The web had ~50 `x || 'INR'` fallbacks. Each now asks ONE helper (helpers.js moneyCode / fmtMoney: a row's own code, else the shop's myCur(), else
 * none — and none prints the bare amount). This guard keeps it so, the way india-words-guard.cjs keeps GSTIN / PAN / the rupee sign out:
 *
 *   · every file under public/ (html · js) is read with its comments stripped; the literals 'INR' · "INR" · Asia/Kolkata · en-IN are counted;
 *   · a file NOT in ALLOW may hold none;
 *   · a file IN ALLOW may hold at most the count it holds today (a ratchet: the ceiling only ever goes DOWN), and each entry says why it stays —
 *     an India-pack path, a currency list that names every code, a demo of lakh grouping;
 *   · vendored / adopted copies (engine/, vendor/), the till master, labs and design mocks are not pages a shop sees (same SKIP as india-words-guard).
 *
 *   node e2e/neutral-literals-guard.cjs          the gate (exit 1 on a new literal)
 *   node e2e/neutral-literals-guard.cjs --list   every file's count
 *
 * OWNS    the allow-list of today's India literals and the ceiling per file
 * CALLED BY .github/workflows/ci.yml (web check job) · tests/neutral-core.test.cjs
 * FLOW    read public/ → strip comments → count → compare with ALLOW → exit 1 on a new one
 * CARD    qa/neutral-literals-guard
 */
'use strict';
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const LIST = process.argv.includes('--list');

const NEUTRAL = /'INR'|"INR"|cu=INR|Asia\/Kolkata|en-IN/g;
const SKIP = [/^engine\//, /^vendor\//, /^data\//, /^lab\//, /^pics\//, /^docs\//, /^till\.html$/, /^promo\.html$/, /-lab(-next)?\.html$/, /-design\.html$/, /^screen-gallery\.html$/, /^design-mock\.html$/, /^testing\.html$/];
const ALLOW = {
  'app/cap-admin.js': { max: 4, why: 'locale demo rows (lakh grouping shown beside USD), the en-IN entry of the format list, and the zone pickers fallback list' },
  'app/cap-standards.js': { max: 6, why: 'the Standards glossary: tag, zone and UPI-link EXAMPLES (en-IN, Asia/Kolkata, cu=INR) and what INR is - documentation, not a default' },
  'app/cap-country.js': { max: 3, why: 'the lakh-words choice, the lakh-pack test and the lakh-words branch (SET-93: lakh · crore words no longer ride the browser ICU): an India-pack path (rupee grouping), chosen by the money own tag' },
  'app.html': { max: 1, why: 'CURRENCIES: the currency picker names every ISO code, INR among them' },
  'bill-print.html': { max: 1, why: 'the sample shop of the print preview (a demo bill, not a real shop record)' },
  'standards.html': { max: 1, why: 'the "checked on" stamp of the Standards page: a fixed UTC date, not a shop record' },
};

/** the file with its comments blanked: JS block + line comments, HTML comments (a URL's // is not a comment) */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1').replace(/<!--[\s\S]*?-->/g, ' ');
}
function listFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (/\.(html|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}
function countIn(file) {
  const rel = path.relative(PUB, file).split(path.sep).join('/');
  if (SKIP.some((pattern) => pattern.test(rel))) return null;
  const hits = stripComments(fs.readFileSync(file, 'utf8')).match(NEUTRAL) || [];
  return { rel, count: hits.length };
}

const rows = listFiles(PUB, []).map(countIn).filter(Boolean).filter((row) => row.count > 0).sort((left, right) => right.count - left.count || left.rel.localeCompare(right.rel));
const allowed = rows.reduce((sum, row) => sum + (ALLOW[row.rel] ? row.count : 0), 0);
if (LIST) {
  rows.forEach((row) => console.log(String(row.count).padStart(4) + '  ' + row.rel + (ALLOW[row.rel] ? '   (ceiling ' + ALLOW[row.rel].max + ' - ' + ALLOW[row.rel].why + ')' : '   NOT ALLOWED')));
  process.exit(0);
}

let fail = 0;
for (const row of rows) {
  const entry = ALLOW[row.rel];
  if (!entry) { fail++; console.log('  FAIL ' + row.rel + ' guesses India (\'INR\' / Asia/Kolkata / en-IN) ' + row.count + ' time(s) - ask helpers.js moneyCode / fmtMoney, or the shop\'s own zone and locale'); }
  else if (row.count > entry.max) { fail++; console.log('  FAIL ' + row.rel + ' holds ' + row.count + ' India literals, ceiling ' + entry.max + ' - a NEW one landed'); }
}
for (const rel of Object.keys(ALLOW)) {
  const row = rows.find((candidate) => candidate.rel === rel);
  if (!row) console.log('  note ' + rel + ' holds no India literal any more - drop it from the allow-list');
  else if (row.count < ALLOW[rel].max) console.log('  note ' + rel + ' is down to ' + row.count + ' (ceiling ' + ALLOW[rel].max + ') - lower the ceiling');
}
console.log(fail ? '\n  neutral-literals-guard: ' + fail + ' file(s) guess India\n' : '\n  neutral-literals-guard: ok - ' + allowed + ' allowed literal(s) in ' + Object.keys(ALLOW).length + ' files, none above its ceiling; no other page guesses India\'s money, zone or locale\n');
if (typeof module !== 'undefined') module.exports = { ALLOW, rows, allowed, fail };
process.exit(fail ? 1 : 0);
