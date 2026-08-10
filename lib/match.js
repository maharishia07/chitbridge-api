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
  from:         'text',    // counterparty / sender display name contains
  subject:      'text',    // manual or auto subject contains
  text:         'text',    // subject OR sender OR the channel excerpt contains
  purpose:      'exact',   // order | invoice | receipt | inquiry | delivery_note | general
  direction:    'exact',   // sent | received
  status:       'exact',   // current_status
  channel:      'exact',   // summary_json.via.channel — whatsapp | email | sms | web
  min_amount:   'number',
  max_amount:   'number',
  has_dispute:  'bool',
  unread:       'bool',
  older_than_days: 'number',
};

const lc = (v) => String(v == null ? '' : v).toLowerCase();

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
    const t = KEYS[k], v = when[k];
    if (t === 'number' && !Number.isFinite(Number(v))) return { ok: false, error: k + ' must be a number' };
    if (t === 'text' && !String(v || '').trim()) return { ok: false, error: k + ' must not be blank' };
  }
  return { ok: true };
}

/**
 * match(chit, when, opts) — every declared term must hold (AND).
 *
 * ⚠️ AND, NOT OR, AND IT IS NOT CONFIGURABLE. Mixed AND/OR in a rule builder is the thing that makes Outlook rules
 * unpredictable once there are more than a handful: nobody can hold the precedence in their head, so the rule that
 * fires is not the rule that was meant. Two conditions = two rules, ordered — which is legible.
 */
function match(chit, when, opts = {}) {
  const c = chit || {};
  const now = opts.now ? new Date(opts.now) : new Date();
  const via = ((c.summary_json || {}).via) || {};
  const subject = lc(c.manual_subject || c.auto_subject);
  const party = lc(c.counterparty_name || c.sender_entity_display_name);
  const amount = c.value === null || c.value === undefined ? null : Number(c.value);

  for (const [k, raw] of Object.entries(when || {})) {
    switch (k) {
      case 'from':      if (!party.includes(lc(raw))) return false; break;
      case 'subject':   if (!subject.includes(lc(raw))) return false; break;
      case 'text':      if (!(subject + ' ' + party + ' ' + lc(via.raw_excerpt)).includes(lc(raw))) return false; break;
      case 'purpose':   if (lc(c.purpose) !== lc(raw)) return false; break;
      case 'direction': if (lc(c.direction) !== lc(raw)) return false; break;
      case 'status':    if (lc(c.current_status) !== lc(raw)) return false; break;
      case 'channel':   if (lc(via.channel) !== lc(raw)) return false; break;
      /* ⚠️ A chit with NO agreed value must not satisfy an amount test in either direction. Treating null as 0
         would make `max_amount: 100` quietly sweep up every unpriced chit — and unpriced is the normal state for
         an inbound request, so the rule would capture exactly the things it was not meant to. */
      case 'min_amount': if (amount === null || !(amount >= Number(raw))) return false; break;
      case 'max_amount': if (amount === null || !(amount <= Number(raw))) return false; break;
      case 'has_dispute': if (!!((+c.open_disputes || 0) > 0) !== !!raw) return false; break;
      case 'unread':      if (!!(!c.read_at) !== !!raw) return false; break;
      case 'older_than_days': {
        const ageDays = (now - new Date(c.created_at)) / 86400000;
        if (!(ageDays >= Number(raw))) return false; break;
      }
      default: return false;                       // unknown key: refuse to match rather than ignore the term
    }
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
  for (const r of (rules || [])) {
    if (r.enabled === false) continue;
    if (match(chit, r.when, opts)) return r;
    if (r.stop_processing) break;
  }
  return null;
}

module.exports = { match, firstMatch, validate, KEYS };
