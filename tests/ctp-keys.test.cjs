/**
 * RAIL-141 (g) · lib/ctpkeys.verifyWith with real keys: Ed25519 only, one spelling of a signature, a bad peer
 * key said once at warn. Offline: node's own crypto, no database, no network.
 */
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const API = path.join(__dirname, '..');
const logger = require(path.join(API, 'lib', 'logger'));
const keys = require(path.join(API, 'lib', 'ctpkeys'));

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

const pem = (key) => key.export({ type: 'spki', format: 'pem' }).toString();
const ed = crypto.generateKeyPairSync('ed25519');
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const HASH = 'a'.repeat(64);
const edSig = crypto.sign(null, Buffer.from(HASH, 'utf8'), ed.privateKey).toString('base64');
const rsaSig = crypto.sign('sha256', Buffer.from(HASH, 'utf8'), rsa.privateKey).toString('base64');

const warned = [];
const realWarn = logger.warn;
logger.warn = (what) => { warned.push(String(what)); };

console.log('\n══ ctpkeys.verifyWith · RAIL-141 (g) ══\n');
try {
  ok('a real Ed25519 signature verifies', () => {
    assert.strictEqual(keys.verifyWith(pem(ed.publicKey), HASH, edSig), true);
  });

  ok('a PEM pasted with literal \\n still verifies', () => {
    assert.strictEqual(keys.verifyWith(pem(ed.publicKey).replace(/\n/g, '\\n'), HASH, edSig), true);
  });

  ok('another hash does not verify', () => {
    assert.strictEqual(keys.verifyWith(pem(ed.publicKey), 'b'.repeat(64), edSig), false);
  });

  ok('an RSA key with its own valid signature is refused — CTP signs Ed25519', () => {
    assert.strictEqual(crypto.verify('sha256', Buffer.from(HASH, 'utf8'), rsa.publicKey, Buffer.from(rsaSig, 'base64')), true, 'the rig: the RSA pair is good');
    assert.strictEqual(keys.verifyWith(pem(rsa.publicKey), HASH, rsaSig), false);
  });

  ok('junk after the padding is not a second spelling of the same signature', () => {
    for (const twin of [edSig + 'AAAA', edSig + '==', edSig + ' ', edSig.slice(0, -2), edSig.replace(/==$/, '')]) {
      assert.strictEqual(keys.verifyWith(pem(ed.publicKey), HASH, twin), false, 'verified: ' + JSON.stringify(twin.slice(-8)));
    }
  });

  ok('stray bits in the last character are not a second spelling either', () => {
    const last = edSig.charAt(85);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const twin = edSig.slice(0, 85) + alphabet[alphabet.indexOf(last) + 1] + '==';
    assert.ok(Buffer.from(twin, 'base64').equals(Buffer.from(edSig, 'base64')), 'the rig: node decodes both to the same bytes');
    assert.strictEqual(keys.verifyWith(pem(ed.publicKey), HASH, twin), false);
  });

  ok('no key, no signature, a non-string signature or a key that does not parse answer no, never throw', () => {
    assert.strictEqual(keys.verifyWith(null, HASH, edSig), false);
    assert.strictEqual(keys.verifyWith(pem(ed.publicKey), HASH, null), false);
    assert.strictEqual(keys.verifyWith(pem(ed.publicKey), HASH, { toString: () => edSig }), false);
    assert.strictEqual(keys.verifyWith('-----BEGIN PUBLIC KEY-----\nnot a key\n-----END PUBLIC KEY-----', HASH, edSig), false);
  });

  ok('a bad peer key is said at warn, once per key, and the PEM is not in the line', () => {
    keys._reset();
    warned.length = 0;
    keys.verifyWith(pem(rsa.publicKey), HASH, edSig);
    keys.verifyWith(pem(rsa.publicKey), HASH, edSig);
    keys.verifyWith('-----BEGIN PUBLIC KEY-----\ngarbage\n-----END PUBLIC KEY-----', HASH, edSig);
    assert.strictEqual(warned.length, 2, 'one line per bad key: ' + JSON.stringify(warned));
    assert.ok(/is rsa, not ed25519/.test(warned[0]), warned[0]);
    assert.ok(!/BEGIN PUBLIC KEY|garbage/.test(warned.join(' ')), 'the PEM was logged');
  });
} finally {
  logger.warn = realWarn;
}

(async () => {
  const name = 'a broken signing key refuses the send in fixed words — no variable name, no parser text';
  const saved = process.env.CTP_PRIVATE_KEY;
  try {
    process.env.CTP_PRIVATE_KEY = 'not a pem at all';
    keys._reset();
    const transport = require(path.join(API, 'lib', 'ctptransport'));
    const out = await transport.send('https://far.example/api/ctp/deliver', { chit_id: 'c1', from: {}, to: {}, header: {}, lines: [] });
    assert.strictEqual(out.why, 'this installation cannot sign yet — nothing was sent');
    pass++; console.log('   ok   ' + name);
  } catch (e) {
    fail++; console.log('   FAIL ' + name + '\n          ' + e.message);
  } finally {
    if (saved === undefined) delete process.env.CTP_PRIVATE_KEY; else process.env.CTP_PRIVATE_KEY = saved;
    keys._reset();
  }

  /* RAIL-142 (h) · Q19: what the far end says, and where it lives, never inside the sentence the shopkeeper reads */
  const realFetch = global.fetch;
  const sendTo = async (fetchStub) => {
    process.env.CTP_PRIVATE_KEY = keys.generate().CTP_PRIVATE_KEY;
    keys._reset();
    global.fetch = fetchStub;
    const transport = require(path.join(API, 'lib', 'ctptransport'));
    return transport.send('https://8.8.8.8/api/ctp/deliver', { chit_id: 'c1', from: {}, to: {}, header: {}, lines: [] });
  };
  const cases = [
    ['a far refusal is our sentence, with their words in far_why (text, capped)', async () => {
      const out = await sendTo(async () => ({ ok: false, status: 403, json: async () => ({ accepted: false, why: '<img src=x onerror=alert(1)>' + 'x'.repeat(5000) }) }));
      assert.strictEqual(out.why, 'the far installation refused this chit');
      assert.strictEqual(out.far_why.length, 300);
      assert.strictEqual(out.status, 403);
    }],
    ['a far why that is not text is not quoted at all', async () => {
      const out = await sendTo(async () => ({ ok: false, status: 400, json: async () => ({ why: { nested: 'object' } }) }));
      assert.strictEqual(out.far_why, null);
    }],
    ['an unreachable far end names no url and no error text', async () => {
      const out = await sendTo(async () => { throw new Error('getaddrinfo ENOTFOUND 8.8.8.8 <b>'); });
      assert.strictEqual(out.why, 'the far installation could not be reached — nothing was sent');
    }],
    ['an accepted copy still says accepted', async () => {
      const out = await sendTo(async () => ({ ok: true, status: 200, json: async () => ({ accepted: true }) }));
      assert.strictEqual(out.accepted, true);
      assert.strictEqual(out.why, 'accepted');
    }],
  ];
  for (const [label, fn] of cases) {
    try { await fn(); pass++; console.log('   ok   ' + label); }
    catch (e) { fail++; console.log('   FAIL ' + label + '\n          ' + e.message); }
  }
  global.fetch = realFetch;
  if (saved === undefined) delete process.env.CTP_PRIVATE_KEY; else process.env.CTP_PRIVATE_KEY = saved;
  keys._reset();
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
