/**
 * tests/crm-204-contact-email.test.cjs - CRM-204: ONE BAD ROW NEVER FAILS A CONTACTS FILE (kept after SEC-130's residual).
 * A shop's party e-mail is that shop's contact data, not a sign-in. It used to go to identities.email, one global unique column: an address another
 * account held made the database refuse the write (23505), which keepEmail absorbed and reported as `email_held`. That signal was an existence oracle,
 * so the e-mail now goes to party_contact (per shop, not unique, lib/party-contact.js): nothing can be "held", keepEmail answers kept / not kept
 * (not kept only before b839 has run), and any database error is still thrown, never hidden.
 * No database: a recording fake handle.   Run: node tests/crm-204-contact-email.test.cjs
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const schemaPath = require.resolve('../lib/schema');
let TABLE = true;
require.cache[schemaPath] = { id: schemaPath, filename: schemaPath, loaded: true, exports: { hasTable: async () => TABLE, hasColumn: async () => true, hasColumns: async () => true } };
const L = require('../lib/local-identity');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  PASS  ' + name); } catch (e) { fail++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
};
/** a handle that records every statement; the party_contact write fails with `errCode` when given */
const handle = (errCode) => {
  const log = [];
  return { log, query: async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    log.push(s);
    if (errCode && /party_contact/.test(s)) { const e = new Error('boom'); e.code = errCode; throw e; }
    return { rows: [] };
  } };
};

(async () => {
  await t('a free e-mail is written to party_contact, lower-cased, and kept', async () => {
    const h = handle(); const kept = await L.keepEmail(h, 'E1', 'P1', ' A@X.test ');
    assert.strictEqual(kept, true);
    assert.ok(h.log.some((s) => /^INSERT INTO party_contact/.test(s)));
  });
  await t('there is no unique to hit: no savepoint, no identities.email write of the address', async () => {
    const h = handle(); await L.keepEmail(h, 'E1', 'P1', 'a@x.test');
    assert.ok(!h.log.some((s) => /SAVEPOINT/.test(s)));
    assert.ok(!h.log.some((s) => /SET email = COALESCE/.test(s)));
  });
  await t('any database error is thrown, not hidden', async () => {
    await assert.rejects(() => L.keepEmail(handle('23514'), 'E1', 'P1', 'a@x.test'), (e) => e.code === '23514');
  });
  await t('no e-mail given: nothing written, kept', async () => {
    const h = handle(); assert.strictEqual(await L.keepEmail(h, 'E1', 'P1', null), true);
    assert.strictEqual(h.log.length, 0);
  });
  await t('before b839: not kept, and nothing is written to identities either', async () => {
    TABLE = false;
    const h = handle(); const kept = await L.keepEmail(h, 'E1', 'P1', 'a@x.test');
    TABLE = true;
    assert.strictEqual(kept, false);
    assert.strictEqual(h.log.length, 0);
  });
  await t('the move-in contacts path goes through keepEmail and says only what is true (e-mails not saved yet), never about another account', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'move-in.js'), 'utf8');
    assert.ok(/localIdentity\.keepEmail\(/.test(src) && /emailsUnsaved/.test(src));
    assert.ok(!/email = COALESCE\(email/.test(src) && !/another account/.test(src) && !/emailsHeld|email_held/.test(src));
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
