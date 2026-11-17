/**
 * docnumber-continuity.cjs — Run the counter's nextNumber() outside the browser, against a fresh series and a LEGACY one, because the whole
 * promise made to Athi was "as long as it is not an issue for the continuity" — and continuity is precisely the
 * thing a fresh-install test cannot see.
 */
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'till.html'), 'utf8');

/* the engine, as the page loads it */
global.window = {};
require(require('path').join(__dirname, '..', 'public', 'engine', 'docnumber.js'));

/* pull just nextNumber + its two helpers */
const grab = (name) => {
  let i = src.indexOf('function ' + name + '(');
  const j = src.indexOf('\n}', i);
  /* ⚠️ keep a leading `async ` — slicing from "function" dropped it, and an await inside became a SyntaxError */
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  return src.slice(i, j + 2);
};
const fn = [
  'var S = { shop: { country: COUNTRY } };',
  'var ls = { get: (k, d) => (STORE[k] === undefined ? d : STORE[k]), set: (k, v) => { STORE[k] = v; } };',
  'var DB = { get: async (k) => BOXES[k], set: async (k, v) => { BOXES[k] = v; } };',
  /* W1-TILL: the page keeps no April formula — nextNumber asks the engine through DOCNUM() (the bare CBDoc the page's window provides) */
  'var CBDoc = window.CBDoc;', grab('DOCNUM'),
  grab('docCountry'), grab('tillId'),
  /* ⚠️ nextNumber now reads DOC_TAGS (receipt/despatch/credit/expense/subscription series) — taken from the page
     itself, never retyped here, so the table this test runs against is the one the counter runs (2026-09-27) */
  (src.match(/^var DOC_TAGS = \{[^\n]*\};$/m) || ['var DOC_TAGS = {};'])[0],
  /* ⚠️ and the numbering SCHEME it grew since (a series prefix per counter, and when a change of it takes effect):
     every helper nextNumber now calls, taken from the page. shopLs is the one stand-in — it names the browser store
     per counter key, which is not what this test is about; one store is enough here. */
  'function shopLs(k){ return k; }',
  (src.match(/^var TILLOPT = [^\n]*;$/m) || ["var TILLOPT = null, TILLOPT_AT = '';"])[0],
  grab('tillOptDefaults'), grab('tillOpt'), grab('tillScheme'), grab('schemeTakesEffect'), grab('docTagOf'), grab('docKindOf'),
  /* the number-taker as the page has it now: nextNumber -> underSeriesLock -> takeNumber, with the series helpers (seriesFor, rollSeries,
     parkRuns, switchPrefix, resumeFromCloud, numberText ...) - one contiguous block of till.html, from LAST_SERIES to just before
     DOC_TAGS, lifted whole, so the code that runs here is the code the counter runs */
  src.slice(src.indexOf('var LAST_SERIES = null;'), src.indexOf('var DOC_TAGS = {')),
  /* the only new stand-ins, none of them numbering: who is billing (a keyed counter, as these cases are: tillId reads cb_till_id),
     the name of the cross-tab lock (a bare Node has no navigator.locks) and the page's swallowed-error log */
  'function personOn(){ return false; }', 'function tillStore(){ return "test"; }', 'function cbQuiet(){}',
  'return nextNumber;',
].join('\n');

const make = (country, store, boxes) =>
  new Function('COUNTRY', 'STORE', 'BOXES', 'window', fn)(country, store, boxes, global.window);

(async () => {
  const D = global.window.CBDoc;
  let bad = 0;
  const show = (what, no, country) => {
    const c = D.check(no, country);
    if (!c.ok) bad++;
    console.log('    ' + what.padEnd(30) + no.padEnd(20) + String(no.length).padStart(2)
      + '  ' + (c.ok ? 'ok' : 'OVER — ' + c.reason));
  };

  console.log('\n  A FRESH COUNTER in India\n');
  {
    const store = { cb_till_id: 'C2' }, boxes = {};
    const next = make('IN', store, boxes);
    show('sale', await next(), 'IN');
    show('sale (2nd)', await next(), 'IN');
    show('goods receipt', await next('GRN'), 'IN');
    show('despatch', await next('DC'), 'IN');
  }

  console.log('\n  ⚠ A COUNTER ALREADY BILLING — the continuity case\n');
  {
    /* a series record written before this change: no tagStyle, mid-sequence */
    const store = { cb_till_id: 'C1' };
    const boxes = { 'series': { prefix: 'C1', fy: '26-27', next: 412 },
                    'series-GRN': { prefix: 'C1', fy: '26-27', next: 7 } };
    const next = make('IN', store, boxes);
    const sale = await next();
    const grn = await next('GRN');
    show('sale continues at 412', sale, 'IN');
    console.log('      ' + (sale === 'C1/26-27/0412' ? 'ok    the sequence is unbroken' : 'BROKEN — expected C1/26-27/0412'));
    if (sale !== 'C1/26-27/0412') bad++;
    /**
     * ⚠⚠ A LEGACY GRN SERIES STAYS OVER THE LIMIT UNTIL THE YEAR TURNS, AND THAT IS THE DELIBERATE TRADE.
     * Changing a live series mid-year destroys the one property numbering exists to prove, which is worse. And
     * the number that must never be over is the SALE — the tax invoice — which is 13. A GRN is our own inward
     * record, not a document we issue. It self-heals at the next financial year, proved just below.
     */
    console.log('    ' + 'GRN keeps its long tag'.padEnd(30) + grn.padEnd(20) + String(grn.length).padStart(2)
      + '  17 by design until the year turns');
    console.log('      ' + (grn === 'GRN/C1/26-27/0007'
      ? 'ok    an existing series did NOT change shape mid-year'
      : 'BROKEN — an existing series changed shape: ' + grn));
    if (grn !== 'GRN/C1/26-27/0007') bad++;
  }

  console.log('\n  ⚠ THE SAME COUNTER, NEXT FINANCIAL YEAR — it should roll to the short tag\n');
  {
    const store = { cb_till_id: 'C1' };
    const boxes = { 'series-GRN': { prefix: 'C1', fy: '25-26', next: 88 } };
    const next = make('IN', store, boxes);
    const grn = await next('GRN');
    show('GRN, new year', grn, 'IN');
    console.log('      ' + (grn === 'G/C1/26-27/0001'
      ? 'ok    restarted at 1 AND took the short tag' : 'BROKEN — ' + grn));
    if (grn !== 'G/C1/26-27/0001') bad++;
  }

  console.log('\n  A SHOP WE HAVE NOT STUDIED (AE) — no Indian rule may reach it\n');
  {
    const store = { cb_till_id: 'C1' }, boxes = {};
    const next = make('AE', store, boxes);
    const sale = await next();
    show('sale', sale, 'AE');
    console.log('      ' + (!/26-27/.test(sale)
      ? 'ok    no Indian financial year' : 'BROKEN — inherited India\'s FY: ' + sale));
    if (/26-27/.test(sale)) bad++;
  }

  console.log('\n  ' + bad + ' problems\n');
  process.exitCode = bad ? 1 : 0;
})();
