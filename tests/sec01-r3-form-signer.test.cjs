'use strict';
/**
 * tests/sec01-r3-form-signer.test.cjs - VERIFY-SEC-01 R3 attack: an editor POSTs {name:"Owner Name"} to /instances/:id/sign.
 * The paper must show the signed-in person, not the typed name; the owner may type a name; signed_by is always the real identity.
 * Real lib/forms.signForm, db + profile stubbed. Run: node tests/sec01-r3-form-signer.test.cjs
 */
const assert = require('assert');
const stub = (mod, exports) => { const p = require.resolve(mod); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
let written = null;
const db = { query: async (sql, p) => sql.startsWith('SELECT') ? { rows: [{ ready: true, signed_at: null }] } : (written = JSON.parse(p[2]), { rows: [{ form_id: p[1], signed_at: 'now', signatory: written }] }) };
stub('../db', { withEntity: async (_e, fn) => fn(db), query: db.query });
stub('../lib/profile', { getProfile: async () => ({ vault: { signatory: { name: 'Vault Signatory', designation: 'Director' } } }) });
const forms = require('../lib/forms');
let pass = 0; const it = async (n, f) => { await f(); pass++; console.log('  ok  ' + n); };
(async () => {
  await it('an editor typing the owner\'s name signs as THEMSELVES, signed_by recorded', async () => {
    const r = await forms.signForm('E1', 'F1', { name: 'Owner Name' }, { identity_id: 'ed-9', display_name: 'Edie Editor', owner: false });
    assert.strictEqual(r.signatory.name, 'Edie Editor'); assert.strictEqual(r.signatory.signed_by, 'ed-9');
  });
  await it('the owner may type a name; signed_by is still the owner', async () => {
    const r = await forms.signForm('E1', 'F1', { name: 'Typed By Owner' }, { identity_id: 'own-1', display_name: 'Olive Owner', owner: true });
    assert.strictEqual(r.signatory.name, 'Typed By Owner'); assert.strictEqual(r.signatory.signed_by, 'own-1');
  });
  await it('the owner with no name uses the vault signatory', async () => {
    const r = await forms.signForm('E1', 'F1', {}, { identity_id: 'own-1', display_name: 'Olive Owner', owner: true });
    assert.strictEqual(r.signatory.name, 'Vault Signatory');
  });
  await it('an editor with no display name is refused 400, never the owner\'s name', async () => {
    await assert.rejects(() => forms.signForm('E1', 'F1', { name: 'Owner Name' }, { identity_id: 'ed-9', owner: false }), (e) => e.status === 400);
  });
  console.log('\n' + pass + ' checks'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
