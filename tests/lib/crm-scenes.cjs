'use strict';
/**
 * crm-scenes.cjs — the world and the scenes of tests/api-problem-crm.test.cjs (API-4 sweep, routes/crm.js, 24 routes).
 *
 * OWNS      the in-memory world the CRM routes run in for the sweep test (the shop's parties, follow-ups, the leads table, the consent and request tables, the
 *           group column), the sign-ins a scenario can ask as (owner, staff, viewer, commenter, another shop, a key, nobody) and every named scene (a refusal or an answer
 *           the generic worlds cannot reach). The routes and the libraries under them are the REAL ones; only the database is a stand-in (tests/support/crm-stub.cjs).
 * CALLED BY tests/api-problem-crm.test.cjs.
 * FLOW      world(stub) → seed() per scenario → before(scenario) sets the sign-in and the database state → the request → the scene's expected status
 * CARD      11-crm-and-marketing/crm-routes
 */
const path = require('path');
const API = path.join(__dirname, '..', '..');

const P = (n) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const SECRET_SQL = 'relation "party_followup" does not exist -- SELECT secret FROM vault';
const SHOP = 'E1';
const OTHER_SHOP = 'E2';
const day = (n) => new Date(Date.now() + n * 86400000).toISOString();
/** the parties of the seed: a customer who trades, a lead, a plain customer, a supplier, and a customer of ANOTHER shop (the foreign id) */
const IDS = { chola: P(2), lead: P(3), plain: P(4), agro: P(1), foreign: P(9), unknown: P(99) };

/** the sign-ins a scenario can ask as: { entity, identity } for crm-stub's as() */
const LOGINS = {
  owner: { entity: SHOP, identity: { identity_id: SHOP, identity_type: 'entity', display_name: 'Test shop' } },
  staff: { entity: SHOP, identity: { identity_id: 'A1', identity_type: 'actor', parent_entity_id: SHOP, access_level: 'editor', display_name: 'Test staff' } },
  viewer: { entity: SHOP, identity: { identity_id: 'A2', identity_type: 'actor', parent_entity_id: SHOP, access_level: 'viewer', display_name: 'Test viewer' } },
  commenter: { entity: SHOP, identity: { identity_id: 'A3', identity_type: 'actor', parent_entity_id: SHOP, access_level: 'commenter', display_name: 'Test commenter' } },
  stranger: { entity: OTHER_SHOP, identity: { identity_id: OTHER_SHOP, identity_type: 'entity', display_name: 'Other shop' } }
};

/** the state of the tables a scenario can switch off (a migration not run) */
const FRESH_WORLD = () => ({ leads: true, prefs: true, requests: true, groups: true, requestRows: [], prefRows: [], members: [], minted: [] });

function seed(D, W, row) {
  const cs = (r, o) => Object.assign(r, { customer_type: 'entity', added_via: 'manual', txn_count: 4, last_txn_at: '2026-09-30T10:00:00Z', groups: ['Dealers'], segment: 'regular', segment_override: null }, o);
  const ss = (r, o) => Object.assign(r, { category: 'Raw', preferred: false, supply_kind: 'goods', added_via: 'manual' }, o);
  const chola = row({ party_id: IDS.chola, display_name: 'Chola Auto Care', user_id: 'chola', party_no: 'P-0002', phone: '+919840000002' });
  const lead = row({ party_id: IDS.lead, display_name: 'Lead Lata', user_id: '~shop.cus-0003', on_rail: false, party_no: 'P-0003', phone: '+919840000003' });
  const plain = row({ party_id: IDS.plain, display_name: 'Plain Pillai', user_id: '~shop.cus-0004', on_rail: false, party_no: 'P-0004' });
  const agro = row({ party_id: IDS.agro, display_name: 'Agro Mills', user_id: 'agromills', party_no: 'P-0001' });
  const abroad = row({ party_id: IDS.foreign, display_name: 'Foreign Farid', user_id: 'farid', party_no: 'P-0009', owner: OTHER_SHOP });
  Object.assign(D, {
    cust: [cs(chola), cs(lead, { added_via: 'lead', txn_count: 0, groups: [], segment: 'new' }), cs(plain, { txn_count: 0, groups: [] }), cs(abroad, { groups: [] })],
    sup: [ss(agro)],
    walk: [{ owner: SHOP, phone: '+919840012321', points: '120', last_at: '2026-09-29T00:00:00Z' }],
    stored: { customer: { [IDS.chola]: { party_no: 'P-0002', balance_minor: 100000, oldest_due: '2026-09-01' } }, supplier: {} },
    chits: [], messages: [], disputes: [], ledger: [], changes: [],
    interactions: [{ owner: SHOP, party_id: IDS.chola, interaction_id: 'i1', kind: 'call', direction: 'out', body: 'Asked about payment', at: '2026-09-08T00:00:00.000Z', by_user_id: SHOP }],
    followups: [
      { owner: SHOP, party_id: IDS.chola, followup_id: P(21), what: 'Call back', due_at: day(-2), created_at: '2026-09-08T01:00:00.000Z', done_at: null, assignee_user_id: SHOP, source: 'manual' },
      { owner: OTHER_SHOP, party_id: IDS.foreign, followup_id: P(29), what: 'Not yours', due_at: day(1), created_at: '2026-09-08T01:00:00.000Z', done_at: null, assignee_user_id: OTHER_SHOP, source: 'manual' }
    ],
    migrated: true, team: [SHOP, 'A1', 'A2', 'A3'], country: null, points: null, memberships: [], queries: [], appended: [], pre: null, shopCountry: 'IN',
    hiddenColumn: true, ledgerOn: true
  });
}

/** the statements beyond crm-stub's own: the leads table, consent, requests, the mint, the group column, the call queue — answered from the world W */
function extraOf(D, W) {
  const ids = [{ identity_id: SHOP, user_id: 'acme', bridge_id: 'B1', display_name: 'Test shop' }];
  const cs = (r, o) => Object.assign(r, { customer_type: 'entity', added_via: 'manual', txn_count: 0, last_txn_at: null, groups: [], segment: 'new' }, o);
  const gone = (what) => Object.assign(new Error('relation "' + what + '" does not exist'), { code: '42P01' });
  let n = 0;
  const uid = () => '30000000-0000-4000-8000-' + String(++n).padStart(12, '0');
  const request = (p) => ({ request_id: uid(), owner: p[0], party_id: p[1], who: p[2], kind: p[3], country: p[4], received_at: p[5], due_at: p[6], created_by: p[7], answered_at: null, outcome: null, answer: null });
  return async (sql, p) => {
    if (/FROM identities WHERE parent_entity_id = \$1 AND user_id LIKE/.test(sql)) return { rows: ids.filter((i) => i.parent_entity_id === p[0] && i.user_id.startsWith(p[1].replace('%', '')) && String(i.display_name).toLowerCase() === p[2]) };
    if (/^SELECT user_id, bridge_id FROM identities WHERE identity_id/.test(sql)) return { rows: ids.filter((i) => i.identity_id === p[0]) };
    if (/^SELECT user_id FROM identities WHERE user_id LIKE/.test(sql)) return { rows: ids.filter((i) => i.user_id.startsWith(p[0].replace('%', ''))).slice(-1) };
    if (/^INSERT INTO identities/.test(sql)) { const r = { identity_id: '40000000-0000-4000-8000-' + String(ids.length).padStart(12, '0'), bridge_id: p[0], display_name: p[1], user_id: p[2], parent_entity_id: p[3] }; ids.push(r); return { rows: [r] }; }
    if (/^UPDATE identities SET otp_contact/.test(sql)) { ids.find((i) => i.identity_id === p[0]).otp_contact = p[1]; return { rows: [] }; }
    if (/^INSERT INTO customer_list/.test(sql)) { D.cust.push(cs(Object.assign({ owner: p[0], party_id: p[1], display_name: 'Ravi Jewellers', user_id: '~shop.cus-0010', on_rail: false, entity_kind: 'customer', status: 'active', merged_into: null, hidden_at: null, party_no: null }), { added_via: /'lead'/.test(sql) || p[2] === 'lead' ? 'lead' : 'manual' })); return { rows: [{ customer_list_id: 'CL1' }] }; }
    if (/FROM information_schema.tables/.test(sql)) return { rows: W.leads ? [{ '?column?': 1 }] : [] };
    if (/^SELECT DISTINCT ON \(item_id\)/.test(sql)) return { rows: D.memberships.filter((m) => p[2].indexOf(m.item_id) >= 0).map((m) => ({ item_id: m.item_id, grp: m.grp, at: m.at })) };
    if (/^INSERT INTO memberships/.test(sql)) { const r = { membership_id: 'mm' + (D.memberships.length + 1), entity_id: p[0], item_id: p[2], kind: p[3], grp: p[4], at: '2026-10-10T09:00:00.000Z' }; D.memberships.push(r); return { rows: [r] }; }
    if (/^SELECT EXISTS \(SELECT 1 FROM customer_list/.test(sql)) return { rows: [{ ok: D.cust.some((r) => r.owner === p[0] && r.party_id === p[1]) }] };
    if (/^SELECT txn_count FROM customer_list/.test(sql)) { const r = D.cust.find((x) => x.owner === p[0] && x.party_id === p[1] && x.added_via === 'lead'); return { rows: r ? [{ txn_count: r.txn_count }] : [] }; }
    if (/^SELECT country FROM identities WHERE identity_id = \$1/.test(sql)) return { rows: [{ country: 'IN' }] };
    /* consent (b306) and requests (b307) */
    if (/^SELECT to_regclass\(\$1\) IS NOT NULL AS ok/.test(sql)) return { rows: [{ ok: p[0] === 'privacy_request' ? W.requests : W.prefs }] };
    if (/^SELECT pref_id, .* FROM party_contact_pref/.test(sql)) return { rows: W.prefRows.filter((r) => r.owner === p[0] && r.party_id === p[1]) };
    if (/^INSERT INTO party_contact_pref/.test(sql)) { const r = { pref_id: uid(), owner: p[0], party_id: p[1], channel: p[2], purpose: p[3], allowed: p[4], basis: p[5], notice_version: p[6], noted_by: p[7], noted_at: '2026-10-13T06:00:00.000Z', withdrawn_at: null }; W.prefRows.push(r); return { rows: [r] }; }
    if (/^SELECT DISTINCT ON \(party_id, channel, purpose\)/.test(sql)) { if (!W.prefs) throw gone('party_contact_pref'); return { rows: [] }; }
    if (/FROM party_contact_pref\s+WHERE owner_entity_id = \$1 AND party_id = \$2 AND channel = \$3 AND purpose = \$4/.test(sql)) return { rows: W.prefRows.filter((r) => r.owner === p[0] && r.party_id === p[1] && r.channel === p[2] && r.purpose === p[3]).slice(0, 1) };
    if (/^INSERT INTO privacy_request/.test(sql)) { const r = request(p); W.requestRows.push(r); return { rows: [r] }; }
    if (/^WITH c AS \(SELECT count\(\*\)::int AS total/.test(sql)) {
      const all = W.requestRows.filter((r) => r.owner === p[0]);
      const head = { total: all.length, n_open: all.filter((r) => !r.answered_at).length, n_late: 0 };
      return { rows: all.length ? all.map((r) => Object.assign({}, head, r)) : [Object.assign({ request_id: null }, head)] };
    }
    if (/^UPDATE privacy_request SET answered_at = now\(\)/.test(sql)) {
      const r = W.requestRows.find((x) => x.owner === p[0] && x.request_id === p[1] && !x.answered_at);
      if (!r) return { rows: [] };
      Object.assign(r, { answered_at: '2026-10-13T07:00:00.000Z', answered_by: p[2], outcome: p[3], answer: p[4] });
      return { rows: [r] };
    }
    /* the group column (b205) */
    if (/^SELECT DISTINCT unnest\(groups\)/.test(sql)) { if (!W.groups) throw Object.assign(new Error('column "groups" does not exist'), { code: '42703' }); return { rows: [{ g: 'Dealers' }] }; }
    if (/^UPDATE customer_list SET groups = array_append/.test(sql)) { if (!W.groups) throw Object.assign(new Error('column "groups" does not exist'), { code: '42703' }); return { rows: D.cust.filter((r) => r.owner === p[0] && p[2].indexOf(r.party_id) >= 0).map((r) => ({ customer_identity_id: r.party_id, n: 1 })) }; }
    if (/^UPDATE customer_list SET groups = array_remove/.test(sql)) { const hit = D.cust.filter((r) => r.owner === p[0] && (r.groups || []).indexOf(p[1]) >= 0); return { rows: hit.map((r) => ({ customer_identity_id: r.party_id })) }; }
    if (/^SELECT count\(\*\)::int AS n FROM customer_list WHERE owner_entity_id = \$1 AND \$2 = ANY/.test(sql)) return { rows: [{ n: D.cust.filter((r) => r.owner === p[0] && (r.groups || []).indexOf(p[1]) >= 0).length }] };
    if (/FROM definition d/.test(sql)) return { rows: [] };
    /* the call desk's queue and its writes */
    if (/^SELECT q\.followup_id/.test(sql)) return { rows: [{ total_rows: 1, late_rows: 1, today_rows: 0, followup_id: P(21), party_id: IDS.lead, what: 'Ring again', due_at: day(-1), assignee_user_id: SHOP, src: 'followup', party_name: 'Lead Lata', phone: '+919840011111', last_outcome: null, last_at: null, stage: 'lead' }] };
    if (/^UPDATE party_followup SET done_at = now\(\), done_by = \$3 WHERE owner_entity_id = \$1 AND party_id = \$2/.test(sql)) return { rows: [] };
    if (/^SELECT body FROM party_interaction/.test(sql)) return { rows: [] };
    return null;
  };
}

/** the import's set-based statements (lib/crm-leads.js), answered BEFORE crm-stub's per-row ones: they share prefixes */
function preOf(D, W, row) {
  const digits = (text) => String(text || '').replace(/[^0-9]/g, '');
  const made = [];
  const cs = (r, o) => Object.assign(r, { customer_type: 'entity', added_via: 'lead', txn_count: 0, last_txn_at: null, groups: [], segment: 'new' }, o);
  return async (sql, p) => {
    if (/^SELECT i.identity_id, i.display_name, i.user_id, regexp_replace/.test(sql)) {
      const prefix = p[3].replace('%', '');
      const all = D.cust.map((r) => Object.assign({ _c: true }, r)).concat(D.sup.map((r) => Object.assign({ _s: true }, r)));
      const hit = all.filter((r) => r.owner === p[0] && (p[1].indexOf(digits(r.otp_contact)) >= 0 || p[1].indexOf(digits(r.phone)) >= 0 || (r.user_id.startsWith(prefix) && p[2].indexOf(r.display_name.toLowerCase()) >= 0)));
      return { rows: hit.map((r) => ({ identity_id: r.party_id, display_name: r.display_name, user_id: r.user_id, d1: digits(r.otp_contact), d2: digits(r.phone), minted: r.user_id.startsWith(prefix), on_customer: !!r._c, added_via: r._c ? r.added_via : null, txn_count: r._c ? r.txn_count : 0, supplier: !!r._s })) };
    }
    if (/^SELECT identity_id, bridge_id, display_name, user_id FROM identities WHERE parent_entity_id = .1 AND user_id LIKE .2 AND lower.btrim.display_name.. = ANY/.test(sql)) return { rows: made.filter((i) => p[2].indexOf(String(i.display_name).toLowerCase()) >= 0) };
    if (/^INSERT INTO identities .* SELECT v.b, v.n, v.u/.test(sql)) { const out = p[1].map((b, i) => ({ identity_id: '50000000-0000-4000-8000-' + String(made.length + i).padStart(12, '0'), bridge_id: b, display_name: p[2][i], user_id: p[3][i], parent_entity_id: p[0] })); out.forEach((r) => made.push(r)); return { rows: out }; }
    if (/^UPDATE identities i SET otp_contact = COALESCE/.test(sql)) return { rows: [] };
    if (/^INSERT INTO customer_list .* SELECT .1, v.id, 'entity', 'lead'/.test(sql)) {
      p[1].forEach((id) => { const x = made.find((y) => y.identity_id === id); D.cust.push(cs(row({ party_id: id, display_name: x.display_name, user_id: x.user_id, on_rail: false }))); });
      return { rows: p[1].map((id) => ({ customer_identity_id: id })) };
    }
    if (/^UPDATE customer_list SET added_via = 'lead' WHERE/.test(sql)) return { rows: [] };
    if (/^SELECT customer_identity_id AS id FROM customer_list WHERE owner_entity_id = .1 AND customer_identity_id = ANY/.test(sql)) return { rows: D.cust.filter((r) => r.owner === p[0] && p[1].indexOf(r.party_id) >= 0).map((r) => ({ id: r.party_id })) };
    if (/^INSERT INTO memberships .* SELECT .1, .2, v.id/.test(sql)) return { rows: p[4].map((id, i) => ({ membership_id: 'mm' + i, item_id: id, kind: p[2], grp: p[5][i], at: '2026-10-12T09:00:00.000Z' })) };
    if (/^INSERT INTO party_interaction .* SELECT .1, v.pid, 'note'/.test(sql)) return { rows: [], rowCount: p[1].length };
    return null;
  };
}

/** a library call that fails the way a database does, with text that must never reach a caller */
const boom = async () => {
  throw new Error(SECRET_SQL);
};

/** every named scene: [id, route, expected status, options]. Options: who, key, signedOut, db ('fail'), world (a change to W), data (a change to D), url, body, patch. */
function extras() {
  const X = (id, route, status, o) => Object.assign({ id, route, expect: status, setup: {} }, o || {});
  /** a scene that the sweep ADDS (a refusal the old code did not make): never frozen */
  const N = (id, route, status, o) => X(id, route, status, Object.assign({ after: true }, o || {}));
  const C = '/api/crm';
  const A = IDS;
  const asOf = (who, more) => ({ setup: Object.assign({ who }, more || {}) });
  const at = (url, more) => Object.assign({ url: C + url }, more || {});
  const noFollowups = { setup: { world: { migrated: false } } };
  return [
    /* the list and the record */
    X('list-all', 'GET ' + C + '/parties', 200),
    X('list-leads', 'GET ' + C + '/parties', 200, at('/parties?view=leads')),
    X('list-with-consent', 'GET ' + C + '/parties', 200, at('/parties?with=consent')),
    X('list-a-page', 'GET ' + C + '/parties', 200, at('/parties?page=1&limit=1')),
    N('list-view-given-twice', 'GET ' + C + '/parties', 400, at('/parties?view=leads&view=leads')),
    X('record-found', 'GET ' + C + '/parties/:id', 200),
    X('record-lead', 'GET ' + C + '/parties/:id', 200, at('/parties/' + A.lead)),
    X('record-supplier', 'GET ' + C + '/parties/:id', 200, at('/parties/' + A.agro)),
    X('record-unknown', 'GET ' + C + '/parties/:id', 404, at('/parties/' + A.unknown)),
    X('record-of-another-shop', 'GET ' + C + '/parties/:id', 404, at('/parties/' + A.foreign)),
    X('record-by-staff', 'GET ' + C + '/parties/:id', 200, asOf('staff')),
    X('record-by-viewer', 'GET ' + C + '/parties/:id', 200, asOf('viewer')),
    /* API-8 (S34): the record with every optional column empty (identities.user_id · status and the party number are nullable; the Ledger off gives no dues), and a customer holding points */
    X('record-sparse', 'GET ' + C + '/parties/:id', 200, { data: (D) => { Object.assign(D.cust[0], { user_id: null, status: null, party_no: null }); D.stored.customer = {}; D.ledgerOn = false; } }),
    X('record-with-points', 'GET ' + C + '/parties/:id', 200, { data: (D) => { D.points = { programme: { name: 'Gold' }, points: 120, worth: 60, entries: [] }; } }),
    /* the timeline */
    X('timeline-found', 'GET ' + C + '/parties/:id/timeline', 200),
    X('timeline-unknown', 'GET ' + C + '/parties/:id/timeline', 404, at('/parties/' + A.unknown + '/timeline')),
    X('timeline-bad-before', 'GET ' + C + '/parties/:id/timeline', 400, at('/parties/' + A.chola + '/timeline?before=whenever')),
    X('timeline-before-a-day', 'GET ' + C + '/parties/:id/timeline', 200, at('/parties/' + A.chola + '/timeline?before=2026-09-30&limit=5')),
    N('timeline-limit-given-twice', 'GET ' + C + '/parties/:id/timeline', 400, at('/parties/' + A.chola + '/timeline?limit=5&limit=6')),
    X('timeline-next-page', 'GET ' + C + '/parties/:id/timeline', 200, at('/parties/' + A.chola + '/timeline?limit=1')),
    X('timeline-before-b276', 'GET ' + C + '/parties/:id/timeline', 200, Object.assign(noFollowups)),
    /* consent (b306) */
    X('prefs-found', 'GET ' + C + '/parties/:id/contact-prefs', 200),
    X('prefs-with-history', 'GET ' + C + '/parties/:id/contact-prefs', 200, { world: (W) => { W.prefRows.push({ pref_id: '20000000-0000-4000-8000-000000000001', owner: SHOP, party_id: A.chola, channel: 'whatsapp', purpose: 'marketing', allowed: true, basis: 'consent', notice_version: null, noted_by: SHOP, noted_at: '2026-10-01T00:00:00.000Z', withdrawn_at: null }); } }),
    X('prefs-unknown', 'GET ' + C + '/parties/:id/contact-prefs', 404, at('/parties/' + A.unknown + '/contact-prefs')),
    X('prefs-not-migrated', 'GET ' + C + '/parties/:id/contact-prefs', 503, { setup: { world: { prefs: false } } }),
    X('prefs-noted', 'POST ' + C + '/parties/:id/contact-prefs', 201, { body: { channel: 'whatsapp', purpose: 'marketing', allowed: true, basis: 'consent' } }),
    X('prefs-no-answer', 'POST ' + C + '/parties/:id/contact-prefs', 400, { body: { channel: 'whatsapp', purpose: 'marketing' } }),
    X('prefs-bad-channel', 'POST ' + C + '/parties/:id/contact-prefs', 400, { body: { channel: 'pigeon', purpose: 'marketing', allowed: true } }),
    X('prefs-offers-without-consent', 'POST ' + C + '/parties/:id/contact-prefs', 400, { body: { channel: 'whatsapp', purpose: 'marketing', allowed: true, basis: 'legitimate_use' } }),
    X('prefs-note-unknown', 'POST ' + C + '/parties/:id/contact-prefs', 404, Object.assign({ body: { channel: 'phone', purpose: 'service', allowed: false } }, at('/parties/' + A.unknown + '/contact-prefs'))),
    X('prefs-note-not-migrated', 'POST ' + C + '/parties/:id/contact-prefs', 503, { body: { channel: 'phone', purpose: 'service', allowed: false }, setup: { world: { prefs: false } } }),
    /* the log */
    X('log-a-note', 'POST ' + C + '/parties/:id/interactions', 201, { body: { kind: 'note', body: 'Spoke at the counter' } }),
    X('log-an-out-call', 'POST ' + C + '/parties/:id/interactions', 201, { body: { kind: 'call', direction: 'out', body: 'Rang about the rate' } }),
    X('log-no-kind', 'POST ' + C + '/parties/:id/interactions', 400, { body: { kind: 'carrier-pigeon', body: 'x' } }),
    X('log-unknown-party', 'POST ' + C + '/parties/:id/interactions', 404, Object.assign({ body: { kind: 'note', body: 'x' } }, at('/parties/' + A.unknown + '/interactions'))),
    X('log-an-offer-without-consent', 'POST ' + C + '/parties/:id/interactions', 403, { body: { kind: 'message', direction: 'out', channel: 'whatsapp', purpose: 'marketing', body: 'A new offer' } }),
    X('log-bad-channel', 'POST ' + C + '/parties/:id/interactions', 400, { body: { kind: 'message', direction: 'out', channel: 'pigeon', body: 'x' } }),
    X('log-bad-purpose', 'POST ' + C + '/parties/:id/interactions', 400, { body: { kind: 'message', direction: 'out', purpose: 'spam', body: 'x' } }),
    X('log-before-b276', 'POST ' + C + '/parties/:id/interactions', 503, Object.assign({ body: { kind: 'note', body: 'x' } }, noFollowups)),
    /* follow-ups */
    X('followups-all', 'GET ' + C + '/followups', 200),
    X('followups-mine-done', 'GET ' + C + '/followups', 200, at('/followups?scope=mine&done=1&page=1&limit=10')),
    X('followups-before-b276', 'GET ' + C + '/followups', 503, noFollowups),
    N('followups-scope-given-twice', 'GET ' + C + '/followups', 400, at('/followups?scope=mine&scope=all')),
    X('followup-made', 'POST ' + C + '/followups', 201, { body: { party_id: A.chola, what: 'Ring about the quote', due_at: day(2) } }),
    X('followup-no-party', 'POST ' + C + '/followups', 400, { body: { what: 'x' } }),
    X('followup-no-words', 'POST ' + C + '/followups', 400, { body: { party_id: A.chola } }),
    X('followup-unknown-party', 'POST ' + C + '/followups', 404, { body: { party_id: A.unknown, what: 'x' } }),
    X('followup-before-b276', 'POST ' + C + '/followups', 503, { body: { party_id: A.chola, what: 'x' }, setup: noFollowups.setup }),
    X('followup-done', 'PATCH ' + C + '/followups/:id', 200, { url: C + '/followups/' + P(21), body: { done: true } }),
    X('followup-snoozed', 'PATCH ' + C + '/followups/:id', 200, { url: C + '/followups/' + P(21), body: { after: 'tomorrow' } }),
    X('followup-nothing-to-change', 'PATCH ' + C + '/followups/:id', 400, { url: C + '/followups/' + P(21), body: {} }),
    X('followup-unknown', 'PATCH ' + C + '/followups/:id', 404, { url: C + '/followups/' + P(98), body: { done: true } }),
    X('followup-of-another-shop', 'PATCH ' + C + '/followups/:id', 404, { url: C + '/followups/' + P(29), body: { done: true } }),
    X('followup-not-the-assignee', 'PATCH ' + C + '/followups/:id', 403, { url: C + '/followups/' + P(21), body: { assignee_user_id: 'A2' }, setup: { who: 'staff' } }),
    X('followup-deleted', 'DELETE ' + C + '/followups/:id', 200, { url: C + '/followups/' + P(21) }),
    X('followup-delete-unknown', 'DELETE ' + C + '/followups/:id', 404, { url: C + '/followups/' + P(98) }),
    X('followup-delete-of-another-shop', 'DELETE ' + C + '/followups/:id', 404, { url: C + '/followups/' + P(29) }),
    /* removing a party */
    X('party-removed', 'DELETE ' + C + '/parties/:id', 200, at('/parties/' + A.plain)),
    X('party-remove-by-staff', 'DELETE ' + C + '/parties/:id', 403, asOf('staff')),
    X('party-remove-unknown', 'DELETE ' + C + '/parties/:id', 404, at('/parties/' + A.unknown)),
    X('party-remove-with-dues', 'DELETE ' + C + '/parties/:id', 409, { data: (D) => { D.stored.customer[A.chola] = { party_no: 'P-0002', balance_minor: 50000, oldest_due: '2026-09-01' }; }, url: C + '/parties/' + A.chola }),
    /* leads */
    X('lead-added', 'POST ' + C + '/leads', 201, { body: { name: 'Ravi Jewellers', phone: '+91 98400 12321', stage: 'demo' } }),
    X('lead-no-name', 'POST ' + C + '/leads', 400, { body: { phone: '+91 98400 12321' } }),
    X('lead-bad-phone', 'POST ' + C + '/leads', 400, { body: { name: 'X', phone: 'abc' } }),
    X('lead-bad-stage', 'POST ' + C + '/leads', 400, { body: { name: 'X', stage: 'customer' } }),
    X('lead-before-b297', 'POST ' + C + '/leads', 503, { body: { name: 'X' }, setup: { world: { leads: false } } }),
    N('lead-body-not-an-object', 'POST ' + C + '/leads', 400, { body: [] }),
    X('lead-moved', 'POST ' + C + '/parties/:id/stage', 200, { url: C + '/parties/' + A.lead + '/stage', body: { stage: 'trial' } }),
    X('lead-move-bad-stage', 'POST ' + C + '/parties/:id/stage', 400, { url: C + '/parties/' + A.lead + '/stage', body: { stage: 'customer' } }),
    X('lead-move-unknown', 'POST ' + C + '/parties/:id/stage', 404, { url: C + '/parties/' + A.unknown + '/stage', body: { stage: 'trial' } }),
    X('lead-move-of-another-shop', 'POST ' + C + '/parties/:id/stage', 404, { url: C + '/parties/' + A.foreign + '/stage', body: { stage: 'trial' } }),
    X('lead-move-a-customer', 'POST ' + C + '/parties/:id/stage', 409, { url: C + '/parties/' + A.chola + '/stage', body: { stage: 'trial' }, data: (D) => { D.cust[0].added_via = 'lead'; } }),
    X('lead-move-before-b297', 'POST ' + C + '/parties/:id/stage', 503, { url: C + '/parties/' + A.lead + '/stage', body: { stage: 'trial' }, setup: { world: { leads: false } } }),
    /* the call desk */
    X('calls-queue', 'GET ' + C + '/calls', 200),
    X('calls-mine', 'GET ' + C + '/calls', 200, at('/calls?scope=mine&page=1&limit=10')),
    X('calls-before-b276', 'GET ' + C + '/calls', 503, noFollowups),
    N('calls-scope-given-twice', 'GET ' + C + '/calls', 400, at('/calls?scope=mine&scope=all')),
    X('outcome-logged', 'POST ' + C + '/parties/:id/outcome', 201, { url: C + '/parties/' + A.lead + '/outcome', body: { outcome: 'interested' } }),
    X('outcome-moves-the-stage', 'POST ' + C + '/parties/:id/outcome', 201, { url: C + '/parties/' + A.lead + '/outcome', body: { outcome: 'demo_booked', due_at: day(3).slice(0, 10) } }),
    X('outcome-bad-pick', 'POST ' + C + '/parties/:id/outcome', 400, { url: C + '/parties/' + A.lead + '/outcome', body: { outcome: 'nope' } }),
    X('outcome-unknown', 'POST ' + C + '/parties/:id/outcome', 404, { url: C + '/parties/' + A.unknown + '/outcome', body: { outcome: 'interested' } }),
    X('outcome-before-b297', 'POST ' + C + '/parties/:id/outcome', 503, { url: C + '/parties/' + A.lead + '/outcome', body: { outcome: 'not_now' }, setup: { world: { leads: false } } }),
    X('outcome-before-b276', 'POST ' + C + '/parties/:id/outcome', 503, { url: C + '/parties/' + A.lead + '/outcome', body: { outcome: 'interested' }, setup: noFollowups.setup }),
    /* the import */
    X('import-a-file', 'POST ' + C + '/leads/import', 201, { body: { rows: [{ name: 'Kala Stores', phone: '+91 98400 11111' }, { name: 'Bad', phone: 'call me' }] } }),
    X('import-a-preview', 'POST ' + C + '/leads/import', 200, { body: { rows: [{ name: 'Kala Stores', phone: '+91 98400 11111' }], dry: true } }),
    X('import-no-rows', 'POST ' + C + '/leads/import', 400, { body: { rows: [] } }),
    X('import-too-many', 'POST ' + C + '/leads/import', 400, { body: { rows: Array.from({ length: 501 }, (unused, index) => ({ name: 'N' + index })) } }),
    X('import-by-viewer', 'POST ' + C + '/leads/import', 403, Object.assign({ body: { rows: [{ name: 'A' }], dry: true } }, asOf('viewer'))),
    X('import-by-commenter', 'POST ' + C + '/leads/import', 403, Object.assign({ body: { rows: [{ name: 'A' }] } }, asOf('commenter'))),
    X('import-before-b297', 'POST ' + C + '/leads/import', 503, { body: { rows: [{ name: 'A' }] }, setup: { world: { leads: false } } }),
    /* the walk-in */
    X('walk-in-added', 'POST ' + C + '/walk-ins/add', 201, { body: { phone: '+91 98400 55555', name: 'Corner shop' } }),
    X('walk-in-no-phone', 'POST ' + C + '/walk-ins/add', 400, { body: {} }),
    /* a database that fails under a request that is otherwise fine: a 500 that says nothing of its cause */
    X('followup-made-db-fails', 'POST ' + C + '/followups', 500, { body: { party_id: A.chola, what: 'x' }, setup: { db: 'fail' } }),
    X('lead-added-db-fails', 'POST ' + C + '/leads', 500, { body: { name: 'Ravi' }, patch: { local: { addCustomer: boom } } }),
    X('lead-moved-db-fails', 'POST ' + C + '/parties/:id/stage', 500, { url: C + '/parties/' + A.lead + '/stage', body: { stage: 'trial' }, patch: { memberships: { add: boom } } }),
    X('outcome-db-fails', 'POST ' + C + '/parties/:id/outcome', 500, { url: C + '/parties/' + A.lead + '/outcome', body: { outcome: 'interested' }, setup: { db: 'fail' } }),
    X('import-db-fails', 'POST ' + C + '/leads/import', 500, { body: { rows: [{ name: 'Kala Stores' }] }, patch: { leads: { importLeads: boom } } }),
    X('walk-in-db-fails', 'POST ' + C + '/walk-ins/add', 500, { body: { phone: '+91 98400 55555' }, setup: { db: 'fail' } }),
    X('group-db-fails', 'POST ' + C + '/groups', 500, { body: { name: 'Dealers', add: [A.plain] }, setup: { db: 'fail' } }),
    X('segment-send-db-fails', 'POST ' + C + '/segments/:key/send', 500, { url: C + '/segments/regular/send', body: { text: 'x', dry: true }, setup: { db: 'fail' } }),
    /* privacy requests (b307) */
    X('requests-listed', 'GET ' + C + '/privacy-requests', 200),
    X('requests-listed-with-rows', 'GET ' + C + '/privacy-requests', 200, { world: (W) => { W.requestRows.push({ request_id: '30000000-0000-4000-8000-000000000001', owner: SHOP, party_id: null, who: 'Lata', kind: 'access', country: 'IN', received_at: '2026-10-01T00:00:00.000Z', due_at: '2026-10-31T00:00:00.000Z', answered_at: null }); } }),
    X('requests-open-only', 'GET ' + C + '/privacy-requests', 200, at('/privacy-requests?open=1&page=1&limit=5')),
    X('requests-not-migrated', 'GET ' + C + '/privacy-requests', 503, { setup: { world: { requests: false } } }),
    N('requests-open-given-twice', 'GET ' + C + '/privacy-requests', 400, at('/privacy-requests?open=1&open=0')),
    X('request-logged', 'POST ' + C + '/privacy-requests', 201, { body: { kind: 'access', who: 'Lata', party_id: A.chola } }),
    X('request-logged-for-nobody-in-particular', 'POST ' + C + '/privacy-requests', 201, { body: { kind: 'grievance', who: 'A caller', country: 'AU' } }),
    X('request-bad-party-id', 'POST ' + C + '/privacy-requests', 400, { body: { kind: 'access', who: 'Lata', party_id: 'nope' } }),
    X('request-bad-kind', 'POST ' + C + '/privacy-requests', 400, { body: { kind: 'wish', who: 'Lata' } }),
    X('request-unknown-party', 'POST ' + C + '/privacy-requests', 404, { body: { kind: 'access', who: 'Lata', party_id: A.unknown } }),
    X('request-not-migrated', 'POST ' + C + '/privacy-requests', 503, { body: { kind: 'access', who: 'Lata' }, setup: { world: { requests: false } } }),
    X('request-answered', 'POST ' + C + '/privacy-requests/:id/answer', 200, { url: C + '/privacy-requests/30000000-0000-4000-8000-000000000001/answer', body: { outcome: 'done', answer: 'Sent the copy.' }, world: (W) => { W.requestRows.push({ request_id: '30000000-0000-4000-8000-000000000001', owner: SHOP, party_id: null, who: 'Lata', kind: 'access', country: 'IN', received_at: '2026-10-01T00:00:00.000Z', due_at: '2026-10-31T00:00:00.000Z', answered_at: null }); } }),
    X('request-answered-twice', 'POST ' + C + '/privacy-requests/:id/answer', 409, { url: C + '/privacy-requests/30000000-0000-4000-8000-000000000002/answer', body: { outcome: 'done', answer: 'Sent.' } }),
    X('request-answer-no-outcome', 'POST ' + C + '/privacy-requests/:id/answer', 400, { url: C + '/privacy-requests/30000000-0000-4000-8000-000000000001/answer', body: {} }),
    X('request-answer-by-staff', 'POST ' + C + '/privacy-requests/:id/answer', 403, { url: C + '/privacy-requests/30000000-0000-4000-8000-000000000001/answer', body: { outcome: 'done', answer: 'x' }, setup: { who: 'staff' } }),
    X('request-answer-not-an-id', 'POST ' + C + '/privacy-requests/:id/answer', 400, { url: C + '/privacy-requests/nope/answer', body: { outcome: 'done', answer: 'x' } }),
    X('request-answer-not-migrated', 'POST ' + C + '/privacy-requests/:id/answer', 503, { url: C + '/privacy-requests/30000000-0000-4000-8000-000000000001/answer', body: { outcome: 'done', answer: 'x' }, setup: { world: { requests: false } } }),
    /* segments and groups */
    X('segments-listed', 'GET ' + C + '/segments', 200),
    X('segments-listed-by-viewer', 'GET ' + C + '/segments', 200, asOf('viewer')),
    X('group-made', 'POST ' + C + '/groups', 201, { body: { name: 'Dealers', add: [A.plain], remove: [] } }),
    X('group-no-name', 'POST ' + C + '/groups', 400, { body: { add: [A.plain] } }),
    X('group-nothing-to-do', 'POST ' + C + '/groups', 400, { body: { name: 'Dealers' } }),
    X('group-by-viewer', 'POST ' + C + '/groups', 403, { body: { name: 'Dealers', add: [A.plain] }, setup: { who: 'viewer' } }),
    X('group-before-b205', 'POST ' + C + '/groups', 409, { body: { name: 'Dealers', add: [A.plain] }, setup: { world: { groups: false } } }),
    N('group-body-not-an-object', 'POST ' + C + '/groups', 400, { body: [] }),
    X('group-dropped', 'DELETE ' + C + '/groups/:name', 200, { url: C + '/groups/Dealers' }),
    X('group-drop-unknown', 'DELETE ' + C + '/groups/:name', 404, { url: C + '/groups/Nobody' }),
    X('group-drop-by-staff', 'DELETE ' + C + '/groups/:name', 403, { url: C + '/groups/Dealers', setup: { who: 'staff' } }),
    X('segment-send-preview', 'POST ' + C + '/segments/:key/send', 200, { url: C + '/segments/regular/send', body: { text: 'A new offer', dry: true } }),
    X('segment-send-by-viewer', 'POST ' + C + '/segments/:key/send', 403, { url: C + '/segments/regular/send', body: { text: 'x', dry: true }, setup: { who: 'viewer' } }),
    X('segment-send-unknown-key', 'POST ' + C + '/segments/:key/send', 400, { url: C + '/segments/nope/send', body: { text: 'x', dry: true } }),
    X('segment-send-no-text', 'POST ' + C + '/segments/:key/send', 400, { url: C + '/segments/regular/send', body: { dry: true } }),
    X('segment-send-bad-channel', 'POST ' + C + '/segments/:key/send', 400, { url: C + '/segments/regular/send', body: { text: 'x', channel: 'sms', dry: true } }),
    X('segment-send-a-service-message', 'POST ' + C + '/segments/:key/send', 400, { url: C + '/segments/regular/send', body: { text: 'x', purpose: 'service', dry: true } }),
    N('segment-send-body-not-an-object', 'POST ' + C + '/segments/:key/send', 400, { url: C + '/segments/regular/send', body: [] })
  ];
}

module.exports = { preOf, P, IDS, SHOP, OTHER_SHOP, LOGINS, SECRET_SQL, FRESH_WORLD, seed, extraOf, extras, day };
