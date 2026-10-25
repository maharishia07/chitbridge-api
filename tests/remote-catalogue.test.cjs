/**
 * tests/remote-catalogue.test.cjs — NET-39 walk finding: a supplier on ANOTHER installation shows its catalogue. The signed `catalogue` question, answered in the local shape,
 * the seller's numbers and currency as carried; silence and a shop that shows nothing are said in words (never an empty "nothing published"); a local supplier is untouched.
 * Offline: the address book and the ask are stubs. Run: node tests/remote-catalogue.test.cjs
 */
'use strict';
const path = require('path');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
const API = path.join(__dirname, '..');
const book = require(path.join(API, 'lib', 'ctpaddress'));
const remoteCatalogue = require(path.join(API, 'lib', 'remote-catalogue'));

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('   ok   ' + name); } catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + (e && e.message)); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'not true'); };

const LOCAL = { identity_id: 'loc-1', bridge_id: 'CBLOCAL001', display_name: 'Local Co', currency_code: 'INR' };
const FAR = { identity_id: 'far-1', bridge_id: 'CBMZ5MN34G', display_name: 'AU Pumps', currency_code: null };
let ACTIVE = true;
book.resolve = async (id) => (id === 'far-1' ? { local: false, inactive: !ACTIVE, installation_key: 'sit-au' } : { local: true, installation_key: null });
book.remoteInstallations = async () => new Map([['sit-au', { active: ACTIVE, domain: 'au.example.com', label: 'Sit AU' }]]);
const VIEW = { ok: true, found: true, bridge_id: FAR.bridge_id, shop: { display_name: 'AU Pumps', currency_code: 'AUD' }, schema: { id: 's1' }, fields: [{ key: 'name' }], items: [{ item_id: 'it-1', item_data: { name: 'Pump', code: 'P-1', unit: 'pc', price: 450, currency: 'AUD' } }, { item_id: 'it-2', item_data: { name: 'Hose', unit: 'm', price: 12 } }], groups: [], finishes: [], offers: [], categories: [] };
const ASKED = [];
const ask = (answer) => async (target, want, deps) => { ASKED.push({ target, want, deps }); return typeof answer === 'function' ? answer() : answer; };

(async () => {
  console.log('\n== NET-39 · a remote supplier’s catalogue ==\n');
  await t('a local supplier is unchanged: null, nothing asked', async () => {
    ASKED.length = 0;
    ok((await remoteCatalogue.forSupplier(LOCAL, { ask: ask(VIEW) })) === null && ASKED.length === 0);
  });
  await t('a remote supplier’s items come from the ask, in the local shape, with the seller’s currency and numbers as given', async () => {
    ASKED.length = 0;
    const out = await remoteCatalogue.forSupplier(FAR, { ask: ask(VIEW) });
    ok(out.supplier.identity_id === FAR.identity_id && out.items.length === 2 && out.schema && out.fields.length === 1 && Array.isArray(out.groups) && Array.isArray(out.finishes));
    /* walk 2026-10-25: the stub holds no money, so the supplier block carries the seller's currency from its answer (the screen read A$12.50 as ₹12.50) */
    ok(out.supplier.currency_code === 'AUD' && FAR.currency_code === null, 'the supplier block carries the seller currency; the stub row is not changed');
    ok(out.shop.currency_code === 'AUD' && out.items[0].item_data.price === 450 && out.items[0].item_data.currency === 'AUD' && out.items[0].item_id === 'it-1', 'seller numbers must travel as given');
    ok(!('ok' in out) && !('found' in out) && out.remote.ok === true && out.remote.installation_key === 'sit-au');
    ok(ASKED[0].want.want === 'catalogue' && ASKED[0].want.bridge_id === FAR.bridge_id && ASKED[0].target.domain === 'au.example.com' && ASKED[0].deps.timeout === 5000);
  });
  await t('far side silent: words in the payload, not an empty "nothing published"', async () => {
    const out = await remoteCatalogue.forSupplier(FAR, { ask: ask({ ok: false, why: 'could not reach x: timed out' }) });
    ok(out.items.length === 0 && out.remote.ok === false && /Sit AU did not answer in 5 seconds/.test(out.remote.why));
  });
  await t('far side throws: fail closed (nothing shown as published), said in words', async () => {
    const out = await remoteCatalogue.forSupplier(FAR, { ask: async () => { throw new Error('boom'); } });
    ok(out.remote.ok === false && /could not be asked/.test(out.remote.why));
  });
  await t('a non-public remote shop: "does not show a catalogue" words', async () => {
    const out = await remoteCatalogue.forSupplier(FAR, { ask: ask({ ok: true, found: false, why: 'AU Pumps has no public catalogue' }) });
    ok(out.remote.ok === false && /does not show a catalogue/.test(out.remote.why) && out.items.length === 0);
  });
  await t('DECISIONS 14:50 · an EXISTING supplier row is kept; when its shop no longer sells outside the far side answers "no business here" and the catalogue says the sentence, not "does not show a catalogue"', async () => {
    const out = await remoteCatalogue.forSupplier(FAR, { ask: ask({ ok: true, found: false, why: 'no business here with bridge id CBMZ5MN34G' }) });
    ok(out.remote.ok === false && out.remote.why === 'AU Pumps sells only on their own ChitBridge, so they cannot be your supplier from here.', out.remote.why);
    ok(out.supplier.identity_id === FAR.identity_id && out.items.length === 0, 'the row is kept, with nothing to order');
    const nothing = await remoteCatalogue.forSupplier(FAR, { ask: ask({ ok: true, found: false, why: 'AU Pumps has no public catalogue' }) });
    ok(/does not show a catalogue/.test(nothing.remote.why), 'a shop that sells outside but shows nothing keeps its own words');
  });
  await t('an installation that is not active is said in words, nothing asked', async () => {
    ACTIVE = false; ASKED.length = 0;
    const out = await remoteCatalogue.forSupplier(FAR, { ask: ask(VIEW) });
    ACTIVE = true;
    ok(out.remote.ok === false && /not available from here/.test(out.remote.why) && ASKED.length === 0);
  });
  await t('the order cart keeps the seller’s line as given: id, code, name, unit, price, currency are in the items it adds from', async () => {
    const out = await remoteCatalogue.forSupplier(FAR, { ask: ask(VIEW) });
    const fields = out.items[0].item_data;
    ok(out.items[0].item_id && fields.code === 'P-1' && fields.name === 'Pump' && fields.unit === 'pc' && fields.price === 450 && fields.currency === 'AUD');
  });
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
