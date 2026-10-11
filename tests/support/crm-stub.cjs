/**
 * tests/support/crm-stub.cjs — the offline stand-in for CB CRM's tests: an in-memory database that recognises the CRM's statements
 * by their text, the real router, and the real lib/crm · lib/crm-followups. Nothing here needs Postgres, a network or the Ledger engines.
 *   const t = require('./support/crm-stub.cjs').make();  t.data (tables) · t.as(entity, opts) · t.get/post/patch/del(path, body) · t.close()
 * The party-fields decorator is the one thing replaced: it fills in the Ledger's STORED figures from t.data.stored (the real one
 * needs the sibling engines repo), which is exactly what the tests then compare the API's answer with.
 */
'use strict';
const path = require('path'), http = require('http');
const API = path.join(__dirname, '..', '..');
process.env.DATABASE_URL = ''; process.env.NODE_ENV = 'test';
const stub = (rel, exports) => { const p = require.resolve(path.join(API, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };

function make() {
  const data = {
    cust: [], sup: [], walk: [], stored: { customer: {}, supplier: {} }, chits: [], messages: [], disputes: [], ledger: [], changes: [],
    interactions: [], followups: [], migrated: true, hvMissing: false, hiddenColumn: true, team: ['E1', 'A1', 'A2'], country: null, points: null,
    queries: [], appended: [],
  };
  let seq = 0; const uid = () => '00000000-0000-4000-8000-' + String(++seq).padStart(12, '0');
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const gone = (what) => { const e = new Error('relation "' + what + '" does not exist'); e.code = '42P01'; return e; };

  async function run(sqlRaw, p) {
    const sql = norm(sqlRaw); p = p || []; data.queries.push(sql); if (data.pre) { const x = await data.pre(sql, p); if (x) return x; }
    if (/to_jsonb\(i\)->'policy_flags'->'crm'/.test(sql)) return { rows: [{ crm: data.rule || null }] };
    if (/FROM customer_list cl JOIN identities i/.test(sql)) {
      if (/party_item/.test(sql) && data.hvMissing) throw gone('party_item');
      return { rows: data.cust.filter((r) => r.owner === p[0] && (!p[1] || r.party_id === p[1])).map((r) => Object.assign({}, r)) };
    }
    if (/FROM supplier_list sl JOIN identities i/.test(sql)) return { rows: data.sup.filter((r) => r.owner === p[0] && (!p[1] || r.party_id === p[1])).map((r) => Object.assign({}, r)) };
    if (/FROM reward_ledger/.test(sql)) return { rows: data.walk.filter((r) => r.owner === p[0]) };
    if (/to_regclass\('party_interaction'\)/.test(sql)) return { rows: [{ i: data.migrated, f: data.migrated }] };
    if (/FROM books_setting/.test(sql)) return { rows: data.country ? [{ country: data.country, enabled: true }] : [] };
    /* the Ledger-side reads of the timeline */
    if (/FROM party_item/.test(sql)) return { rows: data.ledger.filter((r) => r.entity === p[0] && r.party_id === p[1] && r.created_at < p[2]).slice(0, p[3]) };
    if (/FROM books_change_log/.test(sql)) return { rows: data.changes.filter((r) => r.entity === p[0] && r.row_id === p[1] && r.at < p[2]).slice(0, p[3]) };
    if (/FROM chit_messages/.test(sql)) return { rows: data.messages.filter((m) => p[0].indexOf(m.chit_id) >= 0 && m.created_at < p[1]) };
    if (/FROM chit_disputes/.test(sql)) return { rows: data.disputes.filter((d) => p[0].indexOf(d.chit_id) >= 0) };
    /* b276 tables */
    if (/^SELECT interaction_id, kind, direction, body, at, by_user_id FROM party_interaction/.test(sql)) {
      if (!data.migrated) throw gone('party_interaction');
      return { rows: data.interactions.filter((r) => r.owner === p[0] && r.party_id === p[1] && r.at < p[2]).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, p[3]) };
    }
    if (/^INSERT INTO party_interaction/.test(sql)) {
      if (!data.migrated) throw gone('party_interaction');
      const r = { interaction_id: uid(), owner: p[0], party_id: p[1], kind: p[2], direction: p[3], body: p[4], at: p[5], by_user_id: p[6], created_at: new Date().toISOString() };
      data.interactions.push(r); return { rows: [r] };
    }
    if (/FROM party_followup WHERE owner_entity_id = \$1 AND party_id = \$2 ORDER BY created_at/.test(sql)) {
      if (!data.migrated) throw gone('party_followup');
      return { rows: data.followups.filter((r) => r.owner === p[0] && r.party_id === p[1]) };
    }
    if (/^SELECT f\.followup_id/.test(sql)) {
      if (!data.migrated) throw gone('party_followup');
      let rows = data.followups.filter((r) => r.owner === p[0]);
      if (/f\.followup_id = \$2/.test(sql)) rows = rows.filter((r) => r.followup_id === p[1]);
      else {
        rows = rows.filter((r) => (/f\.done_at IS NOT NULL/.test(sql) ? !!r.done_at : !r.done_at));
        const m = sql.match(/f\.assignee_user_id = \$(\d+)/); if (m) rows = rows.filter((r) => r.assignee_user_id === p[m[1] - 1]);
        const q = sql.match(/f\.party_id = \$(\d+)/); if (q) rows = rows.filter((r) => r.party_id === p[q[1] - 1]);
        rows = rows.slice().sort((a, b) => (a.due_at < b.due_at ? -1 : 1));
      }
      return { rows: rows.map((r) => Object.assign({ party_name: 'Name of ' + r.party_id.slice(-4), assignee_name: 'Who ' + r.assignee_user_id }, r)) };
    }
    if (/^SELECT cl\.customer_identity_id AS pid/.test(sql)) return { rows: data.cust.filter((r) => r.owner === p[0] && p[1].indexOf(r.party_id) >= 0).map((r) => ({ pid: r.party_id, party_no: 'P-' + r.party_id.slice(-4), live: !r.hidden_at && !r.merged_into })) };
    if (/^SELECT sl\.supplier_entity_id AS pid/.test(sql)) return { rows: data.sup.filter((r) => r.owner === p[0] && p[1].indexOf(r.party_id) >= 0).map((r) => ({ pid: r.party_id, party_no: 'P-' + r.party_id.slice(-4), live: !r.hidden_at && !r.merged_into })) };
    if (/^SELECT 1 FROM identities WHERE identity_id = \$1 AND \(identity_id = \$2/.test(sql)) return { rows: data.team.indexOf(p[0]) >= 0 && p[1] === 'E1' ? [{ '?column?': 1 }] : [] };
    if (/^INSERT INTO party_followup/.test(sql)) {
      if (!data.migrated) throw gone('party_followup');
      const r = { followup_id: uid(), owner: p[0], party_id: p[1], what: p[2], due_at: p[3], assignee_user_id: p[4], source: p[5], done_at: null, done_by: null, bell_day: null, created_at: new Date().toISOString() };
      data.followups.push(r); return { rows: [{ followup_id: r.followup_id }] };
    }
    if (/^UPDATE party_followup SET bell_day = \$2::date/.test(sql)) { data.followups.forEach((r) => { if (p[2].indexOf(r.followup_id) >= 0) r.bell_day = p[1]; }); return { rows: [] }; }
    if (/^UPDATE party_followup SET/.test(sql)) {
      const r = data.followups.find((x) => x.owner === p[0] && x.followup_id === p[1]);
      sql.replace(/^UPDATE party_followup SET (.*) WHERE.*$/, '$1').split(', ').forEach((a) => {
        const m = a.match(/^(\w+) = (\$(\d+)|now\(\)|NULL)$/); if (!m) throw new Error('unexpected SET ' + a);
        r[m[1]] = m[2] === 'now()' ? new Date().toISOString() : m[2] === 'NULL' ? null : p[m[3] - 1];
      });
      return { rows: [] };
    }
    if (/^DELETE FROM party_followup/.test(sql)) { const i = data.followups.findIndex((x) => x.owner === p[0] && x.followup_id === p[1]); if (i < 0) return { rows: [] }; data.followups.splice(i, 1); return { rows: [{ followup_id: p[1] }] }; }
    if (/^SELECT assignee_user_id, due_at, followup_id FROM party_followup/.test(sql)) {
      const end = p[1], today = p[2];
      return { rows: data.followups.filter((r) => r.owner === p[0] && !r.done_at && r.due_at < end && r.bell_day !== today) };
    }
    if (/^SELECT owner_entity_id FROM ops\.f_crm_followup_entities/.test(sql)) { if (!data.migrated) { const e = new Error('function ops.f_crm_followup_entities() does not exist'); e.code = '42883'; throw e; } }
    if (/^SELECT owner_entity_id FROM ops\.f_crm_followup_entities/.test(sql)) return { rows: Array.from(new Set(data.followups.filter((r) => !r.done_at).map((r) => ({ owner_entity_id: r.owner })).map((x) => x.owner_entity_id))).map((x) => ({ owner_entity_id: x })) };
    /* lists */
    if (/EXISTS \(SELECT 1 FROM customer_list WHERE owner_entity_id = \$1 AND customer_identity_id = \$2\) AS customer/.test(sql)) {
      return { rows: [{ customer: data.cust.some((r) => r.owner === p[0] && r.party_id === p[1]), supplier: data.sup.some((r) => r.owner === p[0] && r.party_id === p[1]) }] };
    }
    if (/^UPDATE customer_list SET hidden_at/.test(sql)) {
      if (!data.hiddenColumn) { const e = new Error('column "hidden_at" of relation "customer_list" does not exist'); e.code = '42703'; throw e; }
      data.cust.forEach((r) => { if (r.owner === p[0] && r.party_id === p[1] && !r.hidden_at) r.hidden_at = new Date().toISOString(); }); return { rows: [] };
    }
    if (/^UPDATE supplier_list SET hidden_at/.test(sql)) { data.sup.forEach((r) => { if (r.owner === p[0] && r.party_id === p[1] && !r.hidden_at) r.hidden_at = new Date().toISOString(); }); return { rows: [] }; }
    if (/^SELECT country FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [{ country: data.country || 'IN' }] };   /* the shop's day, for what is late */
    if (data.extra) { const x = await data.extra(sql, p); if (x) return x; }
    throw new Error('crm-stub: unexpected SQL: ' + sql.slice(0, 120));
  }
  const handle = { query: run };
  const trySavepoint = async (h, fn, fb) => { try { return await fn(); } catch (_) { return fb; } };
  stub('db', { query: run, withEntity: async (o, fn) => fn(handle), trySavepoint, withTransaction: async (fn) => fn(handle) });

  /* the Ledger's stored figures, handed back the way party-fields.decorate would (ledger on = balance_minor present) */
  stub('lib/party-fields', {
    SCHEMES: ['GSTIN', 'PAN'], ensureNo: async () => 'P-00099',
    decorate: async (withEntity, owner, rows, idKey, side) => {
      for (const r of rows) { const s = data.stored[side][String(r[idKey])] || {};
        Object.assign(r, { party_no: s.party_no || null, legal_name: s.legal_name || null, credit_days: s.credit_days == null ? null : s.credit_days, credit_limit_minor: null, state_code: s.state_code || null, merged_into: null, tax_ids: s.tax_ids || [] });
        if (side === 'customer') r.nickname = s.nickname || null;
        if (data.ledgerOn !== false) { r.balance_minor = s.balance_minor || 0; r.oldest_due = s.oldest_due || null; } }
      return rows;
    } });
  stub('lib/select', { rows: async (owner, sel) => data.chits.filter((c) => c.counterparty_id === sel.counterparty_id) });
  stub('lib/policy', { get: async () => ({ overdue_days: 7 }) });
  stub('lib/reward-store', { balance: async () => data.points || { programme: null, points: 0, worth: 0, entries: [] }, append: async (o, holder, e, def) => { data.appended.push({ owner: o, holder, entry: e, def }); }, holderFrom: () => null });

  const ref = { entity: 'E1', identity: null, api_key: false };
  const authFn = (req, res, next) => { req.identity = ref.identity || { identity_id: ref.entity }; if (ref.api_key) req.api_key = true; next(); };
  authFn.entityOf = () => ref.entity;
  stub('middleware/auth', authFn);

  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/', require(path.join(API, 'routes', 'crm.js')));
  const srv = app.listen(0); const port = srv.address().port;
  function call(method, p, body) {
    return new Promise((resolve, reject) => {
      const d = body == null ? null : JSON.stringify(body);
      const r = http.request({ port, method, path: p, headers: d ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d) } : {} },
        (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : {} })); });
      r.on('error', reject); r.end(d || undefined);
    });
  }
  return {
    data, port, close: () => srv.close(), uid,
    as(entity, o) { ref.entity = entity; ref.api_key = !!(o && o.key); ref.identity = (o && o.identity) || { identity_id: entity }; },
    get: (p) => call('GET', p), post: (p, b) => call('POST', p, b || {}), patch: (p, b) => call('PATCH', p, b || {}), del: (p) => call('DELETE', p),
  };
}

/** a list row as the SQL would return it (the flags already computed by the database) */
function row(o) {
  return Object.assign({ owner: 'E1', party_id: null, display_name: 'X', user_id: 'x', bridge_id: 'CBX', email: null, phone: null, otp_contact: null, gstn: null, status: 'active',
    entity_kind: 'customer', city: null, on_rail: true, same_world: true, merged_into: null, hidden_at: null, party_no: null }, o);
}
module.exports = { make, row };
