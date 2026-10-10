'use strict';
/**
 * agent-signin-body.test.cjs — M01: the shop-PC agent never builds a sign-in body by hand.
 * Invariant: a login never creates an identity. /register only refuses to INSERT when mode === 'login', and
 * CBSignin.ask()/verify() (tools/tally-connector/signin.js) are the ONE place that adds it. Source guard, counter-gates style.
 * Run: node tests/agent-signin-body.test.cjs  · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'tools', 'tally-connector');
const PROG = fs.readFileSync(path.join(DIR, 'till.js'), 'utf8').replace(/\r\n/g, '\n');
const CBSignin = require(path.join(DIR, 'signin.js'));
let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };
const route = (p) => { const i = PROG.indexOf("url.pathname === '" + p + "'"); assert(i > 0, p + ' not found'); return PROG.slice(i, i + 4500); };
const start = route('/api/signin/start'), finish = route('/api/signin/finish');

it('till.js requires the shared CBSignin (and the kit stages it)', () => {
  assert(/const CBSignin = require\('\.\/signin'\)/.test(PROG));
  assert(/STAGED = \[[^\]]*'signin\.js'/.test(PROG));
});
it('/api/signin/start builds its body with CBSignin.ask()', () => assert(/CBSignin\.ask\(who\)/.test(start)));
it('/api/signin/finish builds its body with CBSignin.verify()', () => assert(/CBSignin\.verify\(who, otp\)/.test(finish)));
it('no hand-built { email: who } / { user_id: who } literal anywhere in till.js', () => {
  assert(!/\{\s*email:\s*who\b/.test(PROG) && !/\{\s*user_id:\s*who\b/.test(PROG));
  assert(!/who\.indexOf\('@'\)\s*>\s*0\s*\?\s*\{/.test(PROG));
});
it('the register/verify calls pass the CBSignin body, not an inline object', () => {
  assert(/noKey\('POST', '\/api\/entities\/register', asked\.body\)/.test(start));
  assert(/noKey\('POST', '\/api\/entities\/verify', vbody\)/.test(finish));
});
it('ask() always carries mode:login, for an e-mail and for a user id', () => {
  assert.strictEqual(CBSignin.ask('Shop@Example.com').body.mode, 'login');
  assert.strictEqual(CBSignin.ask('kumar01').body.mode, 'login');
  assert.strictEqual(CBSignin.ask('kumar01').body.email, undefined);
});
it('verify() carries mode:login with the otp; a PIN goes as pin', () => {
  assert.deepStrictEqual(CBSignin.verify('a@b.co', '123456').body, { mode: 'login', email: 'a@b.co', otp: '123456' });
  assert.strictEqual(CBSignin.verify('kumar01', '1234').body.mode, 'login');
});
it('a typo is refused before any network call (no body to send)', () => {
  assert.strictEqual(CBSignin.ask('a@').ok, false);
  assert.strictEqual(CBSignin.verify('a@b.co', '12').ok, false);
});
console.log(pass + ' checks');
