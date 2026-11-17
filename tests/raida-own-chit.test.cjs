/**
 * tests/raida-own-chit.test.cjs — a finding on a chit is refused unless this entity holds its own copy (BOLA, raidachit 17 Nov).
 * UNIT      03-disputes-service-and-register/raida-register-and-report
 * CARD      03-disputes-service-and-register/raida-register-and-report
 * Offline: the connection is a stub that answers by statement text. Run: node tests/raida-own-chit.test.cjs
 */
'use strict';
const assert = require('assert');
const { requireOwnChit } = require('../lib/raida-own-chit');

const ME = '11111111-1111-4111-8111-111111111111', CHIT = '22222222-2222-4222-8222-222222222222', LINE = '33333333-3333-4333-8333-333333333333';
const held = { chit_header: new Set([CHIT]), chit_line: new Set([CHIT + '|' + LINE]) };
const conn = () => ({
  asked: [],
  async query(sql, params) {
    this.asked.push(sql);
    const ok = /FROM chit_header/.test(sql) ? held.chit_header.has(params[0]) && params[1] === ME : held.chit_line.has(params[0] + '|' + params[2]) && params[1] === ME;
    return { rows: ok ? [{ '?column?': 1 }] : [] };
  }
});
let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n       ' + e.message); process.exitCode = 1; } };
const refused = async (c, chit, line) => { try { await requireOwnChit(c, ME, chit, line); } catch (e) { return e; } return null; };

(async () => {
  await it('no chit id (a standalone register): nothing is checked, no statement is sent', async () => {
    const c = conn();
    assert.strictEqual(await refused(c, null, null), null);
    assert.strictEqual(c.asked.length, 0);
  });
  await it('a chit this entity holds, no line: allowed after ONE statement', async () => {
    const c = conn();
    assert.strictEqual(await refused(c, CHIT, null), null);
    assert.strictEqual(c.asked.length, 1);
  });
  await it('a chit and a line on it: allowed', async () => assert.strictEqual(await refused(conn(), CHIT, LINE), null));
  await it('a chit this entity holds no copy of is refused with the one 404 (the sentence the route gives)', async () => {
    const e = await refused(conn(), '44444444-4444-4444-8444-444444444444', null);
    assert.ok(e && e.status === 404 && /Chit not found or you do not have access/.test(e.message));
  });
  await it('a junk chit id is refused (404) and never reaches the database: it fails closed', async () => {
    const c = conn();
    const e = await refused(c, 'not-a-uuid', null);
    assert.ok(e && e.status === 404);
    assert.strictEqual(c.asked.length, 0);
  });
  await it('a line that is not on that chit is refused (404), a junk line id is refused too', async () => {
    const e = await refused(conn(), CHIT, '55555555-5555-4555-8555-555555555555');
    assert.ok(e && e.status === 404);
    const j = await refused(conn(), CHIT, 'junk');
    assert.ok(j && j.status === 404);
  });
  await it('another entity asking for a chit that exists is refused: the copy must be its own', async () => {
    const c = conn();
    let e = null;
    try { await requireOwnChit(c, '99999999-9999-4999-8999-999999999999', CHIT, null); } catch (err) { e = err; }
    assert.ok(e && e.status === 404);
  });
  console.log('\n  ' + pass + ' passed · ' + pass + ' checks');
})();
