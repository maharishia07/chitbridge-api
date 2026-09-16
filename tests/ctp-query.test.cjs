/**
 * ── ⭐⭐⭐ CTP QUERY — the READ verb, proven without a network ───────────────────────────────────────────────────
 *
 * Athi, 2026-09-16: *"catalogue pull I guess… the same resolves in cross platform also."*
 *
 * What is under test is the RULE: a signed question round-trips, a tampered or stale or unsigned one is refused
 * with a reason, the asker refuses to ask an unpaired installation, and — the part that matters most — the door
 * that answers a peer calls the SAME public-view function an anonymous visitor gets. A pull that could show a
 * peer more than /shop.html shows is the one failure this verb must not have.
 *
 * ⚠️ OFFLINE. Keys are generated in-process; the "network" is an injected fetch. Same stance as ctp-collision.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = path.join(__dirname, '..');
const Q = require('../lib/ctpquery');

let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };
const okA = async (name, fn) => { try { await fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); } };

/**
 * ── ⚠️⚠️ THE VERIFIER IS THE REAL ONE, AND THAT IS THE LESSON OF THIS FILE'S FIRST DAY ───────────────────────
 *
 * The first version signed the raw hash BYTES (`Buffer.from(hash, 'hex')`) and verified the same way — on both
 * sides — so every check passed. Then the live two-installation simulation (2026-09-16) had Home refuse every
 * question from Mexico with "signature did not verify": lib/ctpkeys signs the hex STRING's utf-8 bytes, and a
 * test that verifies with its own function can never notice that it disagrees with the one production uses.
 *
 * ⭐ So the asker signs the way ctpkeys.signer does, and the answerer verifies through ctpkeys.verifyWith —
 * the exact function routes/ctp.js calls. The convention is pinned against the code that enforces it, not
 * against a copy of what I believed it was.
 */
const keys = require('../lib/ctpkeys');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const signer = { alg: 'ed25519', sign: (hash) => crypto.sign(null, Buffer.from(String(hash), 'utf8'), privateKey).toString('base64') };
const verify = (hash, sigB64, who) => who === 'platform-mx' && keys.verifyWith(publicPem, hash, sigB64);

const FROM = { installation_key: 'platform-mx', population: 'live', bridge_id: 'CBMEX1CO99' };
const TO = { installation_key: 'platform-0', domain: 'in.example' };

(async () => {
  console.log('\n══ CTP QUERY — a signed question, and the same public view either way ══\n');

  ok('⭐ a question round-trips: build → sign → open', () => {
    const q = Q.sign(Q.build(FROM, TO, { want: 'catalogue', bridge_id: 'CBZQK5DAH9' }), signer);
    const o = Q.open(q, { verify });
    assert.strictEqual(o.ok, true, o.why);
    assert.strictEqual(o.ask.want, 'catalogue');
    assert.strictEqual(o.ask.bridge_id, 'CBZQK5DAH9');
    assert.strictEqual(o.from.installation_key, 'platform-mx');
  });

  ok('⭐ resolve is the other question — a handle, not a bridge id', () => {
    const q = Q.sign(Q.build(FROM, TO, { want: 'resolve', handle: 'alpha-timers' }), signer);
    const o = Q.open(q, { verify });
    assert.strictEqual(o.ok, true, o.why);
    assert.strictEqual(o.ask.handle, 'alpha-timers');
  });

  ok('⚠️ a question altered after signing is refused', () => {
    const q = Q.sign(Q.build(FROM, TO, { want: 'catalogue', bridge_id: 'CBZQK5DAH9' }), signer);
    q.ask.bridge_id = 'CBSOMEONE1';            /* re-aimed at another store after the seal */
    const o = Q.open(q, { verify });
    assert.strictEqual(o.ok, false);
    assert.ok(/seal does not match/.test(o.why), o.why);
  });

  ok('⚠️ a question signed by somebody else is refused', () => {
    const other = crypto.generateKeyPairSync('ed25519');
    const badSigner = { alg: 'ed25519', sign: (h) => crypto.sign(null, Buffer.from(h, 'hex'), other.privateKey).toString('base64') };
    const q = Q.sign(Q.build(FROM, TO, { want: 'catalogue', bridge_id: 'CBZQK5DAH9' }), badSigner);
    const o = Q.open(q, { verify });
    assert.strictEqual(o.ok, false);
    assert.ok(/signature did not verify/.test(o.why), o.why);
  });

  ok('⚠️⚠️ the wire signs the hex STRING — a signature over the raw hash bytes does NOT verify', () => {
    /* exactly the mistake the first simulation made; it must stay a red check for ever */
    const rawBytesSigner = { alg: 'ed25519', sign: (h) => crypto.sign(null, Buffer.from(h, 'hex'), privateKey).toString('base64') };
    const q = Q.sign(Q.build(FROM, TO, { want: 'catalogue', bridge_id: 'CBZQK5DAH9' }), rawBytesSigner);
    const o = Q.open(q, { verify });
    assert.strictEqual(o.ok, false, 'Home would refuse this, and did — the simulation proved it');
    assert.ok(/signature did not verify/.test(o.why), o.why);
    /* and the correct convention, through the SAME real verifier, passes — so the check is not vacuous */
    assert.strictEqual(Q.open(Q.sign(Q.build(FROM, TO, { want: 'catalogue', bridge_id: 'CBZQK5DAH9' }), signer), { verify }).ok, true);
  });

  ok('⚠️ a captured question is not re-asked next week', () => {
    const q = Q.sign(Q.build(FROM, TO, { want: 'catalogue', bridge_id: 'CBZQK5DAH9' }), signer);
    const later = () => new Date(Date.parse(q.at) + Q.MAX_AGE_MS + 1000);
    const o = Q.open(q, { verify, now: later });
    assert.strictEqual(o.ok, false);
    assert.ok(/minutes old/.test(o.why), o.why);
    assert.ok(q.nonce && q.nonce.length >= 16, 'and every question carries a nonce');
  });

  ok('⚠️ an unsigned question, or one an answerer cannot verify, is refused — never waved through', () => {
    const q = Q.sign(Q.build(FROM, TO, { want: 'catalogue', bridge_id: 'CBZQK5DAH9' }), null);
    assert.strictEqual(Q.open(q, { verify }).ok, false, 'no signature');
    const signed = Q.sign(Q.build(FROM, TO, { want: 'catalogue', bridge_id: 'CBZQK5DAH9' }), signer);
    const o = Q.open(signed, {});
    assert.strictEqual(o.ok, false);
    assert.ok(/cannot verify/.test(o.why), 'an answerer with no verifier must say so: ' + o.why);
  });

  ok('a question must want something this door answers', () => {
    assert.throws(() => Q.build(FROM, TO, { want: 'everything' }), /must want one of/);
    assert.throws(() => Q.build(FROM, TO, { want: 'resolve' }), /needs a handle/);
    assert.throws(() => Q.build(FROM, TO, { want: 'catalogue' }), /needs a bridge id/);
    const q = Q.sign(Q.build(FROM, TO, { want: 'catalogue', bridge_id: 'CBZQK5DAH9' }), signer);
    q.ask.want = 'secrets'; /* after the seal — refused for the want before the seal is even checked */
    assert.strictEqual(Q.open(q, { verify }).ok, false);
  });

  /* ── the ASKER's side, with the network injected ─────────────────────────────────────────────────────────── */
  await okA('⭐ ask() signs, posts to <endpoint>/query, and returns the far answer', async () => {
    let posted = null;
    const r = await Q.ask({ domain: 'in.example' }, { want: 'catalogue', bridge_id: 'CBZQK5DAH9' }, {
      resolvePeer: async () => ({ installation_key: 'platform-0', endpoint: 'https://in.example/api/ctp/deliver', domain: 'in.example' }),
      signer, from: FROM,
      fetch: async (url, opts) => { posted = { url, body: JSON.parse(opts.body), redirect: opts.redirect };
        return { ok: true, status: 200, json: async () => ({ ok: true, found: true, bridge_id: 'CBZQK5DAH9', items: [] }) }; },
    });
    assert.strictEqual(r.ok, true, r.why);
    assert.strictEqual(r.found, true);
    assert.strictEqual(posted.url, 'https://in.example/api/ctp/query', 'the query door sits beside the deliver door');
    assert.strictEqual(posted.redirect, 'error', 'a redirected POST is a different endpoint than the one verified');
    assert.ok(posted.body.sealed && posted.body.sealed.sig, 'what was posted is SIGNED');
    assert.strictEqual(Q.open(posted.body, { verify }).ok, true, 'and the far end would accept it');
  });

  await okA('⚠️ ask() refuses to ask an installation we do not deal with — nothing is sent', async () => {
    let sent = false;
    const r = await Q.ask({ domain: 'stranger.example' }, { want: 'resolve', handle: 'x' }, {
      resolvePeer: async () => null, signer, from: FROM, fetch: async () => { sent = true; },
    });
    assert.strictEqual(r.ok, false);
    assert.ok(/no installation we deal with/.test(r.why), r.why);
    assert.strictEqual(sent, false);
  });

  await okA('⚠️ the far end’s own refusal is quoted, not guessed at', async () => {
    const r = await Q.ask({ domain: 'in.example' }, { want: 'resolve', handle: 'nobody' }, {
      resolvePeer: async () => ({ installation_key: 'platform-0', endpoint: 'https://in.example/api/ctp/deliver', domain: 'in.example' }),
      signer, from: FROM,
      fetch: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, why: 'installation platform-mx is not one we deal with' }) }),
    });
    assert.strictEqual(r.ok, false);
    assert.ok(/not one we deal with/.test(r.why), r.why);
  });

  /* ── SINGLE SOURCE: the door answers with the SAME view an anonymous visitor gets ────────────────────────── */
  ok('⭐⭐⭐ the /query door calls publicViewFor(entity, false) — never buildPublicView, never asOwner', () => {
    const src = fs.readFileSync(path.join(API, 'routes', 'ctp.js'), 'utf8');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const code = strip(src);
    /* neither asOwner nor viewer: the RAW view with no widening, then the SAME trim a visitor gets */
    assert.ok(/publicViewFor\(ent, \{\}\)/.test(code), 'the peer must get exactly the anonymous view');
    assert.ok(/publicResponseFor\(view, false\)/.test(code), 'and exactly the response a visitor is sent');
    assert.ok(!/buildPublicView/.test(code), 'a second call into the view builder is a second visibility policy');
    assert.ok(/verifyWith\(pk\.public_key/.test(code), 'and the signature is checked against the key on THEIR domain');
  });

  /**
   * ⚠️ THIS FIRST FAILED WITH "3 !== 1", AND THAT WAS THE POINT. The extraction had moved one call into
   * publicViewFor and left two others — the network shopfront's per-department view and the enquiry visibility
   * check — each with its own copy of the deps object. Three copies of "what a stranger may see". All three go
   * through publicViewFor now; the raw view is the single source and publicResponseFor is the single trim.
   */
  ok('⭐⭐ and every local caller goes through the SAME function — one view, three doors', () => {
    const src = fs.readFileSync(path.join(API, 'routes', 'catalogue.js'), 'utf8');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const code = strip(src);
    assert.strictEqual((code.match(/catalogueView\.buildPublicView\(/g) || []).length, 1,
      'buildPublicView may be called from exactly ONE place in routes/catalogue.js — publicViewFor');
    assert.ok(/const view = await publicViewFor\(entity, \{ asOwner \}\)/.test(code), 'the /:bridge_id route goes through it');
    assert.ok(/publicViewFor\(ent, \{\}\)/.test(code), 'so does the network shopfront, per department');
    assert.ok(/publicViewFor\(ent\.rows\[0\], \{ viewer \}\)/.test(code), 'and the enquiry check, with its viewer');
    assert.ok(/module\.exports\.publicViewFor = publicViewFor/.test(code));
    assert.ok(/module\.exports\.publicResponseFor = publicResponseFor/.test(code));
    assert.ok(/module\.exports\.resolveEntity = resolveEntity/.test(code));
  });

  ok('⚠️ resolve answers only for a BUSINESS — the grammar decides before the database is asked', () => {
    const src = fs.readFileSync(path.join(API, 'routes', 'ctp.js'), 'utf8');
    assert.ok(/resolveuserid'\)\.classify\(ask\.handle\)/.test(src), 'classify first');
    assert.ok(/c\.kind !== 'entity' && c\.kind !== 'network_node' && c\.kind !== 'bridge_id'/.test(src),
      'an employee, a customer or a minted party is never resolvable by another installation');
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
