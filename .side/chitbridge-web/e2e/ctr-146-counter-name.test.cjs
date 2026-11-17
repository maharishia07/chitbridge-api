/**
 * ctr-146-counter-name.test.cjs — CTR-146 (proof 2026-11-14): the till header says the counter's name, never its code ("Counter DQLG").
 * OWNS      the proof on the real public/till.html code (counterName · counterPill · counterTitle lifted into a vm sandbox, the till's storage stubbed). Hand-computed: a name the shop gave wins
 *           ("Front till"); a stored name that is just the default "Counter 1" is not a name, so the number the bills run under speaks: C5 reads "Counter 5", 7 reads "Counter 7";
 *           a code such as DQLG is not shown - the header says "Counter"; a stored custom name ("Back counter") stays; the pill and the title are the same answer as counterName.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/ctr-146-counter-name.test.cjs
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

const store = {}; let id = 'C5';
const sandbox = { String, ls: { get: (k, d) => (k in store ? store[k] : d) }, shopLs: (k) => 'shop:' + k, tillId: () => id, cbQuiet() {} };
vm.createContext(sandbox);
vm.runInContext(liftFns('public/till.html', ['counterName', 'counterPill', 'counterTitle']) + '\nthis.counterName = counterName; this.counterPill = counterPill; this.counterTitle = counterTitle;', sandbox);

let bad = 0;
const ok = (m, c, info) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || !info ? '' : ' -> ' + info)); if (!c) bad++; };
const set = (own, stored, tid) => { Object.keys(store).forEach((k) => delete store[k]); if (own) store['shop:cb_till_counter_name'] = own; if (stored) store.cb_till_name = stored; id = tid; };

set('', '', 'C5');
ok('number C5 -> "Counter 5"', sandbox.counterName() === 'Counter 5', sandbox.counterName());
set('', '', '7');
ok('number 7 -> "Counter 7"', sandbox.counterName() === 'Counter 7', sandbox.counterName());
set('', '', 'DQLG');
ok('a code (DQLG) is not shown: the header says "Counter"', sandbox.counterName() === 'Counter', sandbox.counterName());
set('', 'Counter 1', 'C5');
ok('a stored default "Counter 1" is not a name: the bills\' number speaks (Counter 5)', sandbox.counterName() === 'Counter 5', sandbox.counterName());
set('', 'Back counter', 'DQLG');
ok('a stored custom name stays ("Back counter")', sandbox.counterName() === 'Back counter', sandbox.counterName());
set('Front till', 'Back counter', 'DQLG');
ok('a name the shop gave this counter wins ("Front till")', sandbox.counterName() === 'Front till', sandbox.counterName());
set('', '', 'DQLG');
ok('the header pill and the title are the same answer ("Counter")', sandbox.counterPill() === 'Counter' && sandbox.counterTitle() === 'Counter', sandbox.counterPill() + '/' + sandbox.counterTitle());
set('Front till', '', 'C5');
ok('the pill gives the shop\'s own name too', sandbox.counterPill() === 'Front till' && sandbox.counterTitle() === 'Front till', sandbox.counterPill());
process.exitCode = bad ? 1 : 0;
