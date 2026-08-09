'use strict';
// Regression — the CHANNEL MAP (b123). Which inbound number / address belongs to which entity.
//
// This is the map the capture webhooks resolve against, so the whole security property of the public webhook rests
// on it: the entity comes from the MAP, never from the payload. These are the pure parts — normalisation and the
// channel catalogue — asserted with no server and no DB.  Run: node tests/channels.test.js
const assert = require('node:assert');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  \x1b[32mok\x1b[0m  ' + name); pass++; } catch (e) { console.log('  \x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; } };

const ch = require('../lib/channels');

console.log('\nchannels · normalisation — one number is ONE key');
/**
 * ⚠️ THE FAILURE THIS PREVENTS IS SILENT. A provider sends "+919876543210"; the owner typed "+91 98765 43210".
 * Stored as written, the lookup misses, ownerOf returns null, the webhook decides the message is "not for us" and
 * drops it — with a 200, no error, and a customer who believes they placed an order. There is nothing to debug
 * afterwards, which is exactly why it has to be impossible up front.
 */
t('★★ spaces, dashes and brackets are all the same number', () => {
  const want = '+919876543210';
  for (const raw of ['+919876543210', '+91 98765 43210', '+91-98765-43210', '(91) 9876543210', ' 919876543210 ']) {
    assert.strictEqual(ch.normalise('whatsapp', raw), want, JSON.stringify(raw));
  }
});
t('★ a leading zero is not part of an international number', () => {
  assert.strictEqual(ch.normalise('whatsapp', '0919876543210'), '+919876543210');
});
t('★ sms normalises like whatsapp — both are phone numbers', () => {
  assert.strictEqual(ch.normalise('sms', '+91 98765 43210'), '+919876543210');
});
t('★★ email is case-folded — Orders@Shop.com and orders@shop.com are one address', () => {
  assert.strictEqual(ch.normalise('email', '  Orders@Shop.com '), 'orders@shop.com');
});
t('★ an empty address normalises to empty, never to "+"', () => {
  assert.strictEqual(ch.normalise('whatsapp', '   '), '');
  assert.strictEqual(ch.normalise('whatsapp', '++'), '');
  assert.strictEqual(ch.normalise('email', ''), '');
});

console.log('\nchannels · the catalogue of channels');
t('★ every channel declares what it needs to receive on', () => {
  for (const c of ch.CHANNELS) {
    assert.ok(c.key && c.name && c.addressLabel, 'incomplete channel: ' + JSON.stringify(c));
    assert.ok(Array.isArray(c.env), c.key + ' must declare its env requirement, even if empty');
  }
});
/**
 * ⚠️ "CONFIGURED" MEANS THE SERVER HOLDS THE SECRET — not that somebody typed a number into a form. A panel that
 * reports WhatsApp as connected when it is not sends the owner away believing messages will arrive, and they will
 * not. The claim has to be derived from the environment, every time it is asked.
 */
t('★★ a channel is only "configured" when its secrets are really present', () => {
  const wa = ch.CHANNELS.find((c) => c.key === 'whatsapp');
  const had = { ...process.env };
  delete process.env.WHATSAPP_APP_SECRET; delete process.env.WHATSAPP_VERIFY_TOKEN;
  assert.strictEqual(ch.providerReady(wa), false, 'no secrets → not configured');
  process.env.WHATSAPP_APP_SECRET = 'x';
  assert.strictEqual(ch.providerReady(wa), false, 'HALF the secrets is still not configured');
  process.env.WHATSAPP_VERIFY_TOKEN = 'y';
  assert.strictEqual(ch.providerReady(wa), true, 'both present → configured');
  process.env = had;
});
t('★ a channel needing no provider is ready on its own (the web intake link)', () => {
  assert.strictEqual(ch.providerReady(ch.CHANNELS.find((c) => c.key === 'web')), true);
});

console.log('\nchannels · ⚠️ a CLAIM is not a PERMISSION (b124)');
/**
 * The gap b124 closes, asserted at the only place it can be without a DB: the SQL that channel_owner() is defined
 * as. b123 resolved on the binding alone, so entity A claiming entity B's live number would have received B's
 * customers' messages. `status` existed as a rung and nothing read it — declared-but-unenforced.
 *
 * ⚠️ AND WHY IT IS NOT A SELF-SERVICE CHALLENGE. Send-a-code-and-send-it-back proves nothing for an inbound line:
 * the claimant is shown the code and the number is reachable by anyone, so A can message B's number with A's own
 * code. A challenge is only proof when the claimant cannot also satisfy it.
 */
const fs = require('node:fs'), path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'b124_channel_verified_only.sql'), 'utf8');
t('★★ channel_owner() resolves VERIFIED bindings only — a declared claim reaches nobody', () => {
  const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION channel_owner'));
  assert.match(fn, /status\s*=\s*'verified'/, 'the status filter is the whole point of b124');
});
t('★ it stays SECURITY DEFINER and narrow — the webhook has no session to read the table with', () => {
  const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION channel_owner'));
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /RETURNS uuid/, 'it answers one question and returns one id — never a row, never a list');
  assert.match(sql, /REVOKE ALL ON FUNCTION channel_owner\(text, text\) FROM PUBLIC/);
});
t('★★ approval is NOT an entity action — it cannot be reached with a normal session', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'channels.js'), 'utf8');
  const approve = route.slice(route.indexOf("router.post('/:id/approve'"));
  assert.ok(!/^\s*router\.post\('\/:id\/approve',\s*auth/.test(approve), 'approve must not use the entity auth middleware');
  assert.match(approve.split('\n')[0], /admin/, 'approve must sit behind the admin gate');
});
t('★★ a missing CB_ADMIN_KEY DISABLES approval — it never means "no check"', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'channels.js'), 'utf8');
  const gate = route.slice(route.indexOf('function admin('), route.indexOf("router.post('/:id/approve'"));
  assert.match(gate, /if \(!key\) return res\.status\(503\)/, 'no key must fail CLOSED, not open');
  assert.match(gate, /timingSafeEqual/, 'compare the key in constant time');
});

console.log('\nchannels · ⚠️ the webhook must get the RAW body');
/**
 * An HMAC is computed over the exact bytes the provider sent; a re-serialised parsed object is not those bytes.
 * A global express.json() mounted before the capture router consumed the stream, so the route's own express.raw()
 * saw an already-parsed object, createHmac().update({}) threw, the route's catch swallowed it, and EVERY delivery
 * got a cheerful 200. A signature could never be verified and every real message would have been dropped while
 * Meta was told it had been accepted. Silent, total, and invisible to anything except an actual signed request.
 */
t('★★ the raw parser for /api/capture/webhook is mounted BEFORE express.json', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const raw = srv.indexOf("app.use('/api/capture/webhook', express.raw(");
  const json = srv.indexOf('app.use(express.json(');
  assert.ok(raw > -1, 'the raw mount is missing — signatures cannot be verified');
  assert.ok(json > -1, 'express.json mount not found; this test needs rewriting');
  assert.ok(raw < json, 'raw must come FIRST or the body is already consumed and the HMAC can never match');
});

console.log('\nchannels · ' + (fail ? '\x1b[31m' + fail + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + '  (' + pass + ' assertions)\n');
process.exit(fail ? 1 : 0);
