// @stage tested
// @stage-note [CO1] privacy controls — contact consent (b306), the privacy-request register (b307), and the platform's privacy facts
// @stage-note (who processes what, where). 503 PRIVACY_NOT_MIGRATED until b306 / b307 run.
'use strict';
/**
 * lib/privacy.js — CO1 (web docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md K2 · K4 · K9 · K11). ONE place for:
 *
 *   FACTS             the sub-processors, what each one holds and WHERE (K9) — read by GET /api/privacy/facts and the RoPA
 *                     (web docs/compliance/ROPA.md points here; it keeps no second list)
 *   mayMessage        may this shop message this party on this channel for this purpose — may · why · code (K2, MKT-SRV1 G0)
 *   gate / refusal    the ONE send gate every sender and the interaction log ask (MKT-SRV1 G2 · CO1-GATE)
 *   prefs / notePref  the append-only consent rows of b306 — the newest row per (channel, purpose) is the answer
 *   isStopWord        CON-2: is a whole inbound message the country's word for "stop the offers" (lib/optout.js asks it)
 *   DUE_DAYS / dueAt  the legal clock for a request, per country and kind (K4 · K11)
 *   requests / logRequest / answerRequest   the b307 register
 *
 * ⭐ NOTHING HERE PRETENDS AN ORGANISATIONAL ACT IS DONE. The notice version and the grievance contact are NULL until the owner publishes
 *   them (env PRIVACY_NOTICE_VERSION · PRIVACY_CONTACT) — web docs/compliance/OWNER-ACTIONS.md. The facts answer says so in words.
 * ⚠️ No money here; no secret is read — a provider is "on" when its key is SET, the key itself never leaves process.env.
 *
 * owns: consent rows (party_contact_pref), the send gate, the request register and the per-country law words
 * called by: routes/privacy.js · routes/crm.js · lib/whatsapp-out.js · lib/crm-calls.js · lib/crm-groups.js
 * FLOW  gate(party | phone tail) → mayMessage(rows) → { may, why, code }
 * // CARD 11-crm-and-marketing/privacy-consent
 */
const F = require('./crm-followups');
const bad = F.bad;

/* ── K9 · the sub-processors and where the data sits. A region is a FACT from the repo or the environment, else null ("not stated"). ── */
const FACTS = [
  {
    name: 'Supabase (Postgres on AWS)',
    role: 'database — every chit, bill, book, party and account',
    region: 'ap-south-1 (Mumbai, India)',
    source: 'migrations/b257_where_an_installation_runs.sql header',
    always: true
  },
  {
    name: 'Railway',
    role: 'the API server and its request logs',
    region: () => process.env.RAILWAY_REPLICA_REGION || process.env.RAILWAY_REGION || null,
    source: 'env RAILWAY_REGION (also on GET /health)',
    always: true
  },
  { name: 'Vercel', role: 'the web app (static pages; no database)', region: null, source: 'not stated in the repo', always: true },
  { name: 'Resend', role: 'sign-in codes and mail by e-mail', region: null, source: 'lib/notify.js', on: () => !!process.env.RESEND_API_KEY },
  { name: 'Meta (WhatsApp Cloud API)', role: 'order updates by WhatsApp', region: null, source: 'lib/whatsapp-out.js', on: () => !!process.env.WHATSAPP_TOKEN },
  /* T1-AI: every model call goes through lib/ai.js invokeSkill — CB Assist's ask, conformance note and catalogue intro too. */
  {
    name: 'Anthropic',
    role: 'AI drafting of chits and catalogues, and Assist answers',
    region: null,
    source: 'lib/ai.js (all AI, incl. routes/assist.js)',
    on: () => !!process.env.ANTHROPIC_API_KEY
  },
  { name: 'OpenAI', role: 'speech and form reading', region: null, source: 'lib/speech.js · lib/forms.js', on: () => !!process.env.OPENAI_API_KEY }
];
function facts() {
  const val = (v) => (typeof v === 'function' ? v() : v);
  const notice = process.env.PRIVACY_NOTICE_VERSION || null,
    contact = process.env.PRIVACY_CONTACT || null;
  return {
    notice_version: notice,
    notice: notice ? 'Privacy notice ' + notice + ' is in force.' : 'No privacy notice is published yet. The owner publishes it.',
    contact,
    contact_line: contact ? 'Privacy questions and grievances: ' + contact : 'No privacy contact is named yet. The owner names one.',
    processors: FACTS.map((item) => ({
      name: item.name,
      role: item.role,
      region: val(item.region) || null,
      source: item.source,
      on: item.always ? true : !!val(item.on)
    })),
    due_days: DUE_DAYS
  };
}

/* ── K2 · consent ── */
const CHANNELS = ['phone', 'sms', 'whatsapp', 'email', 'chitbridge'];
const PURPOSES = ['service', 'marketing'];
const BASES = ['consent', 'legitimate_use'];

function notMigrated(n) {
  return bad('Privacy records need migration ' + n + ' — not run yet.', 503, 'PRIVACY_NOT_MIGRATED');
}
const _ok = {};
/** does the table exist? (a yes is remembered; a no is asked again — the day it is run, it just works) */
async function need(h, table, n) {
  if (_ok[table]) return;
  const r = await h.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [table]);
  if (!(r.rows[0] && r.rows[0].ok)) throw notMigrated(n);
  _ok[table] = true;
}
function forget() {
  Object.keys(_ok).forEach((item) => delete _ok[item]);
}

const iso = (v) => (v == null ? null : new Date(v).toISOString());
const prefShape = (r) => ({
  pref_id: r.pref_id,
  channel: r.channel,
  purpose: r.purpose,
  allowed: !!r.allowed,
  basis: r.basis,
  notice_version: r.notice_version || null,
  noted_at: iso(r.noted_at),
  noted_by: r.noted_by || null,
  withdrawn_at: iso(r.withdrawn_at),
  source: r.source || null,
  source_ref: r.source_ref || null
});
/** CON-2 (b777): who made a row - 'staff' | 'self' | 'reply' - and the capture that proves a reply. Code deploys before the migration, so ask (a no is rechecked every minute). */
const SOURCES = ['staff', 'self', 'reply'];
const sourceReady = () => require('./schema').hasColumn('party_contact_pref', 'source');
/** the extra RETURNING columns of a write that knows b777 has run */
const sourceCols = (ready) => (ready ? ', source, source_ref' : '');
/** READ the label whether or not b777 has run: to_jsonb(row)->>'source' is NULL when the column does not exist yet, and costs no extra query (a read must not add a trip) */
const sourceRead = (rowName) => `, to_jsonb(${rowName})->>'source' AS source, to_jsonb(${rowName})->>'source_ref' AS source_ref`;

/**
 * mayMessage(rows, channel, purpose) → { may, why, code } — rows newest first (prefs() order). PURE.
 *   service: may, on legitimate use (DPDP s.7 · PDPL Art.4 · APP 6.1) — unless the newest row for it says no.
 *   marketing: only on a consent row that is still standing (DPDP s.6 · Spam Act s.16 · APP 7) — no row means no.
 * `code` (MKT-SRV1 G0) is what a screen or a sender branches on — CODES below; `why` is the sentence it prints, never parsed.
 */
const CODES = {
  CONSENT: 'CONSENT',
  LEGITIMATE_USE: 'LEGITIMATE_USE',
  NO_CONSENT: 'NO_CONSENT',
  WITHDRAWN: 'CONSENT_WITHDRAWN',
  SAID_NO: 'SAID_NO',
  OPTED_OUT: 'OPTED_OUT'
};
/** the sentence for a withdrawal - names the reply when the row says it was a STOP reply (CON-2 C3); the code stays CONSENT_WITHDRAWN */
function withdrawnWhy(row, channel) {
  if (row.source !== 'reply') return 'They withdrew consent for offers on ' + channel + '.';
  const at = row.withdrawn_at || row.noted_at;
  return 'They replied STOP' + (at ? ' on ' + iso(at).slice(0, 10) : '') + '.';
}
function mayMessage(rows, channel, purpose) {
  const r = (rows || []).find((x) => x.channel === channel && x.purpose === purpose);
  if (purpose === 'marketing') {
    if (!r) return { may: false, code: CODES.NO_CONSENT, why: 'No consent for offers on ' + channel + '. Ask them first.' };
    if (!r.allowed)
      return r.withdrawn_at
        ? { may: false, code: CODES.WITHDRAWN, why: withdrawnWhy(r, channel) }
        : { may: false, code: CODES.SAID_NO, why: 'They said no to offers on ' + channel + '.' };
    return { may: true, code: CODES.CONSENT, why: 'They agreed to offers on ' + channel + '.' };
  }
  if (r && !r.allowed) return { may: false, code: CODES.OPTED_OUT, why: 'They asked not to be messaged on ' + channel + '.' };
  return { may: true, code: CODES.LEGITIMATE_USE, why: 'Messages about their own orders are allowed.' };
}
/** the answer per channel × purpose for one party's rows (newest first) — the `may` map GET contact-prefs, the list and the record all carry */
function mayAll(rows) {
  const may = {};
  CHANNELS.forEach((item) => {
    may[item] = {};
    PURPOSES.forEach((p) => {
      may[item][p] = mayMessage(rows, item, p);
    });
  });
  return may;
}
/** every row for one party, newest first, and the answer per channel × purpose */
async function prefs(h, owner, party_id) {
  await need(h, 'party_contact_pref', 'b306');
  const r = await h.query(
    `SELECT pref_id, channel, purpose, allowed, basis, notice_version, noted_at, noted_by, withdrawn_at${sourceRead('party_contact_pref')} FROM party_contact_pref
                            WHERE owner_entity_id = $1 AND party_id = $2 ORDER BY noted_at DESC LIMIT 500`,
    [owner, party_id]
  );
  const history = r.rows.map(prefShape);
  return { history, may: mayAll(history) };
}

/** the newest row for this (channel, purpose): by the party's id, else by any of the shop's parties whose phone or sign-in contact has the number's last 9 digits (R1) */
async function newestRow(handle, owner, target, channel, purpose) {
  if (target.party_id) {
    const byParty = await handle.query(
      `SELECT channel, purpose, allowed, basis, withdrawn_at, pref_id, noted_at${sourceRead('party_contact_pref')} FROM party_contact_pref
                             WHERE owner_entity_id = $1 AND party_id = $2 AND channel = $3 AND purpose = $4 ORDER BY noted_at DESC LIMIT 1`,
      [owner, target.party_id, channel, purpose]
    );
    return byParty.rows;
  }
  const { phoneMatchKey, phoneTailSql } = require('./stores'),
    key = phoneMatchKey(target.to_ref); /* R1: a WhatsApp number carries the country code, the counter's phone often does not */
  if (!key) return [];
  const byNumber = await handle.query(
    `SELECT p.channel, p.purpose, p.allowed, p.basis, p.withdrawn_at, p.pref_id, p.noted_at${sourceRead('p')} FROM party_contact_pref p JOIN identities i ON i.identity_id = p.party_id
                             WHERE p.owner_entity_id = $1 AND p.channel = $3 AND p.purpose = $4
                               AND $2 IN (${phoneTailSql('i.phone')}, ${phoneTailSql('i.otp_contact')})
                             ORDER BY p.noted_at DESC LIMIT 1`,
    [owner, key, channel, purpose]
  );
  return byNumber.rows;
}
/**
 * ⭐ THE SEND GATE (MKT-SRV1 G2 · CO1-GATE) — the ONE reader every sender and the interaction log ask before contacting a party.
 * gate(h, owner, { party_id } | { to_ref }, channel, purpose) → { may, why, code, migrated }. ONE statement: the newest row for this
 * (channel, purpose), found by the party's id, or — for a WhatsApp reply that only knows a phone — by any of the shop's parties whose
 * phone or sign-in contact has the same digits. Before b306 there are no rows: service passes, offers are refused (no consent can exist).
 */
async function gate(h, owner, who, channel, purpose) {
  if (CHANNELS.indexOf(channel) < 0 || PURPOSES.indexOf(purpose) < 0) throw bad('Channel or purpose is not one we know.', 400, 'BAD_CHANNEL');
  const w = who || {};
  let migrated = true;
  try {
    await need(h, 'party_contact_pref', 'b306');
  } catch (e) {
    if (e && e.code === 'PRIVACY_NOT_MIGRATED') migrated = false;
    else throw e;
  }
  const rows = migrated && (w.party_id || w.to_ref) ? await newestRow(h, owner, w, channel, purpose) : [];
  /* MKT-17: the row this verdict rests on — a send stores {code, pref_id, at} as its consent proof (channel_outbound.basis) */
  const pref = rows[0] ? { id: rows[0].pref_id || null, at: rows[0].noted_at || null } : null;
  return Object.assign(mayMessage(rows, channel, purpose), { migrated, pref });
}
/** a refused verdict as the error a route answers: 403 { code, why } */
function refusal(v) {
  const e = bad(v.why, 403, v.code);
  e.why = v.why;
  return e;
}
/** the newest row per (party, channel, purpose) for MANY parties in one statement (the list's ?with=consent) — SQL text, $1 = owner */
const LATEST_SQL = (one) => `SELECT DISTINCT ON (party_id, channel, purpose) party_id, channel, purpose, allowed, basis, withdrawn_at${sourceRead('party_contact_pref')} FROM party_contact_pref
  WHERE owner_entity_id = $1${one ? ' AND party_id = $2' : ''} ORDER BY party_id, channel, purpose, noted_at DESC`;
/** rows of LATEST_SQL (or null: b306 not run) → Map party_id → { migrated, may } — `contactPrefsOf(map, id)` answers a party with no rows too */
function contactPrefs(rows) {
  const by = new Map();
  (rows || []).forEach((item) => {
    const k = String(item.party_id);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(item);
  });
  return by;
}
function contactPrefsOf(by, party_id) {
  return { migrated: !!by, may: mayAll(by ? by.get(String(party_id)) || [] : []) };
}

/** the words of one consent change, checked: { channel, purpose, basis } - or the sentence that says what is wrong (400) */
function checkedPref(x) {
  const channel = String(x.channel || '').toLowerCase(),
    purpose = String(x.purpose || '').toLowerCase();
  if (CHANNELS.indexOf(channel) < 0) throw bad('Channel is phone, sms, whatsapp, email or chitbridge.');
  if (PURPOSES.indexOf(purpose) < 0) throw bad('Purpose is service or marketing.');
  if (typeof x.allowed !== 'boolean') throw bad('Say yes or no.');
  const basis = x.basis == null ? (purpose === 'marketing' ? 'consent' : 'legitimate_use') : String(x.basis);
  if (BASES.indexOf(basis) < 0) throw bad('Basis is consent or legitimate_use.');
  if (purpose === 'marketing' && x.allowed && basis !== 'consent') throw bad('Offers need their consent.');
  if (x.source != null && SOURCES.indexOf(x.source) < 0) throw bad('Source is staff, self or reply.');
  return { channel, purpose, basis };
}
/** one new row: a yes, a no, or a withdrawal of an earlier yes (the earlier rows stay — the proof of what was said when) */
async function notePref(h, owner, party_id, b, by) {
  await need(h, 'party_contact_pref', 'b306');
  const x = b || {},
    { channel, purpose, basis } = checkedPref(x);
  const before = (await prefs(h, owner, party_id)).history.find((item) => item.channel === channel && item.purpose === purpose);
  const withdrawn = !x.allowed && before && before.allowed && before.basis === 'consent';
  const withSource = !!x.source && (await sourceReady()); /* b777 not run yet: the row is still written, only its label is lost */
  const values = [owner, party_id, channel, purpose, x.allowed, basis, process.env.PRIVACY_NOTICE_VERSION || null, by || null];
  if (withSource) values.push(x.source, x.source_ref || null);
  const inserted = await h.query(
    `INSERT INTO party_contact_pref (owner_entity_id, party_id, channel, purpose, allowed, basis, notice_version, noted_by, withdrawn_at${withSource ? ', source, source_ref' : ''})
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${withdrawn ? 'now()' : 'NULL'}${withSource ? ', $9, $10' : ''})
                           RETURNING pref_id, channel, purpose, allowed, basis, notice_version, noted_at, noted_by, withdrawn_at${sourceCols(withSource)}`,
    values
  );
  return prefShape(inserted.rows[0]);
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
  '*': { '*': 30, basis: 'our rule' }
};
/**
 * ⭐ THE LAW'S WORDS PER COUNTRY (T3-P3-CONSENT) — what the shopper's privacy page and the CRM consent block paint, beside DUE_DAYS (the one
 * per-country privacy table). `kinds` is what a screen draws buttons from (never a regex over prose): the requests that law gives a person.
 * A country with no pack says so and offers every kind (the widest rights) — NEVER India's words for an unstated country.
 */
/**
 * CON-2 · the words a person may reply to stop offers, per country (LAW[c].optout). `words` are matched against the WHOLE message only
 * (isStopWord); `line` is appended to every offer we send (the Spam Act: an opt-out in every message); `done` is the one confirmation sentence
 * ({shop} = the shop's name). OPTOUT_BASE is English and serves every country, and a shop with no country gets it ALONE.
 * ⚠️ the local-language words below are PROPOSED: cb-country confirms them before merge.
 */
const OPTOUT_BASE = ['STOP', 'STOP ALL', 'UNSUBSCRIBE', 'OPT OUT']; /* CANCEL, END and QUIT are left out on purpose: people use them to cancel an ORDER (cb-country, #320) */
const OPTOUT_LINE = 'Reply STOP to stop offers.';
const OPTOUT_DONE = 'You will get no more offers from {shop}. Order messages still reach you.';
const optoutPack = (localWords) => ({ words: OPTOUT_BASE.concat(localWords || []), line: OPTOUT_LINE, done: OPTOUT_DONE });
const LAW = {
  IN: {
    law: 'Digital Personal Data Protection Act 2023',
    short: 'DPDP Act',
    authority: 'Data Protection Board of India',
    consent: 'Offers need your consent. You may withdraw it at any time.',
    rights: 'You may see, correct or erase your data, or name a nominee.',
    kinds: ['access', 'correct', 'erase', 'withdraw', 'nominate', 'grievance'],
    optout: optoutPack() /* Hindi/Tamil words and transliterations wait for a native-speaker check (pending Athi) */
  },
  AU: {
    law: 'Privacy Act 1988 (Cth)',
    short: 'Privacy Act',
    authority: 'Office of the Australian Information Commissioner',
    consent: 'Offers need your consent. You may opt out at any time.',
    rights: 'You may see and correct your data.',
    kinds: ['access', 'correct', 'withdraw', 'grievance'],
    optout: optoutPack()
  },
  AE: {
    law: 'Federal Decree-Law 45/2021 (Personal Data Protection)',
    short: 'PDPL',
    authority: 'UAE Data Office',
    consent: 'Offers need your consent. Withdrawing it is your right.',
    rights: 'You may see, correct or erase your data.',
    kinds: ['access', 'correct', 'erase', 'withdraw', 'grievance'],
    optout: optoutPack(['إيقاف', 'ايقاف', 'إلغاء الاشتراك', 'الغاء الاشتراك']) /* never a bare إلغاء (cancel) */
  }
};
function lawOf(country) {
  const c = country ? String(country).toUpperCase() : null,
    L = c && LAW[c];
  if (L) return Object.assign({ country: c, known: true, note: null, due_days: dueDays(c, '*') }, L);
  return {
    country: c,
    known: false,
    law: null,
    short: null,
    authority: null,
    consent: 'Offers need your consent. You may withdraw it at any time.',
    rights: 'You may see, correct or erase your data.',
    kinds: KINDS.slice(),
    optout: optoutPack(),
    note: c ? 'No privacy pack for ' + c + ' yet. Every request kind is offered.' : 'The shop has no country set, so its privacy law is not known.',
    due_days: dueDays(c, '*')
  };
}
/** a reply folded to compare: Unicode-normalised, upper-cased, punctuation and symbols dropped, spaces collapsed ("Stop." and " STOP! " are one word) */
function foldReply(text) {
  return String(text == null ? '' : text)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/** is the WHOLE message one of the country's stop words? Pure. "stop by at 5 for 2kg rice" is an order, so a word inside a sentence never counts. */
function isStopWord(text, country) {
  const folded = foldReply(text);
  return !!folded && lawOf(country).optout.words.some((word) => foldReply(word) === folded);
}
/** the shop's country (upper-case ISO code, or null when unstated) and name — ONE read, for lib/optout and the offers footer */
async function shopFacts(handle, owner) {
  const found = await handle.query(`SELECT country, display_name FROM identities WHERE identity_id = $1`, [owner]);
  const row = found.rows[0] || {};
  return { country: row.country ? String(row.country).toUpperCase() : null, name: row.display_name || null };
}
function dueDays(country, kind) {
  const c = DUE_DAYS[country] || DUE_DAYS['*'];
  return c[kind] || c['*'];
}
function dueAt(received, country, kind) {
  return new Date(Date.parse(received) + dueDays(country, kind) * 86400000).toISOString();
}
const reqShape = (r, now) => ({
  request_id: r.request_id,
  party_id: r.party_id || null,
  who: r.who,
  kind: r.kind,
  country: r.country,
  received_at: iso(r.received_at),
  due_at: iso(r.due_at),
  answered_at: iso(r.answered_at),
  outcome: r.outcome || null,
  answer: r.answer || null,
  late: !r.answered_at && Date.parse(r.due_at) < now,
  answered_late: !!r.answered_at && Date.parse(r.answered_at) > Date.parse(r.due_at)
});
const REQ_COLS = 'request_id, party_id, who, kind, country, received_at, due_at, answered_at, outcome, answer';

/**
 * requests(h, owner, { open?, page?, limit? }) → { requests, total, page, limit, open, late } — ONE statement: the counts over the whole
 * register (or the open ones) and one page of rows, open first by due date (MKT-SRV1 G4: every list answers total · page · limit).
 */
async function requests(h, owner, o) {
  await need(h, 'privacy_request', 'b307');
  const x = o || {},
    open = !!x.open,
    PL = require('./page-limit');
  const limit = PL.limitOf(x.limit, 50, 200),
    page = PL.pageOf(x.page);
  /* party_id (T3-P3-CONSENT): the shopper's own requests only — the same statement, one more AND */
  const where = `owner_entity_id = $1${open ? ' AND answered_at IS NULL' : ''}${x.party_id ? ' AND party_id = $4' : ''}`;
  const args = [owner, limit, (page - 1) * limit].concat(x.party_id ? [x.party_id] : []);
  const r = await h.query(
    `WITH c AS (SELECT count(*)::int AS total, (count(*) FILTER (WHERE answered_at IS NULL))::int AS n_open,
                                  (count(*) FILTER (WHERE answered_at IS NULL AND due_at < now()))::int AS n_late FROM privacy_request WHERE ${where})
                           SELECT c.total, c.n_open, c.n_late, r.* FROM c LEFT JOIN LATERAL (SELECT ${REQ_COLS} FROM privacy_request WHERE ${where}
                             ORDER BY (answered_at IS NULL) DESC, due_at ASC LIMIT $2 OFFSET $3) r ON true`,
    args
  );
  const now = Date.now(),
    head = r.rows[0] || {};
  return {
    requests: r.rows.filter((nestedX) => nestedX.request_id).map((nestedX) => reqShape(nestedX, now)),
    total: Number(head.total) || 0,
    page,
    limit,
    open: Number(head.n_open) || 0,
    late: Number(head.n_late) || 0
  };
}
async function logRequest(h, owner, b, by) {
  await need(h, 'privacy_request', 'b307');
  const x = b || {},
    kind = String(x.kind || '').toLowerCase();
  if (KINDS.indexOf(kind) < 0) throw bad('Kind is access, correct, erase, withdraw, nominate or grievance.');
  const who = String(x.who == null ? '' : x.who)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  if (!who) throw bad('Who asked? A name, phone or e-mail.');
  let country = x.country ? String(x.country).toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) throw bad('Country is a two-letter code, like IN.');
  if (!country) {
    country = (await shopFacts(h, owner)).country;
  }
  /* GOV-AU1: whose law sets the clock is never guessed (privacy_request.country is NOT NULL) — asked, in words */
  if (!country) throw bad('Which country\u2019s law applies? Give its two-letter code, like AU — or set the shop\u2019s country first.');
  const received = x.received_at ? Date.parse(x.received_at) : Date.now();
  if (!isFinite(received)) throw bad('When did it come in? Give a date.');
  if (received > Date.now() + 60000) throw bad('It cannot come in tomorrow.');
  const rec = new Date(received).toISOString();
  const r = await h.query(
    `INSERT INTO privacy_request (owner_entity_id, party_id, who, kind, country, received_at, due_at, created_by)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${REQ_COLS}`,
    [owner, x.party_id || null, who, kind, country, rec, dueAt(rec, country, kind), by || null]
  );
  return reqShape(r.rows[0], Date.now());
}
async function answerRequest(h, owner, id, b, by) {
  await need(h, 'privacy_request', 'b307');
  const x = b || {},
    outcome = String(x.outcome || '').toLowerCase();
  if (['done', 'partly', 'refused'].indexOf(outcome) < 0) throw bad('Outcome is done, partly or refused.');
  const answer = String(x.answer == null ? '' : x.answer)
    .trim()
    .slice(0, 2000);
  if (!answer) throw bad('Write what was done, or why not.');
  const r = await h.query(
    `UPDATE privacy_request SET answered_at = now(), answered_by = $3, outcome = $4, answer = $5
                            WHERE owner_entity_id = $1 AND request_id = $2 AND answered_at IS NULL RETURNING ${REQ_COLS}`,
    [owner, id, by || null, outcome, answer]
  );
  if (!r.rows[0]) throw await unanswerable(h, owner, id);
  return reqShape(r.rows[0], Date.now());
}
/** why no row took the answer (S35): a request this shop does not hold — unknown, or another shop's — is the one 404; one it holds was answered already (409, an answer is given once) */
async function unanswerable(handle, owner, id) {
  const held = await handle.query(`SELECT 1 FROM privacy_request WHERE owner_entity_id = $1 AND request_id = $2`, [owner, id]);
  return held.rows.length ? bad('Not found, or already answered — an answer is given once.', 409, 'ANSWERED') : bad('No such request.', 404, 'NOT_FOUND');
}

/* ── T3-P3-CONSENT · the shopper's own privacy answer — ONE transaction as the SHOP (its rows, its law), scoped by the server to THIS party ── */
/** what the platform holds about the person, as lines a page paints: { key, label, value | null } — a null is said as "not held", never dropped */
function heldOf(my) {
  return [
    { key: 'name', label: 'Name', value: my.display_name || null },
    { key: 'phone', label: 'Phone', value: my.phone || null },
    { key: 'contact', label: 'Sign-in contact', value: my.otp_contact || my.email || null },
    { key: 'orders', label: 'Orders and bills', value: 'On the chits you and the shop both hold (My orders).' }
  ];
}
/** the migration-aware read: the value, or null with the code the page greys on */
async function readOr(fn) {
  try {
    return { value: await fn(), may: { may: true, code: 'OK', why: null } };
  } catch (e) {
    if (e && e.code === 'PRIVACY_NOT_MIGRATED')
      return { value: null, may: { may: false, code: e.code, why: 'Not set up yet at this shop. Ask the shop directly.' } };
    throw e;
  }
}
/**
 * shopper(h, shop, me) → { shop: { name, country }, law, held[], consent: { migrated, history, may }, requests: { migrated, requests[], total },
 *                         may_consent { may, code, why }, may_request { may, code, why } }
 * Two statements + the b306/b307 reads: the two identity rows at once, then prefs() and requests() (each says in a code when its table is absent).
 */
async function shopper(h, shop, me) {
  const ids = (
    await h.query(`SELECT identity_id, display_name, phone, email, otp_contact, country FROM identities WHERE identity_id = ANY($1::uuid[])`, [[shop, me]])
  ).rows;
  const my = ids.find((item) => item.identity_id === me) || {},
    sh = ids.find((item) => item.identity_id === shop) || {};
  const pr = await readOr(() => prefs(h, shop, me)),
    rq = await readOr(() => requests(h, shop, { party_id: me, limit: 50 }));
  return {
    shop: { name: sh.display_name || null, country: sh.country ? String(sh.country).toUpperCase() : null },
    law: lawOf(sh.country),
    held: heldOf(my),
    consent: pr.value ? { migrated: true, history: pr.value.history, may: pr.value.may } : { migrated: false, history: [], may: mayAll([]) },
    requests: rq.value ? { migrated: true, requests: rq.value.requests, total: rq.value.total } : { migrated: false, requests: [], total: 0 },
    may_consent: pr.may,
    may_request: rq.may
  };
}

module.exports = {
  LAW,
  lawOf,
  shopper,
  FACTS,
  facts,
  CHANNELS,
  PURPOSES,
  BASES,
  KINDS,
  DUE_DAYS,
  dueDays,
  dueAt,
  isStopWord,
  OPTOUT_LINE,
  shopFacts,
  CODES,
  mayMessage,
  mayAll,
  gate,
  refusal,
  LATEST_SQL,
  contactPrefs,
  contactPrefsOf,
  prefs,
  notePref,
  requests,
  logRequest,
  answerRequest,
  need,
  forget,
  notMigrated
};
