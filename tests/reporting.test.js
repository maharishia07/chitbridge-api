'use strict';
/**
 * reporting.test.js — the network reporting currency, and the line between a LENS and a DENOMINATION.
 *
 * The load-bearing test in this file is the one asserting that a converted total FAILS money.isMoney(). That is what
 * stops a derived figure from ever being minted onto a chit as though two parties had agreed it.
 */
const assert = require('assert');
const money = require('../lib/money');
const reporting = require('../lib/reporting');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log(`  PASS  ${name}`); pass++; } catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; } };
const ta = async (name, fn) => { try { await fn(); console.log(`  PASS  ${name}`); pass++; } catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; } };
const throws = (fn, re, msg) => assert.throws(fn, (e) => re.test(e.message), msg);

/** Fake deps: `operators` is what the catalogue says, `entityCurrency` what regional would resolve. */
function deps(operators, entityCurrency) {
  const dbPath = require.resolve('../db');
  const prev = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    query: async (sql) => (/FROM identities/.test(sql) ? { rows: [{ currency_code: entityCurrency, country: null }] } : { rows: [] }),
    withEntity: async () => ({ rows: [] }), withTransaction: async () => ({ rows: [] }),
  } };
  delete require.cache[require.resolve('../lib/regional')];
  delete require.cache[require.resolve('../lib/reporting')];
  const rep = require('../lib/reporting');
  delete require.cache[require.resolve('../lib/reporting')];
  delete require.cache[require.resolve('../lib/regional')];
  if (prev) require.cache[dbPath] = prev; else delete require.cache[dbPath];
  return { rep, d: {
    query: async () => ({ rows: [] }),
    withEntity: async (_e, fn) => fn({ query: async () => ({ rows: operators.map((o) => ({ operator: o })) }) }),
  } };
}

const SUMMARY = money.summarise([
  { value: 329000, currency: 'INR' },
  { value: 4100,   currency: 'USD' },
  { value: 15200,  currency: 'AED' },
  { value: null,   currency: 'AED' },
  { value: null,   currency: null  },
]);

(async () => {
console.log('\nreporting');

// ── resolving the network's currency ────────────────────────────────────────────────────────────────────────
await ta('1. a network reports in its OPERATOR\'s currency', async () => {
  const { rep, d } = deps(['op-1'], 'AED');
  assert.deepStrictEqual(await rep.reportingCurrencyFor('net-1', d), { currency: 'AED', basis: 'operator', operator_id: 'op-1' });
});
await ta('2. NO operator → null, never a guess', async () => {
  const { rep, d } = deps([], 'AED');
  assert.strictEqual(await rep.reportingCurrencyFor('net-1', d), null);
});
await ta('3. TWO operators → null; ambiguous governance is refused, not resolved', async () => {
  const { rep, d } = deps(['op-1', 'op-2'], 'AED');
  assert.strictEqual(await rep.reportingCurrencyFor('net-1', d), null);
});
await ta('4. an empty network id never reaches the database', async () => {
  const { rep, d } = deps(['op-1'], 'AED');
  assert.strictEqual(await rep.reportingCurrencyFor('  ', d), null);
});

// ── THE HARD LINE ───────────────────────────────────────────────────────────────────────────────────────────
t('5. ⚠ a converted total is NOT money and can never be minted', () => {
  const out = reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 88.2, AED: 24.1 }, as_of: '2026-07-31', source: 'test feed' });
  assert.ok(!money.isMoney(out), 'a derived figure must be structurally un-mintable');
  assert.strictEqual(out.amount, undefined, 'no `amount` key — do not "tidy" this into a money value');
  assert.strictEqual(out.currency, undefined, 'no `currency` key either');
  assert.strictEqual(out.derived, true);
});
t('6. and money.read() rejects it outright', () => {
  const out = reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 88.2, AED: 24.1 }, as_of: '2026-07-31', source: 'test feed' });
  throws(() => money.read(out, { assume: 'INR' }), /Unreadable price/);
});

// ── conversion refuses everything that would mislead ────────────────────────────────────────────────────────
t('7. a PARTIAL conversion is refused — it looks complete and is not', () => {
  throws(() => reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 88.2 }, as_of: '2026-07-31', source: 'x' }),
    /No rate for AED into INR/);
});
t('8. the date is mandatory', () => throws(
  () => reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 88.2, AED: 24.1 }, source: 'x' }), /needs the DATE/));
t('9. the source is mandatory', () => throws(
  () => reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 88.2, AED: 24.1 }, as_of: '2026-07-31' }), /needs the SOURCE/));
t('10. a missing reporting currency means mode 3 is unavailable, not defaulted', () => throws(
  () => reporting.convertForReport(SUMMARY, { rates: {}, as_of: '2026-07-31', source: 'x' }), /reporting currency is required/));
t('11. a zero or negative rate is refused', () => throws(
  () => reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 0, AED: 24.1 }, as_of: '2026-07-31', source: 'x' }), /greater than zero/));

// ── what it does produce ────────────────────────────────────────────────────────────────────────────────────
t('12. the target currency converts at 1, not via a rate it was not given', () => {
  const out = reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 88.2, AED: 24.1 }, as_of: '2026-07-31', source: 'x' });
  assert.strictEqual(out.lines.find((l) => l.from === 'INR').rate, 1);
  assert.strictEqual(out.lines.find((l) => l.from === 'INR').reported, 329000);
});
t('13. the arithmetic is right', () => {
  const out = reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 88.2, AED: 24.1 }, as_of: '2026-07-31', source: 'x' });
  assert.strictEqual(out.lines.find((l) => l.from === 'USD').reported, money.round2(4100 * 88.2));
  assert.strictEqual(out.reported_total, money.round2(329000 + 4100 * 88.2 + 15200 * 24.1));
});
t('14. the SPLIT travels with the conversion, so the truth is always available', () => {
  const out = reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 88.2, AED: 24.1 }, as_of: '2026-07-31', source: 'x' });
  assert.strictEqual(out.split.length, 3, 'a screen must never be able to show the derived figure alone');
  assert.deepStrictEqual(out.excluded, { non_monetary: 1, awaiting_agreement: 1 });
});
t('15. the caveat names the rate date and source', () => {
  const out = reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 88.2, AED: 24.1 }, as_of: '2026-07-31', source: 'RBI ref' });
  assert.match(out.caveat, /DERIVED/); assert.match(out.caveat, /2026-07-31/); assert.match(out.caveat, /RBI ref/);
  assert.match(out.caveat, /split is authoritative/);
});
t('16. unagreed offers are never converted — they had no value to convert', () => {
  const out = reporting.convertForReport(SUMMARY, { to: 'INR', rates: { USD: 88.2, AED: 24.1 }, as_of: '2026-07-31', source: 'x' });
  assert.strictEqual(out.lines.find((l) => l.from === 'AED').original, 15200, 'only the agreed AED value, not the null one');
});
t('17. no rate table lives in this module', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/reporting'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  assert.ok(!/\b(USD|AED|EUR|JPY|CNY)\s*:\s*[0-9]/.test(code), 'rates belong to a dated feed, never to source');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
})();
