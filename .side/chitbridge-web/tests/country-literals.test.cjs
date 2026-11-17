'use strict';
/**
 * tests/country-literals.test.cjs — THE COUNTRY-LITERAL RATCHET, web twin of chitbridge-engines tests/country-literals.test.js
 * (CTRY-DATA, Athi 11 Nov 2026: "country rules should be data" / "we should not be having any country rule in the code").
 *
 * The engines guard holds src/ (outside the packs) to its baseline. This one holds public/ (the pages and public/app/) to theirs. It counts, in CODE
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
 * NOT SCANNED (named, so nothing is skipped silently): adopted engine copies (public/engine/*, public/app/workflow.js: header "ADOPTED"); public/vendor/ (third-party code; xlsx.full.min.js has 7 accidental matches); GENERATED files (public/app/screens.js: 19 label-register hits that follow public/till.html and disappear with them); e2e/, tests/, tools/.
 *
 * ⭐ RATE / THRESHOLD CENSUS (11 Nov 2026; numbers next to a tax word, 0.18 · 75000 · 375000 · 2500 · 5% · 10% · 18% …) outside the packs:
 * web public: no tax rate is computed from a typed number. Typed numbers are display or sample: "GST 18%" in help and sample text
 *   (cap-definitions · cap-catsetup · cap-network), "+5% GST" in the Legend, "A$1,000" in the Standards prose, rate 5 / 18 in sample lines
 *   (bill-print · country-lab), and TWO live defaults: public/app/cap-print.js standard rate falls back to 18 when the pack states none, and
 *   public/bill-print.html defaults the signature tax to { word: 'GST', split: true, rate: 18 }. Both are class (a) (pack tax.rates /
 *   standard_rate) and answer-bearing: a move is NOT neutral for a shop whose pack states no rate.
 * OWNS    the baseline of country literals outside the packs for web and the class of each
 * CALLED BY .github/workflows/ci.yml (check job)
 * FLOW    read public/** → strip comments → count four kinds → compare with BASELINE → exit 1 on a rise, an unexplained fall, a new file
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
  'public/app/cap-standards.js': { n: [63, 4, 138, 121], split: [6, 320, 0], cls: 'b', to: 'STD_COUNTRIES (the Standards page country filter: hand-typed IN · AU · AE, fed from CBRegulation.list())', why: 'THE REGISTER OF STANDARDS: read line by line, 320 of 326 hits are data rows (fields c = applies-in ISO codes, n / w / p / why / note / eq = display prose naming GST, CGST, HSN, India, Australia, UAE on a standards page). The 6 in (a) are the hand-typed STD_COUNTRIES list; nothing here computes a tax' },
  'public/till.html': { n: [2, 0, 3, 52], split: [55, 2, 0], cls: 'a', to: 'words{taxName,taxId} · taxLedgers[head].label · invoice.supplyWords · returns (till master: change there, then vendor-till; heads CGST/SGST/IGST are COMPUTED at 23200 by rate/2)', why: 'the counter (vendored byte copy of the till master): GST / GSTIN / CGST / SGST / IGST words on the receive sheet, the slip and the shop-details check; two language pickers (b)' },
  'public/app.html': { n: [0, 6, 4, 28], split: [20, 11, 7], cls: 'a', to: 'words{taxName,productCode} · taxLedgers[head].label · tax.taxIds[GSTIN]', why: 'catalogue sheet and invoice preview: GST / HSN / CGST / SGST / IGST words and scheme tests (a); the currency picker list is an ISO list (b); the IRP invoice field names CgstAmt · IgstAmt · GstRt in the e-invoice view are India\'s schema (c)' },
  'public/app/cap-admin.js': { n: [1, 4, 9, 20], split: [15, 16, 3], cls: 'b', to: 'returns[x].summaryBand · taxLedgers[head].label · words.productCode', why: 'a MIS band that reads India\'s GST only, GST head labels, HSN words (a); locale / calendar pickers and money samples (b); Tally / Zoho / GoFrugal connector error words (c)' },
  'public/app/cap-country.js': { n: [7, 0, 7, 2], split: [16, 0, 0], cls: 'a', to: 'setup{ fy_start_month } · tax.schemes[] · locale.zones[] · tax.registrationKinds[].help', why: 'Country Setup screen: India-only branches (composition, tax-id word PIN) and the Australian time-zone labels and the GST scheme help (same words as api lib/pack-words)' },
  'public/app/catalogue-model.js': { n: [0, 0, 13, 3], split: [0, 16, 0], cls: 'b', why: 'language group "Indian" and the standards notes ("Code / HSN" ambiguity, India SAC, India-specific cess): display text' },
  'public/app/cap-readiness.js': { n: [9, 0, 6, 0], split: [1, 14, 0], cls: 'b', to: 'compliance.markets[] (BIS: India conformity)', why: 'export-readiness origin picker and alias list (b); one standards name "BIS — India conformity" (a, cb-compliance)' },
  'public/country-lab.html': { n: [4, 0, 2, 9], split: [9, 6, 0], cls: 'a', to: 'tax.taxIds[scheme] { name, shape, example } · returns.einvoice words', why: 'Country Lab: per-pack tax-id checks (ABN · TRN · GSTIN) and the GST / IRN words in the compare text typed in the page; default compare pair and two prose mentions (b)' },
  'public/app/bank-demo.js': { n: [1, 1, 0, 3], split: [0, 5, 0], cls: 'b', why: 'the no-login bank demo is a fixed Australian SAMPLE (AU · AUD statement and books, the GST-basis question): demo seed data, no rule computed; the post adapter and the flow stay country-free' },
  'public/app/bank-demo-sample.js': { n: [0, 0, 0, 2], split: [0, 2, 0], cls: 'b', why: 'the no-login bank demo fixed Australian SAMPLE statement, moved out of bank-demo.js (71e4e79c): one narration line (ATO PAYMENT BAS) is seed data, no rule computed' },
  'public/design-mock.html': { n: [3, 3, 8, 0], split: [0, 14, 0], cls: 'b', why: 'design mock: demo network data (USA · India · UAE)' },
  'public/testing.html': { n: [6, 8, 0, 0], split: [0, 14, 0], cls: 'b', why: 'testing console: test defaults and test fixtures (INR · IN · AE rows)' },
  'public/conversion-lab.html': { n: [0, 11, 0, 0], split: [0, 11, 0], cls: 'b', why: 'conversion lab: sample prices and RBI-reference sample rates' },
  'public/app/cap-definitions.js': { n: [1, 0, 1, 8], split: [4, 6, 0], cls: 'b', to: 'tax.scheme · words.taxName', why: 'definition help text with "GST 18%" examples and the HS / HSN explanation (b); the scheme default "GST" and the India-only slab note (a)' },
  'public/app/chit-sheet.js': { n: [0, 0, 0, 10], split: [10, 0, 0], cls: 'a', to: 'words{taxName} · taxLedgers[head].label', why: 'the chit sheet\'s GST / IGST / CGST / SGST section headings and totals' },
  'public/app/cap-books.js': { n: [0, 0, 0, 3], split: [3, 0, 0], cls: 'a', to: 'tax.taxIds[] (scheme list) · words.creditNote', why: 'GST labels in the books' },
  'public/app/cap-books-party.js': { n: [0, 0, 0, 5], split: [5, 0, 0], cls: 'a', to: 'tax.taxIds[] (scheme list)', why: 'TAX_SCHEMES list (GSTIN · TRN · ABN · VAT …), split out of cap-books.js' },
  'public/app/cap-shop.js': { n: [3, 0, 0, 2], split: [5, 0, 0], cls: 'a', to: 'tax.taxIds[] · profile.secondId', why: 'the shop vault\'s tax-id labels, the India-only second id (the bank code words moved to helpers.js PACK_WORDS, one table)' },
  'public/app/helpers.js': { n: [4, 0, 0, 6], split: [10, 0, 0], cls: 'a', to: 'words{ taxName, taxId, postcode, region, stock } (the one PACK_WORDS table: helpers.js reads it for the web)', why: 'PACK_WORDS (taxName IN GST · AU GST · AE VAT: the fallback for a page with no registered pack, e.g. the auditor Tax close, walk-returns R9; pack words.taxName already holds it): IN GSTIN · PIN · State; AU ABN · Postcode; AE TRN · P.O. Box · Emirate; US Inventory' },
  'public/bill-print.html': { n: [0, 0, 0, 2], split: [2, 0, 0], cls: 'a', to: 'words{taxName,taxId} · invoice.sampleRate', why: 'the bill-print page defaults to India (country IN, tax word GST, rate 18, id word GSTIN, INR) and prints CGST / SGST / HSN words' },
  'public/app/cap-crm-record.js': { n: [0, 0, 0, 6], split: [6, 0, 0], cls: 'a', to: 'taxLedgers[head].label · tax.taxIds[GSTIN]', why: 'CRM supply words (CGST and SGST / IGST) and a GSTIN scheme test' },
  'public/app/cap-catsetup.js': { n: [0, 0, 1, 4], split: [1, 4, 0], cls: 'b', to: 'words.slabReference', why: 'Indian language group and help text naming HSN and GST slabs (b); the "GST slab rates (reference)" heading (a)' },
  'public/product-lab.html': { n: [0, 1, 0, 2], split: [3, 0, 0], cls: 'a', to: 'words.unitCode (UQC) · currency from the shop, no INR default', why: 'product lab defaults INR and shows the GST unit code' },
  'public/app/cap-legend.js': { n: [0, 0, 1, 3], split: [0, 4, 0], cls: 'b', why: 'Legend prose: examples (+5% GST), "India is 2-2-3" grouping note' },
  'public/app/cart.js': { n: [0, 0, 0, 4], split: [4, 0, 0], cls: 'a', to: 'words.taxName · words.productCode', why: 'scheme falls back to the word "GST" (three places) and an HSN chip' },
  'public/app/ui-standard.js': { n: [0, 1, 3, 0], split: [0, 4, 0], cls: 'b', why: 'standards gallery text and a USD mock amount' },
  'public/list-lab.html': { n: [0, 0, 0, 4], split: [0, 4, 0], cls: 'b', why: 'list lab demo ledger rows (Output CGST / SGST)' },
  'public/network-design.html': { n: [0, 4, 0, 0], split: [0, 4, 0], cls: 'b', why: 'network design mock data (currency_code INR)' },
  'public/offer-lab-next.html': { n: [0, 4, 0, 0], split: [0, 4, 0], cls: 'b', why: 'offer lab (next): INR fallback and rupee sign in a lab page' },
  'public/supplier-design.html': { n: [0, 4, 0, 0], split: [0, 4, 0], cls: 'b', why: 'supplier design mock data (currency_code INR)' },
  'public/app/cap-catalogue.js': { n: [0, 0, 0, 3], split: [3, 0, 0], cls: 'a', to: 'catalogue.tariffCode { lengths: [4, 6, 8], word: "HSN" } · words.productCode', why: 'catalogue code checks: HSN length rule (4, 6 or 8 digits) and the Code / HSN label' },
  'public/app/cap-settings.js': { n: [1, 1, 0, 0], split: [0, 2, 0], cls: 'b', why: 'a USD money-format probe in settings' },
  'public/app/cap-testing.js': { n: [0, 0, 0, 2], split: [0, 2, 0], cls: 'b', why: 'test-case wording "GST-registered, unregistered, overseas"' },
  'public/app/cap-categories.js': { n: [0, 0, 0, 1], split: [1, 0, 0], cls: 'a', to: 'words.taxName', why: 'slab chip text "GST n%"' },
  'public/app/cap-chit2.js': { n: [0, 0, 0, 1], split: [1, 0, 0], cls: 'a', to: 'words.taxName', why: 'a line\'s tax name falls back to "GST"' },
  'public/app/cap-finance-returns.js': { n: [1, 0, 0, 0], split: [1, 0, 0], cls: 'a', to: 'returns[x].reader', why: 'one pack.id === "IN" branch in the returns screen' },
  'public/app/cap-fx.js': { n: [0, 1, 0, 0], split: [0, 1, 0], cls: 'b', why: 'a currency input placeholder "USD"' },
  'public/app/cap-network.js': { n: [0, 0, 0, 1], split: [0, 1, 0], cls: 'b', why: 'a sample TAX TREATMENT row "GST 18% inclusive" in the network demo' },
  'public/app/country-profiles.js': { n: [0, 0, 0, 1], split: [1, 0, 0], cls: 'a', to: 'words.slabWord', why: 'the hint "Rates by slab (HSN)"' },
  'public/cart-design.html': { n: [0, 1, 0, 0], split: [0, 1, 0], cls: 'b', why: 'cart design mock data' },
  'public/shop.html': { n: [1, 0, 0, 0], split: [1, 0, 0], cls: 'a', to: '(none: the shop page reads the shop\'s own country)', why: 'default region _REGION = "IN"' },
  'public/storefront-design.html': { n: [0, 1, 0, 0], split: [0, 1, 0], cls: 'b', why: 'storefront design mock data' },
};

/** every .js / .cjs / .html file under public/ except vendor/ (third-party minified code); adopted copies and generated files are skipped by their header */
function listFiles() {
  const out = [];
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach((e) => {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'vendor') walk(rel); } else if (/\.(c?js|html)$/.test(e.name)) out.push(rel);
  });
  walk('public');
  return out;
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
