// lib/channels.js — the CHANNEL MAP: which inbound number / address belongs to which entity.
//
// The capture pipeline (b104) has been complete except for one thing: when a message arrives on a public webhook,
// whose intake inbox does it go in? routes/capture.js has carried the answer as a comment since it was written —
// "the entity comes from the number→entity MAP, NEVER the payload (else it is S1 on a public endpoint)". This is
// that map, and `ownerOf` is the only way the webhook is allowed to ask.
//
// See migration b123 and SPEC-capture-connector.md.
// ⚠️ `query`, not `pool`. The db module exports pool as a lazy GETTER — destructuring it at require time
// evaluates it before the pool exists, and this file is required at boot.
const { withEntity, query } = require('../db');

function _missing(e) {
  const err = new Error('Channels not migrated yet (b123).');
  err.status = 503; err.code = 'CHANNEL_STORE_MISSING';
  return (e && (e.code === '42P01' || e.code === '42703' || e.code === '42883')) ? err : e;
}

/**
 * The channels we can actually receive on, and what each one needs before it can.
 *
 * ⚠️ `provider` IS READ FROM THE ENVIRONMENT, NOT DECLARED HERE. A panel that says "WhatsApp: connected" because
 * someone typed a number in is worse than one that says nothing — the customer's message would vanish and the
 * screen would insist everything was fine. Connected means the server really holds the secret.
 */
const CHANNELS = [
  { key: 'whatsapp', name: 'WhatsApp', hint: 'Meta Cloud API or a BSP (Twilio · Gupshup · 360dialog)',
    addressLabel: 'Business number', placeholder: '+919876543210',
    env: ['WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'] },
  { key: 'email', name: 'Email', hint: 'inbound parse (SendGrid · Mailgun · Postmark), or forward-to-chit',
    addressLabel: 'Inbound address', placeholder: 'orders@yourshop.com',
    env: ['EMAIL_INBOUND_SECRET'] },
  { key: 'sms', name: 'SMS', hint: 'not wired yet — the adapter is the only missing piece',
    addressLabel: 'Number', placeholder: '+919876543210', env: ['SMS_INBOUND_SECRET'] },
  { key: 'web', name: 'Web form', hint: 'the public intake link — no provider needed',
    addressLabel: 'Form key', placeholder: 'orders', env: [] },
];

/** ⚠️ NORMALISE BEFORE STORING. "+91 98765 43210", "+919876543210" and "919876543210" are one number, and a map
 *  that treats them as three will silently fail to match the one the provider actually sends. */
function normalise(channel, address) {
  const a = String(address || '').trim();
  if (!a) return '';
  if (channel === 'whatsapp' || channel === 'sms') {
    const digits = a.replace(/[^\d]/g, '');
    return digits ? '+' + digits.replace(/^0+/, '') : '';
  }
  return a.toLowerCase();
}

function providerReady(ch) { return (ch.env || []).length === 0 || (ch.env || []).every((k) => !!process.env[k]); }

/** The whole panel in one read: every channel, whether its provider is configured, and this entity's bindings. */
async function listChannels(entity_id) {
  let rows = [], note = null;
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `SELECT id, channel, address, label, status, verified_at, created_at
         FROM channel_binding WHERE entity_id = $1 ORDER BY channel, created_at`, [entity_id]));
    rows = r.rows;
  } catch (e) { if (_missing(e).status === 503) note = 'channels not migrated (b123)'; else throw e; }
  return {
    note,
    channels: CHANNELS.map((ch) => ({
      key: ch.key, name: ch.name, hint: ch.hint,
      address_label: ch.addressLabel, placeholder: ch.placeholder,
      // ⚠️ Two different facts, kept apart. A provider can be configured with nothing bound to it, and a number
      // can be bound with no provider behind it — and only the pair actually receives anything.
      provider_configured: providerReady(ch),
      bindings: rows.filter((b) => b.channel === ch.key),
    })),
  };
}

async function addBinding(entity_id, { channel, address, label }) {
  const ch = CHANNELS.find((c) => c.key === channel);
  if (!ch) { const e = new Error('Unknown channel'); e.status = 400; throw e; }
  const addr = normalise(channel, address);
  if (!addr) { const e = new Error(ch.addressLabel + ' is required'); e.status = 400; throw e; }
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `INSERT INTO channel_binding (entity_id, channel, address, label)
       VALUES ($1,$2,$3,$4) RETURNING id, channel, address, label, status, created_at`,
      [entity_id, channel, addr, String(label || '').slice(0, 80) || null]));
    return r.rows[0];
  } catch (e) {
    /**
     * ⚠️ 23505 IS EXPECTED, AND WHAT IT MEANS MUST NOT BE OVERSHARED. The unique index is global, so this fires
     * when ANOTHER entity already holds the address — a row this caller cannot see and must not learn about
     * beyond the fact that it cannot have it. "Already in use" and nothing else.
     */
    if (e && e.code === '23505') { const c = new Error('That ' + ch.addressLabel.toLowerCase() + ' is already in use.'); c.status = 409; throw c; }
    throw _missing(e);
  }
}

async function removeBinding(entity_id, id) {
  try {
    const r = await withEntity(entity_id, (c) => c.query(
      `DELETE FROM channel_binding WHERE id = $1 AND entity_id = $2 RETURNING id`, [id, entity_id]));
    if (!r.rows.length) { const e = new Error('Not found'); e.status = 404; throw e; }
    return { ok: true, id };
  } catch (e) { if (e && e.status) throw e; throw _missing(e); }
}

/**
 * ownerOf — WHO OWNS THIS ADDRESS. The only question a webhook may ask, and the only one this answers.
 *
 * ⚠️ Goes through the SECURITY DEFINER `channel_owner()` because the caller has NO SESSION: a provider POST has
 * no entity to set on the connection, so under FORCE RLS a direct SELECT sees nothing and every inbound message
 * would be silently dropped. The function returns a uuid or nothing — it cannot list, cannot filter, and exposes
 * no label, name or message.
 *
 * Returns null when nothing is bound, which the webhook must treat as "not for us" — never as an error, and never
 * as a reason to fall back to anything in the payload.
 */
async function ownerOf(channel, address) {
  const addr = normalise(channel, address);
  if (!addr) return null;
  try {
    const r = await query('SELECT channel_owner($1,$2) AS entity_id', [channel, addr]);
    return (r.rows[0] && r.rows[0].entity_id) || null;
  } catch (e) { return null; }   // not migrated / no binding → not for us. The webhook stays inert, never 500s.
}

module.exports = { CHANNELS, listChannels, addBinding, removeBinding, ownerOf, normalise, providerReady };
