/**
 * quote-attempt-key.test.cjs: queue 345. The four quote writes (public/app/cap-quotes.js CB_QUOTE_EP) are idem:'attempt'.
 * CARD 01-rail-core-the-chit/chit-proposal · owns: the proof that a retry after a lost answer reuses the Idempotency-Key of a proposal write
 * called by: npm run check:quoteattempt, CI (.github/workflows/ci.yml)
 *
 * idem:true mints a fresh key per send, so a lost answer then a retry created or sent a proposal twice. The FIN-63 helpers in core.js
 * (cbIdemKey / attemptOf / settleAttempt) keep one key per attempt; this file proves the four rows use them:
 *   1. each write row is POST + idem:'attempt'; quoteList (a read) carries no key
 *   2. the same door, target and body twice give the same key (the retry)
 *   3. another proposal (:pid) is another attempt
 *   4. accept and reject on the same {id,pid} and body give DIFFERENT keys (the door name is part of the attempt)
 *   5. a settled answer ends the attempt
 * Run: node e2e/quote-attempt-key.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8');
const core = read('core.js');
const i = core.indexOf('/* the Idempotency-Key of a write');
const j = core.indexOf('async function apiOnce(');
if (i < 0 || j < 0) throw new Error('idempotency block not found in core.js');

let n = 0;
const sandbox = { console, JSON, Date, cblog: () => {}, CB: { _uuid: () => 'k' + ++n } };
vm.createContext(sandbox);
vm.runInContext(core.slice(i, j) + '\nthis.cbIdemKey = cbIdemKey; this.attemptOf = attemptOf; this.settleAttempt = settleAttempt;', sandbox);
const { cbIdemKey, attemptOf, settleAttempt } = sandbox;

const quotes = { console };
vm.createContext(quotes);
vm.runInContext(read('cap-quotes.js'), quotes);
const EP = quotes.CB_QUOTE_EP;

const answer = (status, body) => ({ status, clone: () => ({ json: async () => body }) });
const keyFor = (name, params, body) => cbIdemKey(EP[name], false, sandbox.CB, 'rid', attemptOf(name, params, body));

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

(async () => {
  console.log('\n══ queue 345 · one key per quote attempt ══\n');
  const WRITES = ['quotePropose', 'quoteAccept', 'quoteReject', 'quoteCounter'];
  const params = { id: 'c1', pid: 'p1' }, body = { note: 'n' };
  for (const name of WRITES) {
    ok(EP[name] && EP[name].m === 'POST' && EP[name].idem === 'attempt', '1a · ' + name + " is POST idem:'attempt'");
    const first = keyFor(name, params, body);
    ok(first && keyFor(name, params, body) === first, '2 · ' + name + ': the retry after a lost answer reuses the key');
    ok(keyFor(name, { id: 'c1', pid: 'p2' }, body) !== first, '3 · ' + name + ': another proposal is another attempt');
    await settleAttempt(EP[name], attemptOf(name, params, body), answer(200, {}));
    ok(keyFor(name, params, body) !== first, '5 · ' + name + ': a settled answer ends the attempt');
  }
  ok(EP.quoteList.m === 'GET' && !EP.quoteList.idem, '1b · quoteList (a read) carries no key');
  ok(keyFor('quoteAccept', params, {}) !== keyFor('quoteReject', params, {}), '4 · accept and reject on the same {id,pid} and body {} get different keys');

  console.log(bad ? `\n  ✗ ${bad} failed\n` : '\n  ✓ all passed\n');
  process.exit(bad ? 1 : 0);
})();
