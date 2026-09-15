'use strict';
// @stage poc
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

let cached = null;   /* { ok, privateKey?, publicKeyPem?, why } — computed once; a key does not change at runtime */

function load() {
  if (cached) return cached;
  const pem = String(process.env.CTP_PRIVATE_KEY || '').trim();
  if (!pem) { cached = { ok: false, why: 'CTP_PRIVATE_KEY is not set — this installation cannot sign' }; return cached; }
  try {
    /* ⚠️ the PEM may arrive with literal \n from an environment variable pasted through a UI */
    const privateKey = crypto.createPrivateKey(pem.replace(/\\n/g, '\n'));
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      cached = { ok: false, why: 'CTP_PRIVATE_KEY is a ' + privateKey.asymmetricKeyType + ' key — CTP signs ed25519' };
      return cached;
    }
    const publicKeyPem = crypto.createPublicKey(privateKey)
      .export({ type: 'spki', format: 'pem' }).toString();
    cached = { ok: true, privateKey, publicKeyPem, why: 'ed25519, from CTP_PRIVATE_KEY' };
  } catch (e) {
    /* ⚠️ NOT "no key". A deployment with a broken key believes it is signing; this says otherwise, loudly. */
    cached = { ok: false, why: 'CTP_PRIVATE_KEY is set but unusable: ' + e.message };
  }
  return cached;
}

/** what a human or a health check should be told — never the private half */
function status() {
  const k = load();
  return { can_sign: k.ok, public_key: k.ok ? k.publicKeyPem : null, why: k.why };
}

/**
 * The signer lib/ctpenvelope.sign expects, or null when this installation has no identity.
 * ⚠️ Signs the DIGEST it is handed, never a message it constructs itself — one definition of "the bytes that are
 * covered" lives in ctpenvelope.digest, and a second one here would be a signature that verifies nothing.
 */
function signer() {
  const k = load();
  if (!k.ok) return null;
  return {
    alg: 'ed25519',
    sign: (hash) => crypto.sign(null, Buffer.from(String(hash), 'utf8'), k.privateKey).toString('base64'),
  };
}

/**
 * Verify a signature against a PUBLIC key in PEM — the far installation's, from its manifest.
 * ⚠️ Never throws: a malformed key from a stranger is a refusal, not a crash on our side.
 */
function verifyWith(publicKeyPem, hash, sigB64) {
  try {
    if (!publicKeyPem || !sigB64) return false;
    return crypto.verify(null, Buffer.from(String(hash), 'utf8'),
      crypto.createPublicKey(String(publicKeyPem).replace(/\\n/g, '\n')),
      Buffer.from(String(sigB64), 'base64'));
  } catch (_) { return false; }
}

/** ⭐ for an operator standing one up: `node -e "console.log(require('./lib/ctpkeys').generate())"` */
function generate() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    CTP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    public_key: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** tests need a fresh read after changing the environment */
function _reset() { cached = null; }

module.exports = { status, signer, verifyWith, generate, _reset };
