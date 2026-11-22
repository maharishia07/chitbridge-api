// OWNER     cb-security
// RISK      security
// OWNS      the handoff door of SEC-112 P1a: one-time code + device id → the checked claims and the ONE linked account → refusal word, or an account to sign in
// FLOW      POST /api/signin/provider/handoff { code } ──▶ take('handoff', code) (single use) ──▶ device equals the start row's ──▶ provider switched on + e-mail rule ──▶ exactly one link ──▶ the account row ──▶ not ended ──▶ { identity } for the session writer
// CALLED BY routes/signin-provider.js (POST /provider/handoff) · tests/signin-provider.test.cjs
// CARD      18-identity-sign-in-and-access/sign-in
'use strict';
/**
 * lib/signin-provider-door.js — SEC-112 P1a (P0-DESIGN §5 route 4, §6 "Sign in (linked)"). This file decides WHO may be signed in; it opens no session itself: the route hands the answer to the one session writer
 * (lib/identity-auth.issueToken, the same call POST /api/signin/verify makes) so a provider session and a code session are the same thing.
 *
 * ⭐ THE LINK KEY IS THE PROVIDER SUBJECT, NEVER THE E-MAIL (DECISIONS 2026-11-17). Nobody is found, linked or created by an e-mail address here: a Google account that says "ravi@shop" does not become Ravi's by saying so
 *    (account pre-hijack, OWASP ASVS V2.5 / the OIDC Core §5.7 warning). A link is written only by the connect step, after the person proves the account with its own code or PIN (P1a connect, not this file).
 * ⭐ A VERIFIED E-MAIL IS STILL REQUIRED where the provider's word counts (registry email_trust 'claim'): a Google token whose email_verified is not true opens nothing, even for a linked subject.
 * ⭐ NEVER AN ACCOUNT HERE. No link → a sentence that points at the OTP sign-in; creating an account through a provider is P1b.
 * ⭐ SINGLE USE, SAME DEVICE: the one-time row is spent before anything else is looked at; a code used from another device is as dead as a spent one (one answer for both: SSO_HANDOFF).
 * ⚠️ NO TOKEN, CODE OR CLAIM VALUE is logged: refusals carry the code word only.
 */
const pending = require('./signin-pending');
const provider = require('./signin-provider');
const identityAuth = require('./identity-auth');
const { endedStatus } = require('./business-status');
const { deviceIdOf } = require('./person-session');
const store = require('./signin-provider-store');
const policy = require('./policy');
const { query } = require('../db');

/** the sentences (the shopkeeper's words; the codes are registered in docs/error-codes.json) */
const WORDS = Object.freeze({
  SSO_HANDOFF: 'That sign-in already finished or took too long. Start again from the sign-in page.',
  SSO_NOT_LINKED: 'No account here is connected to that sign-in. Sign in with your mobile number or e-mail and the code we send you.',
  SSO_EMAIL_UNVERIFIED: 'The provider has not confirmed that e-mail address, so nobody was signed in. Sign in with your mobile number or e-mail and the code we send you.',
  SSO_MANY: 'That sign-in is connected to more than one account. Sign in with your mobile number or e-mail and the code we send you.',
  SIGNIN_PROVIDER_NOT_ACCEPTED: 'This business does not accept that way to sign in. Use your mobile number or e-mail and the code we send you.',
  SIGNIN_UNAVAILABLE: 'Sign-in could not finish. Start again from the sign-in page.',
  PROVIDER_OFF: 'That sign-in is not switched on here. Use your mobile number or e-mail and the code we send you.',
  SIGNIN_REFUSED: 'Sign-in failed. Check your details or ask for a new code.'
});
const STATUS = Object.freeze({ SSO_HANDOFF: 401, SSO_NOT_LINKED: 403, SSO_EMAIL_UNVERIFIED: 403, SSO_MANY: 409, PROVIDER_OFF: 404, SIGNIN_REFUSED: 403, SIGNIN_PROVIDER_NOT_ACCEPTED: 403, SIGNIN_UNAVAILABLE: 503 });

const refuse = (code, payload) => ({ refusal: code, status: STATUS[code], detail: WORDS[code], payload: payload || null });

/** the refusal the held row alone settles (e-mail not verified, no link, more than one), or null */
function heldRefusal(held, row, claims) {
  if (row.email_trust === 'claim' && claims.email_verified !== true) return refuse('SSO_EMAIL_UNVERIFIED', held);
  const links = Array.isArray(held.links) ? held.links : [];
  if (!links.length) return refuse('SSO_NOT_LINKED', held);
  if (links.length > 1) return refuse('SSO_MANY', held);
  return null;
}

/** the refusal the spent row alone settles: no row or another device, the provider off, then heldRefusal; null when the row may go on */
function entryRefusal(held, device) {
  if (!held || !held.device_id || held.device_id !== device) return refuse('SSO_HANDOFF');
  const row = provider.rowOf(held.provider);
  if (!row || !provider.configured(row)) return refuse('PROVIDER_OFF');
  return heldRefusal(held, row, held.claims || {});
}

/** the account row the one link points at → { found, shop } or { refusal } (not an account, ended, or linked under another shop) */
async function accountOfLink(link, held) {
  const [found] = await identityAuth.rowsOfCandidates(query, [link.identity_id]);
  if (!found || !identityAuth.isAccount(found) || endedStatus(found.status)) return { refusal: refuse('SIGNIN_REFUSED', held) };
  const shop = found.parent_entity_id || found.identity_id; // the link was written under this shop: another shop's link opens nothing here
  if (link.entity_id && String(link.entity_id) !== String(shop)) return { refusal: refuse('SIGNIN_REFUSED', held) };
  return { found, shop };
}

/**
 * decide(code, deviceHeader) → { refusal, status, detail } or { identity, claims, link, provider } — the account to sign in.
 * `device` is the already-checked device id (deviceIdOf) or null; with none the route answers NO_DEVICE before this runs.
 */
async function decide(code, device) {
  const held = await pending.take('handoff', code); // spent here, whatever follows
  const early = entryRefusal(held, device);
  if (early) return early;
  const row = provider.rowOf(held.provider);
  const claims = held.claims || {};
  const link = held.links[0];
  const account = await accountOfLink(link, held);
  if (account.refusal) return account.refusal;
  const late = await liveRefusal(account.shop, row, claims, link, held);
  if (late) return late;
  return { identity: account.found, claims, link, provider: row.key, next: held.next };
}

/** the two checks read fresh: the shop's own switch, and the link itself (an unlink since the callback revokes the code); the refusal, or null */
async function liveRefusal(shop, row, claims, link, held) {
  /* M1: the shop's own switch (GOV flag signin_providers), read after the account row tells which shop it is */
  const flags = await policy.get(shop);
  if (provider.signinMethodRefusal(flags, row.key)) return refuse('SIGNIN_PROVIDER_NOT_ACCEPTED', held);
  /* L1: the link is read again NOW (the callback's copy is up to 60 s old): an unlink within the window revokes the code */
  const now = await store.linksFor(Object.assign({ provider: row.key }, claims));
  return now.some((again) => String(again.link_id) === String(link.link_id)) ? null : refuse('SSO_NOT_LINKED');
}

module.exports = { decide, WORDS, STATUS, deviceIdOf };
