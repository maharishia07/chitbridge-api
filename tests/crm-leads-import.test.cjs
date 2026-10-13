/**
 * CB CRM L3 — leads from a CSV: POST /api/crm/leads/import. Offline (tests/support/crm-stub.cjs).
 *   pure: normalise (the one phone helper · in-file dedupe by phone then name · the cap and its sentence) · plan (merge / skip, with the reason)
 *   route: who may (a viewer → 403 in words) · dry = the plan, nothing written · the real run = ONE statement per table, never one per row
 *          (the same statement count for 6 rows and for 300) · merged = the existing party becomes a lead · b297 not run → 503, nothing created
 * Run: node tests/crm-leads-import.test.cjs
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
const state = { table: true };
{ const p = require.resolve(path.join(API, 'lib/schema')); require.cache[p] = { id: p, filename: p, loaded: true, exports: { hasTable: async (t) => (t === 'memberships' ? state.table : true), hasColumn: async () => true, hasColumns: async () => ({}), _reset() {} } }; }
const { make, row } = require('./support/crm-stub.cjs');
const t = make(), D = t.data;
const CL = require(path.join(API, 'lib/crm-leads'));
const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
let pass = 0;
const ita = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; } };
const cs = (r, via, n) => Object.assign(r, { customer_type: 'entity', added_via: via || 'manual', txn_count: n == null ? 1 : n, segment: 'new' });

/* ── the pure half ─────────────────────────────────────────────────────────────────────────────────────────────── */
(async () => {
  await ita('normalise: the phone through the one helper (rewards.holderOf), spaces folded, the extras kept', async () => {
    const r = CL.normalise([{ name: '  Ravi   Jewellers ', phone: '+91 98400 12321', email: 'r@x.in', business: 'Ravi & Co', city: 'Madurai', source: 'Expo', note: 'Met at stall 4' }])[0];
    assert.strictEqual(r.name, 'Ravi Jewellers'); assert.strictEqual(r.phone, '+919840012321'); assert.strictEqual(r.digits, '919840012321');
    assert.strictEqual(r.business, 'Ravi & Co'); assert.strictEqual(r.city, 'Madurai'); assert.strictEqual(r.source, 'Expo'); assert.strictEqual(r.note, 'Met at stall 4'); assert.strictEqual(r.why, null);
  });
  await ita('normalise: no name · an email as the name · a bad phone → skipped with the reason; a row with no phone is fine', async () => {
    const rs = CL.normalise([{ name: '', phone: '9840012321' }, { name: 'a@b.in' }, { name: 'Kala', phone: 'abc' }, { name: 'Mani', phone: '12345' }, { name: 'Velu' }]);
    assert.deepStrictEqual(rs.map((r) => r.why), ['No name', 'That looks like an email', 'Phone does not look right', 'Phone does not look right', null]);
  });
  await ita('normalise: the same phone twice keeps the first (row numbers are the file\'s); the same name twice with no phone too', async () => {
    const rs = CL.normalise([{ name: 'A', phone: '98400 12321' }, { name: 'B', phone: '+91-98400-12321' }, { name: 'C', phone: '9840012321' }, { name: 'c' }, { name: 'A', phone: '9840099999' }, { name: 'D' }, { name: ' d ' }]);
    assert.strictEqual(rs[1].why, null, '"+91…" is not the same digits as "98400…" — the helper does not guess a country code');
    assert.strictEqual(rs[2].why, 'Same phone as row 1'); assert.strictEqual(rs[3].why, null, 'a row skipped for its phone does not claim its name'); assert.strictEqual(rs[4].why, 'Same name as row 1');
    assert.strictEqual(rs[6].why, 'Same name as row 6');
  });
  await ita('normalise: 501 rows → the sentence; nothing → the sentence', async () => {
    assert.throws(() => CL.normalise(Array.from({ length: 501 }, (_, i) => ({ name: 'N' + i }))), (e) => e.status === 400 && e.code === 'TOO_MANY' && e.message === 'Import up to 500 leads at a time. Split the file.');
    assert.throws(() => CL.normalise([]), (e) => e.code === 'NO_ROWS'); assert.throws(() => CL.normalise(null), (e) => e.code === 'NO_ROWS');
    assert.strictEqual(CL.normalise(Array.from({ length: 500 }, (_, i) => ({ name: 'N' + i }))).length, 500);
  });
  await ita('plan: a phone the shop has → merge; a trader → Already a customer; a lead → Already a lead; a supplier → Already a supplier; a minted name → merge; a registered name → add', async () => {
    const rows = CL.normalise([{ name: 'New', phone: '9840000001' }, { name: 'Trader', phone: '9840000002' }, { name: 'Lead', phone: '9840000003' }, { name: 'Sup', phone: '9840000004' }, { name: 'Minted Name' }, { name: 'Registered Name' }]);
    CL.plan(rows, [
      { identity_id: 'x1', digits: '9840000001', name_fold: 'other', minted: true, on_customer: true, added_via: 'manual', txn_count: 0, supplier: false },
      { identity_id: 'x2', digits: '9840000002', name_fold: 'trader', minted: false, on_customer: true, added_via: 'manual', txn_count: 3, supplier: false },
      { identity_id: 'x3', digits: '9840000003', name_fold: 'lead', minted: true, on_customer: true, added_via: 'lead', txn_count: 0, supplier: false },
      { identity_id: 'x4', digits: '9840000004', name_fold: 'sup', minted: true, on_customer: false, added_via: null, txn_count: 0, supplier: true },
      { identity_id: 'x5', digits: null, name_fold: 'minted name', minted: true, on_customer: true, added_via: 'manual', txn_count: 0, supplier: false },
      { identity_id: 'x6', digits: null, name_fold: 'registered name', minted: false, on_customer: true, added_via: 'manual', txn_count: 0, supplier: false }]);
    assert.deepStrictEqual(rows.map((r) => r.outcome + (r.why ? ':' + r.why : '')), ['merge', 'skip:Already a customer', 'skip:Already a lead', 'skip:Already a supplier', 'merge', 'add']);
    assert.strictEqual(rows[0].party_id, 'x1');
    const s = CL.shape(rows, true); assert.strictEqual(s.added, 1); assert.strictEqual(s.merged, 2); assert.strictEqual(s.skipped.length, 3); assert.strictEqual(s.rows.length, 6); assert.strictEqual(s.dry, true);
  });

  /* ── the route, on the stub ──────────────────────────────────────────────────────────────────────────────────── */
  const ids = [{ identity_id: 'E1', user_id: 'acme', bridge_id: 'B1' }, { identity_id: P(5), user_id: '~acme.cus-0005', display_name: 'Old Minted', parent_entity_id: 'E1', otp_contact: null }];
  D.cust = [cs(row({ party_id: P(1), display_name: 'Regular Raj', user_id: 'rr', phone: '+919840000001' })),                    /* traded, by phone */
    cs(row({ party_id: P(2), display_name: 'Lead Lata', user_id: '~acme.cus-0002', otp_contact: '+919840000002' }), 'lead', 0),  /* a lead already */
    cs(row({ party_id: P(3), display_name: 'Manual Mani', user_id: '~acme.cus-0003', otp_contact: '+919840000003' }), 'manual', 0), /* no trade → merge */
    cs(row({ party_id: P(5), display_name: 'Old Minted', user_id: '~acme.cus-0005' }), 'manual', 0)];                         /* by minted name → merge */
  D.sup = [row({ party_id: P(4), display_name: 'Supplier Sam', user_id: 'ss', phone: '9840000004' })];
  const M = [], inserted = [], notes = [], numbered = []; let clRows = [];
  const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
  D.pre = async (sql, p) => {
    if (/^SELECT user_id, bridge_id FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: ids.filter((i) => i.identity_id === p[0]) };
    if (/^SELECT i\.identity_id, i\.display_name, i\.user_id, regexp_replace/.test(sql)) {
      const prefix = p[3].replace('%', '');
      const all = D.cust.filter((r) => r.owner === p[0]).map((r) => Object.assign({ _cust: true }, r)).concat(D.sup.filter((r) => r.owner === p[0]).map((r) => Object.assign({ _sup: true }, r)));
      const hit = all.filter((r) => p[1].indexOf(digits(r.otp_contact)) >= 0 || p[1].indexOf(digits(r.phone)) >= 0 || (r.user_id.startsWith(prefix) && p[2].indexOf(r.display_name.toLowerCase()) >= 0));
      return { rows: hit.map((r) => ({ identity_id: r.party_id, display_name: r.display_name, user_id: r.user_id, d1: digits(r.otp_contact), d2: digits(r.phone), minted: r.user_id.startsWith(prefix),
        on_customer: !!r._cust, added_via: r._cust ? r.added_via : null, txn_count: r._cust ? r.txn_count : 0, supplier: !!r._sup })) };
    }
    if (/^SELECT identity_id, bridge_id, display_name, user_id FROM identities WHERE parent_entity_id = \$1 AND user_id LIKE \$2 AND lower\(btrim\(display_name\)\) = ANY/.test(sql)) {
      return { rows: ids.filter((i) => i.parent_entity_id === p[0] && i.user_id.startsWith(p[1].replace('%', '')) && p[2].indexOf(String(i.display_name).toLowerCase()) >= 0) };
    }
    if (/^SELECT user_id FROM identities WHERE user_id LIKE \$1 ORDER BY length/.test(sql)) return { rows: ids.filter((i) => i.user_id.startsWith(p[0].replace('%', ''))).sort((a, b) => a.user_id.localeCompare(b.user_id)).slice(-1) };
    if (/^INSERT INTO identities \(bridge_id, display_name, user_id, identity_type, parent_entity_id, status, created_by, entity_kind\) SELECT/.test(sql)) {
      const out = p[1].map((b, i) => { const r = { identity_id: 'N' + (ids.length + i), bridge_id: b, display_name: p[2][i], user_id: p[3][i], parent_entity_id: p[0] }; return r; });
      out.forEach((r) => ids.push(r)); inserted.push(out.length); return { rows: out };
    }
    if (/^UPDATE identities i SET otp_contact = COALESCE/.test(sql)) { p[1].forEach((id, i) => { const r = ids.find((x) => x.identity_id === id && x.parent_entity_id === p[0]); if (r) { r.otp_contact = r.otp_contact || p[2][i]; r.city = r.city || p[3][i]; } }); return { rows: [] }; }
    if (/^INSERT INTO customer_list \(owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at, legal_name\) SELECT/.test(sql)) {
      const fresh = p[1].filter((id) => !D.cust.some((r) => r.owner === p[0] && r.party_id === id));
      fresh.forEach((id) => { const i = p[1].indexOf(id); const x = ids.find((y) => y.identity_id === id); D.cust.push(cs(row({ party_id: id, display_name: x.display_name, user_id: x.user_id, otp_contact: x.otp_contact || null, legal_name: p[2][i] }), 'lead', 0)); });
      clRows.push(fresh.length); return { rows: fresh.map((id) => ({ customer_identity_id: id })) };
    }
    if (/^UPDATE customer_list SET added_via = 'lead' WHERE/.test(sql)) { const done = []; D.cust.forEach((r) => { if (r.owner === p[0] && p[1].indexOf(r.party_id) >= 0 && r.txn_count === 0 && r.added_via !== 'lead') { r.added_via = 'lead'; done.push(r.party_id); } }); return { rows: done.map((id) => ({ customer_identity_id: id })) }; }
    if (/^SELECT customer_identity_id AS id FROM customer_list WHERE owner_entity_id = \$1 AND customer_identity_id = ANY/.test(sql)) return { rows: D.cust.filter((r) => r.owner === p[0] && p[1].indexOf(r.party_id) >= 0).map((r) => ({ id: r.party_id })) };
    if (/^INSERT INTO memberships \(entity_id, item_type, item_id, kind, grp, by_user_id\) SELECT/.test(sql)) { const out = p[4].map((id, i) => ({ membership_id: 'mm' + (M.length + i), entity_id: p[0], item_id: id, kind: p[2], grp: p[5][i], at: '2026-10-12T09:00:00.000Z' })); out.forEach((r) => M.push(r)); return { rows: out }; }
    if (/^SELECT DISTINCT ON \(item_id\)/.test(sql)) { const latest = new Map(); M.filter((m) => m.entity_id === p[0] && m.kind === p[1] && p[2].indexOf(m.item_id) >= 0).forEach((m) => latest.set(m.item_id, m)); return { rows: Array.from(latest.values()).map((m) => ({ item_id: m.item_id, grp: m.grp, at: m.at })) }; }
    if (/^INSERT INTO party_interaction \(owner_entity_id, party_id, kind, direction, body, at, by_user_id\) SELECT/.test(sql)) { p[1].forEach((id, i) => notes.push({ party_id: id, body: p[2][i] })); return { rows: [], rowCount: p[1].length }; }
    return null;
  };
  /* the stub replaces party-fields (it needs the sibling engines repo): the set-based numbering is answered here, and must be asked for the SET */
  require(path.join(API, 'lib/party-fields')).ensureNos = async (h, owner, list) => { numbered.push(list.length); return new Map(list.map((id, i) => [id, 'P-0010' + i])); };
  const FILE = [
    { name: 'Ravi Jewellers', phone: '+91 98400 12321', email: 'ravi@x.in', business: 'Ravi & Co', city: 'Madurai', source: 'Expo', note: 'Stall 4' },   /* add */
    { name: 'Regular Raj', phone: '98400 00001' },        /* a trader — same digits as "+919840000001"? no: the helper keeps what was typed → a new party */
    { name: 'Anyone', phone: '+91 9840000001' },          /* the trader's phone → Already a customer */
    { name: 'Lata Again', phone: '+919840000002' },       /* a lead's phone → Already a lead */
    { name: 'Mani New', phone: '+919840000003' },         /* a manual party, no trade → merge */
    { name: 'Sam', phone: '9840000004' },                  /* a supplier's phone → Already a supplier */
    { name: 'old minted' },                                /* the minted name → merge */
    { name: 'Ravi Jewellers', phone: '9000000000' },       /* same name as row 1 → skipped */
    { name: 'Dup Phone', phone: '+91 98400 12321' },       /* same phone as row 1 → skipped */
    { name: 'Bad Phone', phone: 'call me' },               /* bad phone */
    { name: '' },                                          /* no name */
  ];
  await ita('who may: a viewer login → 403 in words, nothing asked of the database', async () => {
    t.as('E1', { identity: { identity_id: 'A2', identity_type: 'actor', access_level: 'viewer' } });
    D.queries.length = 0; const r = await t.post('/leads/import', { rows: FILE });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'VIEW_ONLY'); assert.strictEqual(r.body.message, 'Only an editor can import leads.'); assert.strictEqual(D.queries.length, 0);
    t.as('E1', { identity: { identity_id: 'A1', identity_type: 'actor', access_level: 'editor' } });
    assert.notStrictEqual((await t.post('/leads/import', { rows: FILE, dry: true })).status, 403, 'an editor may');
    t.as('E1');
  });
  await ita('501 rows → 400 with the sentence; no rows → 400; an api key → 403', async () => {
    const r = await t.post('/leads/import', { rows: Array.from({ length: 501 }, (_, i) => ({ name: 'N' + i })) });
    assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'TOO_MANY'); assert.strictEqual(r.body.message, 'Import up to 500 leads at a time. Split the file.');
    assert.strictEqual((await t.post('/leads/import', {})).body.code, 'NO_ROWS');
    t.as('E1', { key: true }); assert.strictEqual((await t.post('/leads/import', { rows: FILE })).status, 403); t.as('E1');
  });
  await ita('dry: the plan — add · merge · skip with the reason per row — and NOTHING written', async () => {
    const n = { ids: ids.length, cust: D.cust.length, m: M.length }; D.queries.length = 0;
    const r = await t.post('/leads/import', { rows: FILE, dry: true });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.dry, true);
    assert.deepStrictEqual(r.body.rows.map((x) => x.outcome), ['add', 'add', 'skip', 'skip', 'merge', 'skip', 'merge', 'skip', 'skip', 'skip', 'skip']);
    assert.deepStrictEqual(r.body.skipped.map((x) => x.row + ':' + x.why), ['3:Already a customer', '4:Already a lead', '6:Already a supplier', '8:Same name as row 1', '9:Same phone as row 1', '10:Phone does not look right', '11:No name']);
    assert.strictEqual(r.body.added, 2); assert.strictEqual(r.body.merged, 2); assert.strictEqual(r.body.rows[4].party_id, P(3)); assert.strictEqual(r.body.rows[6].party_id, P(5));
    assert.strictEqual(ids.length, n.ids); assert.strictEqual(D.cust.length, n.cust); assert.strictEqual(M.length, n.m);
    assert.ok(!D.queries.some((q) => /^(INSERT|UPDATE)/.test(q)), 'a dry run writes nothing');
  });
  await ita('import: 201 — ONE identities insert, ONE customer_list insert, ONE memberships insert, ONE note insert, the number block asked ONCE for the set', async () => {
    D.queries.length = 0;
    const r = await t.post('/leads/import', { rows: FILE });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); assert.strictEqual(r.body.dry, false);
    assert.strictEqual(r.body.added, 2); assert.strictEqual(r.body.merged, 2); assert.strictEqual(r.body.skipped.length, 7);
    assert.deepStrictEqual(inserted, [2], 'the two new parties in one statement'); assert.deepStrictEqual(clRows, [2]); assert.deepStrictEqual(numbered, [2]);
    assert.strictEqual(D.queries.filter((q) => /^INSERT INTO identities/.test(q)).length, 1); assert.strictEqual(D.queries.filter((q) => /^INSERT INTO customer_list/.test(q)).length, 1);
    assert.strictEqual(D.queries.filter((q) => /^INSERT INTO memberships/.test(q)).length, 1); assert.strictEqual(D.queries.filter((q) => /^INSERT INTO party_interaction/.test(q)).length, 1);
    const ravi = ids.find((i) => i.display_name === 'Ravi Jewellers'); assert.ok(ravi && ravi.user_id === '~acme.cus-0006', 'minted after the top number'); assert.strictEqual(ravi.otp_contact, '+919840012321'); assert.strictEqual(ravi.city, 'Madurai');
    assert.strictEqual(D.cust.find((c) => c.party_id === ravi.identity_id).legal_name, 'Ravi & Co');
    assert.strictEqual(D.cust.find((c) => c.party_id === P(3)).added_via, 'lead', 'merged: the manual party is a lead now'); assert.strictEqual(D.cust.find((c) => c.party_id === P(5)).added_via, 'lead');
    assert.strictEqual(D.cust.find((c) => c.party_id === P(1)).added_via, 'manual', 'the trader is untouched');
    assert.deepStrictEqual(M.map((m) => m.item_id).sort(), [ravi.identity_id, ids.find((i) => i.display_name === 'Regular Raj' && i.parent_entity_id).identity_id, P(3), P(5)].sort(), 'a stage row for every added and merged party');
    assert.ok(M.every((m) => m.grp === 'lead' && m.entity_id === 'E1'));
    assert.deepStrictEqual(notes, [{ party_id: ravi.identity_id, body: 'Imported from Expo. Email ravi@x.in. Stall 4' }], 'email · source · note → one timeline note; a row with none gets none');
    const lv = (await t.get('/parties?view=leads')).body; assert.ok(lv.parties.some((p) => p.party_id === ravi.identity_id) && lv.parties.some((p) => p.party_id === P(3)), 'the Leads view lists them');
  });
  await ita('no per-row statements: 300 rows cost the same number of statements as 6', async () => {
    const run = async (n) => { D.queries.length = 0; const r = await t.post('/leads/import', { rows: Array.from({ length: n }, (_, i) => ({ name: 'Bulk ' + n + '-' + i, phone: '+9198' + String(10000000 + n * 1000 + i).slice(-8) })) }); assert.strictEqual(r.status, 201, JSON.stringify(r.body).slice(0, 200)); assert.strictEqual(r.body.added, n); return D.queries.length; };
    const six = await run(6), many = await run(300);
    assert.strictEqual(many, six, 'statements: ' + six + ' for 6, ' + many + ' for 300'); assert.ok(six < 20, 'a dozen statements, not hundreds (' + six + ')');
  });
  await ita('BEFORE b297: 503 LEADS_NOT_MIGRATED in words, nothing created (a dry run too)', async () => {
    state.table = false; const n = { ids: ids.length, cust: D.cust.length, m: M.length };
    const r = await t.post('/leads/import', { rows: FILE }); assert.strictEqual(r.status, 503); assert.strictEqual(r.body.code, 'LEADS_NOT_MIGRATED'); assert.strictEqual(r.body.message, 'Lead stages arrive after the next update.');
    assert.strictEqual((await t.post('/leads/import', { rows: FILE, dry: true })).status, 503);
    assert.strictEqual(ids.length, n.ids); assert.strictEqual(D.cust.length, n.cust); assert.strictEqual(M.length, n.m); state.table = true;
  });
  await ita('the widened seams: memberships.addMany refuses a party that is not this shop\'s (nothing inserted); mintMany answers each name', async () => {
    const MM = require(path.join(API, 'lib/memberships')); const n = M.length;
    await assert.rejects(() => MM.addMany({ query: (s, p) => D.pre(s.replace(/\s+/g, ' ').trim(), p) }, 'E1', { kind: 'lead_stage', items: [{ item_id: P(3), group: 'lead' }, { item_id: P(9), group: 'lead' }] }), (e) => e.code === 'NOT_FOUND');
    await assert.rejects(() => MM.addMany({ query: async () => ({ rows: [] }) }, 'E1', { kind: 'lead_stage', items: [{ item_id: P(3), group: 'customer' }] }), (e) => e.code === 'BAD_GROUP');
    assert.strictEqual(M.length, n);
    const L = require(path.join(API, 'lib/local-identity'));
    const m = await L.mintMany('E1', ['Fresh One', '', 'x@y.z', 'fresh  one', 'Old Minted'], { query: (s, p) => D.pre(s.replace(/\s+/g, ' ').trim(), p), kind: 'cus' });
    assert.strictEqual(m.rows[0].created, true); assert.ok(/^~acme\.cus-\d{4}$/.test(m.rows[0].user_id)); assert.strictEqual(m.rows[1].error, 'Give them a name'); assert.ok(/email/.test(m.rows[2].error));
    assert.strictEqual(m.rows[3].created, false); assert.strictEqual(m.rows[3].identity_id, m.rows[0].identity_id, 'the same name twice in the list is one row');
    assert.strictEqual(m.rows[4].created, false); assert.strictEqual(m.rows[4].identity_id, P(5), 'a name already minted finds its row');
  });
  /* guards.cjs counts the LAST "<n> checks" line; a guard that counts nothing reads as 0 and FAILS */
  console.log('\n' + pass + ' checks'); t.close();
})();
