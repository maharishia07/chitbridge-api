/* standin.cjs — the walks' stand-in API (a shop with the Ledger on, nothing waiting, a closed walk-in day, three parties), answered INSIDE the page.
 * Moved out of kural-footer.cjs so frame-every-width.cjs serves the same answers (one stand-in, not two).
 * WX-L2C (2026-10-13): WIDENED, not copied, with the L2C routes (leads · calls · outcome · stage · the record · timeline · follow-ups · Log) as a small
 * state machine that mirrors chitbridge-api's rules (routes/crm.js · lib/crm-calls.js OUTCOMES · lib/crm.js isLead): standIn({ l2c: l2cState() }).
 * A walk without `l2c` is answered exactly as before. */
'use strict';
const TD = require('./today.cjs');
const fs = require('fs'), path = require('path');
const C = require('./contract.cjs'), crmApi = require('./crm-api.cjs'), books = require('./books-api.cjs');
const J = C.json;
const TODAY = TD.TODAY;
const FIX = path.join(__dirname, '..', 'fixtures', 'golden-parties.json');
/* the stand-in: a shop with the Ledger on, nothing waiting, a closed walk-in day (so no notice is on screen), three parties */
const fx = JSON.parse(fs.readFileSync(FIX, 'utf8'));
function standIn(over) {
  return Object.assign({ noClose: false, calls: [] }, over || {});
}

/* ═══ L2C — the server's rules, in the page (lib/crm-calls.js OUTCOMES: the days and the stage each outcome moves to; lib/memberships KINDS) ═══ */
const STAGES = ['lead', 'demo', 'trial', 'parked', 'lost'];
const OUTCOMES = [
  { key: 'no_answer', label: 'No answer', days: 1, stage: null, then: 'Ring again' },
  { key: 'call_back', label: 'Call back', days: null, stage: null, then: 'Ring back', ask: true, presets: { today: 0, tomorrow: 1, '3days': 3 } },
  { key: 'interested', label: 'Interested', days: 2, stage: null, then: 'Follow up' },
  { key: 'demo_booked', label: 'Demo booked', days: null, stage: 'demo', then: 'Demo', ask: true, presets: { tomorrow: 1, '3days': 3 } },
  { key: 'not_now', label: 'Not now', days: 30, stage: 'parked', then: 'Ring again' },
  { key: 'wrong_number', label: 'Wrong number', days: null, stage: 'lost', then: null },
];
const NOT_READY = 'Lead stages arrive after the next update.';
const localDay = (d) => { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
const today = () => localDay(TD.now());
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); return localDay(d); };
/** a day → the instant the api stores for it: the SHOP's midnight (Asia/Kolkata, the walks' browser zone), never the runner's (the page shows the day, not "12:00 am") */
const dayAt = (day) => new Date(day + 'T00:00:00+05:30').toISOString();
const uuid = (n) => '20000000-0000-4000-8000-' + String(n).padStart(12, '0');

/* ═══ T3-P3-CONSENT — consent (b306) and the privacy-request register (b307), the api's rules in the page (lib/privacy.js mayMessage · gate · DUE_DAYS) ═══ */
const PV_CH = ['phone', 'sms', 'whatsapp', 'email', 'chitbridge'], PV_PU = ['service', 'marketing'];
const PV_KINDS = ['access', 'correct', 'erase', 'withdraw', 'nominate', 'grievance'];
const PV_LAW = { IN: { country: 'IN', known: true, law: 'Digital Personal Data Protection Act 2023', short: 'DPDP Act', authority: 'Data Protection Board of India', consent: 'Offers need your consent. You may withdraw it at any time.', rights: 'You may see, correct or erase your data, or name a nominee.', kinds: PV_KINDS, note: null, due_days: 30 },
  AU: { country: 'AU', known: true, law: 'Privacy Act 1988 (Cth)', short: 'Privacy Act', authority: 'Office of the Australian Information Commissioner', consent: 'Offers need your consent. You may opt out at any time.', rights: 'You may see and correct your data.', kinds: ['access', 'correct', 'withdraw', 'grievance'], note: null, due_days: 30 } };
const pvLaw = (c) => PV_LAW[c] || { country: c || null, known: false, law: null, short: null, authority: null, consent: 'Offers need your consent. You may withdraw it at any time.', rights: 'You may see, correct or erase your data.', kinds: PV_KINDS, note: c ? 'No privacy pack for ' + c + ' yet. Every request kind is offered.' : 'The shop has no country set, so its privacy law is not known.', due_days: 30 };
/** privState({ country, migrated, reqsMigrated, seed }) — the rows one walk writes; `seed` plants one late request */
function privState(o) {
  o = o || {};
  const P = { country: o.country || 'IN', migrated: o.migrated !== false, reqsMigrated: o.reqsMigrated !== false, prefs: [], reqs: [], seq: 0 };
  if (o.seed) P.reqs.push({ request_id: uuid(901), party_id: null, who: 'Kumar (walk-in)', kind: 'access', country: P.country, received_at: new Date(TD.nowMs() - 40 * 86400e3).toISOString(), due_at: new Date(TD.nowMs() - 10 * 86400e3).toISOString(), answered_at: null, outcome: null, answer: null });
  return P;
}
function pvMay(rows, channel, purpose) {   /* lib/privacy.mayMessage, newest first */
  const r = rows.find((x) => x.channel === channel && x.purpose === purpose);
  if (purpose === 'marketing') {
    if (!r) return { may: false, code: 'NO_CONSENT', why: 'No consent for offers on ' + channel + '. Ask them first.' };
    if (!r.allowed) return r.withdrawn_at ? { may: false, code: 'CONSENT_WITHDRAWN', why: 'They withdrew consent for offers on ' + channel + '.' } : { may: false, code: 'SAID_NO', why: 'They said no to offers on ' + channel + '.' };
    return { may: true, code: 'CONSENT', why: 'They agreed to offers on ' + channel + '.' };
  }
  if (r && !r.allowed) return { may: false, code: 'OPTED_OUT', why: 'They asked not to be messaged on ' + channel + '.' };
  return { may: true, code: 'LEGITIMATE_USE', why: 'Messages about their own orders are allowed.' };
}
/** lib/consent-standing (api SEC audit 2026-11-16): a staff yes written after the customer's own no (source self / reply) does not stand; rows newest first */
const pvOwn = (x) => x.source === 'self' || x.source === 'reply';
const pvStanding = (rows) => rows.filter((x, i) => !x.allowed || pvOwn(x) || !rows.slice(i + 1).find((o) => o.channel === x.channel && o.purpose === x.purpose && pvOwn(o) && !o.allowed));
const pvRows = (P, party) => P.prefs.filter((x) => x.party_id === party).slice().reverse();
function pvMayAll(rows) { rows = pvStanding(rows); const may = {}; PV_CH.forEach((c) => { may[c] = {}; PV_PU.forEach((p) => { may[c][p] = pvMay(rows, c, p); }); }); return may; }
const pvContactPrefs = (P, party) => ({ migrated: P.migrated, may: pvMayAll(P.migrated ? pvRows(P, party) : []) });
const PV_EVIDENCE = 'To note a yes to offers, say it came from staff (source: staff) and add a note of what the customer said, and when.';
function pvNote(P, party, b, by, source) {
  const channel = String(b.channel || '').toLowerCase(), purpose = String(b.purpose || '').toLowerCase();
  if (PV_CH.indexOf(channel) < 0) return [400, errBody('Channel is phone, sms, whatsapp, email or chitbridge.', 'BAD_REQUEST')];
  if (PV_PU.indexOf(purpose) < 0) return [400, errBody('Purpose is service or marketing.', 'BAD_REQUEST')];
  if (typeof b.allowed !== 'boolean') return [400, errBody('Say yes or no.', 'BAD_REQUEST')];
  if (source === 'staff' && b.allowed && purpose === 'marketing' && (b.source !== 'staff' || String(b.note || '').trim().length < 3)) return [400, errBody(PV_EVIDENCE, 'BAD_REQUEST')];
  const before = pvRows(P, party).find((r) => r.channel === channel && r.purpose === purpose);
  const withdrawn = !b.allowed && before && before.allowed && before.basis === 'consent';
  const row = { pref_id: uuid(800 + (++P.seq)), party_id: party, channel, purpose, allowed: b.allowed, basis: purpose === 'marketing' ? 'consent' : 'legitimate_use', notice_version: null, noted_at: new Date(TD.nowMs() + P.seq * 1000).toISOString(), noted_by: by, source: source || 'staff', withdrawn_at: withdrawn ? TD.nowIso() : null };
  P.prefs.push(row); return [201, { pref: Object.assign({}, row, { party_id: undefined }) }];
}
const reqShape = (r) => Object.assign({}, r, { late: !r.answered_at && Date.parse(r.due_at) < TD.nowMs(), answered_late: !!r.answered_at && Date.parse(r.answered_at) > Date.parse(r.due_at) });
function pvRequests(P, o) {
  const all = P.reqs.filter((r) => (!o.open || !r.answered_at) && (!o.party_id || r.party_id === o.party_id)).sort((a, b) => ((!!a.answered_at) - (!!b.answered_at)) || (Date.parse(a.due_at) - Date.parse(b.due_at)));
  const limit = Math.min(200, Math.max(1, Number(o.limit) || 50)), page = Math.max(1, Number(o.page) || 1);
  return { requests: all.slice((page - 1) * limit, page * limit).map(reqShape), total: all.length, page, limit, open: all.filter((r) => !r.answered_at).length, late: all.filter((r) => !r.answered_at && Date.parse(r.due_at) < TD.nowMs()).length };
}
function pvLog(P, b, party) {
  const kind = String(b.kind || '').toLowerCase(); if (PV_KINDS.indexOf(kind) < 0) return [400, errBody('Kind is access, correct, erase, withdraw, nominate or grievance.', 'BAD_REQUEST')];
  const who = String(b.who || '').trim(); if (!who) return [400, errBody('Who asked? A name, phone or e-mail.', 'BAD_REQUEST')];
  const rec = b.received_at ? Date.parse(b.received_at) : TD.nowMs();
  const r = { request_id: uuid(700 + (++P.seq)), party_id: party || b.party_id || null, who, kind, country: P.country, received_at: new Date(rec).toISOString(), due_at: new Date(rec + (kind === 'grievance' && P.country === 'IN' ? 15 : 30) * 86400e3).toISOString(), answered_at: null, outcome: null, answer: null };
  P.reqs.push(r); return [201, { request: reqShape(r) }];
}
const NOT_PV = (n) => errBody('Privacy records need migration ' + n + ' — not run yet.', 'PRIVACY_NOT_MIGRATED');
/** the routes: the shop's (auth, as the CRM calls them) and the shopper's (/api/privacy/me, the storefront token) */
function privRoute(S, r, q, u, p, m, body, owner) {
  const P = S.priv; let x;
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/contact-prefs$/))) {
    if (!P.migrated) return J(r, 503, NOT_PV('b306'));
    const party = decodeURIComponent(x[1]);
    if (m === 'POST') { const [st, o] = pvNote(P, party, body || {}, owner ? 'ent-walk' : 'act-2', 'staff'); return J(r, st, o); }
    return J(r, 200, { party_id: party, history: pvRows(P, party).map((h) => Object.assign({}, h, { party_id: undefined })), may: pvMayAll(pvRows(P, party)), law: pvLaw(P.country) });
  }
  if (p === '/api/crm/privacy-requests') {
    if (!P.reqsMigrated) return J(r, 503, NOT_PV('b307'));
    if (m === 'POST') { const [st, o] = pvLog(P, body || {}, null); return J(r, st, o); }
    return J(r, 200, Object.assign(pvRequests(P, { open: u.searchParams.get('open') === '1', page: u.searchParams.get('page'), limit: u.searchParams.get('limit') }), { may_answer: !!owner, why: owner ? null : 'Only the owner answers a privacy request.' }));
  }
  if ((x = p.match(/^\/api\/crm\/privacy-requests\/([^/]+)\/answer$/)) && m === 'POST') {
    if (!owner) return J(r, 403, errBody('Only the owner answers a privacy request.', 'OWNER_ONLY'));
    const rq = P.reqs.find((z) => z.request_id === x[1] && !z.answered_at); if (!rq) return J(r, 409, errBody('Not found, or already answered — an answer is given once.', 'ANSWERED'));
    const o = String((body || {}).outcome || ''); if (['done', 'partly', 'refused'].indexOf(o) < 0) return J(r, 400, errBody('Outcome is done, partly or refused.', 'BAD_REQUEST'));
    if (!String((body || {}).answer || '').trim()) return J(r, 400, errBody('Write what was done, or why not.', 'BAD_REQUEST'));
    Object.assign(rq, { answered_at: TD.nowIso(), outcome: o, answer: String(body.answer).trim() }); return J(r, 200, { request: reqShape(rq) });
  }
  /* the shopper's own surface: the storefront token names the party (S.priv.shopper) and the shop */
  if (p.indexOf('/api/privacy/me') === 0) {
    const me = P.shopper || uuid(555), auth = q.headers().authorization || '';
    if (!/^Bearer /.test(auth)) return J(r, 401, errBody('Sign in to view this', 'UNAUTHORISED'));
    if (p === '/api/privacy/me' && m === 'GET') {
      const rows = P.migrated ? pvRows(P, me) : [], rq = P.reqsMigrated ? pvRequests(P, { party_id: me, limit: 50 }) : null;
      return J(r, 200, { shop: { name: 'Mayur Bhavan', country: P.country }, law: pvLaw(P.country),
        held: [{ key: 'name', label: 'Name', value: 'Kumar' }, { key: 'phone', label: 'Phone', value: '+91 98400 00009' }, { key: 'contact', label: 'Sign-in contact', value: null }, { key: 'orders', label: 'Orders and bills', value: 'On the chits you and the shop both hold (My orders).' }],
        consent: { migrated: P.migrated, history: rows.map((h) => Object.assign({}, h, { party_id: undefined })), may: pvMayAll(rows) },
        requests: rq ? { migrated: true, requests: rq.requests, total: rq.total } : { migrated: false, requests: [], total: 0 },
        may_consent: P.migrated ? { may: true, code: 'OK', why: null } : { may: false, code: 'PRIVACY_NOT_MIGRATED', why: 'Not set up yet at this shop. Ask the shop directly.' },
        may_request: P.reqsMigrated ? { may: true, code: 'OK', why: null } : { may: false, code: 'PRIVACY_NOT_MIGRATED', why: 'Not set up yet at this shop. Ask the shop directly.' } });
    }
    if (p === '/api/privacy/me/consent' && m === 'POST') { if (!P.migrated) return J(r, 503, NOT_PV('b306')); const [st, o] = pvNote(P, me, body || {}, me, 'self'); return J(r, st, st === 201 ? Object.assign(o, { may: pvMayAll(pvRows(P, me)) }) : o); }
    if (p === '/api/privacy/me/requests' && m === 'POST') { if (!P.reqsMigrated) return J(r, 503, NOT_PV('b307')); const [st, o] = pvLog(P, Object.assign({}, body || {}, { who: 'Kumar' }), me); return J(r, st, o); }
  }
  return null;
}

/** the mutable world one walk writes into: leads, their stage history, calls (interactions) and follow-ups */
function l2cState(o) {
  const L = { leads: [], seq: 0, fu: [], ix: [], stages: [], migrated: true, listFails: 0 };
  /* { seed: true }: one untouched lead already there (a view-only login has something to look at, and nothing to do) */
  if (o && o.seed) L.leads.push({ n: 1, party_id: uuid(1), party_no: 'P-0101', name: 'Seed Lead Selvi', phone: '9800000001', stage: 'lead', since: new Date(TD.nowMs() - 86400e3).toISOString(), txn: 0, last_txn_at: null });
  return L;
}
const errBody = (msg, code) => ({ code, error: msg, message: msg });

/** a lead as GET /parties?view=leads sends it: a MINTED party (kind local — with a bridge_id, as the mint gives one) on the customer list, added_via lead */
function leadRow(L, l) {
  const stage = l.txn > 0 ? 'customer' : l.stage;
  return { party_id: l.party_id, display_name: l.name, user_id: '~mayur.cus-' + String(l.n).padStart(4, '0'), bridge_id: 'CBL' + String(l.n).padStart(7, '0'), email: null, phone: l.phone, otp_contact: l.phone, gstn: null, city: null, status: 'active',
    kind: 'local', on_chitbridge: false, may_trade: { ok: false, why: 'local' }, roles: { customer: true, supplier: false }, party_no: l.party_no, last_activity: l.last_at || null,
    customer: { list_id: 'cl-' + l.party_id, segment: 'new', segment_override: null, txn_count: l.txn, last_txn_at: l.txn ? l.last_txn_at : null, groups: [], customer_type: 'entity', added_via: 'lead' },
    lead: { stage, since: l.since }, legal_name: null, nickname: null, state_code: null, tax_ids: [], terms: { customer: { credit_days: null, credit_limit_minor: null } },
    dues: { balance_minor: 0, oldest_due: null, side: 'customer', open_side: false, overdue: false }, gstin: { value: null, source: null, theirs: null, differs: false }, name: l.name };
}
const findLead = (L, id) => L.leads.find((l) => l.party_id === id || l.party_no === id);
const isLead = (l) => l.txn === 0;
function fuRows(L) { return L.fu.map((f) => { const l = findLead(L, f.party_id); return Object.assign({ party_no: l && l.party_no, party_name: l && l.name }, f); }); }
/** the timeline the record reads: calls and notes (interaction), follow-ups made and done, and every stage move as the api sends it since FX-L2C
 *  (kind stage { stage, from, by } — memberships read newest-first, from = the older row) */
function tlEntries(L, id) {
  const out = [];
  const st = L.stages.filter((s) => s.party_id === id).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  st.forEach((s, i) => out.push({ kind: 'stage', at: s.at, membership_id: 'ms-' + id.slice(-4) + '-' + i, stage: s.stage, from: st[i + 1] ? st[i + 1].stage : null, by: null }));
  L.ix.filter((x) => x.party_id === id).forEach((x) => out.push({ kind: 'interaction', at: x.at, interaction_id: x.interaction_id, interaction_kind: x.kind, direction: x.direction, body: x.body }));
  L.fu.filter((f) => f.party_id === id).forEach((f) => { out.push({ kind: 'followup', at: f.created_at, followup_id: f.followup_id, what: f.what, due_at: f.due_at }); if (f.done_at) out.push({ kind: 'followup_done', at: f.done_at, followup_id: f.followup_id, what: f.what }); });
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
function addFu(L, party_id, what, day, source) { const f = { followup_id: 'fu-' + (++L.seq), party_id, what, due_at: dayAt(day), due_day: day, assignee_user_id: null, source: source || 'manual', done_at: null, created_at: TD.nowIso() }; L.fu.push(f); return f; }
/** the api's follow-up shape with the SHOP's day (crm-api.followupOne reads the UTC date off due_at; the shop's midnight is the evening before in UTC) */
function fuShape(f) {
  const t = today(), d = f.due_day || localDay(new Date(f.due_at)), week = addDays(t, 6);
  return Object.assign(crmApi.followupOne(f), { due_day: d, late: !f.done_at && d < t, today: !f.done_at && d === t, bucket: d < t ? 'late' : d === t ? 'today' : d <= week ? 'week' : 'later' });
}
function addIx(L, party_id, kind, direction, body) { const x = Object.assign(crmApi.interaction({ kind, direction, body }).interaction, { interaction_id: 'ix-' + (++L.seq), party_id }); L.ix.push(x); return x; }   /* the api's interaction shape (crm-api.cjs), this party's id */
function setStage(L, l, stage) { l.stage = stage; l.since = TD.nowIso(); L.stages.push({ party_id: l.party_id, stage, at: l.since }); return { stage, since: l.since }; }

/** the walk's "counter bills the lead": txn_count 1 — the server's rule (isLead: txn_count 0) ends the lead */
function l2cBill(L, name) { const l = L.leads.find((x) => x.name === name); if (!l) return { status: 404, no: '—' }; l.txn = 1; l.last_txn_at = TD.nowIso(); return { status: 201, no: 'FX/' + l.n, total: 100 }; }
/** the walk's bare POST stage (what the server answers, no page involved) */
function l2cStage(L, name, stage) { const l = L.leads.find((x) => x.name === name); if (!l) return { status: 404, code: 'NOT_FOUND' }; if (!isLead(l)) return { status: 409, code: 'IS_CUSTOMER' }; setStage(L, l, stage); return { status: 200, code: '' }; }
/** a view-only co-assist's session (hat view_only in the token, as lib/access signs it) */
function viewerSession() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const token = b64({ alg: 'none' }) + '.' + b64({ identity_id: 'act-2', identity_type: 'actor', parent_entity_id: 'ent-walk', parent_entity_name: 'Mayur Bhavan', display_name: 'Vel', hat: 'view_only', exp: Math.floor(TD.nowMs() / 1000) + 3600 }) + '.x';
  return JSON.stringify({ token, role: 'actor', hat: 'view_only', name: 'Vel', entity: 'Mayur Bhavan', bridgeId: 'CBWALK0001' });
}

/** the L2C routes; null = not one of them (the plain answers below take over) */
function l2cRoute(L, r, q, u, p, m, body) {
  let x;
  if (p === '/api/crm/parties' && m === 'GET' && u.searchParams.get('view') === 'leads') {
    const rows = L.migrated ? L.leads.filter(isLead).map((l) => leadRow(L, l)) : [];
    return J(r, 200, crmApi.listPage(rows, { leads_migrated: L.migrated, may: crmApi.mayOf(r) }));   /* the one envelope (total · page · limit), as the contract says */
  }
  if (p === '/api/crm/parties' && m === 'GET') {
    const base = crmApi.list(fx.list, { records: fx.records });   /* the golden parties, plus every lead that has traded (a customer now) */
    const grown = L.leads.filter((l) => !isLead(l)).map((l) => leadRow(L, l));
    return J(r, 200, crmApi.listPage(base.parties.concat(grown), { walk_ins: base.walk_ins, may: crmApi.mayOf(r) }));
  }
  if (p === '/api/crm/leads' && m === 'POST') {
    if (!L.migrated) return J(r, 503, errBody(NOT_READY, 'LEADS_NOT_MIGRATED'));
    const name = String((body || {}).name || '').replace(/\s+/g, ' ').trim();
    if (!name) return J(r, 400, errBody('Give the lead a name.', 'BAD_NAME'));
    if (L.leads.some((l) => l.name.toLowerCase() === name.toLowerCase())) return J(r, 409, errBody('That name is already on your list.', 'EXISTS'));
    const stage = (body || {}).stage || 'lead'; if (STAGES.indexOf(stage) < 0) return J(r, 400, errBody('That is not one of the stages.', 'BAD_GROUP'));
    const n = L.leads.length + 1, l = { n, party_id: uuid(n), party_no: 'P-01' + String(n).padStart(2, '0'), name, phone: (body || {}).phone || null, stage, since: TD.nowIso(), txn: 0, last_txn_at: null };
    L.leads.push(l); L.stages.push({ party_id: l.party_id, stage, at: l.since });
    return J(r, 201, { party: { party_id: l.party_id, display_name: name, party_no: l.party_no, kind: 'local', on_chitbridge: false, lead: { stage, since: l.since } } });
  }
  if (p === '/api/crm/calls' && m === 'GET') {
    const t = today(), calls = [];
    L.fu.filter((f) => !f.done_at && (f.due_day || localDay(new Date(f.due_at))) <= t).forEach((f) => { const l = findLead(L, f.party_id); if (!l) return; const d = f.due_day || localDay(new Date(f.due_at)); const last = L.ix.filter((x) => x.party_id === l.party_id && x.kind === 'call').slice(-1)[0];
      calls.push({ party_id: l.party_id, party_name: l.name, phone: l.phone, stage: isLead(l) ? l.stage : 'lead', followup_id: f.followup_id, what: f.what, due_day: d, assignee_user_id: null, new: false, last_outcome: last ? last.body : null, last_at: last ? last.at : null, late: d < t, today: d === t, may_call: true, call_why: null, call_code: null }); });
    L.leads.filter((l) => isLead(l) && !L.ix.some((x) => x.party_id === l.party_id) && !L.fu.some((f) => f.party_id === l.party_id && !f.done_at)).forEach((l) => calls.push({ party_id: l.party_id, party_name: l.name, phone: l.phone, stage: l.stage, followup_id: null, what: null, due_day: null, assignee_user_id: null, new: true, last_outcome: null, last_at: null, late: false, today: false, may_call: true, call_why: null, call_code: null }));
    return J(r, 200, { calls, total: calls.length, page: 1, limit: calls.length, count: calls.length, late: calls.filter((c) => c.late).length, today: calls.filter((c) => c.today).length, shop_day: t,
      outcomes: OUTCOMES.map((o) => ({ key: o.key, label: o.label, ask: !!o.ask, presets: o.presets ? Object.keys(o.presets) : [], moves: o.stage || null })), may: Object.assign(L.migrated ? { ok: true } : { ok: false, why: NOT_READY }, { write: crmApi.mayOf(r).write }) });
  }
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/outcome$/)) && m === 'POST') {
    const l = findLead(L, decodeURIComponent(x[1])), b = body || {}, o = OUTCOMES.find((k) => k.key === b.outcome);
    if (!o) return J(r, 400, errBody('Pick what happened on the call.', 'BAD_OUTCOME'));
    if (o.stage && !L.migrated) return J(r, 503, errBody(NOT_READY, 'LEADS_NOT_MIGRATED'));
    if (!l) return J(r, 404, errBody('Not your party.', 'NOT_FOUND'));
    const t = today(); let day = null;
    if (o.key !== 'wrong_number') {
      if (o.ask) {
        if (b.due_at) { day = String(b.due_at).slice(0, 10); if (day < t) return J(r, 400, errBody('Pick a day from today.', 'BAD_DUE')); }
        else { const pick = b.after == null || b.after === '' ? (o.key === 'call_back' ? 'tomorrow' : null) : String(b.after); if (pick == null) return J(r, 400, errBody('When is the demo?', 'NEED_DAY')); if (!(pick in o.presets)) return J(r, 400, errBody('Pick today, tomorrow or 3 days.', 'BAD_AFTER')); day = addDays(t, o.presets[pick]); }
      } else day = addDays(t, o.days);
    }
    L.fu.filter((f) => f.party_id === l.party_id && !f.done_at).forEach((f) => { f.done_at = TD.nowIso(); });
    const interaction = Object.assign({ owner: 'ent-walk' }, addIx(L, l.party_id, 'call', 'out', o.label));   /* the outcome's 201 names the owner, as the api's does */
    const followup = day ? fuShape(addFu(L, l.party_id, o.then, day, 'interaction')) : null;
    const stage = o.stage && isLead(l) ? setStage(L, l, o.stage) : null;
    return J(r, 201, { interaction, followup, stage, suggest: null });
  }
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/stage$/)) && m === 'POST') {
    if (!L.migrated) return J(r, 503, errBody(NOT_READY, 'LEADS_NOT_MIGRATED'));
    const l = findLead(L, decodeURIComponent(x[1])), stage = String((body || {}).stage || '');
    if (STAGES.indexOf(stage) < 0) return J(r, 400, errBody('That is not one of the stages.', 'BAD_GROUP'));
    if (!l) return J(r, 404, errBody('Not one of your leads.', 'NOT_FOUND'));
    if (!isLead(l)) return J(r, 409, errBody('They are a customer now.', 'IS_CUSTOMER'));
    return J(r, 200, { ok: true, party_id: l.party_id, lead: setStage(L, l, stage) });
  }
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/interactions$/)) && m === 'POST') {
    const l = findLead(L, decodeURIComponent(x[1])); if (!l) return J(r, 404, errBody('Not your party.', 'NOT_FOUND'));
    const b = body || {}; return J(r, 201, { interaction: addIx(L, l.party_id, b.kind, b.direction || null, b.body) });
  }
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/timeline$/)) && m === 'GET') {
    const l = findLead(L, decodeURIComponent(x[1])); if (!l) return null;
    return J(r, 200, crmApi.timelinePage(tlEntries(L, l.party_id), l.party_id, { before: u.searchParams.get('before'), limit: u.searchParams.get('limit') }));   /* the one envelope (crm-api) */
  }
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)$/)) && m === 'GET') {
    const l = findLead(L, decodeURIComponent(x[1])); if (!l) return null;
    const row = leadRow(L, l), stage = row.lead.stage;
    row.lead = Object.assign({}, row.lead, { moves: STAGES.filter((g) => g !== stage), may: L.migrated ? { ok: true } : { ok: false, why: NOT_READY } });
    /* contact_prefs: a lead has no consent rows yet — the same answer the record builder gives (crm-api prefsBefore: service allowed, offers need consent) */
    return J(r, 200, Object.assign(row, { may: crmApi.mayOf(r), merged_from: null, relationship: null, points: null, migrated: true, contact_prefs: crmApi.prefsBefore(), followups: fuRows(L).filter((f) => f.party_id === l.party_id && !f.done_at).map(fuShape) }));
  }
  if (p === '/api/crm/followups' && m === 'GET') {
    const done = u.searchParams.get('done') === '1';
    const list2 = fuRows(L).filter((f) => !!f.done_at === done).map(fuShape);
    return J(r, 200, { followups: list2, total: list2.length, page: 1, limit: list2.length, late: list2.filter((x) => x.late).length, today: list2.filter((x) => x.today).length, shop_day: today(), may: crmApi.mayOf(r) });   /* W2-CRM: the one envelope · the shop's day · the server's may */
  }
  if (p === '/api/crm/followups' && m === 'POST') {
    const b = body || {}, l = findLead(L, b.party_id); if (!l) return J(r, 404, errBody('Not your party.', 'NOT_FOUND'));
    return J(r, 201, { followup: fuShape(addFu(L, l.party_id, b.what, String(b.due_at).slice(0, 10), b.source)) });
  }
  if ((x = p.match(/^\/api\/crm\/followups\/([^/]+)$/)) && (m === 'PATCH' || m === 'DELETE')) {
    const f = L.fu.find((y) => y.followup_id === decodeURIComponent(x[1])); if (!f) return J(r, 404, errBody('Not your follow-up.', 'NOT_FOUND'));
    if (m === 'DELETE') { L.fu = L.fu.filter((y) => y !== f); return J(r, 200, { ok: true }); }
    const b = body || {}; if (b.done === true) f.done_at = TD.nowIso(); if (b.due_at) f.due_at = b.due_at; if (b.assignee_user_id !== undefined) f.assignee_user_id = b.assignee_user_id;
    return J(r, 200, { followup: fuShape(Object.assign({}, fuRows(L).find((y) => y.followup_id === f.followup_id))) });
  }
  return null;
}

async function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method(); let x;
  S.calls.push(m + ' ' + p);
  if (S.l2c) { let body = null; try { body = q.postDataJSON(); } catch (_) {} const done = l2cRoute(S.l2c, r, q, u, p, m, body); if (done) return done; }
  if (S.priv) { let body = null; try { body = q.postDataJSON(); } catch (_) {} const done = privRoute(S, r, q, u, p, m, body, !S.viewer); if (done) return done; }
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Mayur Bhavan', currency_code: 'INR', ledger_on: true } });
  if (p === '/api/books/health') return J(r, 200, books.health(S.ledgerOff ? { enabled: false } : undefined));   /* ledgerOff: a shop with CB Accounts not switched on (T3-P3-CONSENT walk) */
  if (p === '/api/books/todo') return J(r, 200, []);
  if (p === '/api/books/accounts') return J(r, 200, { accounts: [{ code: '1300', name: 'Customers (Sundry Debtors)', is_group: false }, { code: '1400', name: 'Cash', is_group: false }, { code: '4000', name: 'Sales', is_group: false }].map((a) => books.accountRow(Object.assign({ account_id: 'acc-' + a.code }, a))) });
  if (p === '/api/books/trial-balance') return J(r, 200, books.trialBalance([]));
  if (p === '/api/books/dues') return J(r, 200, books.dues([], { asOf: TODAY }));
  if (p === '/api/books/cheques') return J(r, 200, books.cheques());
  if (p === '/api/books/returns') return J(r, 200, { form: null, pack: 'IN', code: 'RETURN_FROM_RAIL', why: "Your GSTR-1 and GSTR-3B are made from your bills, not from these books. Close and pay the month's GST here.", rail: '/api/tax/gstr' });   /* an INR shop: the contract's `GET /api/books/returns #rail` example (status 200), as the api sends it */
  if (p === '/api/books/daybook') return J(r, 200, books.daybook((S.noClose ? [] : [{ entry_id: 'e1', entry_no: 'JV/1', posting_date: TODAY, event_type: 'walkin_day', narration: 'Walk-in sales',
    source: { kind: 'day', counter: 'C1', count: 11, how: 'Cash', split: [{ how: 'Cash', amount_minor: 124000 }] }, lines: [{ code: '1400', name: 'Cash', dr_minor: 124000, cr_minor: 0 }, { code: '4000', name: 'Sales', dr_minor: 0, cr_minor: 124000 }] }]).map(books.entry)));
  if (p === '/api/books/pl') return J(r, 200, books.pl([], []));
  if (p === '/api/books/periods') return J(r, 200, books.periods([]));
  if ((x = p.match(/^\/api\/books\/party\/([^/]+)\/statement$/))) return J(r, 200, books.statement(decodeURIComponent(x[1])));   /* the record's Ledger section (as crm.cjs answers it) */
  if (p === '/api/books/terms') return J(r, 200, { terms_migrated: true, may_set: true, why_not: null, default: {}, party: null, events: [] });   /* the record's credit-terms read (CB_PARTY_EP booksTerms), as the contract shapes it */
  if (p === '/api/crm/parties' && m === 'GET') return J(r, 200, Object.assign(crmApi.list(fx.list, { records: fx.records }), { may: crmApi.mayOf(r) }));
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)$/)) && m === 'GET' && S.priv) {   /* T3-P3-CONSENT: the record with THIS walk's consent rows (lib/privacy.contactPrefsOf) */
    const id = decodeURIComponent(x[1]), row = fx.list.find((z) => z.party_id === id || z.party_no === id) || fx.list[0];
    return J(r, 200, Object.assign(crmApi.record(fx.list, row.party_id, fx.records[row.party_id], [], TD.nowMs()), { contact_prefs: pvContactPrefs(S.priv, row.party_id), may: crmApi.mayOf(r) }));
  }
  if ((x = p.match(/^\/api\/crm\/parties\/([^/]+)\/timeline$/)) && S.priv) { const id = decodeURIComponent(x[1]), row = fx.list.find((z) => z.party_id === id || z.party_no === id) || fx.list[0]; return J(r, 200, crmApi.timelinePage([], row.party_id, { limit: u.searchParams.get('limit') })); }
  if (p === '/api/crm/followups') return J(r, 200, Object.assign(crmApi.followups([]), { may: crmApi.mayOf(r) }));
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}
exports.standIn = standIn; exports.route = route;
exports.l2cState = l2cState; exports.l2cBill = l2cBill; exports.l2cStage = l2cStage; exports.viewerSession = viewerSession;
exports.privState = privState;
