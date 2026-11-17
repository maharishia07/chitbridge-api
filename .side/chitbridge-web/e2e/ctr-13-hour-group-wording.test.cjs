/**
 * ctr-13-hour-group-wording.test.cjs — CTR-13 (proof 2026-11-14): Today's bills says "8 pm – 9 pm · 2 bills", not the bare "20:00" nobody could read as an hour group.
 * OWNS      the proof on the real public/till.html code: hourRangeWords lifted into a vm sandbox (the clock pinned to en-US so the machine's language cannot change the answer): hour 20 reads
 *           "8 pm – 9 pm", 9 reads "9 am – 10 am", 23 reads "11 pm – 12 am" (the next hour wraps past midnight), 0 reads "12 am – 1 am"; and the group head in openBills builds its words from it
 *           with the plain count ("1 bill", "2 bills") - the head never prints the raw "HH:00".
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/ctr-13-hour-group-wording.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

/* a Date that always formats for en-US, with the narrow no-break space ICU puts before am/pm folded to a plain space */
class EnDate extends Date {
  toLocaleTimeString(locale, options) { return super.toLocaleTimeString('en-US', options).replace(/[\u202f\u00a0]/g, ' '); }
}
const sandbox = { Date: EnDate, Number, String };
vm.createContext(sandbox);
vm.runInContext(liftFns('public/till.html', ['hourRangeWords']) + '\nthis.hourRangeWords = hourRangeWords;', sandbox);
const say = sandbox.hourRangeWords;

let bad = 0;
const ok = (m, c, info) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || !info ? '' : ' -> ' + info)); if (!c) bad++; };
ok('hour 20 (the 2 bills Rs 460 of the walk) reads "8 pm – 9 pm"', say('20') === '8 pm – 9 pm', say('20'));
ok('hour 09 reads "9 am – 10 am"', say('09') === '9 am – 10 am', say('09'));
ok('hour 23 wraps: "11 pm – 12 am"', say('23') === '11 pm – 12 am', say('23'));
ok('hour 00 reads "12 am – 1 am"', say('00') === '12 am – 1 am', say('00'));
ok('it is never the bare 24-hour "20:00"', !/\d\d:\d\d/.test(say('20')), say('20'));

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'till.html'), 'utf8');
ok('the group head prints hourRangeWords(g.h) and the count as "1 bill" / "N bills"', /esc\(hourRangeWords\(g\.h\)\) \+ ' · <span class="u"[^\n]*\n\s*\+ n \+ \(n === 1 \? ' bill' : ' bills'\)/.test(src), '');
ok('and nowhere is the raw hour printed as the head ("' + "g.h + ':00'" + '")', !/g\.h \+ ':00'/.test(src), '');
process.exitCode = bad ? 1 : 0;
