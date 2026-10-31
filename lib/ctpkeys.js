'use strict';
// @stage poc
// CARD 05-ctp-and-cross-installation/seal-rail
// @stage-note CTP step 4 (docs/CTP-DESIGN.md §8.1). This installation's signing identity. Read by routes/ctp.js
//             to publish the public half and to sign outgoing envelopes; unset in every deployment today, which
//             is why signing degrades to "unsigned and it says so" rather than to an exception.
// @stage-why  The key is the sovereignty anchor b74 named. It belongs in one file so that "which key signs for
//             this installation?" has exactly one answer, and so a white-label deployment differs by one
//             environment variable.
/**
 * ── ⭐⭐⭐ WHO THIS INSTALLATION IS, CRYPTOGRAPHICALLY ────────────────────────────────────────────────────────────
 *
 * b74 called `installation.root_key_ref` *"the sovereignty anchor"* and nothing has ever read it. This is what
 * reads it — or rather, what holds the key it refers to.
 *
 * ⭐ Ed25519, from node's own crypto. No dependency, small keys, and one obvious way to use it. The private half
 * lives in `CTP_PRIVATE_KEY` (PEM, PKCS#8) and NOWHERE ELSE — not in the database, because a database backup
 * that restores an installation's identity somewhere else is an installation that can be impersonated from a
 * backup.
 *
 * ── ⚠️⚠️ IT DEGRADES, IT DOES NOT THROW ─────────────────────────────────────────────────────────────────────────
 *
 * No key configured → `signer()` is null, envelopes go out `alg: 'none'`, and the manifest publishes no public
 * key. A receiver that requires signatures will refuse them, which is the correct outcome and a legible one.
 * The alternative — throwing at startup — turns "CTP is not set up" into "the API will not boot", and CTP is a
 * feature almost no deployment uses. [[feedback-silence-is-the-bug]] is satisfied by `status()`, which every
 * caller can print.
 *
 * ⚠️ AND A MALFORMED KEY IS NOT THE SAME AS NO KEY. A typo'd PEM must not read as "signing is off" — that is how
 * a deployment believes it is signing and is not. `status()` distinguishes them and says so.
 */

const crypto = require('crypto');
const logger = require('./logger');

/* RAIL-97: ONE holder, TWO named key slots. 'ctp' is this installation's own signing identity (CTP_PRIVATE_KEY); 'network' is the NETWORK ROOT key
   (CB_NETWORK_ROOT_KEY) that only a master holds: it signs membership certificates and the master's own questions. The same Ed25519 code reads both. */
const SLOTS = { ctp: 'CTP_PRIVATE_KEY', network: 'CB_NETWORK_ROOT_KEY' };
const held = {}; /* env name -> { ok, privateKey?, publicKeyPem?, why } — computed once; a key does not change at runtime */

function load(slot) {
  const name = SLOTS[slot || 'ctp'];
  if (!name) return { ok: false, why: 'no key slot called ' + slot };
  if (held[name]) return held[name];
  const text = String(process.env[name] || '').trim();
  if (!text) {
    held[name] = { ok: false, why: name + ' is not set — this installation cannot sign' };
    return held[name];
  }
  try {
    /* ⚠️ the PEM may arrive with literal \n from an environment variable pasted through a UI */
    const privateKey = crypto.createPrivateKey(text.replace(/\\n/g, '\n'));
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      held[name] = { ok: false, why: name + ' is a ' + privateKey.asymmetricKeyType + ' key — CTP signs ed25519' };
      return held[name];
    }
    const publicKeyPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
    held[name] = { ok: true, privateKey, publicKeyPem, why: 'ed25519, from ' + name };
  } catch (e) {
    /* ⚠️ NOT "no key". A deployment with a broken key believes it is signing; this says otherwise, loudly. */
    held[name] = { ok: false, why: name + ' is set but unusable: ' + e.message };
  }
  return held[name];
}

/** what a human or a health check should be told — never the private half */
function status(slot) {
  const k = load(slot);
  return { can_sign: k.ok, public_key: k.ok ? k.publicKeyPem : null, why: k.why };
}

/**
 * The signer lib/ctpenvelope.sign expects, or null when this installation has no identity.
 * ⚠️ Signs the DIGEST it is handed, never a message it constructs itself — one definition of "the bytes that are
 * covered" lives in ctpenvelope.digest, and a second one here would be a signature that verifies nothing.
 */
function signer(slot) {
  const k = load(slot);
  if (!k.ok) return null;
  return {
    alg: 'ed25519',
    sign: (hash) => crypto.sign(null, Buffer.from(String(hash), 'utf8'), k.privateKey).toString('base64')
  };
}

/* RAIL-141 (g): an Ed25519 signature is 64 bytes, so exactly 88 base64 characters ending "==", and the last data
   character carries no stray bits. Node's decoder ignores anything after the padding, so "sig + junk" verified:
   one delivery, many signatures. Only the one canonical spelling is accepted. */
const SIGNATURE_RE = /^[A-Za-z0-9+/]{85}[AQgw]==$/;
const warnedPeers = new Set();

/* RAIL-141 (g): a peer key that will not do is a fault in THEIR manifest — said at warn, once per key, never the PEM */
function warnPeerOnce(publicKeyPem, what, err) {
  const print = crypto.createHash('sha256').update(String(publicKeyPem)).digest('hex').slice(0, 12);
  if (warnedPeers.has(print)) return;
  if (warnedPeers.size >= 500) warnedPeers.clear(); /* bounded by registered peers already; capped anyway (cb-security, #485) */
  warnedPeers.add(print);
  logger.fellBack('ctpkeys verifyWith: a peer key (sha256 ' + print + '…) ' + what + ' — every signature from it answers no', err);
}

/**
 * Verify a signature against a PUBLIC key in PEM — the far installation's, from its manifest.
 * ⚠️ Never throws: a malformed key from a stranger is a refusal, not a crash on our side.
 * RAIL-141 (g): Ed25519 only, as load() insists for our own key — an RSA key and an RSA signature verified true.
 */
function verifyWith(publicKeyPem, hash, sigB64) {
  if (!publicKeyPem || typeof sigB64 !== 'string' || !SIGNATURE_RE.test(sigB64)) return false;
  let peerKey = null;
  try {
    peerKey = crypto.createPublicKey(String(publicKeyPem).replace(/\\n/g, '\n'));
  } catch (e) {
    warnPeerOnce(publicKeyPem, 'does not parse', e);
    return false;
  }
  if (peerKey.asymmetricKeyType !== 'ed25519') {
    warnPeerOnce(publicKeyPem, 'is ' + peerKey.asymmetricKeyType + ', not ed25519', null);
    return false;
  }
  return crypto.verify(null, Buffer.from(String(hash), 'utf8'), peerKey, Buffer.from(sigB64, 'base64'));
}

/** ⭐ for an operator standing one up: `node -e "console.log(require('./lib/ctpkeys').generate())"` */
function generate(slot) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    [SLOTS[slot || 'ctp']]: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    public_key: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  };
}

/** tests need a fresh read after changing the environment */
function _reset() {
  for (const k of Object.keys(held)) delete held[k];
  warnedPeers.clear();
}

module.exports = { status, signer, verifyWith, generate, _reset };
