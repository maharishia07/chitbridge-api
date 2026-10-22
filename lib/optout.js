/*
 * OWNS      a STOP reply on WhatsApp: the withdrawal of marketing consent it means, its one confirmation, and the opt-out line every offer carries.
 * CALLED BY routes/capture.js (the HMAC-checked WhatsApp webhook) · lib/whatsapp-out.js (footerFor, for every marketing send).
 * FLOW      webhook → createCapture → fromReply (whole-message match) → privacy.notePref per party x channel → dismiss the capture → confirmReply
 * CARD      23-connectors-and-integrations/functions/stop-reply (CON-2)
 */
'use strict';
// lib/optout.js - CON-2. A customer replies STOP (or their country's word) to the shop's WhatsApp number; from that moment the shop may not
// send offers to that number. The words live in privacy.LAW[country].optout (the one per-country privacy table); the row is written by the ONE
// writer privacy.notePref (append-only); the confirmation goes through the ONE sender whatsapp-out.notify as a service message.
//
// ⚠️ THE WITHDRAWAL IS WRITTEN BEFORE THE WEBHOOK ANSWERS; THE CONFIRMATION AFTER. A lost confirmation is a courtesy missed, a lost
//    withdrawal is a person who asked to stop and still gets offers. Both are logged when they fail - never silent.
// ⚠️ A SHARED PHONE: every party at this shop whose number matches on the last 9 digits is withdrawn (the gate's own match), plus the parties
//    named on earlier offers sent to that number. Over-withdrawing is the safe direction; under-withdrawing keeps messaging a family that said stop.
// ⚠️ E-MAIL IS NOT HERE: a From: header is unverified and could withdraw someone else's consent.
const { withEntity } = require('../db');
const log = require('./logger');
const schema = require('./schema');
const privacy = require('./privacy');
const stores = require('./stores');

/** both channels addressed by one phone number; e-mail and service are never touched */
const WITHDRAW_CHANNELS = ['whatsapp', 'sms'];
const PURPOSE = 'marketing';
/** a reply longer than this cannot be a stop word - skip the shop lookup for ordinary orders */
const LONGEST_STOP_REPLY = 40;
/** the blank line between an offer and its opt-out line */
const FOOTER_JOIN = '\n\n';

/** the parties this number means: the shop's customers, anyone it has consent rows for (a supplier included), and the people earlier offers went to */
function partiesSql(withReceipts) {
  const tailOf = (column) => stores.phoneTailSql(column);
  const byNumber = (alias) => `${tailOf(alias + '.phone')} = $2 OR ${tailOf(alias + '.otp_contact')} = $2`;
  const receipts = withReceipts
    ? `UNION SELECT o.party_id FROM channel_outbound o WHERE o.entity_id = $1 AND o.purpose = 'marketing' AND o.party_id IS NOT NULL AND ${tailOf('o.to_ref')} = $2`
    : '';
  return `SELECT cl.customer_identity_id AS party_id FROM customer_list cl JOIN identities i ON i.identity_id = cl.customer_identity_id
            WHERE cl.owner_entity_id = $1 AND (${byNumber('i')})
          UNION SELECT p.party_id FROM party_contact_pref p JOIN identities i ON i.identity_id = p.party_id
            WHERE p.owner_entity_id = $1 AND (${byNumber('i')})
          ${receipts}`;
}
async function partiesOfNumber(handle, entity, senderRef) {
  const key = stores.phoneMatchKey(senderRef);
  if (!key) return [];
  const withReceipts = await schema.hasColumn('channel_outbound', 'party_id');
  const found = await handle.query(partiesSql(withReceipts), [entity, key]);
  return found.rows.map((row) => row.party_id);
}

/** the (party, channel) pairs already answered "no" for offers - their newest row says allowed = false - so a second STOP adds no row */
async function alreadyStopped(handle, entity, parties) {
  const found = await handle.query(
    `SELECT DISTINCT ON (party_id, channel) party_id, channel, allowed FROM party_contact_pref
      WHERE owner_entity_id = $1 AND party_id = ANY($2::uuid[]) AND purpose = $3 AND channel = ANY($4)
      ORDER BY party_id, channel, noted_at DESC`,
    [entity, parties, PURPOSE, WITHDRAW_CHANNELS]
  );
  return new Set(found.rows.filter((row) => !row.allowed).map((row) => row.party_id + '|' + row.channel));
}

/** write the withdrawal rows for every party x channel not already stopped - through the ONE writer; returns how many parties were newly withdrawn */
async function withdrawAll(handle, entity, parties, captureId) {
  if (!parties.length) return 0;
  const stopped = await alreadyStopped(handle, entity, parties);
  const newly = new Set();
  for (const party of parties) {
    for (const channel of WITHDRAW_CHANNELS) {
      if (stopped.has(party + '|' + channel)) continue;
      await privacy.notePref(handle, entity, party, { channel, purpose: PURPOSE, allowed: false, basis: 'consent', source: 'reply', source_ref: captureId }, null);
      newly.add(party);
    }
  }
  return newly.size;
}

/** one transaction: read the shop's country, and if the whole message is a stop word, withdraw every party on that number */
async function withdrawInOneTransaction(entity, reply) {
  return withEntity(entity, async (handle) => {
    const shop = await privacy.shopFacts(handle, entity);
    if (!privacy.isStopWord(reply.text, shop.country)) return { stop: false };
    await privacy.need(handle, 'party_contact_pref', 'b306');
    const parties = await partiesOfNumber(handle, entity, reply.sender_ref);
    const withdrawn = await withdrawAll(handle, entity, parties, reply.capture_id);
    return { stop: true, parties: parties.length, withdrawn, country: shop.country, shop_name: shop.name };
  });
}

/** the STOP capture is not an order: dismiss it so Intake never asks staff to raise it (the row stays as proof) */
async function dismissStop(entity, captureId) {
  try {
    await require('./capture').dismissCapture(entity, captureId);
  } catch (e) {
    log.warn('optout: the STOP capture could not be dismissed - it waits in Intake, and the withdrawal stands', { entity, captureId, why: String(e && e.message) });
  }
}

/**
 * fromReply(entity, { sender_ref, text, capture_id }) -> { stop, parties?, withdrawn?, country?, shop_name?, failed? }
 * Is this inbound WhatsApp message a STOP? If so, withdraw marketing consent for every party on that number and dismiss the capture. NEVER throws:
 * a failure is logged and answered { stop: true, failed: true } (the capture stays in Intake for staff, and no confirmation claims what did not happen).
 */
async function fromReply(entity, reply) {
  const text = String((reply && reply.text) || '');
  if (!text.trim() || text.length > LONGEST_STOP_REPLY) return { stop: false };
  try {
    const outcome = await withdrawInOneTransaction(entity, reply);
    if (outcome.stop) await dismissStop(entity, reply.capture_id);
    return outcome;
  } catch (e) {
    log.error('optout: a STOP reply could not be recorded - it waits in Intake for staff', { entity, captureId: reply.capture_id, why: String(e && e.message) });
    return { stop: true, failed: true };
  }
}

/** the line we wrote to, with its provider_ref (phone_number_id) - the join notifyChitStatus uses; null when the line is not a verified binding */
async function lineOf(entity, toRef) {
  const found = await withEntity(entity, (handle) =>
    handle.query(`SELECT address, provider_ref FROM channel_binding WHERE entity_id = $1 AND channel = 'whatsapp' AND status = 'verified' AND lower(address) = lower($2) LIMIT 1`, [
      entity,
      toRef || ''
    ])
  );
  return found.rows[0] || null;
}

/**
 * confirmReply(entity, { sender_ref, to_ref, capture_id, country, shop_name }) - the ONE confirmation, a SERVICE message through the ONE sender (so a
 * service opt-out silences it and a receipt is written). Contains no offer. Run it AFTER the webhook answered; never throws.
 */
async function confirmReply(entity, reply) {
  try {
    const line = await lineOf(entity, reply.to_ref);
    const text = privacy.lawOf(reply.country).optout.done.replace('{shop}', reply.shop_name || 'this shop');
    return await require('./whatsapp-out').notify(entity, {
      to_ref: reply.sender_ref,
      from_ref: reply.to_ref,
      provider_ref: line && line.provider_ref,
      text,
      capture_id: reply.capture_id,
      purpose: 'service'
    });
  } catch (e) {
    log.error('optout: the STOP confirmation was not sent - the withdrawal stands', { entity, captureId: reply.capture_id, why: String(e && e.message) });
    return null;
  }
}

/* the opt-out line per shop, remembered a minute: a group send calls notify once per member and must not read the shop each time */
const FOOTER_TTL_MS = 60 * 1000;
const footerCache = new Map();
/**
 * footerFor(entity) -> the text to add after an offer: a blank line and the country's "Reply STOP to stop offers." (the base English line for a shop
 * with no country). Offers carry it in the ONE sender, so every marketing path has it (the Spam Act: an easy opt-out in every message).
 */
async function footerFor(entity) {
  const remembered = footerCache.get(entity);
  if (remembered && Date.now() - remembered.at < FOOTER_TTL_MS) return remembered.footer;
  const shop = await withEntity(entity, (handle) => privacy.shopFacts(handle, entity));
  const footer = FOOTER_JOIN + privacy.lawOf(shop.country).optout.line;
  footerCache.set(entity, { at: Date.now(), footer });
  return footer;
}
/** the room an offer's text must leave for the footer (the longest line any pack carries) */
const footerRoom = () => FOOTER_JOIN.length + privacy.OPTOUT_LINE.length;

module.exports = { fromReply, confirmReply, footerFor, footerRoom, WITHDRAW_CHANNELS };
