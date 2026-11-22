#!/usr/bin/env node
// @type: unit
/**
 * sec3-s1-tester-secret.test.cjs — S1 (VERIFY-EL-SECURITY): the tester code's 8-character floor counted the PUBLIC date.
 * ATTACK    TESTER_CODE=ab{yymmdd} passed the floor with 2 secret characters (676 values); the prefix never changes, and a throwaway registration brought a fresh per-account budget
 *           each time, so ~14 windows from one address opened any owner whose e-mail is known.
 * RULE      only the characters OUTSIDE the date count toward the 8 (shorter = the door stays shut and the boot notice says why); every miss at the tester door is also counted
 *           per CALLER ADDRESS (15 per window, all accounts), and a success on the attacker's own account does not clear it. The door stays a documented testing-phase arrangement.
 * RUN       node tests/sec3-s1-tester-secret.test.cjs        STANDARD  OWASP ASVS 4.0.3 V2.2.1 (anti-automation) · NIST 800-63B 5.2.2
 * CARD      platform/dev-otp
 */
'use strict';
process.env.NODE_ENV = 'test';
process.env.SHOP_CLOCK_ALLOW = '1';
process.env.TESTER_NAMES = '*';
const out = (s) => process.stdout.write(s + '\n');
let bad = 0;
const t = (n, ok) => { out((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) bad++; };
const reqctx = require('../lib/reqctx');
const load = () => { delete require.cache[require.resolve('../lib/dev-otp')]; return require('../lib/dev-otp'); };

(async () => {
  process.env.TESTER_CODE = 'ab{yymmdd}';
  let dev = load();
  t('ab{yymmdd} (2 secret chars + public date) opens no door', dev.testerDoorOpenFor(['x@y.test']) === false);
  t('...and the boot notice says why', dev.testerNotices().some((n) => /secret characters outside the date/.test(n.reason || '')));
  process.env.TESTER_CODE = 'abcdefg{yymmdd}';
  dev = load();
  t('7 secret chars + date is still refused', dev.testerDoorOpenFor(['x@y.test']) === false);
  process.env.TESTER_CODE = 'tq7-Lant{yymmdd}';
  dev = load();
  t('8 secret chars + date opens the door', dev.testerDoorOpenFor(['x@y.test']) === true);

  /* the attacker: one address, a new throwaway account each time (own account budget never runs out) */
  let ipGuesses = 0;
  const attack = (ip) => reqctx.runWithRequest('r', {}, async () => {
    for (let i = 0; i < 40; i++) { await dev.testerGuess('wrong' + i, ['x@y.test'], 'throwaway-' + ip + '-' + i); ipGuesses++; }
  }, ip);
  await attack('203.0.113.9');
  const day = (() => { const c = require('../lib/shop-clock'); return c.bizDay(c.nowMs(), 'Asia/Kolkata').slice(2).replace(/-/g, ''); })();
  const right = 'tq7-Lant' + day;
  const fromAttacker = await reqctx.runWithRequest('r', {}, () => dev.testerGuess(right, ['x@y.test'], 'fresh-account'), '203.0.113.9');
  t('after 15 misses from one address, even the right code is refused from it (fresh account too)', fromAttacker === false);
  const fromOther = await reqctx.runWithRequest('r', {}, () => dev.testerGuess(right, ['x@y.test'], 'fresh-account-2'), '198.51.100.7');
  t('another address is untouched (the real tester still signs in)', fromOther === true);
  const ownWin = await reqctx.runWithRequest('r', {}, () => dev.testerGuess(right, ['x@y.test'], 'own'), '203.0.113.9');
  t('the attacker\'s success on an account of his own does not clear his address count', ownWin === false);
  process.exit(bad ? 1 : 0);
})();
