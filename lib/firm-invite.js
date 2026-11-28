'use strict';
/**
 * @stage tested
 * lib/firm-invite.js — the e-mail that invites a bookkeeper or auditor who is not on ChitBridge yet
 * OWNER     cb-network
 * RISK      plain
 * OWNS      sendFirmInvite({ entityId, email, now?, deps? }) → { sent, delivered, message } · inviteVerdict(counts, limits) (pure) · the two caps (per business per day, per address per week)
 * CALLED BY src/routes/network.js POST /firm-invites (owner only) · tests/firm-invite.test.cjs
 * FLOW      the owner's name, sign-in name and bridge id are read (one bound read) → the caps are checked → ONE fixed e-mail (no free text, nothing typed by the sender goes in it) → the answer says whether it was DELIVERED, never "sent" when it was not
 * CARD      04-network/connections-and-invitations
 *
 * No table (design rule): nothing connects from an invitation. The caps count in this process's memory: a restart or a second instance resets them, which is why the route also has its own per-login rate limit
 * (lib/own-limiters.js) and why the address is kept only as a hash. Numbers (cb-security sizing, in the PR): 20 invitations per business per day, 1 per address per 7 days.
 */
const crypto = require('crypto');
const log = require('./logger');
const { boundRead } = require('./bound-read');

const DAY_MS = 24 * 3600 * 1000;
const WEEK_MS = 7 * DAY_MS;
const fromEnv = (name, fallback) => (Number.isFinite(parseInt(process.env[name], 10)) ? parseInt(process.env[name], 10) : fallback);
const limitsNow = () => ({ perBusinessDay: fromEnv('FIRM_INVITE_PER_BUSINESS_DAY', 20), perAddressWeek: fromEnv('FIRM_INVITE_PER_ADDRESS_WEEK', 1) });

const byBusiness = new Map(); /* entityId → [times] */
const byAddress = new Map(); /* sha256(address) → [times] */
const within = (times, now, span) => (times || []).filter((at) => now - at < span);
const addressKey = (email) => crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
const escapeHtml = (value) => String(value == null ? '' : value).slice(0, 120).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** inviteVerdict({ business, address }, limits) → null or the words of the cap hit; pure */
function inviteVerdict(counts, limits) {
  if (counts.business >= limits.perBusinessDay) return 'You have sent a lot of invitations today. Try again tomorrow.';
  if (counts.address >= limits.perAddressWeek) return 'That address was invited a short while ago. Wait a few days before inviting it again.';
  return null;
}
/** count the attempt (a failed delivery counts too: the cap is against flooding, not against success) */
function remember(entityId, key, now) {
  byBusiness.set(entityId, within(byBusiness.get(entityId), now, DAY_MS).concat(now));
  byAddress.set(key, within(byAddress.get(key), now, WEEK_MS).concat(now));
}
/** the fixed template: who is inviting, how to find them, what to do. Nothing the sender typed is in it except the address it goes to. */
function templateOf(inviter) {
  const name = escapeHtml(inviter.name || 'A business');
  const subject = `${String(inviter.name || 'A business').slice(0, 80)} invites you to connect on ChitBridge`;
  const html = `<p>${name} would like you to look after their books or audit them on ChitBridge.</p>
<p>Their sign-in name is <b>${escapeHtml(inviter.user_id || inviter.bridge_id)}</b>${inviter.bridge_id ? ` (bridge id ${escapeHtml(inviter.bridge_id)})` : ''}.</p>
<p>What to do: create your business on ChitBridge, then ask ${name} to connect by that name. They will accept, and then choose what you may see. Nothing is shared until they do.</p>`;
  return { subject, html };
}
/** sendFirmInvite({ entityId, email }) → { sent, delivered, message } or throws { status: 429, code: 'INVITE_LIMIT' } */
async function sendFirmInvite({ entityId, email, now = Date.now(), deps = {} }) {
  const mail = deps.sendEmail || require('./notify').sendEmail;
  const query = deps.query || require('../db').query;
  const key = addressKey(email);
  const counts = { business: within(byBusiness.get(entityId), now, DAY_MS).length, address: within(byAddress.get(key), now, WEEK_MS).length };
  const refusal = inviteVerdict(counts, limitsNow());
  if (refusal) throw Object.assign(new Error(refusal), { status: 429, code: 'INVITE_LIMIT' });
  const inviter = (await boundRead(query, entityId, 'SELECT display_name AS name, user_id, bridge_id FROM identities WHERE identity_id = $1', [entityId])).rows[0] || {};
  const { subject, html } = templateOf(inviter);
  remember(entityId, key, now);
  const result = await mail(String(email).trim(), subject, html).catch((e) => ({ delivered: false, error: e.message }));
  const delivered = !!(result && result.delivered);
  log.info('firm invite', { entity: entityId, address: key.slice(0, 12), delivered });
  return delivered
    ? { sent: true, delivered: true, message: 'The invitation was sent. Nothing connects until they sign up and you accept.' }
    : { sent: false, delivered: false, message: 'The invitation was NOT sent: e-mail is not available right now. Tell them your sign-in name yourself.' };
}
const reset = () => { byBusiness.clear(); byAddress.clear(); };
module.exports = { sendFirmInvite, inviteVerdict, limitsNow, templateOf, reset };
