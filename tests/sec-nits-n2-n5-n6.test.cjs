#!/usr/bin/env node
// @type: unit
/**
 * sec-nits-n2-n5-n6.test.cjs — the three nits of VERIFY-GF-MONEY-SECURITY, each with its own check.
 * N2  the sign-in log lines carry ids, never an e-mail address or a display name.
 * N5  routes/simulator.js signs no tour token with a constant secret unless this is a test run or a local stack.
 * N6  "sealed" is positive proof of an open stack: a mistyped NODE_ENV ('prd') is sealed; development / test / local stay open; an unset NODE_ENV stays open (local runs).
 * RUN       node tests/sec-nits-n2-n5-n6.test.cjs
 * CARD      18-identity-sign-in-and-access/sign-in
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL = '';
const say = console.log.bind(console);
const ROOT = path.join(__dirname, '..');
let bad = 0;
const t = (name, ok, extra) => { say((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' ' + (extra || ''))); if (!ok) bad++; };

/* N2 */
const signin = fs.readFileSync(path.join(ROOT, 'routes', 'signin.js'), 'utf8');
const logs = signin.split('\n').filter((l) => /console\.log\(/.test(l));
t('N2: no console.log in routes/signin.js names an e-mail, a display name or a handle', logs.length > 0 && logs.every((l) => !/\$\{(email|display_name|identity\.display_name|actor_key|entity_name)\}/.test(l)), logs.filter((l) => /\$\{(email|display_name|identity\.display_name|actor_key|entity_name)\}/.test(l)).join(' | '));

/* N6 */
const devOtp = require(path.join(ROOT, 'lib', 'dev-otp'));
const sealedWith = (v) => { if (v === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = v; return devOtp.isSealed(); };
t('N6: a mistyped word (prd, prod-eu, "Production ") is sealed', sealedWith('prd') && sealedWith('prod-eu') && sealedWith(' Production ') && sealedWith('productoin'));
t('N6: the named sealed words stay sealed (production, uat, staging, live, prod)', ['production', 'uat', 'staging', 'live', 'prod'].every(sealedWith));
t('N6: development, dev, test, local (and a leading space) stay open', ['development', 'dev', 'test', 'local', ' development'].every((v) => !sealedWith(v)));
t('N6: an unset NODE_ENV stays open as before (local runs)', sealedWith(undefined) === false);
process.env.NODE_ENV = 'test';

/* N5 */
const sim = fs.readFileSync(path.join(ROOT, 'routes', 'simulator.js'), 'utf8');
t('N5: the constant tour secret is reachable only in a test run or a local stack', /isTestRun\(\) \|\| devOtp\.isLocalStack\(\)\) \? 'sim-lead-dev-only' : ''/.test(sim) && /if \(!SIM_SECRET\) throw/.test(sim));
const insert = sim.indexOf("INSERT INTO sim_leads");
t('N5: a missing secret refuses BEFORE the lead row is written', sim.indexOf('if (!SIM_SECRET) throw') > 0 && sim.indexOf('if (!SIM_SECRET) throw') < insert);
say(bad ? bad + ' failed' : 'all passed');
process.exit(bad ? 1 : 0);
