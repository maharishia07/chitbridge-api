/* tests/reset-and-seed.test.cjs: the reset wipe clears the identity-owned tables before identities (SEC-130 residual). Fake db, no database. */
const assert = require('node:assert');
const { clearIdentityOwned } = require('../scripts/reset-and-seed.js');

const fakeDb = (present) => {
  const log = [];
  return {
    log,
    query: async (sql, params) => {
      log.push(sql);
      if (/to_regclass/.test(sql)) return { rows: [{ t: present.includes(params[0].replace('public.', '')) ? params[0] : null }] };
      return { rows: [] };
    }
  };
};
const deletes = (db) => db.log.filter((q) => /^DELETE/.test(q));

(async () => {
  const both = fakeDb(['party_tax_id', 'party_contact']);
  await clearIdentityOwned(both);
  assert.deepStrictEqual(deletes(both), ['DELETE FROM public.party_tax_id', 'DELETE FROM public.party_contact'], 'both tables cleared');

  const one = fakeDb(['party_contact']);
  await clearIdentityOwned(one);
  assert.deepStrictEqual(deletes(one), ['DELETE FROM public.party_contact'], 'a table not migrated yet is skipped');

  const none = fakeDb([]);
  await clearIdentityOwned(none);
  assert.deepStrictEqual(deletes(none), [], 'nothing present, nothing deleted');

  const src = require('node:fs').readFileSync(require.resolve('../scripts/reset-and-seed.js'), 'utf8');
  assert.ok(src.indexOf('await clearIdentityOwned(db)') < src.indexOf("DELETE FROM identities WHERE parent_entity_id"), 'wipe calls the helper before identities');
  console.log('reset-and-seed: 4 passed');
})().catch((e) => { console.error(e); process.exit(1); });
