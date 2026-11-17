'use strict';
/**
 * skill-print.test.cjs - THE PRINT SKILL'S VARIANT IDS ARE ONE SET, EVERYWHERE THE CODE NAMES THEM (2026-11-12).
 *
 * Identity standard section 9 (Athi 12 Nov): print is the first OUTPUT skill. Its read-only record is data/cmdb/CAP-SKILL-PRINT.json
 * (`skill.variants`). This guard reads the record and the places that name a paper or a document kind, and fails when one side
 * renames, adds or drops an id the others still use:
 *   paper        record == web public/app/cap-print.js PAPERS == web public/bill-print.html (the #w options and the body[data-w] rules)
 *   bill_kind    record == bill-print.html #kind options
 *   till_paper   record == the till master's #set_paper options (tools/tally-connector/till.html) and the web copy's
 *   till_doc     record == the document kinds printer.js's slipBytes names (cash | supply | tax, then receipt | despatch)
 *   invoke       the record's invoke file holds the named function
 * No new renderer, no routing: it only reads. The web checkout is the sibling (CB_WEB_DIR, else ../chitbridge-web), as pages-parse.
 * Without a web checkout it SKIPS the web half and says so, except under CI, where a missing web checkout is a failure.
 *
 * Run: node tests/skill-print.test.cjs   - no DB, no network.   CARD qa/offline-guards
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const WEB = process.env.CB_WEB_DIR ? path.resolve(process.env.CB_WEB_DIR) : path.join(API, '..', 'chitbridge-web');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const sorted = (list) => Array.from(new Set(list)).sort();

/** the option values of the <select> that opens at `marker`, up to its closing tag (plain text search, no built-up regex) */
function optionsAfter(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return [];
  const body = src.slice(at, src.indexOf('</select>', at));
  return [...body.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
}

/** what each source names, read as text: pure, so the self-test can feed it a doctored copy */
const readers = {
  capPrintPapers: (src) => sorted([...(/var PAPERS = \[([\s\S]*?)\];/.exec(src) || [, ''])[1].matchAll(/\[\s*'([^']+)'\s*,/g)].map((m) => m[1])),
  billPrintOptions: (src, id) => sorted(optionsAfter(src, '<select id="' + id + '"')),
  billPrintCss: (src) => sorted([...src.matchAll(/body\[data-w="([^"]+)"\]/g)].map((m) => m[1]).concat('80')), // the base .slip rule is the 80 mm one
  tillPaper: (src) => sorted(optionsAfter(src, 'id="set_paper"')),
  printerDocKinds: (src) => sorted([...src.matchAll(/doc.kind (?:===|!==) '([a-z]+)'/g)].map((m) => m[1])),
};

/** every disagreement, as a sentence; empty = one set */
function disagreements(record, sources) {
  const v = record.skill.variants, out = [];
  const same = (what, have, want) => { if (JSON.stringify(have) !== JSON.stringify(sorted(want))) out.push(what + ': code names ' + JSON.stringify(have) + ', record says ' + JSON.stringify(sorted(want))); };
  same('cap-print.js PAPERS vs paper', readers.capPrintPapers(sources.capPrint), v.paper);
  same('bill-print.html #w options vs paper', readers.billPrintOptions(sources.billPrint, 'w'), v.paper);
  same('bill-print.html body[data-w] rules vs paper', readers.billPrintCss(sources.billPrint), v.paper);
  same('bill-print.html #kind options vs bill_kind', readers.billPrintOptions(sources.billPrint, 'kind'), v.bill_kind);
  same('the till master #set_paper vs till_paper', readers.tillPaper(sources.till), v.till_paper);
  if (sources.tillWeb) same('the web till copy #set_paper vs till_paper', readers.tillPaper(sources.tillWeb), v.till_paper);
  same('printer.js doc kinds vs till_doc', readers.printerDocKinds(sources.printer), v.till_doc);
  v.bill_kind.forEach((kind) => { if (v.till_doc.indexOf(kind) < 0) out.push('bill_kind ' + kind + ' is not a till_doc kind - the till prints the same three bills the preview paints'); });
  if (!sources.billPrint.includes('function ' + record.skill.invoke.fn + '(')) out.push('bill-print.html has no function ' + record.skill.invoke.fn + '() - the record\'s invoke point is gone');
  return out;
}

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

const record = JSON.parse(read(path.join(API, 'data', 'cmdb', 'CAP-SKILL-PRINT.json')));
const cmdb = require('../lib/cmdb');
const webOk = fs.existsSync(path.join(WEB, 'public', 'bill-print.html')) && fs.existsSync(path.join(WEB, 'public', 'app', 'cap-print.js'));
if (!webOk && process.env.CI) { console.log('  FAIL no web checkout at ' + WEB + ' (CI must have one)'); process.exit(1); }
const sources = webOk ? {
  capPrint: read(path.join(WEB, 'public', 'app', 'cap-print.js')),
  billPrint: read(path.join(WEB, 'public', 'bill-print.html')),
  till: read(path.join(API, 'tools', 'tally-connector', 'till.html')),
  tillWeb: fs.existsSync(path.join(WEB, 'public', 'till.html')) ? read(path.join(WEB, 'public', 'till.html')) : null,
  printer: read(path.join(API, 'tools', 'tally-connector', 'printer.js')),
} : null;

console.log('\nTHE RECORD\n');
it('CAP-SKILL-PRINT fits the shape (skill kind output) and is named by its CI id', () => {
  const v = cmdb.shape(record); assert.ok(v.ok, v.why);
  assert.strictEqual(record.skill.kind, 'output');
});

console.log('\nTHE CODE NAMES THE SAME IDS\n');
if (!webOk) console.log('  skip no web checkout at ' + WEB + ' (set CB_WEB_DIR); the web half of this guard did not run');
else {
  it('paper / bill_kind / till_paper / till_doc / invoke: record and code are one set', () => assert.deepStrictEqual(disagreements(record, sources), []));
  console.log('\nIT BITES\n');
  const rename = (key, from, to) => ({ ...sources, [key]: sources[key].split(from).join(to) });
  it('a paper id renamed in cap-print.js (58 -> 57) fails', () => assert.ok(disagreements(record, rename('capPrint', "['58',", "['57',")).length >= 1));
  it('a paper id renamed in bill-print.html (a4 -> A4) fails', () => assert.ok(disagreements(record, rename('billPrint', '<option value="a4">', '<option value="A4">')).length >= 1));
  it('a paper id renamed on the till (58 -> 57) fails', () => assert.ok(disagreements(record, rename('till', '<option value="58"', '<option value="57"')).length >= 1));
  it('a document kind renamed in printer.js (despatch -> dispatch) fails', () => assert.ok(disagreements(record, rename('printer', "'despatch'", "'dispatch'")).length >= 1));
  it('a renamed render() (the invoke point) fails', () => assert.ok(disagreements(record, rename('billPrint', 'function render(', 'function paint(')).length >= 1));
  it('an id renamed in the RECORD fails', () => { const r = JSON.parse(JSON.stringify(record)); r.skill.variants.paper[1] = '57'; assert.ok(disagreements(r, sources).length >= 1); });
}

console.log('\n' + pass + ' checks passed\n');
