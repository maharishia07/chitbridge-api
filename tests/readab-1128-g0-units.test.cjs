/**
 * tests/readab-1128-g0-units.test.cjs — unit evidence (DISCIPLINES §7) for lib/client-ip.js: the caller's address is read from req.ip or the socket
 * only, and a value that is not an address is refused (fail closed: '' , never a guess). No database, no network.
 * HAND-COMPUTED: an IPv4 address and an IPv6 address pass as written · a forwarded-for header is never read · a string with letters outside hex, spaces or
 * a script is refused · no request at all is refused · req.ip wins over the socket.
 * MIN unit-per-rule
 * MIN refusal-path
 * MIN fail-closed
 * Run: node tests/readab-1128-g0-units.test.cjs
 * CARD 18-identity-sign-in-and-access/sign-in
 */
'use strict';
const assert = require('assert');
const { clientIp } = require('../lib/client-ip');
let failed = 0, passed = 0;
function check(name, fn) { try { fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ': ' + e.message); } }
check('an IPv4 req.ip is returned as written', () => assert.strictEqual(clientIp({ ip: '203.0.113.9' }), '203.0.113.9'));
check('an IPv6 req.ip is returned as written', () => assert.strictEqual(clientIp({ ip: '2001:db8::1' }), '2001:db8::1'));
check('req.ip wins over the socket address', () => assert.strictEqual(clientIp({ ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.2' } }), '10.0.0.1'));
check('with no req.ip the socket address is used', () => assert.strictEqual(clientIp({ socket: { remoteAddress: '10.0.0.2' } }), '10.0.0.2'));
check('a forwarded-for header is never read (the caller typed it)', () => assert.strictEqual(clientIp({ headers: { 'x-forwarded-for': '6.6.6.6' } }), ''));
check('refused: a value that is not an address fails closed to an empty string', () => assert.strictEqual(clientIp({ ip: '<script>alert(1)</script>' }), ''));
check('refused: no request at all fails closed', () => assert.strictEqual(clientIp(undefined), ''));
check('refused: a too-short string fails closed', () => assert.strictEqual(clientIp({ ip: '1.' }), ''));
console.log(failed ? failed + ' failed' : passed + ' passed, 0 failed');
process.exit(failed ? 1 : 0);
