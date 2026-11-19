// tests/deprecation.test.cjs - lib/deprecation.js sends RFC 9745 Deprecation and RFC 8594 Sunset the way the RFCs write them.
//   1 Deprecation is "@" + whole unix seconds (RFC 9745 section 2.1 example: @1688169599 for 2023-06-30T23:59:59Z)
//   2 Sunset is an HTTP-date (RFC 8594 section 3 example form: Sat, 31 Dec 2022 23:59:59 GMT)
//   3 the middleware sets both headers and the Link relations, then calls next
//   4 a bad date or a sunset before the deprecation refuses at mount time
// Offline: no database, no network. Run: node tests/deprecation.test.cjs
'use strict';
const assert = require('node:assert');
const { deprecate, deprecationValue, sunsetValue } = require('../lib/deprecation');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ' + name); pass++; } catch (e) { console.log('  XX  ' + name + ' - ' + e.message); fail++; } };

t('Deprecation is @ + unix seconds (RFC 9745 example)', () => {
  assert.strictEqual(deprecationValue('2023-06-30T23:59:59Z'), '@1688169599');
  assert.strictEqual(deprecationValue(new Date('2023-06-30T23:59:59Z')), '@1688169599');
});
t('Sunset is an HTTP-date (RFC 8594 form)', () => {
  assert.strictEqual(sunsetValue('2022-12-31T23:59:59Z'), 'Sat, 31 Dec 2022 23:59:59 GMT');
});
t('middleware sets both headers and the links, then calls next', () => {
  const h = {}; let nexted = 0;
  const res = { set: (k, v) => { h[k] = v; }, append: (k, v) => { h[k] = (h[k] ? h[k] + ', ' : '') + v; } };
  deprecate({ deprecated: '2026-11-18T00:00:00Z', sunset: '2027-05-18T00:00:00Z', link: 'https://example.test/v2', sunsetLink: 'https://example.test/sunset' })({}, res, () => { nexted++; });
  assert.strictEqual(h.Deprecation, '@' + Math.floor(Date.parse('2026-11-18T00:00:00Z') / 1000));
  assert.strictEqual(h.Sunset, 'Tue, 18 May 2027 00:00:00 GMT');
  assert.ok(/rel="deprecation"/.test(h.Link) && /rel="sunset"/.test(h.Link));
  assert.strictEqual(nexted, 1);
});
t('no link given: no Link header', () => {
  const h = {};
  deprecate({ deprecated: '2026-11-18', sunset: '2027-05-18' })({}, { set: (k, v) => { h[k] = v; }, append: () => { throw new Error('no link expected'); } }, () => {});
  assert.ok(h.Deprecation && h.Sunset && !h.Link);
});
t('a bad date or sunset before deprecation refuses at mount time', () => {
  assert.throws(() => deprecate({ deprecated: 'nope', sunset: '2027-05-18' }), TypeError);
  assert.throws(() => deprecate({ deprecated: '2027-05-18', sunset: '2026-11-18' }), RangeError);
});
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
