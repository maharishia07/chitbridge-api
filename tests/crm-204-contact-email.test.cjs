/**
 * tests/crm-204-contact-email.test.cjs - CRM-204: ONE BAD ROW NEVER FAILS A CONTACTS FILE.
 * A shop's party e-mail is that shop's contact data, not a sign-in. identities.email is globally unique, so an address another account holds
 * made the database refuse the write (23505) and, with no savepoint, abort the whole move-in transaction. lib/local-identity.keepEmail now
 * the e-mail is written inside its own savepoint: a unique refusal leaves the e-mail out (the row stays, the file goes on).
 * Any other error is still thrown. No database: a recording fake handle.   Run: node tests/crm-204-contact-email.test.cjs
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../lib/local-identity');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  PASS  ' + name); } catch (e) { fail++; console.error('  FAIL  ' + name + '\n        ' + (e && e.message)); }
};
/** a handle that records every statement; the e-mail UPDATE fails with `errCode` when given */
const handle = (errCode) => {
  const log = [];
  return { log, query: async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    log.push(s);
    if (errCode && /SET email =/.test(s)) { const e = new Error('dup'); e.code = errCode; throw e; }
    return { rows: [] };
  } };
};

(async () => {
  await t('a free e-mail is written inside a savepoint and kept', async () => {
    const h = handle(); const held = await L.keepEmail(h, 'E1', 'P1', 'a@x.test');
    assert.strictEqual(held, false);
    assert.ok(h.log.some((s) => /SET email =/.test(s)) && h.log.includes('RELEASE SAVEPOINT contact_email'));
  });
  await t('an e-mail another account holds (23505) is left out, the savepoint is rolled back, nothing throws', async () => {
    const h = handle('23505'); const held = await L.keepEmail(h, 'E1', 'P1', 'taken@x.test');
    assert.strictEqual(held, true);
        assert.ok(h.log.includes('ROLLBACK TO SAVEPOINT contact_email'));
  });
  await t('any other database error is still thrown (not hidden)', async () => {
    await assert.rejects(() => L.keepEmail(handle('23514'), 'E1', 'P1', 'a@x.test'), (e) => e.code === '23514');
  });
  await t('no e-mail given: no savepoint, nothing held', async () => {
    const h = handle(); assert.strictEqual(await L.keepEmail(h, 'E1', 'P1', null), false);
    assert.ok(!h.log.some((s) => /SAVEPOINT/.test(s)));
  });
  await t('the move-in contacts path goes through keepEmail and says what was left out (no raw email UPDATE left)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'move-in.js'), 'utf8');
    assert.ok(/L\.keepEmail\(/.test(src) && /emailsHeld/.test(src));
    assert.ok(!/email = COALESCE\(email/.test(src), 'move-in no longer writes identities.email itself');
    assert.ok(!/email = COALESCE\(email/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'local-identity.js'), 'utf8').split('async function keepEmail')[0]), 'addCustomer no longer writes it inline');
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
