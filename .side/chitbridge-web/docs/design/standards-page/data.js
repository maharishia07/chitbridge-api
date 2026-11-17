/* Standards page design — its data, DERIVED from the register (STDREG1, 2026-10-14).
   This file used to hold a 61-row copy of public/app/cap-standards.js as of 3 Oct 2026, which the e2e compared field for field; a copy is a second
   list, and the register has moved on (109 rows on 14 Oct). Now index.html loads the register itself (../../../public/app/cap-standards.js) after this
   file, and STD_PAGE is built from it when the prototype first reads it. Only what the register does not hold is kept here: the sample shop name and the
   kural for the proposed footer. Fields the design added (a · k · c · p · m · limit · eq) are register fields now; `id` and `src` are derived below. */
var tx = window.tx || function (s) { return s; };          /* the two helpers the register asks of its page (as e2e/standards-page.cjs gives it) */
var esc = window.esc || function (s) { return String(s); };
Object.defineProperty(window, 'STD_PAGE', { configurable: true, get: function () {
  var page = {
    asOf: STD_CHECKED,
    asOfLabel: new Date(STD_CHECKED + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    shop: 'Chola Auto Care',
    areas: STD_AREAS, kinds: STD_KINDS, countries: STD_COUNTRIES, statuses: STD_STATUS,
    rows: STANDARDS.map(function (r, i) { return Object.assign({}, r, { key: r.id, id: 's' + (i + 1), src: r.added ? 'added ' + r.added : 'register' }); }),
    why: STD_WHY, record: STD_RECORD,
    kural: { no: 118, ta: ['சமன்செய்து சீர்தூக்குங் கோல்போல் அமைந்தொருபால்', 'கோடாமை சான்றோர்க் கணி'], en: 'Like a scale that weighs evenly and leans to neither side: that is the mark of the wise.' }
  };
  Object.defineProperty(window, 'STD_PAGE', { value: page });
  return page;
} });
