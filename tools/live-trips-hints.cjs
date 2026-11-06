'use strict';
/**
 * OWNS      what a person must tell tools/live-trips.cjs where the route's own schema cannot: fixed path values (params), a body (routes[].body, a value or a function), a query, or a skip with its reason.
 * CALLED BY tools/live-trips.cjs. Tests/tooling only. Every body carries the lt- prefix so what the harness made stays identifiable on the load shop.
 * CARD      speed · round trips
 */
const crypto = require('crypto');
const u = () => crypto.randomBytes(3).toString('hex');
const day = () => new Date().toISOString().slice(0, 10);
/** a setup call that must answer 2xx: returns the answer body or throws with the sentence (so a broken fixture says why in the results) */
async function must(api, method, url, body) {
  const r = await api.call(method, url, body);
  if (r.status < 200 || r.status >= 300) throw new Error(method + ' ' + url + ' → ' + r.status + ' ' + JSON.stringify(r.body || r.text).slice(0, 160));
  return r.body;
}
/** the fixture can't be made: the route is unreached with this reason */
const cannot = (group, reason) => ({ unreached: [group, reason] });
/** a customer party of the load shop (read only: Load Customer A) */
async function customerId(api) {
  if (!api.seeds.customer) { const b = await must(api, 'GET', '/api/crm/parties'); api.seeds.customer = (b.parties.find((x) => x.roles && x.roles.customer) || {}).party_id; }
  return api.seeds.customer;
}
/** a supplier party of the load shop */
async function supplierId(api) {
  if (!api.seeds.supplier) { const b = await must(api, 'GET', '/api/crm/parties'); api.seeds.supplier = (b.parties.find((x) => x.roles && x.roles.supplier) || {}).party_id; }
  return api.seeds.supplier;
}
/** an lt- cash payment received (a books_payment row to propose/confirm against) */
async function newPayment(api) {
  const out = await must(api, 'POST', '/api/books/payments', { party_id: await customerId(api), direction: 'in', amount: 1 + Math.floor(Math.random() * 9000) / 100, mode: 'cash', client_ref: 'lt-pay-' + u() });
  return out.payment.payment_id;
}
/** the key of an open lt- counter of the load shop (a till session): created once, released again when the run ends (cleanup below) */
async function counterKey(api, fresh) {
  if (api.seeds.ckey && !fresh) return api.seeds.ckey;
  const list = (await must(api, 'GET', '/api/counters')).counters || [];
  let c = list.find((x) => String(x.name || '').startsWith('lt-'));
  if (!c) c = (await must(api, 'POST', '/api/counters', { name: 'lt-counter' })).counter;
  if (c.state !== 'closed') await api.call('POST', '/api/counters/' + c.id + '/release', {});
  const opened = await must(api, 'POST', '/api/counters/' + c.id + '/open', {});
  api.seeds.ckey = opened.key; api.seeds.counter = c.id;
  return opened.key;
}
const asCounter = async (api, fresh) => ({ authorization: 'Bearer ' + await counterKey(api, fresh) });
/** the first product of the load shop */
async function itemId(api) {
  if (!api.seeds.item) api.seeds.item = (await must(api, 'GET', '/api/products?limit=1')).items[0].item_id;
  return api.seeds.item;
}
/** a screen key (a paired shop screen): pair a code, claim it, read the key's jti */
async function newScreen(api) {
  const code = (await must(api, 'POST', '/api/till/pair', {})).code;
  const claimed = await must(api, 'POST', '/api/till/pair/claim', { code });
  const jwt = String(claimed.key || claimed.token || '');
  const jti = JSON.parse(Buffer.from(jwt.split('.')[1] || 'e30', 'base64url').toString()).jti;
  (api.seeds.screens = api.seeds.screens || []).push(jti);
  return { code, jti };
}
/** an lt- chit of the load shop (a self receipt with one line; the fixed client_ref makes a second seed answer the same chit) */
async function chitId(api) {
  if (api.seeds.chit) return api.seeds.chit;
  const ref = 'lt-chit-seed';
  const out = await must(api, 'POST', '/api/chits/send', { recipients: [{ self: true, name: 'self' }], purpose: 'receipt', subject: 'lt- goods', manual_subject: 'lt- goods', client_ref: ref, business_json: { doc: 'receipt', doc_no: ref, doc_at: new Date().toISOString(), party: { name: 'lt-supplier' } }, line_items: [{ particulars: 'lt-rice', quantity: 1, unit: 'kg', price: 50, total: 50 }] });
  api.seeds.chit = out.chit_id;
  return out.chit_id;
}
/** an issued lt- form instance (the first form of the library, every required field typed by hand) */
async function formInstance(api, fresh) {
  if (api.seeds.form && !fresh) return api.seeds.form;
  const key = 'certificate-of-origin';
  const res = await must(api, 'POST', '/api/forms/' + key + '/resolve', {});
  const manual = {};
  (res.fields || []).filter((f) => f.required && f.value == null).forEach((f) => { manual[f.id] = 'lt-' + f.id; });
  api.seeds.manualLast = manual;
  const out = await must(api, 'POST', '/api/forms/' + key + '/issue', { manual });
  api.seeds.form = out.form_id || out.id;
  return api.seeds.form;
}
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/** this shop's own public address (its bridge id) */
async function myBridge(api) {
  if (!api.seeds.bridge) api.seeds.bridge = (await must(api, 'GET', '/api/entities/me')).entity.bridge_id;
  return api.seeds.bridge;
}
const LOAD_ID = 'a3866c39-af9a-4eb7-969a-71b7715e89bf'; /* cbt-in-load's identity (its own row is the only one the harness edits by SQL) */
const LOAD_NODE = '2ba7df12-486c-437c-b4b5-1acd99b2f350'; /* its cb_entity row */
/** the register capability on for the load shop only (its capabilities column was NULL; cleanup puts NULL back) */
function registerOn(api) {
  if (api.seeds.registerOn) return;
  api.sql("update identities set capabilities = '[\"register\"]'::jsonb where identity_id = '" + LOAD_ID + "' and capabilities is null");
  api.seeds.registerOn = true;
}
/** a pool shop (cbt-in-*) with no connection to the load shop, its identity id and handle */
function freePoolShop(api, skip) {
  const rows = api.sql("select identity_id, user_id from identities where user_id like 'cbt-in-%' and user_id <> 'cbt-in-load' and identity_id not in (select to_entity_id from connections where from_entity_id = '" + LOAD_ID + "' union select from_entity_id from connections where to_entity_id = '" + LOAD_ID + "') order by user_id limit 8");
  return rows.find((r) => !(skip || []).includes(r[0]));
}
const OLD_FY = '2026-27'; /* the load shop's first document is in November 2026; April 2026 (period 1) holds no entry: the old empty month the tool may lock and close */
module.exports = {
  params: {},
  /** the run's end: switch off the screens it paired and give the counter back (the load shop is left as it was, minus the lt- counter row) */
  cleanup: async (api) => {
    if (api.seeds.registerOn) api.sql("update identities set capabilities = null where identity_id = '" + LOAD_ID + "' and capabilities = '[\"register\"]'::jsonb");
    if (api.seeds.unclaimed) api.sql("update cb_entity set claimed = true where id = '" + LOAD_NODE + "'");
    for (const p of [1, 2]) await api.call('POST', '/api/books/periods/' + OLD_FY + '/' + p + '/unlock', { reason: 'lt- live-trips: restore' });
    for (const jti of api.seeds.screens || []) await api.call('POST', '/api/till/screens/revoke', { jti });
    if (api.seeds.counter) await api.call('POST', '/api/counters/' + api.seeds.counter + '/release', {});
  },
  routes: {
    'POST /api/channels/:id/approve': { skip: ['role', "platform role: answers only to the platform operator key (x-cb-admin-key = CB_ADMIN_KEY), which no shop token holds and sit-in must not expose; needs a platform token"] },
    'POST /api/channels/:id/revoke': { skip: ['role', "platform role: answers only to the platform operator key (x-cb-admin-key = CB_ADMIN_KEY), which no shop token holds and sit-in must not expose; needs a platform token"] },
    'POST /api/channels/:id/template-approve': { skip: ['role', "platform role: answers only to the platform operator key (x-cb-admin-key = CB_ADMIN_KEY), which no shop token holds and sit-in must not expose; needs a platform token"] },
    'POST /api/testing/cases/gherkin': { skip: ['role', "board-writer role: only the testing board shop (or TEST_BOARD_WRITERS) may write cases and CMDB records, so the load shop gets 403 NOT_BOARD_WRITER and holds no CMDB record to read; needs the board account"] },
    'POST /api/testing/cmdb/seed': { skip: ['role', "board-writer role: only the testing board shop (or TEST_BOARD_WRITERS) may write cases and CMDB records, so the load shop gets 403 NOT_BOARD_WRITER and holds no CMDB record to read; needs the board account"] },
    'PUT /api/testing/cmdb/:ci': { skip: ['role', "board-writer role: only the testing board shop (or TEST_BOARD_WRITERS) may write cases and CMDB records, so the load shop gets 403 NOT_BOARD_WRITER and holds no CMDB record to read; needs the board account"] },
    'GET /api/testing/cmdb/:ci': { skip: ['role', "board-writer role: only the testing board shop (or TEST_BOARD_WRITERS) may write cases and CMDB records, so the load shop gets 403 NOT_BOARD_WRITER and holds no CMDB record to read; needs the board account"] },
    'POST /api/chits/:chit_id/raida/:raida_id/dispute': { skip: ['fixture', "links a register entry to an open DISPUTE on the chit; a dispute needs two shops on the chit and a pool counter-party raising it, not a self chit"] },
    'GET /api/chits/:chit_id/use': { skip: ['fixture', "409 CHIT_NOT_A_BILL: only a bill the load shop RECEIVED from another shop answers; the harness sends self chits only"] },
    'POST /api/catalogue/:bridge_id/order/start': { skip: ['no-header', "public storefront door (a shop-window buyer signs in by e-mail code, no shop token): the server has no identity so it never sends X-DB-Trips; it also needs a published shop window"] },
    'POST /api/catalogue/:bridge_id/order/confirm': { skip: ['no-header', "public storefront door (a shop-window buyer signs in by e-mail code, no shop token): the server has no identity so it never sends X-DB-Trips; it also needs a published shop window"] },
    'POST /api/catalogue/:bridge_id/support': { skip: ['no-header', "public storefront door (a shop-window buyer signs in by e-mail code, no shop token): the server has no identity so it never sends X-DB-Trips; it also needs a published shop window"] },
    'POST /api/catalogue/:bridge_id/support/start': { skip: ['no-header', "public storefront door (a shop-window buyer signs in by e-mail code, no shop token): the server has no identity so it never sends X-DB-Trips; it also needs a published shop window"] },
    'POST /api/catalogue/network-store/:networkId/order': { skip: ['no-header', "public storefront door (a shop-window buyer signs in by e-mail code, no shop token): the server has no identity so it never sends X-DB-Trips; it also needs a published shop window"] },
    'GET /api/catalogue/network-store/:networkId': { skip: ['no-header', "public network-store door: no sign-in, so no X-DB-Trips; and the load shop is on no network store"] },
    'GET /api/catalogue/network/:bridge_id': { skip: ['no-header', "public door: no sign-in, so no X-DB-Trips; the load shop has no published shop window (404 Shop not found)"] },
    'DELETE /api/catalogue/:bridge_id/my-documents/:id': { skip: ['role', "needs a storefront customer login and a document that customer filed; the load shop holds no such customer"] },
    'GET /api/assist/resolve': { skip: ['fixture', "404 Unknown container or version: resolving needs a regional version, and the assistant limiter (429 for 10 minutes) stopped further tries"] },
    'POST /api/assist/resolve': { skip: ['precondition', "the route is retired on purpose: it answers 410 ASSIST_REVIEW_RETIRED (gap review superseded), so it has no database work to measure"] },
    'GET /api/integrations/kit/*': { make: async () => ({ params: { '*': 'core.js' } }) },
    'GET /api/integrations/docs/:id': { make: async () => ({ params: { id: 'tally' } }) },
    'GET /api/integrations/download/:id': { make: async () => ({ params: { id: 'csv' } }) },
    'POST /api/integrations/books': { make: async (api) => ({ body: { kind: 'order', chit_id: await chitId(api), system: 'lt-books', ref: 'lt-' + u(), outcome: 'dry' } }) },
    'POST /api/products/bulk': { body: () => ({ items: [{ name: 'lt-bulk-' + u(), price: 10, unit: 'piece' }] }) },
    'POST /api/quick-keys/groups/:id/items': { make: async (api) => { const g = await must(api, 'POST', '/api/quick-keys/groups', { name: 'lt-group-' + u() }); return { params: { id: g.group_id || g.id || (g.group && (g.group.group_id || g.group.id)) }, body: { product_id: await itemId(api) } }; } },
    'POST /api/chits/register/templates': { make: async (api) => { registerOn(api); return { body: { kind: 'risk', title: 'lt-template-' + u() } }; } },
    'POST /api/chits/register/entries/:raida_id/accept': { make: async (api) => { registerOn(api); const e = await must(api, 'POST', '/api/chits/' + await chitId(api) + '/raida', { kind: 'risk', body: 'lt- risk ' + u() }); return { params: { raida_id: e.raida_id || e.id }, body: { rationale: 'lt- accepted for the live-trips run', authority_level: 'owner' } }; } },
    'POST /api/network/entities/:id/claim': { fresh: true, make: async (api) => { api.sql("update cb_entity set claimed = false where id = '" + LOAD_NODE + "'"); api.seeds.unclaimed = true; return { params: { id: LOAD_NODE }, body: {} }; } },
    'GET /api/network/entities/:id/connections': { make: async () => ({ params: { id: LOAD_NODE } }) },
    'GET /api/network/entities/:id/subtree': { make: async () => ({ params: { id: LOAD_NODE } }) },
    'POST /api/connections/request': { make: async (api) => { const p = freePoolShop(api); if (!p) return cannot('fixture', 'every pool shop is already connected to the load shop'); return { body: { to_entity_id: p[0], note: 'lt- live-trips' } }; } },
    'PUT /api/connections/:id/respond': { make: async (api) => { const p = freePoolShop(api); if (!p) return cannot('fixture', 'every pool shop is already connected to the load shop'); const tok = await api.tokenFor(p[1]); const r = await api.call('POST', '/api/connections/request', { to_entity_id: LOAD_ID, note: 'lt- live-trips' }, { authorization: 'Bearer ' + tok }); if (r.status !== 200 && r.status !== 201) return cannot('fixture', 'a pool shop could not ask the load shop: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 100)); const id = (r.body && (r.body.connection_id || (r.body.connection && r.body.connection.connection_id))); return { params: { id }, body: { action: 'accept' } }; } },
    'POST /api/channels/:id/provider-ref': { make: async (api) => { const ch = await must(api, 'POST', '/api/channels', { channel: 'whatsapp', address: '+9190000' + String(Math.floor(Math.random() * 90000) + 10000), label: 'lt-line' }); return { params: { id: ch.id || (ch.channel && ch.channel.id) }, body: { provider_ref: 'lt-' + u() } }; } },
    'PUT /api/identity/documents/:scheme': { make: async () => ({ params: { scheme: 'PHONE' }, body: { value: '98400' + String(Math.floor(Math.random() * 90000) + 10000) } }) },
    'PATCH /api/supplies/:id': { make: async (api) => { const made = await must(api, 'POST', '/api/supplies', { name: 'lt-supply-' + u(), unit: 'piece' }); const id = made.supply ? made.supply.supply_item_id : made.supply_id || made.id; return { params: { id }, body: { note: 'lt- live-trips' } }; } },
    'POST /api/offers/evaluate': { body: () => ({ lines: [{ name: 'lt-item', qty: 2, unitPrice: 100 }], offers: [], ctx: { currency: 'INR' } }) },
    'POST /api/offers/explain': { body: () => ({ lines: [{ name: 'lt-item', qty: 2, unitPrice: 100 }], offers: [], ctx: { currency: 'INR' } }) },
    'POST /api/pricing/price': { make: async (api) => ({ body: { lines: [{ item_id: await itemId(api), qty: 1, listPrice: 100 }] } }) },
    'POST /api/tax/rate': { make: async (api) => ({ body: { lines: [{ item_id: await itemId(api), qty: 1, price: 100, name: 'lt-item' }] } }) },
    'POST /api/assist/gap': { body: () => ({ q: 'lt- how do I count stock?' }) },
    'PUT /api/assist/catalogue-source': { body: () => ({ source_key: 'royale-play@v1' }) },
    'PUT /api/assist/region-override': { make: async (api) => { const cid = 'lt/' + u(); await must(api, 'PUT', '/api/assist/container', { container_id: cid, name: 'lt-container' }); return { body: { container_id: cid, region: 'IN' } }; } },
    'GET /api/assist/container/:id': { make: async (api) => { const cid = 'lt/' + u(); await must(api, 'PUT', '/api/assist/container', { container_id: cid, name: 'lt-container' }); return { params: { id: encodeURIComponent(cid) } }; } },
    'GET /api/assist/resolve': { make: async (api) => { const cid = 'lt/' + u(); const put = await must(api, 'PUT', '/api/assist/container', { container_id: cid, name: 'lt-container' }); return { query: '?region=IN&container=' + encodeURIComponent(cid) + '&version=' + (put.version || 1) }; } },
    'GET /api/assist/catalogue-source/:key': { skip: ['fixture', '404 Unknown source after 3 tries (royale-play@v1, %40-encoded, and after authoring it with PUT /assist/catalogue-source): the read answers only for a source in the built-in registry, which the load shop does not hold'] },
    'POST /api/testing/results/junit': { body: () => ({ xml: '<testsuites><testsuite name="lt-suite" tests="1"><testcase name="[CTR-05] lt-case" classname="lt"/></testsuite></testsuites>' }) },
    'POST /api/testing/changes': { body: () => ({ summary: 'lt- live-trips probe ' + u(), backout: 'lt- nothing to undo: test shop', cites: { kind: 'incident', ref: 'lt-SPD-39' } }) },
    'POST /api/testing/releases': { fresh: true, make: async (api) => { const c = await must(api, 'POST', '/api/testing/changes', { summary: 'lt- release change ' + u(), backout: 'lt- nothing', cites: { kind: 'incident', ref: 'lt-SPD-39' } }); const id = c.definition_id || c.id || (c.change && (c.change.definition_id || c.change.id)); return { body: { name: 'lt-rel-' + u(), changes: [id] } }; } },
    'PUT /api/governance/profile/vault': { make: async (api) => { const prof = await must(api, 'GET', '/api/governance/profile'); return { body: { patch: { sections: {} }, version: prof.vault_version } }; } },
    'POST /api/products/lists/adopt': { skip: ['precondition', 'adopting a list writes a dozen or more catalogue products that carry no lt- prefix and the harness may not delete them; the load shop already holds 12'] },
    'GET /api/catalogue/:bridge_id/capture-fields': { make: async (api) => ({ params: { bridge_id: await myBridge(api) } }) },
    'GET /api/catalogue/:bridge_id/my-documents': { skip: ['role', 'needs a storefront customer login (customerAuth: a buyer who signed in on the shop window by e-mail code), not a shop token; no such customer on the load shop'] },
    'GET /api/catalogue/:bridge_id/support/preview': { make: async (api) => ({ params: { bridge_id: await myBridge(api) } }) },
    'GET /api/catalogue/network/:bridge_id': { make: async (api) => ({ params: { bridge_id: await myBridge(api) } }) },
    'GET /api/attachments/:id': { make: async (api) => { const out = await must(api, 'POST', '/api/attachments', { chit_id: await chitId(api), name: 'lt-file.txt', mime: 'text/plain', data_base64: Buffer.from('lt- live-trips').toString('base64') }); return { params: { id: out.id } }; } },
    'GET /api/products/media/:item_id/:mid': { make: async (api) => { const item = await itemId(api); const out = await must(api, 'POST', '/api/products/' + item + '/media', { name: 'lt-pixel.png', mime: 'image/png', data_base64: PNG }); const mid = out.mid || out.id || (out.media && (out.media.id || out.media.mid)) || (Array.isArray(out.media) && out.media[out.media.length - 1].id); return { params: { item_id: item, mid } }; } },
    'POST /api/invoice/build': { body: () => ({ lines: [{ item_id: 'lt-x', name: 'lt-item', qty: 1, listPrice: 100, price: 100, gst_rate: 18 }], currency: 'INR' }) },
    'GET /api/chits/:chit_id/diagnosis': { make: async (api) => ({ params: { chit_id: await chitId(api) } }) },
    'GET /api/chits/:chit_id/use': { make: async (api) => ({ params: { chit_id: await chitId(api) } }) },
    'GET /api/invoice/:chit_id': { make: async (api) => ({ params: { chit_id: await chitId(api) } }) },
    'GET /api/tax/invoice/:chit_id': { make: async (api) => ({ params: { chit_id: await chitId(api) } }) },
    'POST /api/chits/:chit_id/costs': { make: async (api) => ({ params: { chit_id: await chitId(api) }, body: { rows: [{ kind: 'other', amount: 1, currency: 'INR', note: 'lt-cost' }] } }) },
    'POST /api/forms/:key/issue': { make: async (api) => { const res = await must(api, 'POST', '/api/forms/certificate-of-origin/resolve', {}); const manual = {}; (res.fields || []).filter((f) => f.required && f.value == null).forEach((f) => { manual[f.id] = 'lt-' + f.id; }); return { params: { key: 'certificate-of-origin' }, body: { manual } }; } },
    'POST /api/forms/:key/resolve': { make: async () => ({ params: { key: 'certificate-of-origin' }, body: {} }) },
    'GET /api/forms/instances/:id': { make: async (api) => ({ params: { id: await formInstance(api) } }) },
    'POST /api/forms/instances/:id/sign': { fresh: true, make: async (api) => ({ params: { id: await formInstance(api, true) }, body: { name: 'lt-signer', designation: 'lt-tester' } }) },
    'POST /api/forms/instances/:id/attach': { make: async (api) => ({ params: { id: await formInstance(api) }, body: { chit_id: await chitId(api) } }) },
    'GET /api/till/quick-keys/state': { make: async (api) => ({ headers: await asCounter(api), query: '?business_date=' + day() }) },
    'POST /api/till/quick-keys/state': { make: async (api) => ({ headers: await asCounter(api), body: { business_date: day(), active_group_ids: [] } }) },
    'POST /api/till/quick-keys/hide': { make: async (api) => ({ headers: await asCounter(api), body: { product_id: await itemId(api) } }) },
    'POST /api/till/quick-keys/unhide': { make: async (api) => ({ headers: await asCounter(api), body: { product_id: await itemId(api) } }) },
    'POST /api/till/quick-keys/screen-config': { make: async (api) => ({ headers: await asCounter(api), body: { config: { lt: true } } }) },
    'GET /api/till/reward': { query: '?scheme=phone&value=9840000001' },
    'POST /api/till/reward/claim': { skip: ['precondition', 'refused 400 "this shop runs no programme": the load shop has no reward programme and creating one is a money rule (points are not currency), not a fixture'] },
    'POST /api/till/alias': { make: async (api) => ({ body: { item_id: await itemId(api), text: 'lt-' + u(), by: 'lt-live-trips' } }) },
    'POST /api/till/catalogue': { skip: ['precondition', 'refused 409 CATALOGUE_NOT_EMPTY: it starts a catalogue only in a shop with no products, and the load shop holds 12 (and emptying it is a deletion)'] },
    'POST /api/till/close': { fresh: true, make: async (api) => { const headers = await asCounter(api, true); api.seeds.ckey = null; return { headers, body: {} }; } },
    'POST /api/till/diagnostic': { make: async (api) => ({ headers: await asCounter(api), body: { code: 'lt-live-trips' } }) },
    'POST /api/till/flags': { make: async (api) => ({ body: { item_id: await itemId(api), screen: true } }) },
    'POST /api/till/offer-item': { skip: ['fixture', 'moves a product in or out of a LIVE offer; the load shop holds no live offer and making one is a money promise (deliberate confirm), not a fixture'] },
    'POST /api/till/stock': { make: async (api) => ({ body: { item_id: await itemId(api), status: 'available', by: 'lt-live-trips' } }) },
    'POST /api/till/stock/bulk': { make: async (api) => ({ body: { item_ids: [await itemId(api)], status: 'available', by: 'lt-live-trips' } }) },
    'POST /api/till/enrol': { fresh: true, make: async (api) => { await counterKey(api, true); api.seeds.ckey = null; return { body: { counter: api.seeds.counter, name: 'lt-live-trips', takeover: true } }; } },
    'POST /api/till/pair/claim': { skip: ['no-header', 'public door (no sign-in): it answers 200 but the entity is not known before the code is read, so X-DB-Trips is not sent; the work is 1 key mint, measured by hand as unknown'] },
    'POST /api/till/screens/rename': { make: async (api) => ({ body: { jti: (await newScreen(api)).jti, name: 'lt-screen' } }) },
    'POST /api/till/screens/revoke': { fresh: true, make: async (api) => ({ body: { jti: (await newScreen(api)).jti } }) },
    'GET /api/till/engine/:name': { make: async () => ({ params: { name: 'offers' } }) },
    'POST /api/counters/:id/assign': { make: async (api) => { await counterKey(api); return { params: { id: api.seeds.counter }, body: { phone: null } }; } },
    'POST /api/books/accruals/:ref/reverse': { fresh: true, make: async (api) => { const ref = 'lt-ACC-' + u(); await must(api, 'POST', '/api/books/accruals', { ref, kind: 'outstanding', class: 'electricity', amount: 100, date: '2026-09-15', narration: 'lt- live-trips' }); return { params: { ref }, body: { client_ref: 'lt-' + u() } }; } },
    'POST /api/books/assets/:id/dispose': { fresh: true, make: async (api) => { const a = await must(api, 'POST', '/api/books/assets', { name: 'lt-asset-' + u(), class: 'furniture', cost: 1000, date: day(), how: 'cash' }); const id = a.asset_id || (a.asset && a.asset.asset_id); return { params: { id }, body: { date: day(), proceeds: 0, client_ref: 'lt-' + u() } }; } },
    'POST /api/books/loans/:ref/emi': { fresh: true, make: async (api) => { const ref = 'lt-LOAN-' + u(); await must(api, 'POST', '/api/books/loans', { ref, lender: 'lt-bank', amount: 1000, into: 'bank', rate: 10, date: day() }); return { params: { ref }, body: { principal: 10, interest: 1, date: day(), client_ref: 'lt-' + u() } }; } },
    'POST /api/books/payments/:id/propose': { make: async (api) => ({ params: { id: await newPayment(api) }, body: {} }) },
    'POST /api/books/payments/:id/confirm': { skip: ['fixture', 'allocates a payment to an open bill; a manual journal bill (Dr 1300 with the party) is refused as "there is no bill" by the confirm route (3 tries): needs a bill made by a real sale (counter/invoice chit), not a journal'] },
    'POST /api/books/recurring/:id/post': { fresh: true, make: async (api) => { const t = await must(api, 'POST', '/api/books/recurring', { name: 'lt-rec-' + u(), event: { kind: 'expense', class: 'rent', amount: 100, how: 'cash' }, frequency: 'monthly', next_on: '2026-11-01' }); return { params: { id: t.recurring_id }, body: {} }; } },
    'POST /api/books/recurring/:id/skip': { fresh: true, make: async (api) => { const t = await must(api, 'POST', '/api/books/recurring', { name: 'lt-rec-' + u(), event: { kind: 'expense', class: 'rent', amount: 100, how: 'cash' }, frequency: 'monthly', next_on: '2026-11-01' }); return { params: { id: t.recurring_id }, body: {} }; } },
    'POST /api/books/write-off': { fresh: true, make: async (api) => ({ body: { party_id: await customerId(api), amount: 1, reason: 'lt- live-trips probe', client_ref: 'lt-wo-' + u() } }) },
    'POST /api/books/gst/close': { make: async () => ({ body: { fy: OLD_FY, period: 1 } }) },
    'POST /api/books/gst/pay': { skip: ['precondition', 'a challan can only pay tax OWED (422: more than the tax owed - CGST owed 0); the old empty period 2026-27/1 owes nothing and a period with tax owed is not an empty one (no tax posted on the load shop before November)'] },
    'POST /api/books/periods/:fy/:p/:act': { make: async () => ({ params: { fy: OLD_FY, p: '2', act: 'lock' }, body: { reason: 'lt- live-trips (unlocked again after the run)' } }) },
    'GET /api/books/packs/:id/file': { make: async (api) => { if (!api.seeds.pack) api.seeds.pack = (await must(api, 'POST', '/api/books/packs', { kind: 'month', fiscal_year: OLD_FY, period: 1 })).pack.pack_id; return { params: { id: api.seeds.pack } }; } },
    'GET /api/assist/resolve': { query: '?region=IN' },
    'POST /api/books/accruals': { body: () => ({ ref: 'lt-ELEC-' + u(), kind: 'outstanding', class: 'electricity', amount: 100, date: day(), narration: 'lt- live-trips' }) },
    'POST /api/books/assets': { body: () => ({ name: 'lt-asset-' + u(), class: 'furniture', cost: 1000, date: day(), how: 'cash' }) },
    'POST /api/books/closing-stock': { body: () => ({ date: day(), value: 1000 + Math.floor(Math.random() * 1e6), method: 'manual', client_ref: 'lt-' + u() }) },
    'POST /api/books/contra': { body: () => ({ from: 'cash', to: 'bank', amount: 1, date: day(), client_ref: 'lt-' + u() }) },
    'POST /api/books/depreciation/run': { body: () => ({ fy: '2025-26', client_ref: 'lt-' + u() }) },
    'POST /api/books/loans': { body: () => ({ ref: 'lt-LOAN-' + u(), lender: 'lt-bank', amount: 1000, into: 'bank', rate: 10, date: day() }) },
    'POST /api/combo-templates': { body: () => ({ name: 'lt-combo-' + u(), definition: [{ name: 'lt-group', min: 1, max: 1, options: [{ name: 'lt-option' }] }] }) },
    'POST /api/quick-keys/groups': { body: () => ({ name: 'lt-group-' + u() }) },
    'POST /api/capture/stores': { body: () => ({ phone: '+9190000' + String(Math.floor(Math.random() * 90000) + 10000), display_name: 'lt-store-' + u() }) },
    'PATCH /api/combo-templates/:id': { body: () => ({ name: 'lt-combo-' + u() }) },
    'PATCH /api/quick-keys/groups/:id': { body: () => ({ name: 'lt-group-' + u() }) },
    'PUT /api/assist/container': { body: () => ({ container_id: 'lt/' + u(), name: 'lt-container' }) },
    'POST /api/integrations/profile': { body: () => ({ source: 'lt-live-trips', as_of: day(), fields: { legal_name: 'lt- shop' } }) },
  }
};
