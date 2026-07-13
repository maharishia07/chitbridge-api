// lib/vaultcrypto.js — VAULT AT-REST ENCRYPTION (reviewer F1, 2026-07-13).
// The vault holds a business's complete banking + tax identity. RLS does NOT defend a DB dump or an admin credential, so
// the column must never hold plaintext. This encrypts the whole vault object with AES-256-GCM (authenticated) under a key
// that lives ONLY in the app env (VAULT_ENC_KEY) — never in the DB. A dump/admin therefore sees ciphertext only.
//
// Stored form = a VERSIONED ENVELOPE {v,alg,iv,tag,ct} (base64). `v` lets the scheme rotate. Key = 32 bytes, supplied as
// hex (64 chars) or base64. Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// FAIL-CLOSED on write: encryptVault THROWS if no key is configured → saveVault refuses to store, so real vault data can
// NEVER land in plaintext by accident. On read, a missing/wrong key returns {} (never throws) so a misconfig can't crash.
const crypto = require('crypto');
const ALG = 'aes-256-gcm';

function getKey() {
  const raw = process.env.VAULT_ENC_KEY;
  if (!raw) return null;
  let buf;
  try { buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64'); } catch (_) { return null; }
  return (buf && buf.length === 32) ? buf : null;
}

// is encryption configured (a valid 32-byte key present)? Used to gate the vault feature honestly.
function isConfigured() { return !!getKey(); }

function isEnvelope(x) { return !!(x && typeof x === 'object' && x.ct && x.iv && x.tag && x.alg); }

// obj → envelope. Throws 503 VAULT_ENC_UNCONFIGURED if no key (fail closed — never store plaintext).
function encryptVault(obj) {
  const key = getKey();
  if (!key) { const e = new Error('Vault encryption not configured — set VAULT_ENC_KEY before storing vault data.'); e.status = 503; e.code = 'VAULT_ENC_UNCONFIGURED'; throw e; }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(obj || {}), 'utf8')), cipher.final()]);
  return { v: 1, alg: ALG, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

// stored value → obj. Non-envelope (no data) → {} ; missing/wrong key or tamper → {} (authenticated, never throws on read).
function decryptVault(stored) {
  if (!isEnvelope(stored)) return {};   // null / empty / non-envelope → nothing to decrypt
  const key = getKey();
  if (!key) return {};                  // can't decrypt without the key → empty (safe)
  try {
    const decipher = crypto.createDecipheriv(stored.alg, key, Buffer.from(stored.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(stored.ct, 'base64')), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  } catch (_) { return {}; }            // GCM auth failure (tamper / wrong key) → empty
}

module.exports = { encryptVault, decryptVault, isConfigured, isEnvelope };
