// OWNS      whether a chit meets a declared condition: validate (unknown keys refused) · match · firstMatch; KEYS is the set of condition keys
// CALLED BY lib/folder-inventory.js, lib/folder-rules.js, lib/folder-views.js, routes/folders.js
// FLOW      chit + condition object ──▶ validate(cond) (unknown keys refused) ──▶ match(chit, cond) / firstMatch(chit, rules) ──▶ boolean, or the first rule that fits
// CARD      01-rail-core-the-chit/user-folders-and-auto-file-rules
'use strict';
// lib/match.js — DOES THIS CHIT MEET A DECLARED CONDITION. The third shared primitive.
//
// select.js answers "which chits", measure.js answers "how many / how old". This answers it for ONE chit, which is
// what a rule needs at the moment a chit arrives. Same vocabulary as the selector, deliberately.
//
// ── ⚠️ NO RULE DSL, AND NOT BY ACCIDENT ─────────────────────────────────────────────────────────────────────────
// Two independent references say the same thing. Gmail's filter conditions ARE its search-box syntax — one grammar,
// so anything you can find you can automate. ServiceNow's own SLA guidance says prefer DECLARATIVE conditions and
// keep scripted ones small and rare. Outlook is the counter-example people complain about, precisely because its UI
// invites fuzzy hand-rolled logic that degrades as the mailbox grows.
//
// So a condition here is a small OBJECT of known keys, never an expression to parse. A caller cannot express
// something the list screen cannot also show them, which means a rule can always be previewed before it is saved.
//
// ── ⚠️ AND IT ONLY EVER READS ────────────────────────────────────────────────────────────────────────────────────
// match() has no side effects and returns a boolean. Deciding is separate from doing, because the one action a
// rule may take (filing) is a view operation on your own copy — and anything beyond that must be a human's.

/** The complete vocabulary. A key not listed here does not exist; unknown keys are REFUSED, never ignored. */
const KEYS = {
  from: 'text', // counterparty / sender display name contains
  subject: 'text', // manual or auto subject contains
  text: 'text', // subject OR sender OR the channel excerpt contains
  purpose: 'exact', // order | invoice | receipt | inquiry | delivery_note | general
  direction: 'exact', // sent | received
  status: 'exact', // current_status
  channel: 'exact', // summary_json.via.channel — whatsapp | email | sms | web
  min_amount: 'number',
  max_amount: 'number',
  has_dispute: 'bool',
  unread: 'bool',
  older_than_days: 'number',
  /* ⭐ the document kind (lib/folder-inventory docSql, carried on every lib/select.js row as doc_kind):
     bill_received | bill_issued | receipt | expense | return — what a system folder's rule names */
  doc: 'exact'
};

/** lower-cased text, '' for null — the one way terms are compared */
const lowered = (v) => String(v == null ? '' : v).toLowerCase();

/**
 * validate(when) — returns { ok } or { ok:false, error }.
 *
 * ⚠️ AN UNKNOWN KEY IS AN ERROR, NOT A NO-OP. A rule silently ignoring `sender:` because the key is spelled
 * `from:` would file nothing and look enabled — the worst kind of automation, one that appears to be working.
 */
function validate(when) {
  if (!when || typeof when !== 'object' || Array.isArray(when)) return { ok: false, error: 'A condition must be an object' };
  const keys = Object.keys(when);
  if (!keys.length) return { ok: false, error: 'A condition with no terms would match every chit' };
  for (const k of keys) {
    if (!KEYS[k]) return { ok: false, error: 'Unknown condition: ' + k + '. Allowed: ' + Object.keys(KEYS).join(', ') };
    const kind = KEYS[k],
      value = when[k];
    if (kind === 'number' && !Number.isFinite(Number(value))) return { ok: false, error: k + ' must be a number' };
    if (kind === 'text' && !String(value || '').trim()) return { ok: false, error: k + ' must not be blank' };
  }
  return { ok: true };
}

/** the chit's own readings a term is tested against, worked out once per match */
function chitFacts(chit, opts) {
  const arrival = (chit.summary_json || {}).via || {};
  return {
    chit,
    arrival,
    now: opts.now ? new Date(opts.now) : new Date(),
    subject: lowered(chit.manual_subject || chit.auto_subject),
    party: lowered(chit.counterparty_name || chit.sender_entity_display_name),
    amount: chit.value === null || chit.value === undefined ? null : Number(chit.value)
  };
}

/** one test per condition key: (readings, what the rule asked for) → does the chit hold it? Every KEYS entry has one. */
const TERM_HOLDS = {
  from: (f, raw) => f.party.includes(lowered(raw)),
  subject: (f, raw) => f.subject.includes(lowered(raw)),
  text: (f, raw) => (f.subject + ' ' + f.party + ' ' + lowered(f.arrival.raw_excerpt)).includes(lowered(raw)),
  purpose: (f, raw) => lowered(f.chit.purpose) === lowered(raw),
  direction: (f, raw) => lowered(f.chit.direction) === lowered(raw),
  status: (f, raw) => lowered(f.chit.current_status) === lowered(raw),
  channel: (f, raw) => lowered(f.arrival.channel) === lowered(raw),
  doc: (f, raw) => lowered(f.chit.doc_kind) === lowered(raw),
  /* ⚠️ A chit with NO agreed value must not satisfy an amount test in either direction. Treating null as 0
     would make `max_amount: 100` quietly sweep up every unpriced chit — and unpriced is the normal state for
     an inbound request, so the rule would capture exactly the things it was not meant to. */
  min_amount: (f, raw) => f.amount !== null && f.amount >= Number(raw),
  max_amount: (f, raw) => f.amount !== null && f.amount <= Number(raw),
  has_dispute: (f, raw) => (+f.chit.open_disputes || 0) > 0 === !!raw,
  unread: (f, raw) => !f.chit.read_at === !!raw,
  older_than_days: (f, raw) => (f.now - new Date(f.chit.created_at)) / 86400000 >= Number(raw)
};

/**
 * match(chit, when, opts) — every declared term must hold (AND).
 *
 * ⚠️ AND, NOT OR, AND IT IS NOT CONFIGURABLE. Mixed AND/OR in a rule builder is the thing that makes Outlook rules
 * unpredictable once there are more than a handful: nobody can hold the precedence in their head, so the rule that
 * fires is not the rule that was meant. Two conditions = two rules, ordered — which is legible.
 */
function match(chit, when, opts = {}) {
  const facts = chitFacts(chit || {}, opts);
  for (const [key, raw] of Object.entries(when || {})) {
    const holds = Object.prototype.hasOwnProperty.call(TERM_HOLDS, key) ? TERM_HOLDS[key] : null;
    if (!holds) return false; // unknown key: refuse to match rather than ignore the term
    if (!holds(facts, raw)) return false;
  }
  return true;
}

/**
 * firstMatch(chit, rules) — walk enabled rules IN ORDER and return the first that matches, honouring stop.
 *
 * ⚠️ ORDER + STOP, EXACTLY AS GMAIL AND OUTLOOK DO IT. Overlapping rules are inevitable the moment there is more
 * than one, and "which one won" must be answerable by reading down the list rather than by guessing.
 */
function firstMatch(chit, rules, opts) {
  for (const rule of rules || []) {
    if (rule.enabled === false) continue;
    if (match(chit, rule.when, opts)) return rule;
    if (rule.stop_processing) break;
  }
  return null;
}

module.exports = { match, firstMatch, validate, KEYS };
