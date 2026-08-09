'use strict';
// Regression — OUTBOUND (b126). "Your order has been accepted", back on WhatsApp.
//
// ⚠️ WHY THIS IS A UNIT TEST AND NOT A LIVE PROOF. Inbound could be proven end-to-end against production because
// the webhook trusts an HMAC made with OUR secret — a self-signed payload is indistinguishable from Meta's.
// Outbound calls META'S servers, so it cannot be exercised without a real token; there is nothing to self-sign.
// What CAN be proven without an account is the part that decides whether to send at all, which is also the part
// with the governance in it. The wire call itself stays unproven until a token exists, and is marked as such.
//
// Run: node tests/whatsapp-out.test.js
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  \x1b[32mok\x1b[0m  ' + name); pass++; } catch (e) { console.log('  \x1b[31mXX\x1b[0m  ' + name + ' — ' + e.message); fail++; } };

process.env.JWT_SECRET = process.env.JWT_SECRET || 'wa-out-test';
const w = require('../lib/whatsapp-out');

console.log('\nwhatsapp-out · what it says, and what it stays quiet about');
/**
 * ⚠️ A CHANNEL THAT NARRATES EVERY INTERNAL STEP TRAINS PEOPLE TO IGNORE IT. Only statuses that mean something to
 * the person who sent the message get a reply; an internal reassignment or a read receipt is not their business.
 */
t('★ only customer-facing statuses speak', () => {
  const speaks = Object.keys(w.SAY).sort();
  assert.deepStrictEqual(speaks, ['accepted', 'cancelled', 'completed', 'in_progress', 'rejected']);
});
t('★★ nothing it says promises what has not been agreed', () => {
  const all = Object.values(w.SAY).map((f) => f('X')).join(' ').toLowerCase();
  for (const word of ['guarantee', 'confirmed price', 'will be delivered on', 'paid', 'invoice']) {
    assert.ok(!all.includes(word), 'outbound copy must not imply "' + word + '"');
  }
  assert.match(w.SAY.accepted('X'), /accepted/i);
  assert.match(w.SAY.rejected('X'), /could not be accepted/i);
});
t('★ the subject is optional — a missing one must not print "undefined"', () => {
  for (const f of Object.values(w.SAY)) {
    const s = f(null);
    assert.ok(!/undefined|null/.test(s), 'bad copy with no subject: ' + s);
  }
});

console.log('\nwhatsapp-out · ⚠️ the 24-hour window is a RULE, not a rate limit');
/**
 * Free-form text may only be sent within 24h of the customer's last inbound. Outside it Meta accepts ONLY
 * pre-approved templates, and we have none registered. Sending anyway would be rejected — or worse, billed as a
 * business-initiated conversation nobody authorised.
 */
t('★ the window is exactly 24 hours', () => assert.strictEqual(w.WINDOW_MS, 24 * 60 * 60 * 1000));
t('★★ with no token it REFUSES rather than pretending to queue', async () => {
  delete process.env.WHATSAPP_TOKEN;
  assert.strictEqual(w.canSend(), false);
});
t('★★ every refusal that HAS a recipient is logged, not silently dropped', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsapp-out.js'), 'utf8');
  const notify = src.slice(src.indexOf('async function notify('), src.indexOf('async function notifyChitStatus'));
  /**
   * A notification never attempted is not the same as one that failed, and the shop must be able to tell which.
   * So every refusal on the send path goes through _log — no token, no provider_ref, window closed.
   *
   * ⚠️ THE ONE EXCEPTION IS DELIBERATE. `!to_ref || !text` returns bare, because there is no recipient to file the
   * receipt against (to_ref is NOT NULL) and it is a caller error rather than a business outcome — nothing was
   * ever going to be sent to anyone. Asserting the count keeps that exception at exactly one.
   */
  const logged = (notify.match(/_log\(entity_id, \{[^;]*status: 'refused'/g) || []).length;
  const bare = (notify.match(/return \{ status: 'refused'/g) || []).length;
  assert.ok(logged >= 3, 'expected the token / provider_ref / window refusals to be logged, found ' + logged);
  assert.strictEqual(bare, 1, 'exactly one bare refusal is allowed (no recipient to file against), found ' + bare);
});
t('★★ absent evidence counts as OUTSIDE the window, never inside', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsapp-out.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function windowOpen'), src.indexOf('async function _log'));
  assert.match(fn, /if \(!last\) return \{ open: false/, 'no inbound history must mean CLOSED');
  assert.match(fn, /catch \(e\) \{ return \{ open: false/, 'a failed read must mean CLOSED, never open');
});

console.log('\nwhatsapp-out · ⚠️ it must never affect the chit');
t('★★ the status route calls it AFTER res.json and does not await it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chits.js'), 'utf8');
  // ⚠️ `.notifyChitStatus(` — the CALL, not the first mention. The explanatory comment above it names the function
  // too, and matching that put the assertion window 200 characters short of the code it was meant to check. A test
  // reading documentation instead of implementation passes or fails for reasons that have nothing to do with either.
  const i = src.indexOf('.notifyChitStatus(');
  assert.ok(i > -1, 'the status route does not notify at all');
  const before = src.slice(0, i);
  const lastRes = before.lastIndexOf('res.json({');
  assert.ok(lastRes > -1 && lastRes < i, 'notify must come AFTER the response is sent');
  const call = src.slice(i - 200, i + 200);
  assert.ok(!/await\s+require\('\.\.\/lib\/whatsapp-out'\)/.test(call), 'must not be awaited — it would delay the chit operation');
  assert.match(call, /\.catch\(\(\) => \{\}\)/, 'a failed send must not surface as an unhandled rejection');
});
t('★★ it only replies when the chit CAME FROM a channel', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsapp-out.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function notifyChitStatus'));
  assert.match(fn, /FROM capture c/, 'the reply target must come from the capture, not from the chit');
  assert.match(fn, /if \(!cap \|\| !cap\.sender_ref\) return null/, 'no capture → no reply; messaging a number that never wrote to us is unsolicited contact');
});

console.log('\nwhatsapp-out · ⚠️ templates — the only path that spends on someone not talking to us');
const tpl = require('../lib/whatsapp-templates');
t('★ one UTILITY template carries every status', () => {
  const all = tpl.forDisplay();
  assert.strictEqual(all.length, 1, 'more templates = more Meta approvals = a business that ships none of them');
  assert.strictEqual(all[0].category, 'UTILITY', 'an order update is transactional, not marketing — filing it wrong is both a rejection risk and a false description');
  assert.match(all[0].body, /\{\{1\}\}/, 'the status must travel as a parameter');
});
/**
 * ⚠️ APPROVAL IS PER-WABA. Meta approves a template for one WhatsApp Business Account; our having written it, or
 * another business having had theirs approved, says nothing about whether THIS number may send it. An absent flag
 * must therefore read as NO, not as "probably fine".
 */
t('★★ an absent approval means NO, not "probably fine"', () => {
  assert.strictEqual(tpl.approvedOn({}, 'order_status_update'), false);
  assert.strictEqual(tpl.approvedOn({ templates: {} }, 'order_status_update'), false);
  assert.strictEqual(tpl.approvedOn({ templates: { order_status_update: 'pending' } }, 'order_status_update'), false);
  assert.strictEqual(tpl.approvedOn({ templates: { order_status_update: 'approved' } }, 'order_status_update'), true);
});
t('★★ outside the window, an unapproved template REFUSES and says both reasons', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsapp-out.js'), 'utf8');
  const notify = src.slice(src.indexOf('async function notify('), src.indexOf('async function notifyChitStatus'));
  assert.match(notify, /if \(win\.open\)/, 'the window must still decide which kind of message is even possible');
  assert.match(notify, /is not approved on this number/, 'the refusal must name the template problem, not just the window');
  assert.match(notify, /tpl\.approvedOn\(binding, TEMPLATE_FOR_STATUS\)/, 'approval must be read off the BINDING, not a global');
});
/**
 * ⚠️ META REJECTS PARAMETERS WITH NEWLINES, TABS OR RUNS OF SPACES, and a rejected send is indistinguishable from
 * a lost message at the customer's end. Clean here, where it is certain, rather than trusting whatever the status
 * sentence happened to contain.
 */
t('★★ parameters are cleaned so Meta cannot reject them on formatting', () => {
  assert.strictEqual(tpl.cleanParam('a\nb\tc'), 'a b c');
  assert.ok(!/ {4,}/.test(tpl.cleanParam('a' + ' '.repeat(9) + 'b')));
  assert.strictEqual(tpl.cleanParam(''), '-', 'an empty parameter is rejected outright by Meta');
  assert.strictEqual(tpl.cleanParam(null), '-');
});
t('★ the send payload is the shape Meta documents', () => {
  const p = tpl.buildSend('+919876543210', 'order_status_update', ['It has been accepted.']);
  assert.strictEqual(p.type, 'template');
  assert.strictEqual(p.to, '919876543210', 'Meta takes the number without a leading +');
  assert.strictEqual(p.template.name, 'order_status_update');
  assert.strictEqual(p.template.components[0].parameters[0].text, 'It has been accepted.');
});

console.log('\nwhatsapp-out · ' + (fail ? '\x1b[31m' + fail + ' FAILED\x1b[0m' : '\x1b[32mall passed\x1b[0m') + '  (' + pass + ' assertions)');
console.log('  \x1b[33m⚠️\x1b[0m  The WIRE CALL to Meta is NOT covered here and cannot be until a real token exists.\n');
process.exitCode = fail ? 1 : 0;
