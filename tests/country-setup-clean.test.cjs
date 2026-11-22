/**
 * country-setup-clean.test.cjs — the field-by-field cleaners of a country-setup save (lib/country-setup-clean.js, a part of country-setup.js).
 * OWNS      the unit rule per cleaner: a country or money code, the year-start month, the time zone, the source words, the tax answer — each clean, or refused in words (400)
 * CARD      20-settings-governance-and-plan/country-setup
 * MIN       unit-per-rule · refusal-path · fail-closed
 * Offline: no database, no network. The parent's three helpers are bound here with the real shapes (a refusal carries code, message, status).
 */
'use strict';
const assert = require('assert');
const clean = require('../lib/country-setup-clean').boundTo({
  refuse_: (code, message, status) => Object.assign(new Error(message), { code, status }),
  registeredOf: (answer) => (answer === true || answer === 'true' ? true : answer === false || answer === 'false' ? false : null),
  zoneOk: (zone) => /^[A-Za-z]+\/[A-Za-z_]+$/.test(zone)
});
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('   ok   ' + name); };
const refused = (fn, words) => assert.throws(fn, (e) => e.code === 'COUNTRY_SETUP_BAD' && e.status === 400 && (!words || words.test(e.message)));

console.log('\n== country-setup-clean · the owner\'s words, cleaned or refused ==\n');
t('a code is trimmed and upper-cased', () => assert.strictEqual(clean.cleanCode(' au ', /^[A-Z]{2}$/, 'x'), 'AU'));
t('a code that is not the shape is refused with the sentence given', () => refused(() => clean.cleanCode('Australia', /^[A-Z]{2}$/, 'Pick the country.'), /Pick the country/));
t('an empty code is refused, never defaulted', () => refused(() => clean.cleanCode(undefined, /^[A-Z]{2}$/, 'Pick the country.')));
t('the year-start month is 1 to 12', () => { assert.strictEqual(clean.cleanMonth('4'), 4); assert.strictEqual(clean.cleanMonth(12), 12); });
t('a month out of range, fractional or missing is refused', () => { for (const bad of [0, 13, 4.5, 'april', null, undefined]) refused(() => clean.cleanMonth(bad), /financial year starts/); });
t('a zone the system knows passes; none sent is empty (the pack\'s one zone is set without asking)', () => { assert.strictEqual(clean.cleanTimezone(' Australia/Sydney '), 'Australia/Sydney'); assert.strictEqual(clean.cleanTimezone(undefined), ''); });
t('a zone the system does not know is refused', () => refused(() => clean.cleanTimezone('Mars/Olympus_Mons_1'), /time zone/));
t('only the five known source fields are kept, each cut to 60 characters', () => {
  const out = clean.cleanSource({ country: 'x'.repeat(100), tax: 'typed', stray: 'dropped', currency: null });
  assert.deepStrictEqual(Object.keys(out).sort(), ['country', 'tax']);
  assert.strictEqual(out.country.length, 60);
});
t('a source that is not an object is empty', () => assert.deepStrictEqual(clean.cleanSource('typed'), {}));
t('registered with no number is refused in words (fail closed: nothing is stored on a guess)', () => refused(() => clean.cleanTax('AU', { registered: true }), /registration number/));
t('a number sent with no answer to "registered?" is refused, never silently dropped', () => refused(() => clean.cleanTax('IN', { number: '27AAPFU0939F1ZV' }), /registered for tax/));
t('not registered, no number: clean, and the scheme is none', () => {
  const out = clean.cleanTax('IN', { registered: false });
  assert.strictEqual(out.registered, false);
  assert.strictEqual(out.number, '');
});
t('a tax answer that is not an object is read as nothing said', () => assert.strictEqual(clean.cleanTax('IN', 'yes').registered, null));
console.log('\n' + pass + ' checks');
