// OWNS      the CONNECT step of provider sign-in (SEC-112 P1a, critic 21 Nov): a signed-in person links a provider to their OWN account (re-proof, subject binding), lists their links, and unlinks (re-proof, audit)
// FLOW      Settings › Sign-in ──▶ POST /provider/link/start { provider, pin|otp } ──▶ re-proof ──▶ one-use `lt` + the start address ──▶ GET /provider/:key/start?lt= ──▶ provider ──▶ callback (intent link) ──▶ finishLink ──▶ link row + audit + notice ──▶ 302 web #c=<word>
//           DELETE /provider/links/:link_id { pin|otp } ──▶ re-proof ──▶ own link? enforced? last way in? ──▶ delete + audit + notice
// CALLED BY routes/signin-provider.js (the handlers are mounted there; start and callback call takeLinkStart / finishLink)
// CARD      18-identity-sign-in-and-access/sign-in
'use strict';
/**
 * ⭐ RE-PROOF EVERY TIME. Linking and unlinking each carry the person's own PIN (or a fresh code) in the request, checked by the ONE credential engine (identityAuth.verifyCredential: lock, budget, wrong-count);
 *    a stolen session alone adds no provider. Every failure is the one blind 401 REAUTH_FAILED.
 * ⭐ SUBJECT BINDING. The `lt` (5 min, single use, hashed at rest, bound to this device and this account) is the ONLY thing that says whose account a callback may link; the link key comes from the checked ID token.
 *    Nobody else's account can be named by the browser. Another shop's rows are invisible (row security) and never said.
 * ⭐ THE LINK IS WRITTEN ONLY BY A CONFIRM from the signed-in session that started it (N2, critic round 2): the callback keeps a 60-second confirm row and sends #k=<code>; POST /provider/link/finish with the bearer
 *    session must carry the SAME account, session id (jti) and device as the start, or nothing is written. A start address replayed from another browser or session cannot create a link.
 * ⭐ THE SHOP'S SWITCH (GOV flag signin_providers) gates linking and sign-in alike through provider.signinMethodRefusal.
 * ⭐ AUDIT, NEVER A VALUE: link · unlink · refused link are signin_events rows with method and the keyed subject hash only; the notice mail names the provider, never a subject.
 */
const { problem } = require('../lib/problem');
const log = require('../lib/logger');
const provider = require('../lib/signin-provider');
const pending = require('../lib/signin-pending');
const links = require('../lib/signin-provider-link');
const identityAuth = require('../lib/identity-auth');
const sessions = require('../lib/person-session');
const events = require('../lib/signin-events');
const policy = require('../lib/policy');
const owner = require('../lib/owner');
const auth = require('../middleware/auth');
const { endedStatus } = require('../lib/business-status');
const { query } = require('../db');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORDS = Object.freeze({
  REAUTH_FAILED: 'We could not confirm it is you. Check your PIN or code and try again.',
  LINK_EXISTS: 'That account is already connected here.',
  LINK_NOT_FOUND: 'There is no such connected account.',
  LAST_WAY_IN: 'This is your only way to sign in. Set a PIN first, then disconnect it.',
  LINK_ENFORCED: 'Your business requires this sign-in. Ask the owner to change it.',
  SIGNIN_PROVIDER_NOT_ACCEPTED: 'This business does not accept that way to sign in.',
  PROVIDER_OFF: 'That sign-in is not switched on here.',
  SIGNIN_UNAVAILABLE: 'Connecting could not finish. Try again in a moment.',
  LINK_CONFIRM_FAILED: 'That connection could not be confirmed. Start again from Settings.'
});
const shopOf = (req) => auth.entityOf(req);
const me = (req) => req.identity.identity_id;
/** the listed session this request rides on (its jti), or '' for a token that carries none */
const sessionOf = (req) => String((req.session && req.session.jti) || '');

/** one signin_events row: method + keyed subject hash, never a value; a lost row is logged by the writer, never thrown */
function audit(req, shop, identityId, action, method, code, key) {
  let subject_hash = null;
  try {
    subject_hash = key && key.subject ? require('../lib/vaultcrypto').keyedSubjectHash(method, key.issuer, key.tenant || '', key.subject) : null;
  } catch (failure) {
    log.warn('signin_provider', { why: 'subject hash not made: ' + String((failure && failure.code) || 'ERR') });
  }
  events.record(Object.assign(events.fromRequest(req), { entity_id: shop, identity_id: identityId, action, method, code: code || null, subject_hash }));
}
/** the notice to the account's own address: "<provider> was connected / removed on <date>"; best effort, never blocks, never carries a subject */
function notice(person, label, did) {
  if (!person || !person.email || person.status !== 'active') return;
  const html = '<p>' + label + ' was ' + did + ' your account.</p><p>Not you? Sign in with your code and remove it under Settings, Sign-in.</p>';
  Promise.resolve()
    .then(() => require('../lib/notify').sendEmail(person.email, 'ChitBridge: ' + label + ' was ' + did, html))
    .catch((failure) => log.warn('signin_provider', { why: 'notice not sent: ' + String((failure && failure.code) || 'ERR') }));
}
const refuse = (req, res, status, code) => problem(req, res, { status, code, detail: WORDS[code] });

/** the person's own row (credentials included), proved with the PIN or a fresh code in the body: { person }, or { sent: true } when the 401 is already written */
async function reprove(req, res) {
  const person = (await identityAuth.rowsOfCandidates(query, [me(req)]))[0];
  const body = req.body || {};
  const check = person && !endedStatus(person.status) ? await identityAuth.verifyCredential(query, person, { pin: body.pin, otp: body.otp }) : { ok: false };
  if (!check.ok) {
    audit(req, shopOf(req), me(req), 'fail', body.otp && !body.pin ? 'otp' : 'pin', 'REAUTH_FAILED', null); // N5: the method the person tried
    refuse(req, res, 401, 'REAUTH_FAILED');
    return { sent: true };
  }
  return { person };
}
const flagsOf = (shop) => policy.get(shop);

/* GET /provider/links — the signed-in person's own links, in words that carry no subject */
async function list(req, res) {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  const flags = await flagsOf(shopOf(req));
  const rows = await links.listOf(shopOf(req), me(req));
  const self = (await identityAuth.rowsOfCandidates(query, [me(req)]))[0];
  const available = provider.registry().filter((row) => provider.configured(row)).map((row) => ({ key: row.key, label: row.label, live: provider.connectBuilt(), accepted: !provider.signinMethodRefusal(flags, row.key) }));
  return res.json({
    reproof: self && self.pin_hash ? 'pin' : 'code', // the re-proof this person can give: the PIN they set, else a code sent to their own address
    links: rows.map((row) => ({ link_id: row.link_id, provider: row.provider, email: row.email, email_verified: row.email_verified === true, linked_at: row.linked_at, last_used_at: row.last_used_at })),
    providers: available
  });
}

/* POST /provider/link/start — re-proof, then the one-use `lt` and the address that starts the round trip */
async function startLink(req, res) {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  const body = req.body || {};
  const row = provider.rowOf(body.provider);
  if (!row || !provider.configured(row) || !provider.connectBuilt()) return refuse(req, res, 404, 'PROVIDER_OFF');
  const dev = sessions.deviceOfSignin(req);
  if (!dev.device_id) return problem(req, res, { status: 400, code: 'NO_DEVICE', detail: 'This device must say who it is before it can connect an account.' });
  const jti = sessionOf(req);
  if (!jti) return problem(req, res, { status: 401, code: 'SESSION_EXPIRED', detail: 'Sign in again before connecting an account.' });
  const shop = shopOf(req);
  if (provider.signinMethodRefusal(await flagsOf(shop), row.key)) return refuse(req, res, 403, 'SIGNIN_PROVIDER_NOT_ACCEPTED');
  const proven = await reprove(req, res);
  if (proven.sent) return;
  const lt = provider.randomRef();
  await pending.put('linkstart', lt, { provider: row.key, identity_id: me(req), entity_id: shop, device_id: dev.device_id, jti });
  const url = provider.startUrl(row.key, { device_id: dev.device_id, lt, next: provider.nextOf(body.next) || '/app.html#/settings' });
  if (!url) return refuse(req, res, 404, 'PROVIDER_OFF');
  return res.json({ url });
}

/** the start visit with an `lt`: the intent fields for the start row, or null (the visit is refused as a finished sign-in) */
async function takeLinkStart(lt, device, key) {
  const held = await pending.take('linkstart', String(lt));
  if (!held || held.confirm || held.device_id !== device || held.provider !== key) return null;
  return { intent: 'link', identity_id: held.identity_id, entity_id: held.entity_id, jti: held.jti || '' };
}

/** the checks both halves share: the lt's account is live, in this shop, and the shop still accepts the provider -> { person } or { word } (a result word for the person) */
async function linkable(started, claims, req) {
  const shop = started.entity_id;
  const person = (await identityAuth.rowsOfCandidates(query, [started.identity_id]))[0];
  if (!person || !identityAuth.isAccount(person) || endedStatus(person.status) || String(person.parent_entity_id || person.identity_id) !== String(shop)) return { word: 'SIGNIN_REFUSED' };
  if (provider.signinMethodRefusal(await flagsOf(shop), started.provider)) {
    audit(req, shop, started.identity_id, 'fail', started.provider, 'SIGNIN_PROVIDER_NOT_ACCEPTED', claims);
    return { word: 'SIGNIN_PROVIDER_NOT_ACCEPTED' };
  }
  return { person };
}

/** the callback of an intent-link start row: NOTHING IS WRITTEN HERE (a start address replayed from another browser would otherwise link the victim's account). The checked claims wait in a 60-second confirm row,
 *  found by a one-time code the browser carries to the signed-in page -> { word } (a refusal said at once) or { code } (the confirm code; the link is written by confirmLink) */
async function finishLink(started, claims, req) {
  try {
    const ok = await linkable(started, claims, req);
    if (ok.word) return { word: ok.word };
    const code = provider.randomRef();
    await pending.put('linkstart', code, {
      confirm: true,
      provider: started.provider,
      identity_id: started.identity_id,
      entity_id: started.entity_id,
      device_id: started.device_id,
      jti: started.jti || '',
      claims: { issuer: claims.issuer, tenant: claims.tenant, subject: claims.subject, subject_alt: claims.subject_alt, email: claims.email, email_verified: claims.email_verified, org: claims.org, name: claims.name }
    });
    return { code };
  } catch (failure) {
    log.error('signin_provider', { why: 'link failed: ' + String((failure && failure.code) || 'ERR') });
    return { word: 'SIGNIN_UNAVAILABLE' };
  }
}

/* POST /provider/link/finish { code } — the signed-in session that started the link writes it: same account, same session id, same device, or nothing is written */
async function confirmLink(req, res) {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  const dev = sessions.deviceOfSignin(req);
  const held = await pending.take('linkstart', String((req.body && req.body.code) || ''));
  const jti = sessionOf(req);
  // one blind answer for a made-up, spent, expired or someone-else's code (the row is spent either way)
  if (!held || !held.confirm || !jti || held.jti !== jti || held.identity_id !== me(req) || held.device_id !== dev.device_id || String(held.entity_id) !== String(shopOf(req))) {
    return refuse(req, res, 403, 'LINK_CONFIRM_FAILED');
  }
  const claims = held.claims || {};
  const shop = held.entity_id;
  const ok = await linkable(held, claims, req);
  if (ok.word) return refuse(req, res, 403, ok.word === 'SIGNIN_REFUSED' ? 'LINK_CONFIRM_FAILED' : ok.word);
  const done = await links.add(shop, held.identity_id, Object.assign({ provider: held.provider }, claims));
  if (!done.added) {
    audit(req, shop, held.identity_id, 'fail', held.provider, done.code, claims);
    return refuse(req, res, done.code === 'LINK_EXISTS' ? 409 : 403, WORDS[done.code] ? done.code : 'LINK_CONFIRM_FAILED');
  }
  audit(req, shop, held.identity_id, 'link', held.provider, null, claims);
  notice(ok.person, (provider.rowOf(held.provider) || {}).label || held.provider, 'connected to');
  return res.json({ ok: true, linked: true });
}

/* DELETE /provider/links/:link_id — own link only; re-proof; not the last way in; not an enforced provider for staff */
async function unlink(req, res) {
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
  const id = String(req.params.link_id || '');
  const shop = shopOf(req);
  const own = UUID.test(id) ? (await links.listOf(shop, me(req))).find((row) => String(row.link_id).toLowerCase() === id.toLowerCase()) : null;
  if (!own) return refuse(req, res, 404, 'LINK_NOT_FOUND'); // a foreign id, a made-up id and a gone id answer the same
  const proven = await reprove(req, res);
  if (proven.sent) return;
  const { person } = proven;
  const flags = await flagsOf(shop);
  if (flags.signin_required === own.provider && !owner.isOwner(req)) return refuse(req, res, 403, 'LINK_ENFORCED');
  const otherWay = !!person.pin_hash || (!!person.email && person.status === 'active'); // a PIN, or a verified address a code can reach
  if (!otherWay) return refuse(req, res, 409, 'LAST_WAY_IN');
  const done = await links.remove(shop, me(req), own.link_id);
  if (!done.removed) return refuse(req, res, 404, 'LINK_NOT_FOUND');
  audit(req, shop, me(req), 'unlink', own.provider, null, done.link);
  notice(person, (provider.rowOf(own.provider) || {}).label || own.provider, 'removed from');
  return res.json({ ok: true, removed: true });
}

/** a fault of ours is a 503 in true words (never a crash, never "not switched on"); the cause goes to the log as a code word only */
const guarded = (handler) => async (req, res) => {
  try {
    return await handler(req, res);
  } catch (failure) {
    log.error('signin_provider', { why: 'connect failed: ' + String((failure && failure.code) || 'ERR') });
    return problem(req, res, { status: 503, code: 'SIGNIN_UNAVAILABLE', detail: 'Sign-in could not finish. Start again from the sign-in page.' });
  }
};

module.exports = { list: guarded(list), startLink: guarded(startLink), confirmLink: guarded(confirmLink), unlink: guarded(unlink), takeLinkStart, finishLink, WORDS };
