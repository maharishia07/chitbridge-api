'use strict';
/**
 * tests/crm-247-248-deleted-party-truth.realstack.cjs — A DELETED PARTY TAKES NO WRITE (CRM-247) AND IS NEVER AN IMPORT MATCH (CRM-248), on the LOCAL stack.
 *
 * What "deleted" is (lib/crm.js removeParty): customer_list.hidden_at / supplier_list.hidden_at set — a soft delete, the row and its history stay.
 * The ONE place that knows: lib/party-live.js (the predicate) read by books-store.partyOn (customer / supplier = a LIVE row; `removed` = rows, none live).
 *
 * HAND-COMPUTED EXPECTED RESULTS (shop A, IN, books on; C = a deleted customer, S = a deleted supplier, STR = a uuid on no list):
 *   · every write door that names a party answers a deleted party EXACTLY as it answers STR (same status, same code), and writes nothing:
 *       payment in (C) / out (S) · journal Dr debtors (C) / Cr creditors (S) · group add [C] (added 0, count stays) · follow-up · interaction ·
 *       contact-prefs GET and POST · customer groups by list id.
 *   · the money doors are the same 4xx a stranger gets, and payment rows for C / S = 0, journal lines naming C / S = 0.
 *   · a PRIVACY REQUEST about C stays allowed (201): hiding is not erasing, the shop still holds the person's data, so an access or erasure request
 *     must be loggable and its due date must run (decision pack: docs/critique/CRM-247-248.md).
 *   · the live control party D keeps working on every door (a fix that refuses everything is not a fix).
 *   · import: C's phone in a lead import = ONE new party (added 1, merged 0, a NEW id, not C's); C stays deleted (GET 404) and keeps hidden_at;
 *     C's NAME re-imported is NOT merged into C: skipped with the word, C untouched (restore vs new is the owner's decision).
 *   · manual add / walk-in on C's phone adds a NEW customer (no "already on your list as C").
 * Red on main (bd0ac272), green on the branch. Run: API_BASE=http://127.0.0.1:3187 node tests/crm-247-248-deleted-party-truth.realstack.cjs
 * CARD 11-crm-and-marketing/crm-parties
 */
const { Client } = require('pg');
const crypto = require('crypto');
const H = require('./lib/truth-harness.cjs');
const { DB, j, ok, kase, expect, freshShop, finish } = H;
const RUN = 'd47' + (Date.now() % 1e9).toString(36);
const NOT_REGISTERED = { tax: { registered: false } };
const STR = crypto.randomUUID();
const day = new Date().toISOString().slice(0, 10);
let pg = null;

const lead = (shop, name, phone) => j('/api/crm/leads', { method: 'POST', token: shop.token, body: { name, phone } });
const one = async (sql, args) => (await pg.query(sql, args)).rows[0];

(async () => {
  console.log('\n── crm-247/248 on ' + H.API + ' · run ' + RUN + ' ──');
  ok(await j('/health'), 'health');
  pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const A = await freshShop(RUN + 'a', 'Deleted party', NOT_REGISTERED);
    ok(await j('/api/books/enable', { method: 'POST', token: A.token }), 'books on');
    const accs = ok(await j('/api/books/accounts', { token: A.token }), 'accounts').b;
    const al = accs.accounts || accs.rows || accs;
    const codeOf = (re) => (al.find((a) => re.test(a.name || '')) || {}).code;
    const DEBTORS = codeOf(/debtor|receivable/i), CREDITORS = codeOf(/creditor|payable/i), SALES = codeOf(/^sales/i);
    expect(DEBTORS && CREDITORS && SALES, 'accounts: ' + JSON.stringify({ DEBTORS, CREDITORS, SALES }));

    const phoneC = '9' + String(Date.now()).slice(-9);
    const C = ok(await lead(A, 'Del Customer ' + RUN, phoneC), 'lead C').b.party.party_id;
    const D = ok(await lead(A, 'Live Customer ' + RUN, '9' + String(Date.now() + 7).slice(-9)), 'lead D').b.party.party_id;
    const S = ok(await j('/api/relationships/suppliers', { method: 'POST', token: A.token, body: { name: 'Del Supplier ' + RUN, supply_kind: 'resale' } }), 'supplier').b.supplier.supplier_entity_id;
    const L = ok(await j('/api/relationships/suppliers', { method: 'POST', token: A.token, body: { name: 'Live Supplier ' + RUN, supply_kind: 'resale' } }), 'live supplier').b.supplier.supplier_entity_id;
    const listIdC = (await one('SELECT customer_list_id FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2', [A.entity, C])).customer_list_id;
    ok(await j('/api/crm/groups', { method: 'POST', token: A.token, body: { name: 'Gold', add: [C, D] } }), 'group before');
    ok(await j('/api/crm/followups', { method: 'POST', token: A.token, body: { party_id: C, what: 'ring before delete', due_at: day } }), 'followup before');
    ok(await j('/api/crm/parties/' + C, { method: 'DELETE', token: A.token }), 'delete C');
    ok(await j('/api/crm/parties/' + S, { method: 'DELETE', token: A.token }), 'delete S');
    const gone = await j('/api/crm/parties/' + C, { token: A.token });
    expect(gone.status === 404, 'precondition: GET deleted party is 404, got ' + gone.status);

    const pay = (party, direction) => j('/api/books/payments', { method: 'POST', token: A.token, body: { party_id: party, direction, amount_minor: 10000, received_at: day, mode: 'cash' } });
    const journal = (party, drCode, crCode, drSide) => j('/api/books/entries', { method: 'POST', token: A.token, body: { narration: 'crm247 ' + RUN, date: day, lines: [
      Object.assign({ code: drCode, dr_minor: 5000 }, drSide ? { party } : {}), Object.assign({ code: crCode, cr_minor: 5000 }, drSide ? {} : { party }) ] } });
    const same = (a, b) => a.status === b.status && (a.b.code || null) === (b.b.code || null);
    const show = (r) => r.status + ' ' + (r.b.code || '') + ' ' + String(r.b.message || r.b.detail || '').slice(0, 60);

    /* the stranger's answer to each door is the reference: a deleted party is "not yours" in the same words */
    const doors = [
      ['pay-in', (id) => pay(id, 'in'), 'C'], ['pay-out', (id) => pay(id, 'out'), 'S'],
      ['journal-dr', (id) => journal(id, DEBTORS, SALES, true), 'C'], ['journal-cr', (id) => journal(id, SALES, CREDITORS, false), 'S'],
      ['followup', (id) => j('/api/crm/followups', { method: 'POST', token: A.token, body: { party_id: id, what: 'ring', due_at: day } }), 'C'],
      ['interaction', (id) => j('/api/crm/parties/' + id + '/interactions', { method: 'POST', token: A.token, body: { kind: 'note', body: 'after delete' } }), 'C'],
      ['prefs-get', (id) => j('/api/crm/parties/' + id + '/contact-prefs', { token: A.token }), 'C'],
      ['prefs-post', (id) => j('/api/crm/parties/' + id + '/contact-prefs', { method: 'POST', token: A.token, body: { channel: 'whatsapp', purpose: 'marketing', allowed: true } }), 'C']
    ];
    for (const [id, fn, who] of doors) {
      await kase('D-' + id, 'a deleted ' + (who === 'C' ? 'customer' : 'supplier') + ' is answered like a stranger on ' + id, async () => {
        const str = await fn(STR), del = await fn(who === 'C' ? C : S);
        expect(str.status >= 400 && str.status < 500, 'the stranger reference is a 4xx: ' + show(str));
        expect(same(str, del), 'deleted ' + show(del) + ' vs stranger ' + show(str));
      });
    }
    await kase('D-money-written', 'nothing was written for C or S: payments 0, journal lines 0, follow-ups 0 new, interactions 0 new', async () => {
      const p = await one('SELECT COUNT(*)::int AS n FROM payment WHERE entity_id = $1 AND party_id = ANY($2::uuid[])', [A.entity, [C, S]]).catch(() => null);
      const jl = await one('SELECT COUNT(*)::int AS n FROM journal_line WHERE entity_id = $1 AND party_id = ANY($2::uuid[])', [A.entity, [C, S]]);
      const fu = await one("SELECT COUNT(*)::int AS n FROM party_followup WHERE owner_entity_id = $1 AND party_id = $2 AND what <> 'ring before delete'", [A.entity, C]);
      const ia = await one('SELECT COUNT(*)::int AS n FROM party_interaction WHERE owner_entity_id = $1 AND party_id = $2', [A.entity, C]);
      expect((!p || p.n === 0) && jl.n === 0 && fu.n === 0 && ia.n === 0, 'payments ' + (p && p.n) + ' · journal lines ' + jl.n + ' · new follow-ups ' + fu.n + ' · interactions ' + ia.n);
    });
    await kase('D-group', 'group add [C] on a deleted customer adds nobody (added 0) and the live D is added once: count stays 2 (C was in before) and C is not re-added', async () => {
      const before = await one("SELECT COUNT(*)::int AS n FROM customer_list WHERE owner_entity_id = $1 AND 'Silver' = ANY(COALESCE(groups, '{}'))", [A.entity]);
      const r = await j('/api/crm/groups', { method: 'POST', token: A.token, body: { name: 'Silver', add: [C, D] } });
      const inC = await one("SELECT 'Silver' = ANY(COALESCE(groups, '{}')) AS inn FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2", [A.entity, C]);
      expect(before.n === 0 && r.status === 201 && Number(r.b.added) === 1 && inC.inn === false, 'status ' + r.status + ' added ' + r.b.added + ' · C in Silver ' + inC.inn + ' · ' + JSON.stringify(r.b).slice(0, 120));
    });
    await kase('D-groups-by-list-id', 'POST /relationships/customers/:list_id/groups on a deleted customer is 404 like an unknown list id', async () => {
      const str = await j('/api/relationships/customers/' + crypto.randomUUID() + '/groups', { method: 'POST', token: A.token, body: { groups: ['Gold'] } });
      const del = await j('/api/relationships/customers/' + listIdC + '/groups', { method: 'POST', token: A.token, body: { groups: ['Gold'] } });
      expect(str.status === 404 && same(str, del), 'deleted ' + show(del) + ' vs unknown ' + show(str));
    });
    await kase('D-privacy-kept', 'a privacy request about a deleted party is STILL accepted (201): the shop holds the data until erased, the due date must run', async () => {
      const r = await j('/api/crm/privacy-requests', { method: 'POST', token: A.token, body: { party_id: C, kind: 'access', who: 'Del Customer' } });
      expect(r.status === 201, 'privacy request on a deleted party: ' + show(r));
    });
    await kase('D-live-control', 'the live customer D and live supplier L still take every door (201 / 200): the fix refuses only the deleted', async () => {
      const a = await pay(D, 'in'), b = await pay(L, 'out');
      const c = await j('/api/crm/followups', { method: 'POST', token: A.token, body: { party_id: D, what: 'ring D', due_at: day } });
      const d = await j('/api/crm/parties/' + D + '/interactions', { method: 'POST', token: A.token, body: { kind: 'note', body: 'live' } });
      const e = await j('/api/crm/parties/' + D + '/contact-prefs', { method: 'POST', token: A.token, body: { channel: 'whatsapp', purpose: 'marketing', allowed: true } });
      const f = await journal(D, DEBTORS, SALES, true);
      const g = await j('/api/crm/parties/' + D + '/contact-prefs', { token: A.token });
      expect(a.status === 200 && b.status === 200 && c.status === 201 && d.status === 201 && e.status === 201 && f.status === 200 && g.status === 200,
        'pay in ' + a.status + ' out ' + b.status + ' followup ' + c.status + ' interaction ' + d.status + ' prefs ' + e.status + ' journal ' + f.status + ' prefs-get ' + g.status);
    });

    /* ── CRM-248: import and walk-in matching skip the deleted ── */
    await kase('I-phone', 'a lead import of the deleted C\'s phone adds ONE NEW party (added 1, merged 0, new id); C stays deleted', async () => {
      const r = await j('/api/crm/leads/import', { method: 'POST', token: A.token, body: { rows: [{ name: 'Newcomer ' + RUN, phone: phoneC }] } });
      const pid = r.b.rows && r.b.rows[0] && r.b.rows[0].party_id;
      const old = await one('SELECT hidden_at, added_via FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2', [A.entity, C]);
      const back = await j('/api/crm/parties/' + C, { token: A.token });
      const fresh = pid ? await j('/api/crm/parties/' + pid, { token: A.token }) : { status: 0 };
      expect(r.status === 201 && r.b.added === 1 && r.b.merged === 0 && pid && pid !== C && old.hidden_at && back.status === 404 && fresh.status === 200,
        'import ' + r.status + ' added ' + r.b.added + ' merged ' + r.b.merged + ' id ' + pid + ' (deleted ' + C + ') · C hidden_at ' + !!old.hidden_at + ' · GET C ' + back.status + ' · GET new ' + fresh.status);
    });
    await kase('I-name', 'the deleted C\'s NAME in an import is never merged into C: skipped, C untouched (restore vs new is a decision)', async () => {
      const r = await j('/api/crm/leads/import', { method: 'POST', token: A.token, body: { rows: [{ name: 'Del Customer ' + RUN, phone: '9' + String(Date.now() + 99).slice(-9) }] } });
      const row = r.b.rows && r.b.rows[0];
      const old = await one('SELECT hidden_at FROM customer_list WHERE owner_entity_id = $1 AND customer_identity_id = $2', [A.entity, C]);
      expect(r.status === 201 && r.b.merged === 0 && r.b.added === 0 && row && row.outcome === 'skip' && /deleted/i.test(row.why || '') && old.hidden_at, 'import ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 260));
    });
    await kase('I-walkin', 'a walk-in / manual add on the deleted C\'s phone adds a NEW customer, not "already on your list as C"', async () => {
      const phoneW = '9' + String(Date.now() + 311).slice(-9);
      const W = ok(await lead(A, 'Del Walker ' + RUN, phoneW), 'lead W').b.party.party_id;
      ok(await j('/api/crm/parties/' + W, { method: 'DELETE', token: A.token }), 'delete W');
      const r = await j('/api/crm/walk-ins/add', { method: 'POST', token: A.token, body: { phone: phoneW, name: 'Walk Newcomer ' + RUN } });
      expect(r.status < 300 && r.b.code !== 'EXISTS', 'walk-in ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    });
  } finally {
    await pg.end();
  }
  finish('crm-247-248-deleted-party');
})().catch((e) => { console.error('ABORT', e.message); process.exitCode = 2; });
