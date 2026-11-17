#!/usr/bin/env node
/**
 * e2e/india-words-guard.cjs — AU-WORDS (2026-10-15): NO PAGE STRING NAMES GSTIN · PAN · ₹ OUTSIDE AN INDIA-PACK PATH.
 *
 * Athi on live austore1 (AU), 15 Oct: Home said "Name your GSTIN", the sheet asked for a "PAN on file", CB Accounts wore ₹. Each was a page
 * (or server) string that read India's words directly instead of the shop's country pack. The words now come from the pack through ONE reader
 * (web helpers.js taxIdWord / packWord · api lib/pack-words); the money symbol from CBLocale.symbol of the shop's currency. This guard keeps it so:
 *
 *   · every file under public/ (html · js · json) is read with its comments stripped — a comment may say GSTIN; a STRING may not;
 *   · a file NOT in the allow-list may hold no GSTIN / PAN / ₹ at all;
 *   · a file IN the allow-list (an India-pack path: the India workshop app.html, the glossary, the India vault fields, the id-document list,
 *     helpers.js's one PACK_WORDS table …) may hold at most the count it holds today — the ceiling only ever goes DOWN (ratchet);
 *   · vendored / adopted copies are not read here (public/engine/* — engines; till.html · promo.html — the api's till master; vendor/; data/);
 *     the design mocks and labs are not pages a shop sees.
 *
 *   node e2e/india-words-guard.cjs            the gate (exit 1 on a new mention)
 *   node e2e/india-words-guard.cjs --list     every file's count, to lower a ceiling after a mention is removed
 */
'use strict';
const fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const LIST = process.argv.includes('--list');

const INDIA = /\bGSTIN\b|\bPAN\b|₹/g;
/* not read: vendored / adopted copies, data, design mocks and labs (not a shop's page) */
const SKIP = [/^engine\//, /^vendor\//, /^data\//, /^lab\//, /^pics\//, /^docs\//, /^till\.html$/, /^promo\.html$/, /-lab(-next)?\.html$/, /-design\.html$/, /^screen-gallery\.html$/, /^design-mock\.html$/, /^testing\.html$/, /\.min\./];
/* the India-pack paths and their ceilings (counts with comments stripped, 2026-10-15). A NEW file is not here: it may hold none. */
const ALLOW = {
  'app/cap-standards.js': 12,     /* the glossary: what a GSTIN / PAN IS (India's registry rows, named as such) */
  'app.html': 9,                  /* the India workshop (the GSTIN set-up door, the IN counter bill's buyer GSTIN) */
  'app/cap-admin.js': 7,          /* the India workshop's tax band ("no GSTIN on the profile") and the vault's GSTIN/PAN agreement check */
  'app/cap-chit2.js': 5,          /* the chit's India tax band: the parties' GSTIN on an IN invoice */
  'app/cap-definitions.js': 5,    /* the money adornment's last-resort symbol · the offer kind's worked example */
  'app/cap-legend.js': 4,         /* the legend's done/backlog notes (history, not a shop's screen) */
  'app/screens.js': 4,            /* the screen names of the counter's Find (printer, GSTIN, …) */
  'app/cap-catsetup.js': 3,       /* the catalogue set-up's worked example of a condition row */
  'app/cap-crm-record.js': 3,     /* the CRM record's GSTIN rows under India's pack */
  'app/cap-iddocs.js': 3,         /* the id-document schemes the server may list (PAN is drawn only when the server lists it — cx4 P3) */
  'app/cap-bank-rows.js': 2,      /* the bank screen's record actions (₹ as the action glyph) */
  'app/cap-books-party.js': 2,          /* the books' tax-scheme list (GSTIN · PAN first under India's pack; the word is helpers.taxIdWord) */
  'app/cap-shop.js': 2,           /* the India-shaped vault fields (GSTIN · PAN · IEC · LUT), attached to the IN pack */
  'app/cap-traceability.js': 2,   /* _traceSym's last-resort symbol */
  'app/list-ctl.js': 2,           /* the sort's number regex lists currency marks (₹ $ € £) */
  'app/cap-crm.js': 1,            /* the CRM party's GSTIN under India's pack (CX0: the column reads taxIdWord) */
  'app/helpers.js': 1,            /* PACK_WORDS.IN — the ONE tax-ID word table */
  'bill-print.html': 1,           /* the IN counter print's GSTIN line (showGstin) */
  'shop.html': 1,                 /* the storefront's symbol map (INR ₹ among others) */
};

/** the file with its comments blanked: JS block + line comments, HTML comments (a URL's // is not a comment) */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1').replace(/<!--[\s\S]*?-->/g, ' ');
}
function listFiles(dir, out) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) listFiles(full, out);
    else if (/\.(html|js|json)$/.test(f.name)) out.push(full);
  }
  return out;
}
function countIn(file) {
  const rel = path.relative(PUB, file).split(path.sep).join('/');
  if (SKIP.some((re) => re.test(rel))) return null;
  const hits = stripComments(fs.readFileSync(file, 'utf8')).match(INDIA) || [];
  return { rel, count: hits.length };
}

const rows = listFiles(PUB, []).map(countIn).filter(Boolean).filter((r) => r.count > 0).sort((a, b) => b.count - a.count || a.rel.localeCompare(b.rel));
if (LIST) {
  rows.forEach((r) => { const tail = ALLOW[r.rel] !== undefined ? '   (ceiling ' + ALLOW[r.rel] + ')' : '   NOT ALLOWED'; console.log(String(r.count).padStart(4) + '  ' + r.rel + tail); });
  process.exit(0);
}

let fail = 0;
for (const r of rows) {
  const ceiling = ALLOW[r.rel];
  if (ceiling === undefined) { fail++; console.log('  FAIL ' + r.rel + ' names GSTIN / PAN / ₹ ' + r.count + ' time(s) outside an India-pack path — read the shop\'s pack (helpers.js taxIdWord · packWord · CBLocale.symbol) instead'); }
  else if (r.count > ceiling) { fail++; console.log('  FAIL ' + r.rel + ' holds ' + r.count + ' India words, ceiling ' + ceiling + ' — a NEW mention landed; read the pack instead'); }
}
for (const rel of Object.keys(ALLOW)) {
  const r = rows.find((x) => x.rel === rel);
  if (!r) console.log('  note ' + rel + ' holds no India word any more — drop it from the allow-list');
  else if (r.count < ALLOW[rel]) console.log('  note ' + rel + ' is down to ' + r.count + ' (ceiling ' + ALLOW[rel] + ') — lower the ceiling');
}
console.log(fail ? '\n  india-words-guard: ' + fail + ' file(s) name India\'s words outside an India-pack path\n' : '\n  india-words-guard: ok — ' + rows.length + ' allowed India-pack files, none above its ceiling; no other page string names GSTIN / PAN / ₹\n');
process.exit(fail ? 1 : 0);
