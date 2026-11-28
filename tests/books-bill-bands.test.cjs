/**
 * books-bill-bands.test.cjs — the ONE ageing, per bill (lib/books-bill-bands.js): band + days past due. Offline, the real engines, no database.
 * Unit per rule · the refusal path (settled and unreadable documents are refused a band) · fail closed (a bill with no terms is never called "not due"). Run: node tests/books-bill-bands.test.cjs
 * CARD 16-finance/receivables-and-payables
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const Engines = require(path.join(API, 'lib', 'books-engines'));
const { billBands } = require(path.join(API, 'lib', 'books-bill-bands'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const bill = (ref, minor, date, due) => ({ party: 'p1', side: 'receivable', ref_kind: 'bill', ref, against_ref: ref, amount_minor: minor, currency: 'INR', date, due_date: due || null });
const docsOf = (items) => { const by = Engines.receivables().outstanding(items).by_ref; return Object.keys(by).map((ref) => by[ref]); };
const THIRTY = () => 30;
const NONE = () => null;

const old = bill('B1', 1000, '2026-09-01', '2026-09-15');
const fresh = bill('B2', 500, '2026-10-20');
const bands = billBands(docsOf([old, fresh]), '2026-11-01', THIRTY, 'receivable');
ok('a bill past its own due date: band and whole days late', bands.B1.band === 'd31_60' && bands.B1.days_late === 47, JSON.stringify(bands.B1));
ok('a bill not yet due has days_late null and the not_due band', bands.B2.band === 'not_due' && bands.B2.days_late === null, JSON.stringify(bands.B2));
ok('a bill with a due date is not marked no_terms', bands.B1.no_terms === false);
ok('the same bill on a later day is later by exactly the days between (UTC midnights)', billBands(docsOf([old]), '2026-11-02', THIRTY, 'receivable').B1.days_late === 48);
ok('a payable is aged on the payable side too', billBands(docsOf([Object.assign({}, old, { side: 'payable' })]), '2026-11-01', NONE, 'payable').B1.days_late === 47);
ok('an unknown side is aged as a receivable (the safe default)', billBands(docsOf([old]), '2026-11-01', THIRTY, 'x').B1.days_late === 47);

// fail closed: with no credit days anywhere a bill ages from its bill date and says so — it is never quietly "not due"
const noTerms = billBands(docsOf([fresh]), '2026-11-01', NONE, 'receivable');
ok('fail closed: a bill with no terms ages from its bill date and is marked no_terms', noTerms.B2.no_terms === true && noTerms.B2.age_days === 12 && noTerms.B2.band === 'd0_30', JSON.stringify(noTerms.B2));
// ACC-412: 20 Oct bill, no terms, asOf 1 Nov = 12 days old by hand: it still sits in the 0-30 band, but it is NOT overdue (no due date), days_late null
ok('ACC-412: no terms = not overdue, days_late null, age 12 kept for the band', noTerms.B2.overdue === false && noTerms.B2.days_late === null, JSON.stringify(noTerms.B2));
// by hand: B1 due 15 Sep, asOf 1 Nov = 47 days past a real due date = overdue; B2 due 15 Nov (30 days terms) is not yet due = not overdue
ok('ACC-412: past a real due date is overdue (47); not yet due is not', bands.B1.overdue === true && bands.B1.age_days === 47 && bands.B2.overdue === false, JSON.stringify([bands.B1, bands.B2]));
// due today: 15 Sep asOf 15 Sep = 0 days late = not overdue
ok('ACC-412: due today is not overdue', billBands(docsOf([old]), '2026-09-15', THIRTY, 'receivable').B1.overdue === false);

// the refusal path: a settled document and an empty set get no band at all (refused, not zero-filled)
const refused = (items) => { try { docsOf(items); return false; } catch (err) { return err.status === 422; } };
ok('refusal: no documents is an empty answer, never a throw', Object.keys(billBands([], '2026-11-01', THIRTY, 'receivable')).length === 0);
ok('refusal: a document with nothing outstanding is not aged', !('B1' in billBands(docsOf([old]).map((doc) => Object.assign({}, doc, { outstanding_minor: 0 })), '2026-11-01', THIRTY, 'receivable')));
ok('refusal: a row of an unknown kind is refused by the engine (422) before any band is made', refused([Object.assign({}, old, { ref_kind: 'mystery' })]));
ok('the answer has no prototype (a ref named __proto__ cannot poison it)', Object.getPrototypeOf(billBands([], '2026-11-01', THIRTY, 'receivable')) === null);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
