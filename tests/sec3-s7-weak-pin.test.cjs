#!/usr/bin/env node
// @type: unit
/**
 * sec3-s7-weak-pin.test.cjs — S7 residual (VERIFY-EL-SECURITY): nothing stopped a person choosing 0000 or 1234.
 * ATTACK    a stranger who knows key@shop tries the commonest PINs first; the timed lock slows him but 1234 / 0000 / 1111 still fall in the first cycle.
 * RULE      a PIN that is one repeated digit, a counting run (1234, 4321, 6789), an ABAB / AABB pattern or 2580 is refused when SET (first PIN and change-pin); an ordinary PIN passes.
 * RUN       node tests/sec3-s7-weak-pin.test.cjs        STANDARD  NIST 800-63B 5.1.1.2 (compare against commonly-used values) · OWASP ASVS 4.0.3 V2.1.7
 * CARD      17-people-employees-hr-and-payroll/pin-otp-first-sign-in
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const A = require('../lib/identity-auth');
let bad = 0;
const t = (n, ok) => { process.stdout.write((ok ? 'ok   ' : 'FAIL ') + n + '\n'); if (!ok) bad++; };
(async () => {
  const refused = ['0000', '1111', '9999', '1234', '4321', '2345', '6789', '9876', '0123', '3210', '1212', '1122', '2580'];
  const fine = ['4827', '1357', '7391', '0586', '2468', '1990'];
  t('every common PIN is refused: ' + refused.join(' '), refused.every((p) => A.weakPinReason(p)));
  t('ordinary PINs pass: ' + fine.join(' '), fine.every((p) => A.weakPinReason(p) === null));
  /* the validator the two routes use refuses 1234 and lets 4827 through */
  const run = async (pin) => { const req = { body: { pin } }; await body('pin').isLength({ min: 4, max: 4 }).isNumeric().bail().custom(A.notWeakPin).run(req); return validationResult(req).isEmpty(); };
  t('the set-PIN validator answers 400-shape for 1234 and accepts 4827', (await run('1234')) === false && (await run('4827')) === true);
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  t('both doors use it: first PIN (routes/signin.js) and change-pin (routes/actors.js)', /\.custom\(identityAuth\.notWeakPin\)/.test(src('routes/signin.js')) && /new_pin'\)[^\n]*notWeakPin/.test(src('routes/actors.js')));
  process.exit(bad ? 1 : 0);
})();
