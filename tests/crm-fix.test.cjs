/**
 * CRM-FIX — the Claude review findings R1–R10 (15 Oct 2026, round 2), one failing scenario each. Offline: no Postgres, no network.
 *   R1 an opt-out on WhatsApp is honoured for a chit-status message (number with / without country code)
 *   R2 an offer outside the 24-hour window is never sent as the order-status template
 *   R3 a segment/group send is always marketing (a hand-made purpose:'service' is refused)
 *   R4 the call desk asks the consent gate; do-not-call parties are marked in the queue
 *   R5 an outcome closes only the follow-up the queue row came from
 *   R6 the follow-up "today" uses the shop's identity zone when there is no Ledger setting
 *   R7 adding a customer finds an existing one by phone · R8 supplier remove = CRM remove (no dues) · R9 expensed supplies say they are not in the books
 *   R10 remove-from-parties refuses when EITHER side has money open
 * Run: node tests/crm-fix.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
process.env.WHATSAPP_TOKEN = 'tok';
{ const sp = require.resolve(path.join(API, 'lib/schema')); require.cache[sp] = { id: sp, filename: sp, loaded: true, exports: { hasTable: async () => true, hasColumn: async () => true, forget() {} } }; }
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data;
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };

/* a hand-rolled connection: the consent rows and the captures live in arrays; the statements are recognised by their text */
const last9 = (v) => String(v || '').replace(/\D/g, '').slice(-9);
const world = { parties: [], prefs: [], captures: [], binding: { id: 'b1', address: '9100000000', templates: { order_status_update: 'approved' } }, sent: [], logged: [] };
async function dbq(sql, p) {
  sql = String(sql).replace(/\s+/g, ' ');
  if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
  if (/FROM party_contact_pref p JOIN identities i/.test(sql)) {
    const keyed = /right\(/.test(sql), who = world.parties.filter((x) => (keyed ? last9(x.phone) === p[1] : String(x.phone).replace(/\D/g, '') === p[1])).map((x) => x.id);   /* the predicate as the SQL writes it */
    return { rows: world.prefs.filter((r) => who.indexOf(r.party_id) >= 0 && r.channel === p[2] && r.purpose === p[3]) };
  }
  if (/FROM party_contact_pref WHERE owner_entity_id = \$1 AND party_id = \$2 AND channel/.test(sql)) return { rows: world.prefs.filter((r) => r.party_id === p[1] && r.channel === p[2] && r.purpose === p[3]) };
  if (/MAX\(created_at\) AS last_in FROM capture/.test(sql)) { const keyed = /right\(/.test(sql), c = world.captures.filter((x) => (keyed ? last9(x.sender_ref) === p[1] : x.sender_ref === p[1])); return { rows: [{ last_in: c.length ? c[0].created_at : null }] }; }
  if (/FROM channel_binding/.test(sql)) return { rows: [world.binding] };
  if (/FROM capture c LEFT JOIN channel_binding/.test(sql)) return { rows: world.captures.filter((c) => c.chit_id === p[1]) };
  if (/INSERT INTO channel_outbound/.test(sql)) { world.logged.push({ status: p[6], reason: p[7] }); return { rows: [{ id: 'o1', status: p[6], reason: p[7] }] }; }
  throw new Error('unexpected SQL: ' + sql.slice(0, 120));
}
const handle = { query: dbq };
{ const db = require(path.join(API, 'db')), crmEntity = db.withEntity; db.withEntity = async (e, fn) => (world.on ? fn(handle) : crmEntity(e, fn)); }   /* the sender's world only while world.on */
global.fetch = async (url, o) => { world.sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ messages: [{ id: 'm1' }] }) }; };
const S = require('../lib/stores'), G = require('../lib/crm-groups');   /* the modules under test, by name */
const PV = require('../lib/privacy'), WA = require('../lib/whatsapp-out');
const reset = () => { world.on = true; world.parties = [{ id: 'P1', phone: '9840012321' }]; world.prefs = []; world.captures = []; world.sent = []; world.logged = []; };

(async () => {
  await ita('R1/R7 phoneMatchKey: one key for +91 / bare / country-code forms and AU 04…/61…; too short names no one', async () => {
    assert.strictEqual(S.phoneMatchKey('+91 98400 12321'), S.phoneMatchKey('9840012321')); assert.strictEqual(S.phoneMatchKey('919840012321'), S.phoneMatchKey('9840012321'));
    assert.strictEqual(S.phoneMatchKey('61412345678'), S.phoneMatchKey('0412345678')); assert.strictEqual(S.phoneMatchKey('12345'), ''); assert.strictEqual(G.SEND_CAP > 0, true);
  });
  await ita('R1 gate by a WhatsApp number (country code) finds a party saved without it, and the opt-out holds', async () => {
    reset(); world.prefs = [{ party_id: 'P1', channel: 'whatsapp', purpose: 'service', allowed: false, basis: 'legitimate_use', withdrawn_at: null }];
    const v = await PV.gate(handle, 'E1', { to_ref: '919840012321' }, 'whatsapp', 'service'); assert.strictEqual(v.may, false); assert.strictEqual(v.code, 'OPTED_OUT');
  });
  await ita('R1 AU: 61412345678 reaches a party typed as 0412345678', async () => {
    reset(); world.parties = [{ id: 'P1', phone: '0412345678' }]; world.prefs = [{ party_id: 'P1', channel: 'whatsapp', purpose: 'service', allowed: false, basis: 'legitimate_use', withdrawn_at: null }];
    assert.strictEqual((await PV.gate(handle, 'E1', { to_ref: '61412345678' }, 'whatsapp', 'service')).may, false);
  });
  await ita('R1 an order-status message to an opted-out customer is refused and nothing is sent', async () => {
    reset(); world.prefs = [{ party_id: 'P1', channel: 'whatsapp', purpose: 'service', allowed: false, basis: 'legitimate_use', withdrawn_at: null }];
    world.captures = [{ chit_id: 'C1', id: 'cap1', sender_ref: '919840012321', to_ref: '9100000000', provider_ref: 'ph1', created_at: new Date().toISOString() }];
    const r = await WA.notifyChitStatus('E1', 'C1', 'accepted', 'Order'); assert.strictEqual(r.status, 'refused'); assert.strictEqual(r.code, 'OPTED_OUT'); assert.strictEqual(world.sent.length, 0);
  });
  await ita('R2 an offer outside the 24 h window is refused, never sent as "Update on your order"', async () => {
    reset(); world.prefs = [{ party_id: 'P1', channel: 'whatsapp', purpose: 'marketing', allowed: true, basis: 'consent', withdrawn_at: null }];
    const r = await WA.notify('E1', { to_ref: '9840012321', from_ref: '9100000000', provider_ref: 'ph1', text: 'Diwali sale 20% off', party_id: 'P1', purpose: 'marketing' });
    assert.strictEqual(r.status, 'refused'); assert.strictEqual(world.sent.length, 0, 'no template went out'); assert.match(r.reason, /offer|marketing/i);
  });
  await ita('R2 the window is judged on the number in one form (inbound 919840012321, CRM phone 9840012321) → free text inside it', async () => {
    reset(); world.prefs = [{ party_id: 'P1', channel: 'whatsapp', purpose: 'marketing', allowed: true, basis: 'consent', withdrawn_at: null }];
    world.captures = [{ chit_id: 'C9', id: 'cap9', sender_ref: '919840012321', created_at: new Date().toISOString() }];
    const r = await WA.notify('E1', { to_ref: '9840012321', from_ref: '9100000000', provider_ref: 'ph1', text: 'Sale', party_id: 'P1', purpose: 'marketing' });
    assert.strictEqual(r.status, 'sent'); assert.strictEqual(world.sent[0].type, 'text');
  });
  world.on = false;
  await ita('R3 POST /segments/:key/send with purpose:"service" is refused (400 PURPOSE_FIXED)', async () => {
    D.cust = []; D.sup = [];
    const r = await t.post('/segments/regular/send', { purpose: 'service', text: 'Sale this week', dry: true }); assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'PURPOSE_FIXED');
    const ok = await t.post('/segments/regular/send', { text: 'Sale this week', dry: true }); assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.purpose, 'marketing');
  });

  /* the call desk */
  const cs = (r, via, n) => Object.assign(r, { customer_type: 'entity', added_via: via || 'manual', txn_count: n == null ? 1 : n, segment: 'new' });
  D.cust = [cs(row({ party_id: P(1), display_name: 'Lead Lata', user_id: '~s.cus-0001', on_rail: false }), 'lead', 0), cs(row({ party_id: P(2), display_name: 'Customer Chola', user_id: 'chola' }), 'manual', 5)];
  D.sup = [];
  const prefs = [];   /* { party_id, channel, purpose, allowed } newest first */
  D.pre = async (sql, p) => {
    if (/to_regclass\('party_contact_pref'\)|^SELECT to_regclass\(\$1\)/.test(sql)) return { rows: [{ ok: true }] };
    if (/FROM party_contact_pref\s+WHERE owner_entity_id = \$1 AND party_id = \$2 AND channel = \$3/.test(sql)) return { rows: prefs.filter((r) => r.party_id === p[1] && r.channel === p[2] && r.purpose === p[3]) };
    if (/^SELECT DISTINCT ON \(party_id, channel, purpose\)/.test(sql)) return { rows: prefs.map((r) => Object.assign({ basis: 'consent', withdrawn_at: null }, r)) };
    if (/^SELECT q\.followup_id/.test(sql)) return { rows: D.cust.map((c) => ({ followup_id: null, party_id: c.party_id, party_name: c.display_name, phone: '+919840011111', src: 'new', total_rows: 2, late_rows: 0, today_rows: 0 })) };
    if (/^UPDATE party_followup SET done_at = now\(\)/.test(sql)) {
      D.followups.forEach((f) => { if (f.owner === p[0] && f.party_id === p[1] && !f.done_at && (/followup_id/.test(sql) ? f.followup_id === p[3] : true)) f.done_at = 'now'; }); return { rows: [] };
    }
    if (/^SELECT body FROM party_interaction/.test(sql)) return { rows: [] };
    if (/^SELECT txn_count FROM customer_list/.test(sql)) return { rows: [{ txn_count: 0 }] };
    return null;
  };
  await ita('R4 a "do not call" party: the outcome is refused 403 and nothing is logged; the queue row says may_call false with the reason', async () => {
    prefs.length = 0; prefs.push({ party_id: P(1), channel: 'phone', purpose: 'service', allowed: false });
    const n = D.interactions.length;
    const r = await t.post('/parties/' + P(1) + '/outcome', { outcome: 'interested' }); assert.strictEqual(r.status, 403, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'OPTED_OUT'); assert.strictEqual(D.interactions.length, n);
    const q = (await t.get('/calls')).body.calls; const lata = q.find((c) => c.party_id === P(1)), chola = q.find((c) => c.party_id === P(2));
    assert.strictEqual(lata.may_call, false); assert.ok(lata.call_why); assert.strictEqual(chola.may_call, true);
  });
  await ita('R5 an outcome closes only the follow-up the queue row came from; the colleague\'s stays open', async () => {
    prefs.length = 0; const at = new Date().toISOString();
    D.followups.push({ owner: 'E1', party_id: P(2), followup_id: 'fa', what: 'Ring Ravi', due_at: at, created_at: at, assignee_user_id: 'E1', source: 'manual' },
      { owner: 'E1', party_id: P(2), followup_id: 'fb', what: 'Collect cheque Friday', due_at: at, created_at: at, assignee_user_id: 'E1', source: 'manual' });
    const r = await t.post('/parties/' + P(2) + '/outcome', { outcome: 'no_answer', followup_id: 'fa' }); assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.ok(D.followups.find((f) => f.followup_id === 'fa').done_at, 'the one answered is closed'); assert.ok(!D.followups.find((f) => f.followup_id === 'fb').done_at, "Meena's follow-up is still open");
  });
  await ita('R6 no Ledger setting: the follow-up day comes from the shop\'s identity zone, not UTC', async () => {
    const F = require('../lib/crm-followups'), h = { query: async (sql) => { sql = String(sql);
      if (/FROM books_setting/.test(sql)) return { rows: [] }; if (/FROM identities WHERE identity_id/.test(sql)) return { rows: [{ zone: 'Australia/Sydney' }] }; return { rows: [] }; } };
    assert.strictEqual((await F.todayOf(h, 'E1')).country, 'Australia/Sydney');
  });
  await ita('R7 adding "Customer 2321" with Priya\'s phone finds Priya (exists), mints nothing', async () => {
    const L = require('../lib/local-identity'); let inserted = 0;
    const h = { query: async (sql) => { sql = String(sql).replace(/\s+/g, ' ');
      if (/INSERT/.test(sql)) { inserted++; return { rows: [{ identity_id: 'new' }] }; }
      if (/otp_contact/.test(sql) && /customer_list/.test(sql) && /SELECT/.test(sql)) return { rows: [{ identity_id: 'PRIYA', display_name: 'Priya', user_id: '~s.cus-0001' }] };
      return { rows: [] }; } };
    const r = await L.addCustomer(h, 'E1', { name: 'Customer 2321', phone: '+919840012321', via: 'manual' });
    assert.strictEqual(r.exists, true); assert.strictEqual(r.local.identity_id, 'PRIYA'); assert.strictEqual(inserted, 0);
  });
  await ita('R8 removing a supplier with money owed is refused (HAS_DUES) and hides, never deletes; with nothing owed it hides on the supplier list', async () => {
    D.cust = []; D.sup = [Object.assign(row({ party_id: P(4), display_name: 'Owed Mills', user_id: 'om' }), { category: 'Raw', preferred: false, supply_kind: 'goods', added_via: 'manual', supplier_list_id: 'SL4' }),
      Object.assign(row({ party_id: P(5), display_name: 'Square Mills', user_id: 'sm' }), { category: 'Raw', preferred: false, supply_kind: 'goods', added_via: 'manual', supplier_list_id: 'SL5' })];
    D.stored.supplier[P(4)] = { balance_minor: -4000000 }; D.stored.supplier[P(5)] = { balance_minor: 0 };
    const crm = require('../lib/crm');
    await assert.rejects(() => crm.removeParty('E1', P(4)), (e) => e.code === 'HAS_DUES' && e.status === 409);
    assert.strictEqual(D.sup.length, 2); assert.ok(!D.sup[0].hidden_at);
    await crm.removeParty('E1', P(5)); assert.ok(D.sup.find((x) => x.party_id === P(5)).hidden_at); assert.strictEqual(D.sup.length, 2, 'nothing deleted');
    const src = require('fs').readFileSync(path.join(API, 'routes', 'relationships.js'), 'utf8').split("router.delete('/suppliers/:id'")[1].split('\nrouter.')[0];
    assert.ok(/isOwner/.test(src) && /removeParty/.test(src) && !/DELETE FROM supplier_list/.test(src), 'the route is owner-only and goes through the CRM remove');
  });
  await ita('R9 an expensed supplies purchase says it is not in the books (a code, not prose)', async () => {
    const S = require('../lib/supply-store'); const orig = S.ensureMany;
    const sup = require('../routes/supplies');   /* the route builds `says` from the store's answer */
    const src = require('fs').readFileSync(path.join(API, 'routes', 'supplies.js'), 'utf8');
    assert.ok(/books_posted\s*[:=]\s*false/.test(src + require('fs').readFileSync(path.join(API, 'lib', 'supply-store.js'), 'utf8')), 'the answer carries books_posted:false');
    assert.ok(/not in your books/i.test(src), 'and the toast says so'); void orig; void sup;
  });
  await ita('R10 ₹5,000 receivable and ₹5,000 payable do NOT net to zero for removal', async () => {
    D.cust = [cs(row({ party_id: P(7), display_name: 'Both Sides', user_id: 'bs' }))]; D.sup = [Object.assign(row({ party_id: P(7), display_name: 'Both Sides', user_id: 'bs' }), { category: 'Raw', preferred: false, supply_kind: 'goods', added_via: 'manual' })];
    D.stored.customer[P(7)] = { balance_minor: 500000 }; D.stored.supplier[P(7)] = { balance_minor: -500000 };
    const r = await t.del('/parties/' + P(7)); assert.strictEqual(r.status, 409, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'HAS_DUES');
  });
  console.log(pass + ' checks'); t.close && t.close(); process.exit(process.exitCode || 0);
})();
