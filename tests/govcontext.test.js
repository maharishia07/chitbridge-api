'use strict';
/**
 * WHAT THE APPLICATION CAN KNOW WITHOUT ASKING — the governance context derived at registration.
 *
 * Athi, 2026-09-18: *"most of the parameter we have to pick and fill in ourselves… need to know the location,
 * language, currency, country… device information, device type, ip and so on."*
 *
 * Pure: the engine takes the browser's facts as an object, so every case here is a sentence about a real
 * device rather than a mock of one. No DOM, no network, no database.
 *
 * ⚠️ THE THREE RULES THIS FILE DEFENDS, because each of them is a decision somebody could undo by accident:
 *   1. it never prompts — no geolocation, ever;
 *   2. a guess is labelled, and unknown is a real answer rather than a silent default;
 *   3. the BROWSER never reports an IP, because it cannot see one.
 *
 * Run: node tests/govcontext.test.js
 */
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

/* the engine is a browser IIFE that hangs itself on the global, exactly like locale.js */
const SRC = path.join(__dirname, '..', '..', 'chitbridge-web', 'public', 'app', 'govcontext.js');
const LOCALE = path.join(__dirname, '..', 'lib', 'locale.browser.js');

let pass = 0, fail = 0;
function it(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e.message).split('\n')[0]); }
}

/* ⚠️ locale first — CBGov reads CBLocale.REGIONS and must not carry a second copy of those maps */
(0, eval)(fs.readFileSync(LOCALE, 'utf8'));
(0, eval)(fs.readFileSync(SRC, 'utf8'));
const G = globalThis.CBGov;

console.log('\n══ the governance context ══\n');

console.log('— where the shop is —');
it('a language tag with a region says the country: en-IN → India, and says so', () => {
  const c = G.countryOf({ language: 'en-IN', timeZone: 'Asia/Kolkata' });
  assert.strictEqual(c.value, 'IN');
  assert.ok(/language/.test(c.from), 'it does not say where the answer came from');
});
it('a bare language says nothing, so the time zone answers: "ta" in Asia/Kolkata → India', () => {
  assert.strictEqual(G.regionFromTag('ta'), '');
  const c = G.countryOf({ language: 'ta', timeZone: 'Asia/Kolkata' });
  assert.strictEqual(c.value, 'IN');
  assert.ok(/time zone/.test(c.from));
});
/**
 * ⭐ THE TAG BEATS THE ZONE, and the case that proves it is a real one: an Indian shopkeeper's laptop in Dubai
 * for a week still reports en-IN. A tag is what the reader CHOSE; a zone is where the machine is sitting.
 */
it('⭐ the chosen language beats where the machine is sitting', () => {
  assert.strictEqual(G.countryOf({ language: 'en-IN', timeZone: 'Asia/Dubai' }).value, 'IN');
  assert.strictEqual(G.countryOf({ language: 'ar-AE', timeZone: 'Asia/Kolkata' }).value, 'AE');
});
it('a second language is tried before giving up: ["ta","en-LK"] → Sri Lanka', () => {
  const c = G.countryOf({ language: 'ta', languages: ['ta', 'en-LK'], timeZone: 'Europe/Zurich' });
  assert.strictEqual(c.value, 'LK');
});
/**
 * ⚠️⚠️ UNKNOWN IS A REAL ANSWER. Country decides tax, currency and every format; a silent default of IN would
 * put an Indian tax regime on a shop in Zurich and nothing on the screen would say why. [[feedback-country-first]]
 */
it('⚠️⚠️ a country we do not serve returns UNKNOWN, and names what it saw', () => {
  const c = G.countryOf({ language: 'de-CH', timeZone: 'Europe/Zurich' });
  assert.strictEqual(c.value, '', 'it guessed a country the platform cannot serve');
  assert.strictEqual(c.unserved, 'CH', 'it does not say which country it recognised but cannot serve');
});
it('⚠️ nothing at all is still unknown, never a default', () => {
  assert.strictEqual(G.countryOf({}).value, '');
  assert.strictEqual(G.read({}).country.value, '');
});

console.log('— what the region then says —');
/**
 * ⭐ THE MONEY AND THE FORMATS COME FROM CBLocale.REGIONS, not from a second table in this file. One answer to
 * "what money does India use". [[feedback-adopt-dont-reinvent]]
 */
it('⭐ the region names the money and the formats — this engine keeps no second copy', () => {
  const c = G.read({ language: 'en-IN', timeZone: 'Asia/Kolkata' });
  assert.strictEqual(c.currency.value, 'INR');
  assert.strictEqual(c.locale.value, 'en-IN');
  assert.strictEqual(c.country.name, 'India');
  const src = fs.readFileSync(SRC, 'utf8');
  assert.ok(src.indexOf('CBLocale.REGIONS') > 0, 'the engine no longer reads the regions it should be reading');
  assert.ok(src.indexOf("'INR'") < 0 && src.indexOf("'AED'") < 0,
    'a currency is hard-coded here — that is a second opinion about what money a country uses');
});
it('an unknown country leaves the money blank rather than picking one', () => {
  const c = G.read({ language: 'de-CH', timeZone: 'Europe/Zurich' });
  assert.strictEqual(c.currency.value, '');
  assert.strictEqual(c.country.value, '');
});

console.log('— what kind of machine —');
it('a phone: the UA says mobile', () => {
  assert.strictEqual(G.deviceOf({ uaMobile: true, screenW: 390, screenH: 844, coarsePointer: true }), 'phone');
});
it('a phone by size when the UA will not say', () => {
  assert.strictEqual(G.deviceOf({ uaMobile: null, screenW: 390, screenH: 844, coarsePointer: true }), 'phone');
});
it('a tablet', () => {
  assert.strictEqual(G.deviceOf({ uaMobile: false, screenW: 820, screenH: 1180, coarsePointer: true }), 'tablet');
});
it('a desktop has a fine pointer, whatever its size', () => {
  assert.strictEqual(G.deviceOf({ screenW: 1920, screenH: 1080, coarsePointer: false }), 'desktop');
  assert.strictEqual(G.deviceOf({ screenW: 390, screenH: 844, coarsePointer: false }), 'desktop');
});
/**
 * ⚠️ A COUNTER IS A ROLE, NOT A SCREEN SIZE. A tablet is a waiter's handheld in one shop and the till in
 * another, and deciding that from pixels would tell a shopkeeper what their own equipment is for.
 */
it('⚠️ nothing here ever answers "counter" — that is a choice, not a measurement', () => {
  const sizes = [[390, 844], [820, 1180], [1920, 1080], [1024, 768]];
  for (const [w, h] of sizes)
    for (const coarse of [true, false])
      assert.notStrictEqual(G.deviceOf({ screenW: w, screenH: h, coarsePointer: coarse }), 'counter');
});

console.log('— the three rules —');
/**
 * ⚠️⚠️⚠️ NO PROMPT, EVER. A shop signing up must not meet a permission dialog on its first screen, and
 * geolocation is the one every "detect the country" instinct reaches for first.
 */
it('⚠️⚠️⚠️ it never asks the browser for anything — no geolocation, no permissions', () => {
  /**
   * ⚠️ COMMENTS STRIPPED FIRST. The note at the top of the engine explains that it never touches geolocation,
   * so a plain text search fails on the very sentence promising it — a guard that cannot tell prose from code
   * reports the documentation as the fault. (The same trap as the --sk-ph guard.)
   */
  const raw = fs.readFileSync(SRC, 'utf8');
  const code = raw
    .split('/*').map((part, n) => (n === 0 ? part : part.slice(part.indexOf('*/') + 2))).join(' ')
    .split('\n').map((l) => { const at = l.indexOf('//'); return at < 0 ? l : l.slice(0, at); }).join('\n');
  for (const forbidden of ['geolocation', 'getCurrentPosition', 'watchPosition', 'permissions.query', 'requestPermission'])
    assert.ok(code.indexOf(forbidden) < 0, 'the engine reaches for ' + forbidden + ' — registration would prompt');
  /* ⭐ and the promise is still made in writing, where the next person will read it */
  assert.ok(raw.indexOf('DERIVE, NEVER PROMPT') > 0, 'the rule is no longer stated in the engine');
});
/**
 * ⚠️⚠️ THE BROWSER CANNOT SEE THE IP AND MUST NOT INVENT ONE. Anything it made up would land on an identity
 * record as evidence. The server reads it from the request it is already holding.
 */
it('⚠️⚠️ the browser reports no IP at all — not even an empty one to be mistaken for a reading', () => {
  const c = G.read({ language: 'en-IN', timeZone: 'Asia/Kolkata' });
  assert.strictEqual(c.ip, undefined, 'there is an ip field, so a blank can be mistaken for a reading');
  assert.strictEqual(G.payload(c).ip, undefined, 'the payload carries an ip the browser cannot know');
});
/** ⭐ every value says where it came from, so the screen can show a reading and a guess differently */
it('⭐ every row carries what it came from, and says whether it is known', () => {
  const rows = G.rows(G.read({ language: 'en-IN', timeZone: 'Asia/Kolkata', screenW: 1920, screenH: 1080 }));
  assert.strictEqual(rows.length, 5);
  for (const r of rows) {
    assert.ok(r.what && typeof r.known === 'boolean', 'a row does not say what it is or whether it is known');
    if (r.known) assert.ok(String(r.from || '').length > 3, r.what + ' does not say where it came from');
  }
  const unknown = G.rows(G.read({}));
  assert.ok(unknown.some((r) => !r.known), 'nothing is ever reported as unknown, so a guess cannot be spotted');
});
it('the payload sends values, not the explanations', () => {
  const p = G.payload(G.read({ language: 'en-IN', timeZone: 'Asia/Kolkata', screenW: 1920, screenH: 1080 }));
  assert.strictEqual(p.country, 'IN');
  assert.strictEqual(p.currency_code, 'INR');
  assert.strictEqual(p.timezone, 'Asia/Kolkata');
  assert.ok(p.device && p.device.type, 'the device is not described');
  assert.strictEqual(p.from, undefined, 'the payload carries the screen copy as well as the values');
  /* ⚠️ nulls, not empty strings — an unknown must not arrive at the database as a value */
  const blank = G.payload(G.read({}));
  assert.strictEqual(blank.country, null);
  assert.strictEqual(blank.currency_code, null);
});

/* ⚠️ THE RUNNER COUNTS "<n> checks" AND NOTHING ELSE. scripts/guards.cjs takes the last such line; a guard that
   ends without one reads as "0 checks" and is reported FAILED — 2026-09-17 caught three that proved nothing
   for exactly this reason. So the tally is printed in the shape the suite reads. */
console.log('\n══ governance context · ' + pass + ' passed · ' + fail + ' failed ══');
console.log(pass + ' checks\n');
if (fail) process.exitCode = 1;
