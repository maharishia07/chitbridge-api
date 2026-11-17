#!/usr/bin/env node
/**
 * ctr-117-trade-name-profile-first.test.cjs — CTR-117 (proof 2026-11-14): the counter says the PROFILE's name, not the name a Tally import left in the vault.
 * @type regression
 * OWNS      the proof on the real lib/profile.invoiceParty over a stand-in db: the account is named "Tallytest" (identities.display_name) while the vault's Business identity rows say
 *           trade_name "CB Test Traders" and legal_name "CB Test Traders Pvt Ltd". Hand-computed: trade_name = "Tallytest" (the profile wins); legal_name stays "CB Test Traders Pvt Ltd" (a separate
 *           fact, untouched); name (what a tax invoice prints) = the legal name; a shop whose account has NO display_name falls back to the vault's trade_name "CB Test Traders".
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      identities row + vault rows -> invoiceParty -> trade_name · legal_name · name
 *   node tests/ctr-117-trade-name-profile-first.test.cjs
 */
'use strict';
const path = require('path');
const { API, ok, done, mock, standInDb } = require('./lib/cat-proof-kit.cjs');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
process.env.VAULT_ENC_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'; /* a test key: the vault is stored as the real ciphertext envelope */
const SHOP = '11111111-1111-4111-8111-111111111111';
const vault = { sections: [{ id: 's1', type: 'identity', title: 'Business identity', rows: [
  { id: 'r1', name: 'Trade name', tag: 'trade_name', value: 'CB Test Traders' },
  { id: 'r2', name: 'Legal name', tag: 'legal_name', value: 'CB Test Traders Pvt Ltd' }] }] };
let displayName = 'Tallytest';
const { db } = standInDb((sql) => {
  if (/FROM identities/.test(sql)) return { rows: [{ display_name: displayName, gstn: null, address: null, phone: null, email: null, country: 'IN', currency_code: 'INR' }] };
  if (/FROM entity_profile/.test(sql)) return { rows: [{ vault: require(path.join(API, 'lib', 'vaultcrypto.js')).encryptVault(vault), version: '1' }] };
  return { rows: [], rowCount: 0 };
});
mock('db', db); mock('db/index', db);
const { invoiceParty } = require(path.join(API, 'lib', 'profile.js'));

(async () => {
  const p = await invoiceParty(SHOP);
  ok('the vault rows were read (legal_name is the vault\'s)', p.legal_name === 'CB Test Traders Pvt Ltd', JSON.stringify(p));
  ok('trade_name is the profile\'s "Tallytest", not the vault\'s "CB Test Traders"', p.trade_name === 'Tallytest', p.trade_name);
  ok('legal_name is untouched by the account name', p.legal_name === 'CB Test Traders Pvt Ltd', p.legal_name);
  ok('name (what a tax invoice prints) is the legal name', p.name === 'CB Test Traders Pvt Ltd', p.name);
  displayName = null;
  const q = await invoiceParty(SHOP);
  ok('no account name: the vault\'s trade name fills it ("CB Test Traders")', q.trade_name === 'CB Test Traders', q.trade_name);
  done();
})();
