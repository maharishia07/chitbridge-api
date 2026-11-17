/**
 * bank-cost-blind.test.cjs — l16 integ2b-finmsg (16 Nov 2026): the api's 403 COST_BLIND (B3) on GET /bank/statement-files, /file and /bank/log is SAID, never an empty box or a generic error.
 * OWNS      the proof on the real consts: bksCostBlind · bksCostBlindSay · bksWhy (cap-bank-store.js) · bkstBlind · bkstWhyNot · the load catch and the summary line (cap-bank-statements.js)
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.   node e2e/bank-cost-blind.test.cjs
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const store = fs.readFileSync('public/app/cap-bank-store.js', 'utf8'), stm = fs.readFileSync('public/app/cap-bank-statements.js', 'utf8');
const line = (src, name) => { const m = src.match(new RegExp('^const ' + name + ' = [^\n]*$', 'm')); if (!m) throw new Error(name + ' not found'); return m[0]; };
const cx = vm.createContext({ tx: (s) => s, BKST: { mode: 'server', data: null, fileTotal: 0 } });
vm.runInContext(['bksCostBlind', 'bksCostBlindSay', 'bksWhy'].map((n) => line(store, n)).join('\n') + '\n' + ['bkstBlind', 'bkstWhyNot'].map((n) => line(stm, n)).join('\n') + '\nthis.f = { bksCostBlind, bksCostBlindSay, bksWhy, bkstWhyNot };', cx);
const f = cx.f;
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
const SAY = 'Your access does not include costs, so the bank statements are hidden.';
(async () => {
  const log403 = Object.assign(new Error('Forbidden'), { status: 403, data: { code: 'COST_BLIND' } });
  ok(f.bksCostBlind(log403) && f.bksWhy(log403) === SAY, '/bank/log 403 COST_BLIND says the sentence: ' + f.bksWhy(log403));
  ok(f.bksCostBlind({ status: 403, data: { error: { code: 'COST_BLIND' } } }), 'the nested problem shape is read too');
  ok(!f.bksCostBlind({ status: 403, data: { code: 'GRANT_ENDED' } }) && f.bksWhy({ status: 500, message: 'boom' }) === 'boom', 'another 403 or a 500 keeps its own words');
  const res = (status, body) => ({ status, ok: false, clone: () => ({ json: () => (body ? Promise.resolve(body) : Promise.reject(new Error('no body'))) }) });
  ok((await f.bkstWhyNot(res(403, { code: 'COST_BLIND' }))) === SAY, '/statement-files/:id/file 403 COST_BLIND says the sentence');
  ok((await f.bkstWhyNot(res(403, null))) === 'This access has ended.', 'a 403 with no body keeps "This access has ended."');
  ok(stm.includes("bksCostBlind(failure) ? 'blind' : 'error'") && stm.includes("BKST.mode === 'blind' || "), '/statement-files list 403 sets mode blind and the Statements line says the sentence');
  /* the Bank home: bankHomeSigned (the real function) meets a 403 COST_BLIND on /bank/log and the Statements line says the sentence, not "Kept" */
  const { liftFns } = require('./lib/lift-fn.cjs');
  const homeState = { signed: {}, known: false, blind: false }; /* cap-bank-home.js keeps it as BANK_HOME and publishes it as window.BKH */
  const cx2 = vm.createContext({ tx: (s) => s, bkhSignedRange: () => ({}), BKST: { mode: 'server', data: { accounts: [{ code: '1100', account_id: 'a1' }] }, fileTotal: 0 }, BANK_HOME: homeState, BKH: homeState, api: () => Promise.reject(log403) });
  vm.runInContext(['bksCostBlind', 'bksCostBlindSay'].map((n) => line(store, n)).join('\n') + '\n' + liftFns('public/app/cap-bank-home.js', ['bankHomeSigned']) + '\n' + liftFns('public/app/cap-bank-statements.js', ['bkstSummary']) + '\nthis.g = { bankHomeSigned, bkstSummary };', cx2);
  await cx2.g.bankHomeSigned();
  ok(cx2.BKH.blind === true && cx2.BKH.known === false, 'bankHomeSigned records the 403 COST_BLIND (blind, not known)');
  ok(cx2.g.bkstSummary() === SAY, 'the Bank home Statements line says the sentence, not "Kept": ' + cx2.g.bkstSummary());
  /* the log line the Bank page paints (bankStoreLine) leads with the blind sentence; .say is never painted */
  ok(/const bankStoreLine = \(\) =>\n  bankStoreState\.blind\n    \? bksCostBlindSay\(\)/.test(store) && (store.match(/bankStoreState\.blind = bksCostBlind\(failure\)/g) || []).length === 2, 'the log refusal paints through bankStoreLine at both catch paths');
  if (bad) { console.log(bad + ' FAILED'); process.exit(1); }
  console.log('all ok');
})();
