'use strict';
// OWNS      the shape of a membership certificate and of any document the network master signs (the directory), how it is sealed, and the pure check of one.
// CALLED BY lib/netmember.js (the door, the answers, the operator's issue) · lib/netsync.js (a member verifies what the master sent) · tests/network-cert.test.cjs
// FLOW      issue(master) → { cert, sealed } → a member publishes it as `membership` in its manifest → a receiving door runs check(membership, ctx) against the PINNED master key
// CARD      28-platform-and-operations/network-control-panel (docs/28-platform-and-operations/DESIGN-NETWORK-CONTROL-PANEL.md, "two-part trust")
/**
 * ⭐ NO SECOND DIGEST RULE. A certificate is JSON sealed over `canon.hash` exactly as a CTP envelope is (lib/ctpenvelope.digest), signed with an Ed25519 key
 * from the ONE key holder (lib/ctpkeys, the `network` slot). No new dependency.
 *
 * ⚠️ THIS FILE NEVER READS THE DATABASE OR THE CLOCK BY ITSELF. `check` takes everything it needs in `ctx` (the pinned key, the sender's facts, `now`, the revoked
 * serials), so a test can fix the time and a door can say exactly which fact failed. A refusal is a CODE (a client may branch on it) and a SENTENCE (a person reads it).
 *
 * The certificate: { v, serial, installation_key, domain, public_key_hash, accepts_populations, not_before, not_after, issued_by }.
 *  · public_key_hash binds it to the member's CTP key: a copy of the installation with another key is not covered.
 *  · The skew tolerated is the existing lib/ctpquery MAX_AGE_MS (5 minutes), at the START only: a lapse is exact, so "cut off" does not drift.
 */
const crypto = require('crypto');
const canon = require('./canon');
const keys = require('./ctpkeys');
const ctpquery = require('./ctpquery');

const DAY_MS = 24 * 60 * 60 * 1000;
const CERT_LIFE_MS = 30 * DAY_MS; /* design: 30 days, renewed from day 20, so a master outage of days changes nothing */
const SKEW_MS = ctpquery.MAX_AGE_MS; /* ONE constant for "how far apart two clocks may be" (critic 25 Oct, point 10) */

const clean = (keyText) => String(keyText || '').replace(/\\n/g, '\n').trim();

/** a short, stable fingerprint of a public key: what the installer prints and the operator compares with the master's panel */
function fingerprint(keyText) {
  return crypto.createHash('sha256').update(clean(keyText)).digest('hex');
}

/** the sealed part of a document: what it covers (a hash) and the master's signature over that hash */
function seal(body, slot) {
  const signer = keys.signer(slot || 'network');
  if (!signer) throw Object.assign(new Error('this installation holds no network root key (CB_NETWORK_ROOT_KEY): it cannot sign'), { code: 'NO_NETWORK_KEY' });
  const hash = canon.hash(JSON.parse(JSON.stringify(body)));
  return { alg: signer.alg, hash, sig: signer.sign(hash) };
}

/** does `sealed` cover exactly `body` and was it signed by `publicKey`? → { ok } | { ok:false, why } */
function unseal(body, sealed, publicKey) {
  if (!sealed || !sealed.sig || !sealed.hash) return { ok: false, why: 'it is not signed' };
  if (canon.hash(JSON.parse(JSON.stringify(body || {}))) !== sealed.hash) return { ok: false, why: 'its contents do not match its seal' };
  return keys.verifyWith(publicKey, sealed.hash, sealed.sig) ? { ok: true } : { ok: false, why: 'it was not signed by the master this installation pinned' };
}

/**
 * issue(facts, now) → { cert, sealed }. facts: { installation_key, domain, public_key (the member's PEM), accepts_populations?, life_ms?, issued_by? }.
 * ⚠️ Needs the network root key; throws NO_NETWORK_KEY without it (a master with no key could not issue anything, so "master" is the key, not the row).
 */
function issue(facts, now) {
  const at = now || new Date();
  const cert = {
    v: 1,
    serial: 'M-' + crypto.randomBytes(8).toString('hex'),
    installation_key: String(facts.installation_key),
    domain: String(facts.domain).toLowerCase(),
    public_key_hash: fingerprint(facts.public_key),
    accepts_populations: facts.accepts_populations || ['live'],
    not_before: at.toISOString(),
    not_after: new Date(at.getTime() + (facts.life_ms || CERT_LIFE_MS)).toISOString(),
    issued_by: facts.issued_by || null
  };
  return { cert, sealed: seal(cert) };
}

const no = (code, sentence) => ({ ok: false, code, why: sentence });

/** the binding checks: this certificate is FOR the installation in front of us */
function bindingRefusal(cert, holder) {
  if (cert.installation_key !== holder.installation_key) return no('CTP_MEMBERSHIP_MISMATCH', 'its certificate was issued to ' + cert.installation_key + ', not to ' + holder.installation_key);
  if (String(cert.domain).toLowerCase() !== String(holder.domain || '').toLowerCase()) return no('CTP_MEMBERSHIP_MISMATCH', 'its certificate names the domain ' + cert.domain + ', not ' + holder.domain);
  if (cert.public_key_hash !== fingerprint(holder.public_key)) return no('CTP_MEMBERSHIP_MISMATCH', 'its certificate was issued for a different signing key than the one it publishes now');
  return null;
}

/** the time checks. The start tolerates a clock up to SKEW_MS behind; the end is exact. */
function timeRefusal(cert, now) {
  const nowMs = now.getTime();
  if (nowMs + SKEW_MS < Date.parse(cert.not_before)) return no('CTP_MEMBERSHIP_NOT_YET', 'its membership certificate starts at ' + cert.not_before + ', which is later than this installation’s clock');
  if (nowMs > Date.parse(cert.not_after)) return no('CTP_MEMBERSHIP_LAPSED', 'its membership certificate lapsed on ' + cert.not_after + '; its operator renews it with the network master');
  return null;
}

/**
 * check(membership, ctx) → { ok:true, cert } | { ok:false, code, why }.
 * ctx: { pin: { public_key, installation_key }, who: { installation_key, domain, public_key }, now?: Date, revoked?: Set|array of serials }
 */
function check(membership, ctx) {
  const holder = ctx.who;
  if (!membership || !membership.cert) {
    return no('CTP_NO_MEMBERSHIP', holder.installation_key + ' holds no membership certificate from the network master (' + ctx.pin.installation_key + '), so it is not accepted here. Its operator asks the master for one.');
  }
  const sealOk = unseal(membership.cert, membership.sealed, ctx.pin.public_key);
  if (!sealOk.ok) return no('CTP_MEMBERSHIP_UNTRUSTED', holder.installation_key + '’s membership certificate is refused: ' + sealOk.why + '.');
  const cert = membership.cert;
  const refusal = bindingRefusal(cert, holder) || timeRefusal(cert, ctx.now || new Date());
  if (refusal) return Object.assign(refusal, { why: holder.installation_key + ': ' + refusal.why + '.' });
  const revoked = ctx.revoked instanceof Set ? ctx.revoked : new Set(ctx.revoked || []);
  if (revoked.has(cert.serial)) return no('CTP_MEMBERSHIP_REVOKED', holder.installation_key + ' was suspended by the network master (certificate ' + cert.serial + '), so it is not accepted here. Its own shops and data are untouched.');
  return { ok: true, cert };
}

module.exports = { fingerprint, seal, unseal, issue, check, CERT_LIFE_MS, SKEW_MS, DAY_MS };
