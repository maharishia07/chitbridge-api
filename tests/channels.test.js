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

console.log('\nchannels · ' + (fail ? '\x1b[31m' + fail + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + '  (' + pass + ' assertions)\n');
process.exit(fail ? 1 : 0);
