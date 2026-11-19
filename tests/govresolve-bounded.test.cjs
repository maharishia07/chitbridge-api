#!/usr/bin/env node
// @type: unit
/**
 * govresolve-bounded.test.cjs — NET-25: an installation (the entity's region layer) may declare only inside what the constitution allows.
 * OWNS      the proof of lib/govresolve.js bounded(): currency, timezone and region outside allowed.* fall back to the default (never to the forbidden value);
 *           inside the allowed set they stand; no allowed set means the declared value stands; nothing declared means the default; a country outside allowed.countries is null.
 * CALLED BY scripts/guards.cjs. OFFLINE: the database is stubbed the way tests/govresolve-ctp.test.cjs stubs it.
 * CARD      19-onboarding-and-shop-setup/entity-kind-constitution-vertical-plan-type
 */
'use strict';
const assert = require('assert');
const path = require('path');
const Module = require('module');
const API = path.join(__dirname, '..');

const ALLOWED = { currencies: ['INR', 'AED'], timezones: ['Asia/Kolkata', 'Asia/Dubai'], regions: ['IN', 'AE'], countries: ['IN', 'AE'] };
const DEFAULTS = { currency: 'INR', timezone: 'Asia/Kolkata', region: 'IN' };
const mk = (o) => Object.assign({ vertical_key: null, languages: [], domain: 'x.example' }, o);
const INSTALLATIONS = {
  inside: mk({ installation_key: 'inside', currency: 'AED', timezone: 'Asia/Dubai', region: 'AE', country: 'AE' }),
  outside: mk({ installation_key: 'outside', currency: 'ZZZ', timezone: 'Mars/Base', region: 'ZZ', country: 'ZZ' }),
  nothing: mk({ installation_key: 'nothing', currency: null, timezone: null, region: null, country: null })
};
let CONST_ALLOWED = ALLOWED;
const constitution = () => ({ constitution_key: 'base', version: 'v1', capabilities: [], governance: { allowed: CONST_ALLOWED, defaults: DEFAULTS } });
const dbStub = {
  query: async (sql, args) => {
    if (/FROM constitution\b/.test(sql)) return { rows: [constitution()] };
    if (/FROM installation\b/.test(sql)) return { rows: INSTALLATIONS[args[0]] ? [INSTALLATIONS[args[0]]] : [] };
    return { rows: [] };
  },
  withEntity: async (id, cb) => cb({ query: async () => ({ rows: [] }) })
};
function loadGov() {
  const p = path.join(API, 'lib', 'govresolve.js');
  delete require.cache[require.resolve(p)];
  const real = Module._load;
  Module._load = function (req) {
    if (req === '../db') return dbStub;
    if (req === './confcache') return { memo: async (key, fn) => fn() };
    return real.apply(this, arguments);
  };
  try { return require(p); } finally { Module._load = real; }
}

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

(async () => {
  const G = loadGov();
  await t('NET-25 a currency, timezone and region inside the allowed set stand', async () => {
    const b = (await G.resolveInstallationGovernance('inside', { fresh: true })).basics;
    assert.deepStrictEqual([b.currency, b.timezone, b.region, b.country], ['AED', 'Asia/Dubai', 'AE', 'AE']);
  });
  await t('NET-25 a currency, timezone and region outside the allowed set fall back to the DEFAULT, never the forbidden value', async () => {
    const b = (await G.resolveInstallationGovernance('outside', { fresh: true })).basics;
    assert.deepStrictEqual([b.currency, b.timezone, b.region], ['INR', 'Asia/Kolkata', 'IN']);
  });
  await t('NET-25 a country outside allowed.countries is null, not swapped for another', async () => {
    const b = (await G.resolveInstallationGovernance('outside', { fresh: true })).basics;
    assert.strictEqual(b.country, null);
  });
  await t('NET-25 nothing declared: the default for the three bounded basics, null for the country', async () => {
    const b = (await G.resolveInstallationGovernance('nothing', { fresh: true })).basics;
    assert.deepStrictEqual([b.currency, b.timezone, b.region, b.country], ['INR', 'Asia/Kolkata', 'IN', null]);
  });
  await t('NET-25 with no allowed set at all the declared value stands (bounded only where the constitution bounds)', async () => {
    CONST_ALLOWED = {};
    try {
      const b = (await loadGov().resolveInstallationGovernance('outside', { fresh: true })).basics;
      assert.deepStrictEqual([b.currency, b.timezone, b.region], ['ZZZ', 'Mars/Base', 'ZZ']);
    } finally { CONST_ALLOWED = ALLOWED; }
  });
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
