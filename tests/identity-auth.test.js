'use strict';
/**
 * identity-auth.test.js — the ONE lookup and ONE verify (lib/identity-auth.js), driven with a fake `query` so
 * it runs with no database and no server. [capability: sign-in]
 *
 * ⚠️ WHY THIS EXISTS. routes/entities.js and routes/actors.js each answered "OTP or PIN?" a different way for
 * two months before this file was written — one bypassing lib/dev-otp.js's isSealed() check entirely, the
 * other duplicating the attempt-lock inline. This is the guard the capability entry in app/cap-legend.js
 * names as its own gov gap: something that fails if a THIRD route grows a third copy instead of calling here.
 *
 * Run:  node tests/identity-auth.test.js
 */
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const IA = require('../lib/identity-auth');

let pass = 0, fail = 0;
/** ⚠️ SEQUENTIAL, AWAITED — not fire-and-forget with a fixed setTimeout at the end. A DB-shaped fake still
 *  resolves on a microtask; racing the summary against it is exactly the kind of flaky timing this codebase's
 *  own rules refuse (never widen a run to chase a flake — remove the race instead). */
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

/**
 * a tiny in-memory `identities` table, just enough of it, behind the same query(sql, params) shape as pg.
 * ⚠️ NOT a defensive copy — the exact row objects passed in are stored and mutated in place, the same way a
 * real request re-reads current state from Postgres on its next call. A test that loops verifyCredential()
 * against a copy that never changes is testing something no real request boundary produces.
 */
function fakeDb(rows) {
  const table = rows;
  return async (sql, params) => {
    const s = sql.replace(/\s+/g, ' ');
    if (/UPDATE identities SET.*otp_code = \$1/.test(s)) {
      const row = table.find((r) => r.identity_id === params[2]);
      if (row) { row.otp_code = params[0]; row.otp_expires_at = params[1]; row.otp_attempts = 0; }
      return { rows: [] };
    }
    if (/otp_attempts = COALESCE\(otp_attempts, 0\) \+ 1/.test(s)) {
      const row = table.find((r) => r.identity_id === params[0]);
      if (row) row.otp_attempts = (row.otp_attempts || 0) + 1;
      return { rows: [] };
    }
    if (/UPDATE identities SET pin_attempts = \$1/.test(s)) {
      const row = table.find((r) => r.identity_id === params[1]);
      if (row) { row.pin_attempts = params[0]; if (/pin_locked_at/.test(s)) row.pin_locked_at = new Date(); }
      return { rows: [] };
    }
    if (/pin_attempts = 0/.test(s) || /otp_code = NULL/.test(s) || /email_verified/.test(s)) {
      const row = table.find((r) => r.identity_id === params[0]);
      if (row) { row.pin_attempts = 0; row.otp_code = null; row.otp_expires_at = null; row.otp_attempts = 0; }
      return { rows: [] };
    }
    if (/WHERE email = \$1 AND identity_type = 'entity'/.test(s))
      return { rows: table.filter((r) => r.email === params[0] && r.identity_type === 'entity') };
    if (/WHERE LOWER\(user_id\) = LOWER\(\$1\)/.test(s) && /identity_type = 'entity'/.test(s))
      return { rows: table.filter((r) => String(r.user_id || '').toLowerCase() === params[0].toLowerCase() && r.identity_type === 'entity') };
    if (/WHERE LOWER\(display_name\) = LOWER\(\$1\)/.test(s))
      return { rows: table.filter((r) => String(r.display_name || '').toLowerCase() === params[0].toLowerCase() && r.identity_type === 'entity') };
    if (/WHERE LOWER\(user_id\) = LOWER\(\$1\)/.test(s))
      return { rows: table.filter((r) => String(r.user_id || '').toLowerCase() === params[0].toLowerCase()) };
    if (/WHERE actor_key = \$1 AND parent_entity_id = \$2/.test(s))
      return { rows: table.filter((r) => r.actor_key === params[0] && r.parent_entity_id === params[1] && r.identity_type === 'actor') };
    throw new Error('fakeDb: unhandled query — ' + s.slice(0, 80));
  };
}

/* ── findLoginIdentity — the shapes it must tell apart ────────────────────────────────────────────────── */

t('⭐ an entity is found by its real email', async () => {
  const q = fakeDb([{ identity_id: 'e1', identity_type: 'entity', email: 'owner@shop.com', user_id: 'mayurbhavan', display_name: 'Mayur Bhavan' }]);
  const { identity } = await IA.findLoginIdentity(q, 'owner@shop.com');
  assert.strictEqual(identity && identity.identity_id, 'e1');
});

t('⭐ an entity is found by its handle, no @ at all', async () => {
  const q = fakeDb([{ identity_id: 'e1', identity_type: 'entity', email: 'owner@shop.com', user_id: 'mayurbhavan', display_name: 'Mayur Bhavan' }]);
  const { identity } = await IA.findLoginIdentity(q, 'mayurbhavan');
  assert.strictEqual(identity && identity.identity_id, 'e1');
});

t('⭐⭐ a coassist is found by their OWN b260 handle — the exact match, no classify() needed', async () => {
  const q = fakeDb([{ identity_id: 'a1', identity_type: 'actor', user_id: 'bala@mayurbhavan.br', actor_key: 'bala', parent_entity_id: 'e1', display_name: 'Bala' }]);
  const { identity } = await IA.findLoginIdentity(q, 'bala@mayurbhavan.br');
  assert.strictEqual(identity && identity.identity_id, 'a1');
});

t('⭐⭐⭐ a coassist typed the way a person actually types it, unsuffixed — this is the bug that shipped', async () => {
  const q = fakeDb([
    { identity_id: 'e1', identity_type: 'entity', user_id: 'mayurbhavan', display_name: 'Mayur Bhavan' },
    { identity_id: 'a1', identity_type: 'actor', user_id: 'bala@mayurbhavan.br', actor_key: 'bala', parent_entity_id: 'e1', display_name: 'Bala' },
  ]);
  // ⚠️ this is EXACTLY the shape routes/entities.js's `input.includes('@')` would have sent down the entity
  // email branch, found nothing in the `email` column, and (outside a test) gone on to register a new entity.
  const { identity } = await IA.findLoginIdentity(q, 'bala@mayurbhavan');
  assert.strictEqual(identity && identity.identity_id, 'a1');
});

t('⚠️⚠️ two entities sharing a name is refused, never guessed', async () => {
  const q = fakeDb([
    { identity_id: 'e1', identity_type: 'entity', user_id: 'e1id', display_name: 'Clothing' },
    { identity_id: 'e2', identity_type: 'entity', user_id: 'e2id', display_name: 'Clothing' },
    { identity_id: 'a1', identity_type: 'actor', user_id: 'ravi@clothing.br', actor_key: 'ravi', parent_entity_id: 'e1', display_name: 'Ravi' },
  ]);
  const r = await IA.findLoginIdentity(q, 'ravi@Clothing');
  assert.strictEqual(r.identity, null);
  assert.strictEqual(r.ambiguous, true);
});

t('nothing typed, nothing found — no crash, no guess', async () => {
  const q = fakeDb([]);
  const r = await IA.findLoginIdentity(q, 'nobody@nowhere');
  assert.strictEqual(r.identity, null);
  assert.strictEqual(r.ambiguous, false);
});

/* ── needsPin ──────────────────────────────────────────────────────────────────────────────────────────── */

t('⭐ only an actor WITH a pin_hash needs a PIN — everyone else, OTP', async () => {
  assert.strictEqual(IA.needsPin({ identity_type: 'actor', pin_hash: 'x' }), true);
  assert.strictEqual(IA.needsPin({ identity_type: 'actor', pin_hash: null }), false, 'first-time actor — OTP, not PIN');
  assert.strictEqual(IA.needsPin({ identity_type: 'entity', pin_hash: 'x' }), false, 'an entity is never PIN, whatever the column says');
  assert.strictEqual(IA.needsPin(null), false);
});

/* ── verifyCredential — OTP path ──────────────────────────────────────────────────────────────────────── */

t('⭐ the OTP path clears the code on success', async () => {
  const row = { identity_id: 'e1', identity_type: 'entity', otp_code: '123456', otp_expires_at: new Date(Date.now() + 60000), otp_attempts: 0 };
  const q = fakeDb([row]);
  const r = await IA.verifyCredential(q, row, { otp: '123456' });
  assert.strictEqual(r.ok, true);
});

t('a wrong OTP is refused, not silently accepted', async () => {
  const row = { identity_id: 'e1', identity_type: 'entity', otp_code: '123456', otp_expires_at: new Date(Date.now() + 60000), otp_attempts: 0 };
  const q = fakeDb([row]);
  const r = await IA.verifyCredential(q, row, { otp: '000000' });
  assert.strictEqual(r.ok, false);
});

/* ── verifyCredential — PIN path ──────────────────────────────────────────────────────────────────────── */

t('⭐⭐ the PIN path compares against the hash, never the plain column', async () => {
  const hash = await bcrypt.hash('4321', 10);
  const row = { identity_id: 'a1', identity_type: 'actor', pin_hash: hash, pin_attempts: 0, pin_locked_at: null };
  const q = fakeDb([row]);
  const r = await IA.verifyCredential(q, row, { pin: '4321' });
  assert.strictEqual(r.ok, true);
});

t('⭐⭐ the wrong KIND of credential asks for a PIN — never falls back to OTP silently', async () => {
  const hash = await bcrypt.hash('4321', 10);
  const row = { identity_id: 'a1', identity_type: 'actor', pin_hash: hash, pin_attempts: 0, pin_locked_at: null };
  const q = fakeDb([row]);
  const r = await IA.verifyCredential(q, row, { otp: '123456' }); // sent an OTP to an identity that needs a PIN
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.use_pin, true);
});

t('⚠️⚠️ five wrong PINs lock the account — the sixth correct one still fails', async () => {
  const hash = await bcrypt.hash('4321', 10);
  const row = { identity_id: 'a1', identity_type: 'actor', pin_hash: hash, pin_attempts: 0, pin_locked_at: null };
  const q = fakeDb([row]);
  for (let i = 0; i < IA.MAX_PIN_ATTEMPTS; i++) { await IA.verifyCredential(q, row, { pin: '0000' }); }
  assert.ok(row.pin_locked_at, 'locked after ' + IA.MAX_PIN_ATTEMPTS + ' wrong tries');
  const r = await IA.verifyCredential(q, row, { pin: '4321' }); // the RIGHT pin, after the lock
  assert.strictEqual(r.ok, false, 'locked means locked, even for the correct PIN');
});

/* ── personShape — the one shape both routes now hand a client ──────────────────────────────────────────── */

t('⭐⭐⭐ personShape is the SAME fields for an entity and a coassist — this is what closes the keep() gap', async () => {
  const e = IA.personShape({ identity_id: 'e1', bridge_id: 'CB1', display_name: 'Mayur Bhavan', email: 'o@s.com', user_id: 'mayurbhavan', identity_type: 'entity' });
  const a = IA.personShape({ identity_id: 'a1', bridge_id: 'CB2', display_name: 'Bala', email: null, user_id: 'bala@mayurbhavan.br', identity_type: 'actor' });
  assert.deepStrictEqual(Object.keys(e).sort(), Object.keys(a).sort());
  assert.strictEqual(a.identity_type, 'actor');
});

(async () => {
  for (const [name, fn] of cases) {
    try { await fn(); console.log('  \x1b[32mok\x1b[0m  ' + name); pass++; }
    catch (e) { console.log('  \x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
