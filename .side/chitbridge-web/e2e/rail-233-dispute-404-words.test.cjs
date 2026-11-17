/**
 * rail-233-dispute-404-words.test.cjs - RAIL-233 (2026-11-14): a 404 on a dispute read says the dispute is gone, not "Check the connection".
 * OWNS      failWords() in public/app/cap-dispute.js, lifted and run in a vm sandbox. CALLED BY .github/workflows/ci.yml (Offline guards).
 *   node e2e/rail-233-dispute-404-words.test.cjs      RAIL233_MUTATE=1 reverts the fix in memory and must FAIL
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');
let text = liftFns('public/app/cap-dispute.js', ['failWords'], '  ');
if (process.env.RAIL233_MUTATE) text = text.replace(/\n\s*if \(e && e\.status === 404\)[^\n]*/, '');
const sb = { T: (s) => s };
vm.createContext(sb);
vm.runInContext(text, sb);
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const w404 = sb.failWords({ status: 404 }, 'the dispute');
ok(w404 === "Couldn't find the dispute", '404 names what is missing, no period: ' + w404);
const w404list = sb.failWords({ status: 404 }, 'the disputes on this chit');
ok(w404list === "Couldn't find the disputes on this chit", '404 on a list call names the list: ' + w404list);
ok(/cannot open disputes/.test(sb.failWords({ status: 403 }, 'x')), '403 words unchanged');
ok(/Check the connection/.test(sb.failWords({ status: 500 }, 'the dispute')), 'other errors keep the connection words');
process.exit(bad ? 1 : 0);
