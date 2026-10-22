/*
 * OWNS      the WhatsApp return leg: status replies and group sends, after the consent gate.
 * CALLED BY lib/crm-groups.js · routes/chits.js status hooks.
 * FLOW      consent gate → window / template check → Graph send → log
 * CARD      11-crm-and-marketing/whatsapp-out
 */
// lib/whatsapp-out.js — NOTIFY BACK. A chit's status change reaches the customer on the channel they wrote in on.
// owns: the notify-back leg of a chit status and the group send — consent first, then the 24-hour window, then the template or nothing; channel_outbound is its log
// called by: lib/rail-status.js (notifyChitStatus) · lib/crm-groups.js (notify)
// FLOW  notify → privacy.gate → windowOpen(phoneMatchKey) → text | templatePayload() → Graph → _log
// // CARD 11-crm-and-marketing/whatsapp-out
//
// SPEC-capture-connector.md: "channel → CAPTURE → AI STRUCTURE → HUMAN CONFIRM → CHIT on rail → notify back to
// channel." Inbound has been live since b123/b124; this is the return leg. See migration b126.
//
// ── ⚠️ A REPLY IS A NOTICE, NOT THE RECORD ──────────────────────────────────────────────────────────────────────
// The chit is the record. A WhatsApp message saying "accepted" is a courtesy copy for someone who lives in
// WhatsApp, and if the two ever disagree the chit is right. So this never writes back onto the chit, and a send
// that fails must never fail the chit operation that triggered it.
//
// ── ⚠️ META'S 24-HOUR WINDOW IS A RULE, NOT A RATE LIMIT ────────────────────────────────────────────────────────
// Free-form text may only be sent within 24 hours of the customer's last inbound message. Outside it, ONLY a
// pre-approved template may be sent, and we have none registered. So outside the window this REFUSES and records
// why, rather than posting something Meta will reject — a queued message that silently never arrives is worse
// than an honest "not sent", because the shop believes the customer was told.
const { withEntity } = require('../db');
const log = require('./logger');
const schema = require('./schema');

const GRAPH = process.env.WHATSAPP_GRAPH_BASE || 'https://graph.facebook.com/v21.0';
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Outbound needs its OWN credential — the inbound app secret cannot send. */
function canSend() {
  return !!process.env.WHATSAPP_TOKEN;
}

/**
 * Is this recipient inside the customer-service window? Measured from the LAST inbound we hold from them, which
 * is the only evidence we have of when they last wrote.
 *
 * ⚠️ Absent evidence is treated as OUTSIDE the window, never inside. Guessing "probably fine" here means sending a
 * message Meta rejects — or worse, bills as a business-initiated conversation nobody authorised.
 */
async function windowOpen(entity_id, to_ref) {
  const { phoneMatchKey, phoneTailSql } = require('./stores'),
    key = phoneMatchKey(to_ref); /* R2: the CRM's phone and Meta's sender_ref are one number in two forms */
  if (!key) return { open: false, reason: 'no usable phone number — the 24-hour window is closed' };
  try {
    const r = await withEntity(entity_id, (c) =>
      c.query(
        `SELECT MAX(created_at) AS last_in FROM capture
        WHERE entity_id = $1 AND channel = 'whatsapp' AND ${phoneTailSql('sender_ref')} = $2`,
        [entity_id, key]
      )
    );
    const last = r.rows[0] && r.rows[0].last_in;
    if (!last) return { open: false, reason: 'no inbound message from this number — the 24-hour window is closed' };
    const age = Date.now() - new Date(last).getTime();
    if (age > WINDOW_MS)
      return { open: false, reason: 'their last message was over 24 hours ago; only a pre-approved template may be sent, and none is registered' };
    return { open: true, last };
  } catch (e) {
    return { open: false, reason: 'could not read the inbound history' };
  }
}

/**
 * The single template every status update rides in. ⚠️ ONE, deliberately: each template needs its own Meta
 * approval, and a business waiting on five approvals to get one message out will ship none of them. The status
 * sentence travels as the parameter.
 */
const TEMPLATE_FOR_STATUS = 'order_status_update';

/** The binding for the line we are sending FROM — it carries the per-number template approvals. */
async function _bindingFor(entity_id, from_ref) {
  if (!from_ref) return null;
  try {
    const r = await withEntity(entity_id, (c) =>
      c.query(
        `SELECT id, address, templates FROM channel_binding
        WHERE entity_id = $1 AND channel = 'whatsapp' AND lower(address) = lower($2) LIMIT 1`,
        [entity_id, from_ref]
      )
    );
    return r.rows[0] || null;
  } catch (e) {
    log.fellBack('whatsapp-out _bindingFor: the read failed — answered with nothing', e);
    return null;
  }
}

/** the b126 columns a receipt's values fill, in parameter order (channel is always the literal 'whatsapp', so it takes no parameter) */
const BASE_COLS = ['entity_id', 'chit_id', 'capture_id', 'from_ref', 'to_ref', 'body', 'status', 'reason', 'provider_msg_id'];
/** the b776 columns (MKT): the person, the purpose, the send, the consent proof - written only once the migration has run */
const MKT_COLS = ['party_id', 'purpose', 'send_ref', 'basis'];
const COLUMN_LIST = (withMkt) => 'entity_id, chit_id, capture_id, channel, from_ref, to_ref, body, status, reason, provider_msg_id' + (withMkt ? ', ' + MKT_COLS.join(', ') : '');

/** one receipt as its b126 values, in BASE_COLS order */
function baseValues(entity_id, row) {
  return [entity_id, row.chit_id || null, row.capture_id || null, row.from_ref || null, row.to_ref || '', row.body || null, row.status, row.reason || null, row.provider_msg_id || null];
}
/** one receipt as its b776 values, in MKT_COLS order (basis as JSON text; the INSERT casts it) */
function mktValues(row) {
  return [row.party_id || null, row.purpose || null, row.send_ref || null, row.basis ? JSON.stringify(row.basis) : null];
}
/** the VALUES tuple for one receipt whose first parameter is $first (the channel is the literal) */
function tupleAt(first, withMkt) {
  const marks = BASE_COLS.concat(withMkt ? MKT_COLS : []).map((c, i) => '$' + (first + i) + (c === 'basis' ? '::jsonb' : ''));
  marks.splice(3, 0, "'whatsapp'");
  return '(' + marks.join(',') + ')';
}
/** do receipts carry the b776 columns yet? Code deploys before the migration, so ask (a no is rechecked every minute) */
const hasMktCols = () => schema.hasColumn('channel_outbound', 'send_ref');

/**
 * Record every attempt, including the ones we decline. A notification never attempted is not one that failed.
 * MKT (b776): the receipt also names WHO it went to, WHY (service or offer), WHICH send it belonged to and the CONSENT it relied on.
 */
async function _log(entity_id, row) {
  try {
    const withMkt = await hasMktCols(),
      vals = baseValues(entity_id, row).concat(withMkt ? mktValues(row) : []);
    const r = await withEntity(entity_id, (c) =>
      c.query(`INSERT INTO channel_outbound (${COLUMN_LIST(withMkt)}) VALUES ${tupleAt(1, withMkt)} RETURNING id, status, reason`, vals)
    );
    return r.rows[0];
  } catch (e) {
    log.fellBack('whatsapp-out _log: the receipt was not written (b126 not migrated?) - the send carries on, and the shop sees "not logged"', e);
    return { status: row.status, reason: row.reason, note: 'not logged (b126 not migrated?)' };
  }
}

/** rows per INSERT in logRefused - a send to thousands must not become one enormous statement */
const REFUSED_CHUNK = 500;
/** one VALUES tuple for a refused receipt, its parameters appended to args */
function refusedTuple(entity_id, send_ref, item, args) {
  const row = Object.assign({}, item, { status: 'refused', purpose: 'marketing', send_ref }),
    vals = baseValues(entity_id, row).concat(mktValues(row)),
    tuple = tupleAt(args.length + 1, true);
  args.push(...vals);
  return tuple;
}
/**
 * MKT (b776) · logRefused — the people a GROUP send did NOT message, written as receipts in ONE multi-row INSERT per chunk. A refusal the shop
 * cannot see is a customer who silently never heard (the group send refused them before any sender was asked). Each row: { party_id, to_ref?, reason,
 * basis }; they share the send's send_ref. Before b776 it writes nothing and says so (migrated: false). Never throws.
 */
async function logRefused(entity_id, send_ref, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { logged: 0, migrated: true };
  if (!(await hasMktCols())) return { logged: 0, migrated: false };
  try {
    let logged = 0;
    for (let at = 0; at < list.length; at += REFUSED_CHUNK) {
      const args = [],
        part = list.slice(at, at + REFUSED_CHUNK),
        tuples = part.map((item) => refusedTuple(entity_id, send_ref, item, args));
      await withEntity(entity_id, (c) => c.query(`INSERT INTO channel_outbound (${COLUMN_LIST(true)}) VALUES ${tuples.join(',')}`, args));
      logged += part.length;
    }
    return { logged, migrated: true };
  } catch (e) {
    log.fellBack('whatsapp-out logRefused: the refusals were not written — the send itself is unaffected', e);
    return { logged: 0, migrated: true, failed: true };
  }
}

/**
 * OUTSIDE the window: the order-status template, if this number has it approved → { payload } · else { refusal } in words.
 * R2: that template is a UTILITY order update — an offer (purpose 'marketing') must never ride in it (Meta's policy; a ban risk for the shop's number).
 */
async function templatePayload(entity_id, { from_ref, to_ref, text, purpose, windowReason }) {
  if (purpose === 'marketing') return { refusal: windowReason + ' — and offers need an approved offers template, which is not set up, so nothing was sent' };
  const tpl = require('./whatsapp-templates'),
    binding = await _bindingFor(entity_id, from_ref);
  if (!binding || !tpl.approvedOn(binding, TEMPLATE_FOR_STATUS))
    return { refusal: windowReason + ' — and "' + TEMPLATE_FOR_STATUS + '" is not approved on this number, so nothing can be sent' };
  const payload = tpl.buildSend(to_ref, TEMPLATE_FOR_STATUS, [text]);
  return payload ? { payload } : { refusal: 'no such template' };
}

/**
 * notify — send `text` to `to_ref` from the line they wrote to, if the window allows it.
 *
 * Returns a RESULT, never throws. Callers are chit operations that must not be affected by whether a courtesy
 * message got out.
 */
async function notify(entity_id, { to_ref, from_ref, provider_ref, text, chit_id, capture_id, party_id, purpose, send_ref }) {
  if (!to_ref || !text) return { status: 'refused', reason: 'nothing to send' };
  /**
   * ⭐ CONSENT FIRST (MKT-SRV1 CO1-GATE): the ONE gate (lib/privacy.gate) before anything else — by the party when the caller knows it,
   * else by the number we are writing to. A refusal is logged with its reason and carries the gate's code. A gate that cannot be read
   * refuses (fail closed): sending to someone who said no is the harm this exists to prevent.
   */
  let v;
  try {
    v = await withEntity(entity_id, (h) => require('./privacy').gate(h, entity_id, party_id ? { party_id } : { to_ref }, 'whatsapp', purpose || 'service'));
  } catch (e) {
    log.error('whatsapp consent gate unreadable — not sent', { entity_id, err: e && e.message });
    v = { may: false, code: 'CONSENT_UNREADABLE', why: 'Could not read their consent, so nothing was sent.' };
  }
  /* MKT-17: every receipt of this send names the person, the purpose, the send and the consent row the gate relied on (b776 columns; before it runs they are dropped) */
  const basis = { code: v.code, pref_id: (v.pref && v.pref.id) || null, at: (v.pref && v.pref.at) || null };
  const record = (outcome) =>
    _log(entity_id, Object.assign({ chit_id, capture_id, from_ref, to_ref, body: text, party_id, purpose: purpose || 'service', send_ref, basis }, outcome));
  if (!v.may) return Object.assign(await record({ status: 'refused', reason: v.why }), { code: v.code });
  if (!canSend()) return record({ status: 'refused', reason: 'WHATSAPP_TOKEN is not set — outbound is not configured' });
  if (!provider_ref) return record({ status: 'refused', reason: 'the binding has no provider_ref (phone_number_id) — cannot address a send' });

  /**
   * ⚠️ INSIDE THE WINDOW → FREE TEXT. OUTSIDE → A TEMPLATE, OR NOTHING (b128).
   *
   * Outside Meta's 24 hours a free-form message is simply rejected, so the only way to say anything is a template
   * the business has had approved on THEIR account. Approval is per-WABA: our having written the template, or
   * another business having had theirs approved, says nothing about whether this number may send it. So the flag
   * is read off the binding, and an absent flag means NO.
   *
   * ⚠️ THIS IS THE ONLY PATH THAT SPENDS ON SOMEBODY WHO IS NOT TALKING TO US. Inside the window the customer
   * just wrote in; outside it, a template send is a business-initiated conversation and is billed as one. That is
   * why it takes an explicit per-number approval rather than being on by default.
   */
  const win = await windowOpen(entity_id, to_ref);
  const built = win.open
    ? {
        payload: {
          messaging_product: 'whatsapp',
          to: String(to_ref).replace(/^\+/, ''),
          type: 'text',
          text: { preview_url: false, body: String(text).slice(0, 4000) }
        }
      }
    : await templatePayload(entity_id, { from_ref, to_ref, text, purpose, windowReason: win.reason });
  if (built.refusal) return record({ status: 'refused', reason: built.refusal });
  const payload = built.payload;

  try {
    const res = await fetch(GRAPH + '/' + encodeURIComponent(provider_ref) + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN },
      body: JSON.stringify(payload)
    });
    let j = null;
    try {
      j = await res.json();
    } catch (e) {
      log.fellBack('whatsapp-out: failed — carried on without it', e);
    }
    if (!res.ok) {
      const why = (j && j.error && j.error.message) || 'provider returned ' + res.status;
      return record({ status: 'failed', reason: why });
    }
    const id = j && j.messages && j.messages[0] && j.messages[0].id;
    return record({ status: 'sent', provider_msg_id: id });
  } catch (e) {
    return record({ status: 'failed', reason: (e && e.message) || 'send failed' });
  }
}

/**
 * notifyChitStatus — the thing Athi asked for: "your order has been accepted", back on WhatsApp.
 *
 * ⚠️ IT ONLY SPEAKS WHEN THE CHIT CAME FROM A CHANNEL. A chit composed in the app has no customer waiting on
 * WhatsApp, and messaging a number that never wrote to us is unsolicited contact. The capture→chit link recorded
 * at send time (b104) is what makes this safe: no capture, no reply.
 */
async function notifyChitStatus(entity_id, chit_id, status, subject) {
  try {
    const r = await withEntity(entity_id, (c) =>
      c.query(
        `SELECT c.id, c.sender_ref, c.to_ref, b.provider_ref
         FROM capture c
    LEFT JOIN channel_binding b
           ON b.entity_id = c.entity_id AND b.channel = 'whatsapp'
          AND lower(b.address) = lower(COALESCE(c.to_ref, '')) AND b.status = 'verified'
        WHERE c.entity_id = $1 AND c.chit_id = $2 AND c.channel = 'whatsapp'
        LIMIT 1`,
        [entity_id, chit_id]
      )
    );
    const cap = r.rows[0];
    if (!cap || !cap.sender_ref) return null; // not from a channel — nothing to reply to, and that is fine
    const said = SAY[status];
    if (!said) return null; // a status with no customer-facing meaning stays internal
    return await notify(entity_id, {
      to_ref: cap.sender_ref,
      from_ref: cap.to_ref,
      provider_ref: cap.provider_ref,
      text: said(subject),
      chit_id,
      capture_id: cap.id
    });
  } catch (e) {
    log.fellBack('whatsapp-out notifyChitStatus: the read failed — answered with nothing', e);
    return null;
  }
}

/**
 * ⚠️ WHAT WE SAY, AND WHAT WE DO NOT.
 * Only statuses that mean something to the person who sent the message get a reply. An internal reassignment or a
 * read receipt is not their business, and a channel that narrates every internal step trains people to ignore it.
 * The wording states what happened and never promises what has not been agreed.
 */
const SAY = {
  accepted: (s) => `Your request${s ? ' "' + s + '"' : ''} has been accepted. We will confirm the details shortly.`,
  in_progress: (s) => `Your request${s ? ' "' + s + '"' : ''} is being worked on.`,
  completed: (s) => `Your request${s ? ' "' + s + '"' : ''} is complete. Thank you.`,
  rejected: (s) => `We are sorry — your request${s ? ' "' + s + '"' : ''} could not be accepted. Please reply here if you would like to discuss it.`,
  cancelled: (s) => `Your request${s ? ' "' + s + '"' : ''} has been cancelled.`
};

module.exports = { notify, notifyChitStatus, logRefused, windowOpen, canSend, SAY, WINDOW_MS };
