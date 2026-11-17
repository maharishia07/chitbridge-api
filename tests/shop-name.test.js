'use strict';
/**
 * shop-name.test.js — "The shop's name is the profile's name" (Athi, 2026-10-01). The account's own name
 * (identities.display_name) wins wherever the shop is named; a trade name copied into the vault (e.g. by the Tally
 * connector) only fills it when the profile's is empty; a difference is REPORTED on the profile-map, never hidden.
 * Found live: Tallytest's counter showed "CB Test Traders" (its Tally company name).
 *
 * Offline: db and vaultcrypto are stubbed the way tests/rev01-price-includes-tax.test.js stubs db. No database.
 * Run: node tests/shop-name.test.js
 */
const path = require('path');
const assert = require('assert');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
async function t(label, fn) {
  try { await fn(); console.log('  ok    ' + label); pass++; }
  catch (e) { console.log('  FAIL  ' + label + '\n      ' + e.message); fail++; }
}

let ME = {}, VAULT_ROWS = [];
require.cache[require.resolve(API + '/db')] = { exports: {
  query: async (sql) => { if (/FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [ME] }; throw new Error('unstubbed query in shop-name test: ' + sql); },
  withEntity: async (_id, fn) => fn({ query: async () => ({ rows: [{ vault: { stub: true } }] }) }),
} };
require.cache[require.resolve(API + '/lib/vaultcrypto')] = { exports: {
  decryptVault: () => ({ sections: [{ type: 'identity', label: 'Business identity', rows: VAULT_ROWS }] }),
  encryptVault: (x) => x, isConfigured: () => true, isEnvelope: () => true,
} };
const P = require(API + '/lib/profile');
const router = require(API + '/routes/integrations');

function set(display_name, vaultRows, extra) { ME = Object.assign({ display_name, gstn: null, address: '1 Main Rd', phone: null, email: null, country: 'IN', currency_code: 'INR', policy_flags: {} }, extra || {}); VAULT_ROWS = vaultRows; }
const row = (tag, value, rung) => ({ name: tag, value, tag, rung: rung || 'copied', source: 'tally' });
async function mapAnswer() {
  const layer = router.stack.find((l) => l.route && l.route.path === '/profile-map' && l.route.methods.get);
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let body; await handler({ identity: { identity_id: 'e1' } }, { json: (b) => { body = b; }, status() { return this; } });
  return body;
}

(async () => {
  console.log('\n-- the profile\'s name wins; the vault\'s rides along --\n');
  await t('both set and different: invoiceParty().trade_name is the profile\'s', async () => {
    set('Tallytest', [row('trade_name', 'CB Test Traders', 'verified')]);
    assert.strictEqual((await P.invoiceParty('e1')).trade_name, 'Tallytest');
  });
  await t('…profileValues keeps the profile\'s value even against a HIGHER rung, and records the vault\'s as other', async () => {
    const v = (await P.profileValues('e1')).trade_name;
    assert.strictEqual(v.value, 'Tallytest'); assert.strictEqual(v.source, 'profile');
    assert.deepStrictEqual(v.other, { value: 'CB Test Traders', source: 'tally', rung: 'verified' });
  });
  await t('…the profile-map answer carries name_mismatch { profile, other, source }', async () => {
    assert.deepStrictEqual((await mapAnswer()).name_mismatch, { profile: 'Tallytest', other: 'CB Test Traders', source: 'tally' });
  });
  await t('…legal_name is unchanged (the vault\'s own), and so is name', async () => {
    set('Tallytest', [row('trade_name', 'CB Test Traders'), row('legal_name', 'CB Test Traders Pvt Ltd')]);
    const p = await P.invoiceParty('e1'); assert.strictEqual(p.legal_name, 'CB Test Traders Pvt Ltd'); assert.strictEqual(p.name, 'CB Test Traders Pvt Ltd');
  });

  console.log('\n-- the same name is not a mismatch --\n');
  await t('differing only in case and spaces: no name_mismatch', async () => {
    set('CB Test Traders', [row('trade_name', 'cb  test traders')]);
    assert.strictEqual('name_mismatch' in (await mapAnswer()), false);
  });
  await t('identical: no name_mismatch, no other', async () => {
    set('Shop', [row('trade_name', 'Shop')]);
    assert.strictEqual('name_mismatch' in (await mapAnswer()), false);
  });

  console.log('\n-- an empty profile name is filled from the vault --\n');
  await t('profile name empty: the vault\'s name is used, no mismatch, legal_name unchanged', async () => {
    set('', [row('trade_name', 'CB Test Traders')]);
    const p = await P.invoiceParty('e1'); assert.strictEqual(p.trade_name, 'CB Test Traders'); assert.strictEqual(p.legal_name, null);
    const v = (await P.profileValues('e1')).trade_name; assert.strictEqual(v.value, 'CB Test Traders'); assert.strictEqual(v.other, undefined);
    assert.strictEqual('name_mismatch' in (await mapAnswer()), false);
  });

  console.log('\n-- every other key keeps rung ranking --\n');
  await t('address: a higher-rung vault value still beats the profile\'s declared one', async () => {
    set('Tallytest', [row('address', '9 Vault Lane', 'verified')]);
    const a = (await P.profileValues('e1')).address; assert.strictEqual(a.value, '9 Vault Lane'); assert.strictEqual(a.other, undefined);
  });
  await t('address: an equal-rung vault value still wins, as it always did', async () => {
    set('Tallytest', [row('address', '9 Vault Lane', 'declared')]);   
    assert.strictEqual((await P.profileValues('e1')).address.value, '9 Vault Lane');
  });

  console.log('\n  ' + (pass + fail) + ' checks · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
