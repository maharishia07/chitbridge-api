// @stage tested
// @stage-note [CO1] privacy controls — contact consent (b306), the privacy-request register (b307), and the platform's privacy facts
// @stage-note (who processes what, where). 503 PRIVACY_NOT_MIGRATED until b306 / b307 run.
'use strict';
/**
 * lib/privacy.js — CO1 (web docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md K2 · K4 · K9 · K11). ONE place for:
 *
 *   FACTS             the sub-processors, what each one holds and WHERE (K9) — read by GET /api/privacy/facts and the RoPA
 *                     (web docs/compliance/ROPA.md points here; it keeps no second list)
 *   mayMessage        the send-gate: may this shop message this party on this channel for this purpose, and why (K2)
 *   prefs / notePref  the append-only consent rows of b306 — the newest row per (channel, purpose) is the answer
 *   DUE_DAYS / dueAt  the legal clock for a request, per country and kind (K4 · K11)
 *   requests / logRequest / answerRequest   the b307 register
 *
 * ⭐ NOTHING HERE PRETENDS AN ORGANISATIONAL ACT IS DONE. The notice version and the grievance contact are NULL until the owner publishes
 *   them (env PRIVACY_NOTICE_VERSION · PRIVACY_CONTACT) — web docs/compliance/OWNER-ACTIONS.md. The facts answer says so in words.
 * ⚠️ No money here; no secret is read — a provider is "on" when its key is SET, the key itself never leaves process.env.
 */
const F = require('./crm-followups');
const bad = F.bad;

/* ── K9 · the sub-processors and where the data sits. A region is a FACT from the repo or the environment, else null ("not stated"). ── */
const FACTS = [
  { name: 'Supabase (Postgres on AWS)', role: 'database — every chit, bill, book, party and account', region: 'ap-south-1 (Mumbai, India)',
    source: 'migrations/b257_where_an_installation_runs.sql header', always: true },
  { name: 'Railway', role: 'the API server and its request logs', region: () => process.env.RAILWAY_REPLICA_REGION || process.env.RAILWAY_REGION || null,
    source: 'env RAILWAY_REGION (also on GET /health)', always: true },
  { name: 'Vercel', role: 'the web app (static pages; no database)', region: null, source: 'not stated in the repo', always: true },
  { name: 'Resend', role: 'sign-in codes and mail by e-mail', region: null, source: 'lib/notify.js', on: () => !!process.env.RESEND_API_KEY },
  { name: 'Meta (WhatsApp Cloud API)', role: 'order updates by WhatsApp', region: null, source: 'lib/whatsapp-out.js', on: () => !!process.env.WHATSAPP_TOKEN },
  /* T1-AI: every model call goes through lib/ai.js invokeSkill — CB Assist's ask, conformance note and catalogue intro too. */
  { name: 'Anthropic', role: 'AI drafting of chits and catalogues, and CB Assist answers', region: null, source: 'lib/ai.js (all AI, incl. routes/assist.js)', on: () => !!process.env.ANTHROPIC_API_KEY },
  { name: 'OpenAI', role: 'speech and form reading', region: null, source: 'lib/speech.js · lib/forms.js', on: () => !!process.env.OPENAI_API_KEY },
];
function facts() {
  const val = (v) => (typeof v === 'function' ? v() : v);
  const notice = process.env.PRIVACY_NOTICE_VERSION || null, contact = process.env.PRIVACY_CONTACT || null;
  return {
    notice_version: notice,
    notice: notice ? 'Privacy notice ' + notice + ' is in force.' : 'No privacy notice is published yet. The owner publishes it.',
    contact,
    contact_line: contact ? 'Privacy questions and grievances: ' + contact : 'No privacy contact is named yet. The owner names one.',
    processors: FACTS.map((f) => ({ name: f.name, role: f.role, region: val(f.region) || null, source: f.source, on: f.always ? true : !!val(f.on) })),
    due_days: DUE_DAYS,
  };
}

/* ── K2 · consent ── */
const CHANNELS = ['phone', 'sms', 'whatsapp', 'email', 'chitbridge'];
const PURPOSES = ['service', 'marketing'];
const BASES = ['consent', 'legitimate_use'];

function notMigrated(n) { return bad('Privacy records need migration ' + n + ' — not run yet.', 503, 'PRIVACY_NOT_MIGRATED'); }
const _ok = {};
/** does the table exist? (a yes is remembered; a no is asked again — the day it is run, it just works) */
async function need(h, table, n) {
  if (_ok[table]) return;
  const r = await h.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [table]);
  if (!(r.rows[0] && r.rows[0].ok)) throw notMigrated(n);
  _ok[table] = true;
}
function forget() { Object.keys(_ok).forEach((k) => delete _ok[k]); }

const iso = (v) => (v == null ? null : new Date(v).toISOString());
const prefShape = (r) => ({ pref_id: r.pref_id, channel: r.channel, purpose: r.purpose, allowed: !!r.allowed, basis: r.basis, notice_version: r.notice_version || null,
  noted_at: iso(r.noted_at), noted_by: r.noted_by || null, withdrawn_at: iso(r.withdrawn_at) });

/**
 * mayMessage(rows, channel, purpose) → { may, why } — rows newest first (prefs() order). PURE.
 *   service: may, on legitimate use (DPDP s.7 · PDPL Art.4 · APP 6.1) — unless the newest row for it says no.
 *   marketing: only on a consent row that is still standing (DPDP s.6 · Spam Act s.16 · APP 7) — no row means no.
 */
function mayMessage(rows, channel, purpose) {
  const r = (rows || []).find((x) => x.channel === channel && x.purpose === purpose);
  if (purpose === 'marketing') {
    if (!r) return { may: false, why: 'No consent for offers on ' + channel + '. Ask them first.' };
    if (!r.allowed) return { may: false, why: r.withdrawn_at ? 'They withdrew consent for offers on ' + channel + '.' : 'They said no to offers on ' + channel + '.' };
    return { may: true, why: 'They agreed to offers on ' + channel + '.' };
  }
  if (r && !r.allowed) return { may: false, why: 'They asked not to be messaged on ' + channel + '.' };
  return { may: true, why: 'Messages about their own orders are allowed.' };
}
/** every row for one party, newest first, and the answer per channel × purpose */
async function prefs(h, owner, party_id) {
  await need(h, 'party_contact_pref', 'b306');
  const r = await h.query(`SELECT pref_id, channel, purpose, allowed, basis, notice_version, noted_at, noted_by, withdrawn_at FROM party_contact_pref
                            WHERE owner_entity_id = $1 AND party_id = $2 ORDER BY noted_at DESC LIMIT 500`, [owner, party_id]);
  const history = r.rows.map(prefShape), may = {};
  CHANNELS.forEach((c) => { may[c] = {}; PURPOSES.forEach((p) => { may[c][p] = mayMessage(history, c, p); }); });
  return { history, may };
}
/** one new row: a yes, a no, or a withdrawal of an earlier yes (the earlier rows stay — the proof of what was said when) */
async function notePref(h, owner, party_id, b, by) {
  await need(h, 'party_contact_pref', 'b306');
  const x = b || {}, channel = String(x.channel || '').toLowerCase(), purpose = String(x.purpose || '').toLowerCase();
  if (CHANNELS.indexOf(channel) < 0) throw bad('Channel is phone, sms, whatsapp, email or chitbridge.');
  if (PURPOSES.indexOf(purpose) < 0) throw bad('Purpose is service or marketing.');
  if (typeof x.allowed !== 'boolean') throw bad('Say yes or no.');
  const basis = x.basis == null ? (purpose === 'marketing' ? 'consent' : 'legitimate_use') : String(x.basis);
  if (BASES.indexOf(basis) < 0) throw bad('Basis is consent or legitimate_use.');
  if (purpose === 'marketing' && x.allowed && basis !== 'consent') throw bad('Offers need their consent.');
  const before = (await prefs(h, owner, party_id)).history.find((r) => r.channel === channel && r.purpose === purpose);
  const withdrawn = !x.allowed && before && before.allowed && before.basis === 'consent';
  const r = await h.query(`INSERT INTO party_contact_pref (owner_entity_id, party_id, channel, purpose, allowed, basis, notice_version, noted_by, withdrawn_at)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${withdrawn ? 'now()' : 'NULL'})
                           RETURNING pref_id, channel, purpose, allowed, basis, notice_version, noted_at, noted_by, withdrawn_at`,
    [owner, party_id, channel, purpose, x.allowed, basis, process.env.PRIVACY_NOTICE_VERSION || null, by || null]);
  return prefShape(r.rows[0]);
}

/* ── K4 · K11 · the request register ── */
const KINDS = ['access', 'correct', 'erase', 'withdraw', 'nominate', 'grievance'];
/**
 * The legal clock, in days, per country — the SHORTEST rule in force today, each with its source. A country not listed takes '*'.
 *   IN  grievance 15: IT Intermediary Rules 2021 r.3(2) (if CB is an intermediary — open legal question; the stricter clock until advised).
 *       others 30: SPDI Rules 2011 r.5(9) "within one month" (in force now; DPDP Rules r.14's 90 days start May 2027 and are longer).
 *   AU  30: APP 12.4 / 13.5 "a reasonable period" — OAIC guidance, usually 30 days.
 *   AE  30: PDPL Art.13–18 — the Executive Regulation that sets the period is not issued; 30 days is our own rule until it is.
 */
const DUE_DAYS = {
  IN: { grievance: 15, '*': 30, basis: 'IT Intermediary Rules 2021 r.3(2) · SPDI Rules 2011 r.5(9)' },
  AU: { '*': 30, basis: 'Privacy Act 1988 APP 12.4, 13.5 (OAIC: usually 30 days)' },
  AE: { '*': 30, basis: 'PDPL Art.13–18 — period not yet set by regulation; our rule' },
  '*': { '*': 30, basis: 'our rule' },
};
function dueDays(country, kind) { const c = DUE_DAYS[country] || DUE_DAYS['*']; return c[kind] || c['*']; }
function dueAt(received, country, kind) { return new Date(Date.parse(received) + dueDays(country, kind) * 86400000).toISOString(); }
const reqShape = (r, now) => ({ request_id: r.request_id, party_id: r.party_id || null, who: r.who, kind: r.kind, country: r.country,
  received_at: iso(r.received_at), due_at: iso(r.due_at), answered_at: iso(r.answered_at), outcome: r.outcome || null, answer: r.answer || null,
  late: !r.answered_at && Date.parse(r.due_at) < now, answered_late: !!r.answered_at && Date.parse(r.answered_at) > Date.parse(r.due_at) });
const REQ_COLS = 'request_id, party_id, who, kind, country, received_at, due_at, answered_at, outcome, answer';

async function requests(h, owner, o) {
  await need(h, 'privacy_request', 'b307');
  const open = !!(o && o.open);
  const r = await h.query(`SELECT ${REQ_COLS} FROM privacy_request WHERE owner_entity_id = $1${open ? ' AND answered_at IS NULL' : ''}
                           ORDER BY (answered_at IS NULL) DESC, due_at ASC LIMIT 2000`, [owner]);
  const now = Date.now();
  return r.rows.map((x) => reqShape(x, now));
}
async function logRequest(h, owner, b, by) {
  await need(h, 'privacy_request', 'b307');
  const x = b || {}, kind = String(x.kind || '').toLowerCase();
  if (KINDS.indexOf(kind) < 0) throw bad('Kind is access, correct, erase, withdraw, nominate or grievance.');
  const who = String(x.who == null ? '' : x.who).trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!who) throw bad('Who asked? A name, phone or e-mail.');
  let country = x.country ? String(x.country).toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) throw bad('Country is a two-letter code, like IN.');
  if (!country) { const c = await h.query(`SELECT country FROM identities WHERE identity_id = $1`, [owner]); country = c.rows[0] && c.rows[0].country ? String(c.rows[0].country).toUpperCase() : null; }
  /* GOV-AU1: whose law sets the clock is never guessed (privacy_request.country is NOT NULL) — asked, in words */
  if (!country) throw bad('Which country\u2019s law applies? Give its two-letter code, like AU — or set the shop\u2019s country first.');
  const received = x.received_at ? Date.parse(x.received_at) : Date.now();
  if (!isFinite(received)) throw bad('When did it come in? Give a date.');
  if (received > Date.now() + 60000) throw bad('It cannot come in tomorrow.');
  const rec = new Date(received).toISOString();
  const r = await h.query(`INSERT INTO privacy_request (owner_entity_id, party_id, who, kind, country, received_at, due_at, created_by)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${REQ_COLS}`,
    [owner, x.party_id || null, who, kind, country, rec, dueAt(rec, country, kind), by || null]);
  return reqShape(r.rows[0], Date.now());
}
async function answerRequest(h, owner, id, b, by) {
  await need(h, 'privacy_request', 'b307');
  const x = b || {}, outcome = String(x.outcome || '').toLowerCase();
  if (['done', 'partly', 'refused'].indexOf(outcome) < 0) throw bad('Outcome is done, partly or refused.');
  const answer = String(x.answer == null ? '' : x.answer).trim().slice(0, 2000);
  if (!answer) throw bad('Write what was done, or why not.');
  const r = await h.query(`UPDATE privacy_request SET answered_at = now(), answered_by = $3, outcome = $4, answer = $5
                            WHERE owner_entity_id = $1 AND request_id = $2 AND answered_at IS NULL RETURNING ${REQ_COLS}`, [owner, id, by || null, outcome, answer]);
  if (!r.rows[0]) throw bad('Not found, or already answered — an answer is given once.', 409, 'ANSWERED');
  return reqShape(r.rows[0], Date.now());
}

module.exports = { FACTS, facts, CHANNELS, PURPOSES, BASES, KINDS, DUE_DAYS, dueDays, dueAt, mayMessage, prefs, notePref, requests, logRequest, answerRequest, need, forget, notMigrated };
