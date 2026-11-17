'use strict';
/**
 * tests/country-literals.test.cjs — THE COUNTRY-LITERAL RATCHET, api twin of chitbridge-engines tests/country-literals.test.js
 * (CTRY-DATA, Athi 11 Nov 2026: "country rules should be data" / "we should not be having any country rule in the code").
 *
 * The engines guard holds src/ (outside the packs) to its baseline. This one holds lib/, routes/, middleware/ and server.js to theirs. It counts, in CODE
 * (comments are stripped; a citation in a comment is not a rule), the same four kinds as engines #116:
 *   code  a quoted ISO code of a country we have a pack for ('IN' · "AU") or an object key `IN:`
 *   ccy   a quoted currency code of those countries ('INR' · 'AED')
 *   name  a country's name (India · Australia · UAE · Emirates · Singapore · Japan · Malaysia · United States)
 *   law   a word of one country's tax law (GST · GSTIN · VAT · ABN · TRN · HSN · IRN · BAS …)
 * A file's row below is its BASELINE [code · ccy · name · law]. A count that RISES fails (a new country literal outside a pack: put it
 * in the pack). A count that FALLS fails too, naming the number to write down: the baseline is TIGHT, it only goes down, in a diff
 * somebody reads. A file with hits and no row fails (a new file starts at zero, never grandfathered silently).
 *
 * Every row says what each hit IS: `split` = [a, b, c] hits (they add up to the row's total; `cls` is the biggest share):
 *   a  a country rule that belongs in a pack: `to` names the pack member it should become (COUNTRY-STANDARD Part B)
 *   b  generic or legitimate: an ISO / currency list, test or seed or design-mock data, display text naming a country on a standards page
 *   c  a country-specific ADAPTER, legitimately country-bound (a Tally / Zoho / Xero / GoFrugal mapping, an India registry check)
 * Moving an (a) row into a pack is a separate, dated pack version (Athi's yes for tax, money and law) with its adopt in api and web.
 *
 * NOT SCANNED (named, so nothing is skipped silently): adopted engine copies (header "ADOPTED from chitbridge-engines" or "ADOPTED BUNDLE": lib/reg-*.js, lib/tax-engine.browser.js, lib/tax.js, lib/country.js …: engines' own guard counts them); tools/, scripts/, tests/, migrations/ and the till master copy in tools/tally-connector (the counter's, cb-counter).
 *
 * ⭐ RATE / THRESHOLD CENSUS (11 Nov 2026; numbers next to a tax word, 0.18 · 75000 · 375000 · 2500 · 5% · 10% · 18% …) outside the packs:
 * api lib / routes / middleware: ONE place — lib/pack-words.js help text repeats "10% GST" (AU) and "5% VAT" (AE), the pack's own numbers
 *   (class a, same row as the registration kinds). No rate or threshold is a number in code: 0.18 · 0.05 · 0.12 · 0.28 · 75000 · 375000 ·
 *   7500000 · 2500 appear nowhere outside the adopted packs and engines (lib/reg-au.js turnover_minor 7500000 is the pack). The adopted
 *   lib/gst-returns.js carries India's B2CL limits (₹2.5 lakh to 2024-07, ₹1 lakh from 2024-08) and the s.17(5) reasons: that is engines' file.
 * OWNS    the baseline of country literals outside the packs for api and the class of each
 * CALLED BY scripts/guards.cjs (GUARDS, ci.yml guards job)
 * FLOW    read lib · routes · middleware · server.js → strip comments → count four kinds → compare with BASELINE → exit 1 on a rise, an unexplained fall, a new file
 * CARD    country/literal-ratchet
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

const PATTERNS = {
  code: /['"`](IN|AU|AE|US|SG|JP|MY)['"`]|(?:^|[{,\s])(?:IN|AU|AE|US|SG|JP|MY)\s*:/gm,
  ccy: /['"`](INR|AUD|AED|USD|SGD|JPY|MYR)['"`]/g,
  name: /\b(India|Indian|Australia|Australian|UAE|Emirates|Singapore|Japan|Malaysia|United States)\b/g,
  law: /\b(GSTIN|GST|CGST|SGST|IGST|UTGST|VAT|ABN|TRN|TDS|HSN|BAS|MyInvois|IRN|ATO|FTA|IRAS|LHDN|Peppol)\b/g,
};
const KINDS = Object.keys(PATTERNS);

/* ⭐ THE BASELINE — every scanned file that names a country: n = [code, ccy, name, law], split = [a, b, c], cls, to (for a), why */
const BASELINE = {
  'lib/pack-words.js': { n: [6, 0, 0, 22], split: [28, 0, 0], cls: 'a', to: 'tax.registrationKinds[] · words{taxName,registration,returnShort} · checks.tradeReady[]', why: 'KINDS_BY_PACK + WORDS_BY_PACK: the registration kinds, help sentences and tax words of IN · AU · AE; the file already reads the pack member first (its own header asks for the widening), so the table retires with no api change. Help text also repeats the pack numbers 10% AU GST and 5% UAE VAT (rate census)' },
  'routes/integrations.js': { n: [2, 0, 2, 15], split: [0, 0, 19], cls: 'c', why: 'connector catalogue: Tally / Zoho / GoFrugal text and the Xero country list name India\'s GST and GSTIN; each connector is built for one country and refused for another (cb-connect owns it)' },
  'lib/books-hooks.js': { n: [4, 0, 2, 10], split: [16, 0, 0], cls: 'a', to: 'taxLedgers[head].label · locale.zones[]', why: 'ZONE_BY_COUNTRY IN · AU · AE · SG (country to time zone) and the posting refusals that name CGST / SGST / IGST (India\'s heads) in words' },
  'lib/move-in.js': { n: [0, 4, 0, 9], split: [4, 4, 5], cls: 'c', to: 'tax.taxIds[scheme].check (GSTIN checksum, ABN / GSTIN keys)', why: 'import column synonyms (ABN, GSTIN, HSN / SAC) and the Xero BAS message are the move-in mapper (c, cb-connect); CELL_MARKS maps a$ / us$ / sg$ to ISO codes (b); the GSTIN checksum call and the tax_ids scheme keys are India / AU law in a generic importer (a)' },
  'lib/privacy.js': { n: [6, 0, 4, 0], split: [9, 1, 0], cls: 'a', to: 'privacy{ dsarDays, authority, basis }', why: 'data-subject request periods and regulator names per country (IN 15 / 30 days IT Rules, AU APP 12.4, AE PDPL); the Mumbai hosting-region label is infrastructure text (b)' },
  'lib/parallel-run.js': { n: [0, 1, 0, 8], split: [7, 0, 2], cls: 'a', to: 'returns[GSTR-3B].boxes (engines gst-returns box table)', why: 'the GSTR-3B box codes and labels read from a Tally / Zoho file (a: boxes belong with the return); "their one GST account" comparison words are the parallel-run adapter (c)' },
  'lib/party-fields.js': { n: [0, 0, 0, 9], split: [9, 0, 0], cls: 'a', to: 'tax.taxIds[scheme] { shape, check, example, words }', why: 'SCHEMES list and the ABN / TRN / GSTIN validators and their messages: a tax id\'s shape and check digit are the country pack\'s' },
  'lib/books-tally.js': { n: [0, 0, 0, 8], split: [0, 0, 8], cls: 'c', why: 'DUTY: ChitBridge tax ledger to Tally duty-ledger names (CGST, SGST/UTGST, IGST); a TallyPrime India adapter' },
  'lib/books-period.js': { n: [1, 0, 1, 5], split: [7, 0, 0], cls: 'a', to: 'returns[BAS].{asked,basisNote} · returns[x].railNote', why: 'branches on returnsDef.id === "BAS" (simpler option, non-cash basis note) and on pack id IN (GSTR-1 / 3B come from the rail): a return\'s options and notes are the return\'s own pack member' },
  'lib/profile.js': { n: [0, 0, 0, 7], split: [7, 0, 0], cls: 'a', to: 'tax.taxIds[GSTIN].{label,shapeWords,checkWords}', why: 'GSTIN label, shape and check-character messages, and the GST registration warning' },
  'lib/tax-governance.js': { n: [5, 2, 0, 0], split: [7, 0, 0], cls: 'a', to: '(none: read the shop\'s own pack layer; no India default)', why: 'an INR-currency shop with no layer of its own reads region layer IN\'s slabs (the natdef pattern: India as the default)' },
  'lib/readiness.js': { n: [1, 0, 0, 5], split: [6, 0, 0], cls: 'a', to: 'invoice.header.required[] · words.standard', why: 'the supplier-details check of an India tax invoice (GST Rule 46, standard IN-GST) and the GSTIN guidance' },
  'lib/tax-copy.js': { n: [1, 0, 0, 4], split: [5, 0, 0], cls: 'a', to: 'returns[x].reader · words.taxName', why: 'reads the return copy only when the pack is IN; GST / ITC words in two reasons' },
  'lib/tax-lines.js': { n: [1, 0, 1, 3], split: [5, 0, 0], cls: 'a', to: 'words.taxName · returns[x].supported', why: 'default tax_scheme "GST", the "GSTR returns are for shops registered for GST in India" refusal, and a GST note' },
  'routes/books.js': { n: [4, 0, 0, 1], split: [5, 0, 0], cls: 'a', to: 'returns[x].reader · words.railNote', why: 'two pack.id !== "IN" branches on the return parts and the GSTR-1 / 3B "made from your bills" sentence' },
  'lib/country-setup.js': { n: [2, 0, 1, 1], split: [3, 1, 0], cls: 'a', to: 'tax.schemes[] (which registration schemes a country offers)', why: '"composition" is refused outside IN by a country check; the GST registration refusal words; the Australia/Sydney time-zone example in an error is an IANA example (b)' },
  'lib/books-cashflow.js': { n: [2, 0, 0, 1], split: [3, 0, 0], cls: 'a', to: 'returns[x].{form,short,dueDate}', why: 'INDIA_RETURN (GSTR-3B, GST) and the IN-only due date of the return' },
  'lib/books-manual.js': { n: [0, 0, 0, 3], split: [3, 0, 0], cls: 'a', to: 'tax.blockedCredit[] (s.17(5) reasons)', why: 'GST input credit blocked reasons quoted from CGST s.17(5), and a GST on own use note' },
  'lib/books-pack.js': { n: [1, 0, 1, 1], split: [1, 0, 2], cls: 'c', to: 'tax.taxIds[scheme]', why: 'the Tally status "not_for_country" and its India-only test are the Tally adapter (c); the GSTIN scheme on an imported party is a tax-id rule (a)' },
  'lib/books-todo.js': { n: [1, 0, 0, 2], split: [3, 0, 0], cls: 'a', to: 'returns[x].{short,close}', why: 'the "Close GST" to-do and its IN-only check' },
  'lib/kyb.js': { n: [3, 0, 0, 0], split: [0, 3, 0], cls: 'b', why: 'structural gaps list the export markets (EU, US, JP) of a certificate; market codes, not a tax rule' },
  'routes/till.js': { n: [1, 0, 0, 2], split: [3, 0, 0], cls: 'a', to: 'tax.taxIds[GSTIN] (same member as party-fields)', why: 'GSTIN shape and check-character refusal at the till for an India shop' },
  'lib/bill-privacy.js': { n: [0, 2, 0, 0], split: [2, 0, 0], cls: 'a', to: 'locale.moneySign / CBLocale.money (engine)', why: 'INR gets lakh grouping (en-IN) and the rupee sign by a code test; the locale engine already answers both from the currency' },
  'lib/books-contract.js': { n: [0, 0, 0, 2], split: [0, 0, 2], cls: 'c', why: 'endpoint summaries for POST /gst/close and /gst/pay: the route names are India\'s (a rename is an API contract change: cb-api)' },
  'lib/catalogue-blueprint.js': { n: [0, 0, 2, 0], split: [0, 2, 0], cls: 'b', why: 'seed product "Indian jujube": a fruit name, not a rule' },
  'routes/definitions.js': { n: [2, 0, 0, 0], split: [2, 0, 0], cls: 'a', to: '(none: the shop\'s own layer)', why: 'the region layer query and governedFromRows read layer IN as the fallback for any jurisdiction' },
  'routes/tax.js': { n: [0, 0, 0, 2], split: [0, 2, 0], cls: 'b', why: 'endpoint summary "GST by state, VAT-type by border" names two tax regimes generically' },
  'lib/books-payables.js': { n: [0, 0, 0, 1], split: [1, 0, 0], cls: 'a', to: 'words.creditNote', why: 'a "GST credit note" prompt on an early-payment discount' },
  'lib/catalogue-view.js': { n: [0, 0, 0, 1], split: [1, 0, 0], cls: 'a', to: 'words.taxName', why: 'scheme falls back to the word "GST"' },
  'lib/crm.js': { n: [0, 0, 0, 1], split: [1, 0, 0], cls: 'a', to: 'tax.taxIds[scheme]', why: 'reads a party\'s tax id by the scheme name "GSTIN"' },
  'lib/dev-otp.js': { n: [0, 0, 1, 0], split: [0, 1, 0], cls: 'b', why: 'tester-only warning text: the daily tester code follows India\'s day when no zone is set' },
  'lib/governance-contract.js': { n: [0, 0, 0, 1], split: [0, 0, 1], cls: 'c', why: 'POST /verify summary names IEC, GSTIN, PAN (the India registry verifier, c with lib/verify.js)' },
  'lib/licence-rules.js': { n: [1, 0, 0, 0], split: [1, 0, 0], cls: 'a', to: 'licences[] (per pack)', why: 'LICENCE_RULES keyed by country (IN: ...)' },
  'lib/rates.js': { n: [0, 1, 0, 0], split: [0, 1, 0], cls: 'b', why: 'development fx card: base currency USD, zero rates (a placeholder, not a country rule)' },
  'lib/starter-fields.js': { n: [0, 0, 0, 1], split: [1, 0, 0], cls: 'a', to: 'words.productCode (pack: "HSN")', why: 'the starter catalogue field "Code / HSN"' },
  'lib/tax-contract.js': { n: [0, 0, 0, 1], split: [0, 0, 1], cls: 'c', why: 'GET /api/tax/ledger summary says "my GSTIN" (the India tax ledger route; cb-api renames)' },
  'lib/tax-shelf.js': { n: [0, 0, 0, 1], split: [1, 0, 0], cls: 'a', to: 'words.taxName', why: 'tests a governed scheme against the word "GST"' },
  'lib/verify.js': { n: [0, 0, 0, 1], split: [0, 0, 1], cls: 'c', why: 'the GSTN registry check shape for the verify door (an India registry adapter)' },
  'routes/connectors.js': { n: [0, 1, 0, 0], split: [0, 1, 0], cls: 'b', why: 'the connector test-document sample carries currency INR (test: true)' },
  'routes/identity-docs.js': { n: [1, 0, 0, 0], split: [1, 0, 0], cls: 'a', to: 'identityDocs[] (per pack)', why: 'the id-document types offered, keyed IN: ...' },
  'routes/products.js': { n: [0, 1, 0, 0], split: [1, 0, 0], cls: 'a', to: '(data: the adopted list carries its own currency)', why: 'starter lists\' figures are rupees, so list prices are kept for an INR shop only' },
  'routes/relationships.js': { n: [0, 1, 0, 0], split: [1, 0, 0], cls: 'a', to: 'locale.moneySign (engine)', why: 'an offer\'s amount reads the rupee sign by a code test' },
};

/** every .js / .cjs file of lib/, routes/, middleware/ and server.js (the api's own code; adopted engine copies are skipped by their header) */
function listFiles() {
  const out = ['server.js'];
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((e) => {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel); } else if (/\.c?js$/.test(e.name)) out.push(rel);
  });
  ['lib', 'routes', 'middleware'].forEach((d) => { if (fs.existsSync(path.join(ROOT, d))) walk(d); });
  return out.filter((f) => fs.existsSync(path.join(ROOT, f)));
}

/** the code of a source: block comments, HTML comments and whole-line / trailing `// ` comments removed, line count kept */
function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''))
    .join('\n');
}
/** [code, ccy, name, law] counts of a source */
function count(src) {
  const code = strip(src);
  return KINDS.map((k) => (code.match(PATTERNS[k]) || []).length);
}
/** a file that is another repo's code or a machine's output is not ours to baseline here */
function skipped(src) {
  const head = src.slice(0, 400);
  return /ADOPTED (BUNDLE |from )/.test(head) || /GENERATED by/.test(head);
}

let pass = 0, fail = 0;
const ok = (what, fn) => {
  try {
    fn();
    pass++;
    console.log('  ok  ' + what);
  } catch (e) {
    fail++;
    console.log('  FAIL ' + what + '\n      ' + e.message);
  }
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sumOf = (a) => a.reduce((x, y) => x + y, 0);

const seen = {};
listFiles().forEach((rel) => {
  const src = read(rel);
  if (skipped(src)) return;
  seen[rel] = count(src);
});

Object.keys(seen).sort().forEach((key) => {
  const n = seen[key], row = BASELINE[key];
  if (!sumOf(n) && !row) return;
  ok('⭐ ' + key + ' names no more of a country than its baseline [' + KINDS.join(' · ') + '] = [' + (row ? row.n.join(' · ') : '0') + ']', () => {
    assert.ok(row, key + ' names a country in code (' + KINDS.map((k, i) => k + ' ' + n[i]).join(', ') + ') and has no baseline row: put the rule in the pack (engines src/reg-<id>.js), not here');
    const rose = KINDS.filter((k, i) => n[i] > row.n[i]);
    assert.ok(!rose.length, key + ' has MORE country literals than its baseline (' + rose.map((k) => k + ' ' + n[KINDS.indexOf(k)] + ' > ' + row.n[KINDS.indexOf(k)]).join(', ') + ') — a country rule is back outside a pack');
    assert.deepStrictEqual(n, row.n, key + ' is down to [' + n.join(', ') + ']: write that into BASELINE (a baseline only goes down, and is kept tight) and re-split a · b · c');
  });
});
ok('every baseline row names a scanned file that still has hits (a cleared row is deleted, not kept)', () => {
  const stale = Object.keys(BASELINE).filter((k) => !seen[k] || !sumOf(seen[k]));
  assert.deepStrictEqual(stale, []);
});
ok('every row carries a class (a · b · c), a why, and a split [a, b, c] that adds up to its hits', () => {
  const bad = Object.keys(BASELINE).filter((k) => {
    const r = BASELINE[k];
    return !/^[abc]$/.test(r.cls) || !r.why || !Array.isArray(r.split) || r.split.length !== 3 || sumOf(r.split) !== sumOf(r.n) || r.split['abc'.indexOf(r.cls)] === 0;
  });
  assert.deepStrictEqual(bad, []);
});
ok('every row with an (a) share names the pack member it should become (to)', () => {
  const bad = Object.keys(BASELINE).filter((k) => BASELINE[k].split[0] > 0 && !BASELINE[k].to);
  assert.deepStrictEqual(bad, []);
});
ok('the guard sees what it should (counts a code, a currency, a name, a law word; ignores a comment and a lookalike)', () => {
  assert.deepStrictEqual(count("var a = 'AU'; var b = 'INR'; var c = 'India'; var d = 'GSTIN'; // 'IN' India GST\n/* VAT 'AE' */ var e = 'INDIA_X', f = 'in';"), [1, 1, 1, 1]);
  assert.deepStrictEqual(count('var t = { IN: 1, AU: 2 };'), [2, 0, 0, 0]);
  assert.deepStrictEqual(count('<!-- GSTIN --><p>India</p>'), [0, 0, 1, 0]);
});

const totals = { a: 0, b: 0, c: 0 };
Object.values(BASELINE).forEach((r) => {
  totals.a += r.split[0];
  totals.b += r.split[1];
  totals.c += r.split[2];
});
console.log(pass + ' checks · ' + Object.keys(BASELINE).length + ' baselined files · ' + sumOf(Object.values(BASELINE).map((r) => sumOf(r.n))) + ' literals outside the packs (a ' + totals.a + ' · b ' + totals.b + ' · c ' + totals.c + ')');
console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
