/**
 * T3-P2-CRM — segments & groups through the REAL router (routes/crm.js) and the REAL lib/crm-groups · lib/crm · lib/privacy · lib/whatsapp-out,
 * over the in-memory stand-in (tests/support/crm-stub.cjs). What it proves:
 *   · GET /segments counts the SAME rows the Parties list answers (one definition: lib/customer-groups SEGMENT_SQL read by lib/crm.rows), says each
 *     rule in words, counts the offers that name a group ("Only for", ONE statement), and who may be sent offers — by lib/privacy's CODE, never a
 *     page's own count; before b306 nobody may (NO_CONSENT), and the answer says consent is not set up
 *   · every action carries the server's may/why: a viewer reads the screen and sees VIEW_ONLY / OWNER_ONLY; the writes refuse them too
 *   · POST /groups is ONE transaction: add[] placed, remove[] taken out, the count after; ≤ 20 groups per customer; a bad name refused in words;
 *     before b205 (no groups column) 409 GROUPS_NOT_MIGRATED, never a 500
 *   · DELETE /groups/:name is the owner's; the group leaves every customer; an unknown name is 404
 *   · POST /segments/:key/send: dry = the count and who is refused by code, nothing sent; a real send asks the ONE sender per allowed member
 *     (lib/whatsapp-out.notify, which asks lib/privacy.gate again) — with no WHATSAPP_TOKEN every send is REFUSED in words, logged, never a 500;
 *     only WhatsApp is sendable; an empty text, an unknown key and a set over the cap are refused in words
 * Run: node tests/crm-groups.test.cjs
 */
'use strict';
const assert = require('assert');
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data;
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
delete process.env.WHATSAPP_TOKEN;

/* the seed: four customers in four segments (Chola in group Dealers), a supplier, a lead (never counted) */
const cs = (r, o) => Object.assign({}, r, { customer_type: 'entity', added_via: 'manual', txn_count: 4, last_txn_at: '2026-09-30T10:00:00Z', groups: ['Dealers'], segment: 'regular', segment_override: null }, o);
const ss = (r, o) => Object.assign({}, r, { category: 'Raw', preferred: false, supply_kind: 'goods', added_via: 'manual' }, o);
const chola = row({ party_id: P(2), display_name: 'Chola Auto Care', user_id: 'chola', party_no: 'P-0002', phone: '+919840000002' });
const meena = row({ party_id: P(5), display_name: 'Meena', user_id: 'meena', entity_kind: 'shopper', on_rail: false, party_no: 'P-0005', phone: '+919840000005' });
const big = row({ party_id: P(6), display_name: 'Big Buyer', user_id: 'bigbuyer', party_no: 'P-0006' });
const ravi = row({ party_id: P(4), display_name: 'Ravi Trdrs', user_id: '~shop.cus-0001', on_rail: false, party_no: 'P-0004' });
const lead = row({ party_id: P(9), display_name: 'Lead Lata', user_id: '~shop.cus-0002', on_rail: false, party_no: 'P-0009' });
const agro = row({ party_id: P(1), display_name: 'Agro Mills', user_id: 'agromills', party_no: 'P-0001' });
function seed() {
  D.cust = [cs(chola), cs(meena, { segment: 'inactive', groups: [], customer_type: 'end_customer' }), cs(big, { segment: 'high_value', groups: [], segment_override: 'high_value' }), cs(ravi, { segment: 'new', groups: [], txn_count: 1 }),
    cs(lead, { segment: 'new', groups: [], txn_count: 0, added_via: 'lead' })];
  D.sup = [ss(agro)];
}
seed();
D.memberships = [{ entity_id: 'E1', item_id: P(9), kind: 'lead_stage', grp: 'lead', at: '2026-10-01T00:00:00.000Z' }];

/* the tables beyond the stub's own: offers (b160), consent (b306), the WhatsApp line (b123) and the outbound log (b126) */
const T = { offers: [{ g: 'group:Dealers', n: 2 }, { g: 'regular', n: 1 }], consent: false, prefs: [], groupsColumn: true, outbound: [], line: null, mkt: false, inserts: [], failMulti: false };
D.extra = async (sql, p) => {
  if (/FROM definition d/.test(sql)) return { rows: T.offers };
  if (/^SELECT DISTINCT unnest\(groups\)/.test(sql)) { if (!T.groupsColumn) { const e = new Error('column "groups" does not exist'); e.code = '42703'; throw e; } const s = new Set(); D.cust.forEach((r) => (r.groups || []).forEach((g) => s.add(g))); return { rows: [...s].sort().map((name) => ({ name })) }; }
  if (/^SELECT to_regclass\(\$1\) IS NOT NULL AS ok/.test(sql)) return { rows: [{ ok: T.consent }] };
  if (/^SELECT DISTINCT ON \(party_id, channel, purpose\)/.test(sql)) { if (!T.consent) { const e = new Error('relation "party_contact_pref" does not exist'); e.code = '42P01'; throw e; } return { rows: T.prefs.filter((r) => r.owner === p[0]) }; }
  if (/FROM party_contact_pref\s+WHERE owner_entity_id = \$1 AND party_id = \$2 AND channel = \$3 AND purpose = \$4/.test(sql)) return { rows: T.prefs.filter((r) => r.owner === p[0] && r.party_id === p[1] && r.channel === p[2] && r.purpose === p[3]) };
  if (/^SELECT DISTINCT ON \(item_id\)/.test(sql)) return { rows: D.memberships.filter((m) => p[2].indexOf(m.item_id) >= 0).map((m) => ({ item_id: m.item_id, grp: m.grp, at: m.at })) };
  if (/FROM information_schema.tables/.test(sql)) return { rows: [{ '?column?': 1 }] };
  if (/^UPDATE customer_list SET groups = array_append/.test(sql)) {
    if (!T.groupsColumn) { const e = new Error('column "groups" does not exist'); e.code = '42703'; throw e; }
    const out = []; D.cust.forEach((r) => { if (r.owner === p[0] && p[2].indexOf(r.party_id) >= 0 && (r.groups || []).indexOf(p[1]) < 0) { r.groups = (r.groups || []).concat([p[1]]); out.push({ customer_identity_id: r.party_id, n: r.groups.length }); } });
    return { rows: out };
  }
  if (/^UPDATE customer_list SET groups = array_remove/.test(sql)) {
    const out = []; D.cust.forEach((r) => { if (r.owner === p[0] && (!p[2] || p[2].indexOf(r.party_id) >= 0) && (r.groups || []).indexOf(p[1]) >= 0) { r.groups = r.groups.filter((g) => g !== p[1]); out.push({ customer_identity_id: r.party_id }); } });
    return { rows: out };
  }
  if (/^SELECT count\(\*\)::int AS n FROM customer_list/.test(sql)) return { rows: [{ n: D.cust.filter((r) => r.owner === p[0] && (r.groups || []).indexOf(p[1]) >= 0).length }] };
  if (/FROM channel_binding WHERE entity_id = \$1 AND channel = 'whatsapp'/.test(sql)) return { rows: T.line ? [T.line] : [] };
  if (/information_schema.columns/.test(sql)) return { rows: T.mkt ? [{ '?column?': 1 }] : [] }; /* b776: the MKT columns on channel_outbound */
  if (/^INSERT INTO channel_outbound/.test(sql)) { T.inserts.push({ sql, p }); if (T.failMulti && /send_ref/.test(sql)) throw new Error('db down'); const r = { id: 'ob' + T.outbound.length, status: p[6], reason: p[7], to: p[4] }; T.outbound.push(r); return { rows: [r] }; }
  if (/FROM capture\s+WHERE entity_id = \$1 AND channel = 'whatsapp' AND sender_ref/.test(sql)) return { rows: [{ last_in: null }] };
  return null;
};
const owner = () => t.as('E1');
const who = (identity) => t.as('E1', { identity: Object.assign({ identity_id: 'A1', identity_type: 'actor', parent_entity_id: 'E1', display_name: 'Vel' }, identity), gate: true });
const seg = (r, k) => r.body.segments.find((s) => s.key === k);

(async () => {
  console.log('\n-- GET /api/crm/segments: the one definition, counted; offers; who may be sent offers --');
  await ita('four segments in order, each with its rule in words and the list\'s own count; a lead is never counted; the override is counted', async () => {
    owner(); const r = await t.get('/segments'); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.segments.map((s) => s.key), ['new', 'regular', 'high_value', 'inactive']);
    assert.deepStrictEqual(r.body.segments.map((s) => s.count), [1, 1, 1, 1], JSON.stringify(r.body.segments));
    assert.strictEqual(seg(r, 'high_value').overrides, 1); assert.strictEqual(seg(r, 'new').overrides, 0);
    assert.ok(/top 10% by bills in 12 months, at least 3 bills/.test(seg(r, 'high_value').rule), seg(r, 'high_value').rule);
    assert.ok(/90 days/.test(seg(r, 'inactive').rule) && /3 or more/.test(seg(r, 'regular').rule) && /fewer than 3/.test(seg(r, 'new').rule));
    assert.strictEqual(r.body.customers, 4);
  });
  await ita('the shop\'s own high-value rule (policy_flags.crm) reaches the words', async () => {
    D.rule = { high_value_pct: 25, high_value_min_bills: 5 }; const r = await t.get('/segments'); D.rule = null;
    assert.ok(/top 25% by bills in 12 months, at least 5 bills/.test(seg(r, 'high_value').rule), seg(r, 'high_value').rule);
  });
  await ita('the named group Dealers: one member, 2 offers name it ("Only for", ONE statement); the segment regular has 1 offer; groups_migrated true', async () => {
    const r = await t.get('/segments');
    assert.deepStrictEqual(r.body.groups.map((g) => [g.key, g.name, g.count, g.offers]), [['group:Dealers', 'Dealers', 1, 2]]);
    assert.strictEqual(seg(r, 'regular').offers, 1); assert.strictEqual(seg(r, 'new').offers, 0);
    assert.strictEqual(r.body.groups_migrated, true);
    assert.strictEqual(D.queries.filter((q) => /FROM definition d/.test(q)).length >= 1, true);
  });
  await ita('before b306: consent_migrated false, nobody may be sent offers — every member refused by code NO_CONSENT (lib/privacy\'s own verdict)', async () => {
    const r = await t.get('/segments');
    assert.strictEqual(r.body.consent_migrated, false); assert.strictEqual(r.body.channel, 'whatsapp'); assert.strictEqual(r.body.purpose, 'marketing');
    assert.deepStrictEqual(r.body.groups[0].reach, { may: 0, not: 1, refused_by: [{ code: 'NO_CONSENT', n: 1 }] });
    assert.deepStrictEqual(seg(r, 'regular').reach, { may: 0, not: 1, refused_by: [{ code: 'NO_CONSENT', n: 1 }] });
  });
  await ita('after b306: a standing yes counts as may; a no by its code (SAID_NO); the rest NO_CONSENT', async () => {
    T.consent = true; T.prefs = [{ owner: 'E1', party_id: P(2), channel: 'whatsapp', purpose: 'marketing', allowed: true, basis: 'consent', withdrawn_at: null }, { owner: 'E1', party_id: P(5), channel: 'whatsapp', purpose: 'marketing', allowed: false, basis: 'consent', withdrawn_at: null }];
    const r = await t.get('/segments');
    assert.strictEqual(r.body.consent_migrated, true);
    assert.deepStrictEqual(r.body.groups[0].reach, { may: 1, not: 0, refused_by: [] });
    assert.deepStrictEqual(seg(r, 'inactive').reach, { may: 0, not: 1, refused_by: [{ code: 'SAID_NO', n: 1 }] });
    assert.deepStrictEqual(seg(r, 'new').reach, { may: 0, not: 1, refused_by: [{ code: 'NO_CONSENT', n: 1 }] });
  });
  await ita('the server\'s may/why per action: the owner may everything; a viewer reads the screen and sees VIEW_ONLY / OWNER_ONLY', async () => {
    owner(); let r = await t.get('/segments'); assert.deepStrictEqual([r.body.may.group.may, r.body.may.send.may, r.body.may.delete.may], [true, true, true]);
    who({ access_level: 'viewer' }); r = await t.get('/segments'); assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.may.group.code, 'VIEW_ONLY'); assert.ok(/only view/.test(r.body.may.group.why)); assert.strictEqual(r.body.may.send.code, 'VIEW_ONLY'); assert.strictEqual(r.body.may.delete.code, 'OWNER_ONLY');
    who({ access_level: 'editor' }); r = await t.get('/segments'); assert.deepStrictEqual([r.body.may.group.may, r.body.may.send.may, r.body.may.delete.may], [true, true, false]);
  });

  console.log('\n-- POST /api/crm/groups: one transaction, the count after --');
  await ita('a viewer\'s write is refused in words, nothing written', async () => {
    who({ access_level: 'viewer' }); const before = JSON.stringify(D.cust.map((r) => r.groups));
    const r = await t.post('/groups', { name: 'VIP', add: [P(2)] }); assert.strictEqual(r.status, 403, JSON.stringify(r.body)); assert.strictEqual(JSON.stringify(D.cust.map((r) => r.groups)), before);
  });
  await ita('New group VIP with two members → 201 { name, added 2, removed 0, count 2 }; the list now shows it', async () => {
    owner(); const r = await t.post('/groups', { name: '  VIP  ', add: [P(2), P(5), P(5)], remove: [] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.deepStrictEqual(r.body, { name: 'VIP', added: 2, removed: 0, count: 2 });
    const g = (await t.get('/segments')).body.groups.find((x) => x.name === 'VIP'); assert.ok(g && g.count === 2, JSON.stringify(g));
  });
  await ita('adding a member already in it changes nothing (added 0); removing one → removed 1, count 1', async () => {
    const r = await t.post('/groups', { name: 'VIP', add: [P(2)], remove: [P(5)] }); assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.deepStrictEqual(r.body, { name: 'VIP', added: 0, removed: 1, count: 1 });
  });
  await ita('an id that is nobody\'s customer is not added (added 0); a name of symbols, an empty set and more than 500 ids are refused in words', async () => {
    let r = await t.post('/groups', { name: 'VIP', add: [P(77)] }); assert.strictEqual(r.status, 201); assert.strictEqual(r.body.added, 0);
    r = await t.post('/groups', { name: '<script>', add: [P(2)] }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_NAME'); assert.ok(/Name the group/.test(r.body.message));
    r = await t.post('/groups', { name: 'VIP' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'NOTHING_TO_DO');
    r = await t.post('/groups', { name: 'VIP', add: Array.from({ length: 501 }, (_, i) => P(1000 + i)) }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'TOO_MANY');
  });
  await ita('a customer in 20 groups cannot be placed in a 21st: 400 TOO_MANY_GROUPS (the transaction rolls back)', async () => {
    const c = D.cust.find((r) => r.party_id === P(4)); c.groups = Array.from({ length: 20 }, (_, i) => 'G' + i);
    const r = await t.post('/groups', { name: 'VIP', add: [P(4)] }); assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'TOO_MANY_GROUPS'); c.groups = [];
  });
  await ita('before b205 (no groups column): 409 GROUPS_NOT_MIGRATED naming the file, never a 500', async () => {
    T.groupsColumn = false; const r = await t.post('/groups', { name: 'VIP', add: [P(2)] }); T.groupsColumn = true;
    assert.strictEqual(r.status, 409, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'GROUPS_NOT_MIGRATED'); assert.ok(/b205/.test(r.body.message));
  });

  console.log('\n-- DELETE /api/crm/groups/:name: the owner\'s --');
  await ita('an editor may not delete (403 OWNER_ONLY); the owner may: VIP leaves its member; an unknown name is 404', async () => {
    who({ access_level: 'editor' }); let r = await t.del('/groups/VIP'); assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'OWNER_ONLY');
    owner(); r = await t.del('/groups/VIP'); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.deepStrictEqual(r.body, { name: 'VIP', removed: 1 });
    assert.ok(!D.cust.some((x) => (x.groups || []).indexOf('VIP') >= 0));
    r = await t.del('/groups/VIP'); assert.strictEqual(r.status, 404); assert.strictEqual(r.body.code, 'NOT_FOUND');
  });

  console.log('\n-- POST /api/crm/segments/:key/send: dry first, then the one sender --');
  await ita('dry: the count and who is refused by code, nothing sent (no outbound row)', async () => {
    owner(); T.outbound = [];
    const r = await t.post('/segments/group:Dealers/send', { text: 'Diwali offer: 10% off this week', dry: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.key, r.body.dry, r.body.members, r.body.may, r.body.refused_n, r.body.sent_n], ['group:Dealers', true, 1, 1, 0, 0]);
    const s = await t.post('/segments/inactive/send', { text: 'Come back', dry: true });
    assert.deepStrictEqual([s.body.members, s.body.may, s.body.refused.length, s.body.refused[0].code, s.body.refused_by[0].code], [1, 0, 1, 'SAID_NO', 'SAID_NO']);
    assert.ok(/said no/.test(s.body.refused[0].why), s.body.refused[0].why);
    assert.strictEqual(T.outbound.length, 0);
  });
  await ita('a real send with no WHATSAPP_TOKEN: the one sender refuses each allowed member IN WORDS, logs it, answers 200 — never a 500; the refused member is not attempted', async () => {
    const r = await t.post('/segments/group:Dealers/send', { text: 'Diwali offer: 10% off this week' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.dry, r.body.members, r.body.may, r.body.sent.length, r.body.sent[0].status, r.body.sent_n, r.body.refused_n], [false, 1, 1, 1, 'refused', 0, 1]);
    assert.ok(/WHATSAPP_TOKEN/.test(r.body.sent[0].reason), r.body.sent[0].reason);
    assert.strictEqual(T.outbound.length, 1); assert.strictEqual(T.outbound[0].to, '+919840000002');
    const s = await t.post('/segments/inactive/send', { text: 'Come back' }); assert.deepStrictEqual([s.body.may, s.body.sent.length], [0, 0]); assert.strictEqual(T.outbound.length, 1);
  });
  await ita('a member who agreed but has no phone is refused in words (no provider call)', async () => {
    T.prefs.push({ owner: 'E1', party_id: P(6), channel: 'whatsapp', purpose: 'marketing', allowed: true, basis: 'consent', withdrawn_at: null });
    const r = await t.post('/segments/high_value/send', { text: 'Thank you' }); assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.may, r.body.sent[0].status, r.body.sent[0].reason], [1, 'refused', 'No phone number.']);
  });
  await ita('MKT b776: the people NOT messaged are logged as refused receipts of the same send (one INSERT through the one writer), and the answer names the send', async () => {
    T.mkt = true; T.inserts = []; require('../lib/schema')._reset(); /* a no is remembered for a minute: forget it */
    const r = await t.post('/segments/high_value/send', { text: 'Thank you' }); T.mkt = false;
    assert.strictEqual(r.status, 200); assert.ok(/^[0-9a-f-]{36}$/.test(r.body.send_ref), 'the send has a ref'); assert.strictEqual(r.body.refusals_logged, 1);
    const multi = T.inserts.filter((x) => /send_ref/.test(x.sql)); assert.strictEqual(multi.length, 1, 'one statement for the refusals');
    assert.deepStrictEqual([multi[0].p[4], multi[0].p[6], multi[0].p[10], multi[0].p[11]], ['', 'refused', 'marketing', r.body.send_ref]);
    assert.strictEqual(JSON.parse(multi[0].p[12]).code, 'NO_PHONE'); assert.strictEqual(r.body.refusals_unlogged, false, 'recorded: nothing to warn about');
  });
  await ita('before b776 the send is the same and logs no group refusals (refusals_logged 0)', async () => {
    T.mkt = false; require('../lib/schema')._reset(); const r = await t.post('/segments/high_value/send', { text: 'Thank you' }); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.refusals_logged, 0); assert.strictEqual(r.body.refusals_unlogged, true, 'before b776 a 0 says NOT RECORDED, not nobody refused');
  });
  await ita('refusals that could not be written say so (refusals_unlogged true) and the send is unaffected', async () => {
    T.mkt = true; T.failMulti = true; require('../lib/schema')._reset();
    const r = await t.post('/segments/high_value/send', { text: 'Thank you' }); T.mkt = false; T.failMulti = false; require('../lib/schema')._reset();
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.refusals_logged, 0); assert.strictEqual(r.body.refusals_unlogged, true);
  });
  await ita('refused in words: no text · over 1000 characters · an unknown key · e-mail (not sendable here) · a viewer', async () => {
    let r = await t.post('/segments/group:Dealers/send', { text: '  ' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'NO_TEXT');
    r = await t.post('/segments/group:Dealers/send', { text: 'x'.repeat(1001) }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'TOO_LONG');
    r = await t.post('/segments/everyone/send', { text: 'hi' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_KEY');
    r = await t.post('/segments/regular/send', { text: 'hi', channel: 'email' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'CHANNEL_NOT_SENDABLE');
    r = await t.post('/segments/regular/send', { text: 'hi', channel: 'pigeon' }); assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'BAD_CHANNEL');
    who({ access_level: 'viewer' }); r = await t.post('/segments/regular/send', { text: 'hi', dry: true }); assert.strictEqual(r.status, 403); owner();
  });
  await ita('a set that reaches more than 100 is refused (TOO_MANY) with the number, before any send', async () => {
    const many = Array.from({ length: 101 }, (_, i) => cs(row({ party_id: P(2000 + i), display_name: 'C' + i, user_id: 'c' + i, phone: '+9198' + String(i).padStart(8, '0') }), { segment: 'new', groups: ['Many'], txn_count: 1 }));
    D.cust = D.cust.concat(many); many.forEach((c) => T.prefs.push({ owner: 'E1', party_id: c.party_id, channel: 'whatsapp', purpose: 'marketing', allowed: true, basis: 'consent', withdrawn_at: null }));
    const n = T.outbound.length;
    const d = await t.post('/segments/group:Many/send', { text: 'hi', dry: true }); assert.deepStrictEqual([d.body.members, d.body.may], [101, 101]);
    const r = await t.post('/segments/group:Many/send', { text: 'hi' }); assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'TOO_MANY'); assert.ok(/101/.test(r.body.message));
    assert.strictEqual(T.outbound.length, n); seed();
  });
  t.close();
  console.log('\n' + pass + ' passed' + (process.exitCode ? ' · FAILURES above' : '') + '\n');
})();
