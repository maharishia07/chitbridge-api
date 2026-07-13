// vault-crypto-test.js — LOCAL unit proof of vault at-rest encryption (F1). No DB, no network.
// Run: node scripts/vault-crypto-test.js
const crypto = require('crypto');
let P = 0, F = 0; const chk = (n, ok, d) => { ok ? (P++, console.log('  ✓ ' + n + (d ? '  ' + d : ''))) : (F++, console.log('  ✗ ' + n + (d ? '  — ' + d : ''))); };

console.log('== VAULT CRYPTO (AES-256-GCM, key from env) ==\n');

// a realistic vault with the sensitive fields the reviewer flagged
const vault = {
  identity: { legal_name: 'Royale Paints Pvt Ltd', country: 'India' },
  registrations: { gstin: '33AJMPR0813M1Z0', pan: 'AJMPR0813M', iec: 'AAACR1234B' },
  banking: { account_no: '9876543210012345', ifsc: 'HDFC0001234', swift: 'HDFCINBB' },
  signatory: { name: 'A. Narayanan', designation: 'Director' },
};

// 1 · no key → encrypt fails closed
delete process.env.VAULT_ENC_KEY;
delete require.cache[require.resolve('../lib/vaultcrypto')];
let vc = require('../lib/vaultcrypto');
chk('not configured when no key', vc.isConfigured() === false);
try { vc.encryptVault(vault); chk('encrypt fails closed w/o key', false, 'did not throw'); }
catch (e) { chk('encrypt fails closed w/o key', e.status === 503 && e.code === 'VAULT_ENC_UNCONFIGURED', e.code); }

// 2 · with a key → round-trip
process.env.VAULT_ENC_KEY = crypto.randomBytes(32).toString('base64');
delete require.cache[require.resolve('../lib/vaultcrypto')];
vc = require('../lib/vaultcrypto');
chk('configured with a valid key', vc.isConfigured() === true);
const env = vc.encryptVault(vault);
chk('envelope shape {v,alg,iv,tag,ct}', env.v === 1 && env.alg === 'aes-256-gcm' && !!env.iv && !!env.tag && !!env.ct);

const serialized = JSON.stringify(env);
chk('stored form is CIPHERTEXT (no account no in the blob)', serialized.indexOf('9876543210012345') === -1);
chk('stored form is CIPHERTEXT (no GSTIN in the blob)', serialized.indexOf('33AJMPR0813M1Z0') === -1);
chk('stored form is CIPHERTEXT (no legal name in the blob)', serialized.indexOf('Royale Paints') === -1);

const back = vc.decryptVault(env);
chk('round-trip decrypts to the original', JSON.stringify(back) === JSON.stringify(vault));
chk('  └ banking.account_no intact', back.banking && back.banking.account_no === '9876543210012345');

// 3 · tamper → auth fails → {} (never the wrong plaintext)
const tampered = { ...env, ct: Buffer.from(Buffer.from(env.ct, 'base64').map((b, i) => i === 0 ? b ^ 0xff : b)).toString('base64') };
chk('tampered ciphertext → {} (GCM auth)', JSON.stringify(vc.decryptVault(tampered)) === '{}');

// 4 · wrong key → {} (can't read another key's data)
process.env.VAULT_ENC_KEY = crypto.randomBytes(32).toString('base64');
delete require.cache[require.resolve('../lib/vaultcrypto')];
const vc2 = require('../lib/vaultcrypto');
chk('wrong key → {} (not the plaintext)', JSON.stringify(vc2.decryptVault(env)) === '{}');

// 5 · non-envelope / empty → {} (no crash on legacy/absent)
chk('null → {}', JSON.stringify(vc.decryptVault(null)) === '{}');
chk('plain object (non-envelope) → {}', JSON.stringify(vc.decryptVault({ identity: { legal_name: 'x' } })) === '{}');

console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
process.exit(F ? 1 : 0);
