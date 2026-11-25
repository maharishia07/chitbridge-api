/**
 * tests/ap-move-in.test.cjs — walk AP (22 Nov 2026), the move-in and send findings. OWNER cb-connect (move-in) · RISK money + tax: an account named "1000", an ABN lost, a locked month posted into, a 15% line claimed.
 * AP-F-01 the QuickBooks code column ("Account #") is the code, "Full name" the name · AP-F-02 "Business ID No." is the ABN and is checked by the write's own check · AP-F-03 the title-row hint · AP-F-04 a reversed opening frees the file
 * AP-F-05 a hard-locked month refuses an opening · AP-F-06 MYOB is greyed with its sentence · AP-F-07 a body currency_code is judged, never relabelled · AP-F-08 a rate outside the pack is refused.
 * Fixtures: tests/fixtures/move-in/qbo-*.csv are the walk's own files (C:/dev/walks/wkap/fx). No database: stubs for the reads. Run: node tests/ap-move-in.test.cjs (CALLED BY scripts/guards.cjs)
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const MI = require('../lib/move-in');
const fix = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'move-in', name), 'utf8');
let pass = 0,
  fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    console.log('  PASS  ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL  ' + name + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        '));
    fail++;
  }
};
const fieldsOf = (kind, headers) => Object.fromEntries(MI.guess(kind, headers).guess.map((g) => [g.incoming, g.field]));
const confirmed = (kind, parsed) => MI.guess(kind, parsed.headers).guess.filter((g) => g.field).map((g) => ({ incoming: g.incoming, field: g.field }));

(async () => {
  await t('AP-F-01: QuickBooks "Account #" is the CODE and "Full name" the NAME (not the number as the name)', () => {
    const parsed = MI.readFile({ csv: fix('qbo-chart-account-hash.csv') });
    const f = fieldsOf('accounts', parsed.headers);
    assert.strictEqual(f['Account #'], 'code');
    assert.strictEqual(f['Full name'], 'name');
    const rows = MI.cells('accounts', parsed, confirmed('accounts', parsed));
    assert.strictEqual(rows[0].name, 'Cheque Account');
    assert.strictEqual(rows[0].code, '1000');
  });
  await t('AP-F-01: the real QuickBooks header variants all place code and name', () => {
    const variants = [
      [['Acct #', 'Account name', 'Type'], 'Acct #', 'Account name'],
      [['Number', 'Name', 'Type'], 'Number', 'Name'],
      [['Account Number', 'Account', 'Account Type'], 'Account Number', 'Account'],
      [['Account #', 'Account name', 'Type'], 'Account #', 'Account name']
    ];
    variants.forEach(([heads, code, name]) => {
      const f = fieldsOf('accounts', heads);
      assert.strictEqual(f[code], 'code', heads.join());
      assert.strictEqual(f[name], 'name', heads.join());
    });
  });
  await t('AP-F-01: a trial balance headed "Account #" keeps its code and reads the account by name', () => {
    const f = fieldsOf('trial_balance', ['Account #', 'Account', 'Debit', 'Credit']);
    assert.deepStrictEqual([f['Account #'], f.Account], ['code', 'account']);
  });
  await t("AP-F-02: \"Business ID No.\" is the ABN; a bad ABN is skipped in reg-au's words, a good one kept", () => {
    const parsed = MI.readFile({ csv: fix('qbo-contacts-business-id.csv') });
    const decisions = confirmed('contacts', parsed);
    assert.ok(decisions.some((d) => d.incoming === 'Business ID No.' && d.field === 'abn'));
    const AU = require('../lib/books-engines').packFor ? require('../lib/books-engines').packFor('AU') : require('../lib/country').packFor('AU');
    const pl = MI.plan('contacts', { country: 'AU', source_country: 'AU', source: 'qbo', side: 'customer', rows: MI.cells('contacts', parsed, decisions), world: { pack: AU, chart: [], parties: [], taxIds: [], phones: [], listIds: [] } });
    const harbour = pl.rows.find((r) => /Harbour Cafe/.test(r.what) && r.action !== 'skip');
    assert.ok(harbour && JSON.stringify(harbour.data).includes('51824753556'), 'the good ABN is kept: ' + JSON.stringify(pl.rows.map((r) => [r.what, r.action])));
    const reef = pl.rows.find((r) => /Reef Hardware/.test(r.what));
    assert.strictEqual(reef.action, 'skip');
    assert.ok(/ABN 12345678901/.test(reef.why), reef.why);
  });
  await t('AP-F-03: headings under title rows are found and named; row 1 reading fine, or the row said, is silent', () => {
    const upload = { csv: fix('qbo-tb-title-rows.csv') };
    const hint = MI.headerHint('trial_balance', upload, MI.readFile(upload));
    assert.ok(hint && hint.row === 5 && /row 5/.test(hint.why), JSON.stringify(hint));
    const clean = { csv: fix('qbo-accounts.csv') };
    assert.strictEqual(MI.headerHint('accounts', clean, MI.readFile(clean)), null);
    const said = { csv: fix('qbo-tb-title-rows.csv'), header_row: 5 };
    assert.strictEqual(MI.headerHint('trial_balance', said, MI.readFile(said)), null);
  });
  await t('AP-F-06: MYOB is greyed for an Australian shop with a sentence; "QuickBooks" is read as qbo', () => {
    const au = MI.sourcesFor('AU');
    assert.deepStrictEqual(au.map((i) => [i.source, i.ready]), [['myob', false], ['xero', true], ['qbo', true]]);
    assert.ok(/MYOB file is not built yet/.test(au[0].why));
    assert.throws(() => MI.sourceOf('myob'), /MYOB file is not built yet/);
    assert.strictEqual(MI.sourceOf('QuickBooks'), 'qbo');
  });
  await t('AP-F-05: an opening dated in a hard-locked month is refused PERIOD_LOCKED; an open month and an unknown year pass', async () => {
    const B = require('../lib/books');
    const stub = (status) => ({ query: async () => ({ rows: [{ fiscal_year: '2026-27', period: 1, start_date: '2026-07-01', end_date: '2026-07-31', status }] }) });
    const setting = { country: 'AU', enabled: true, functional_currency: 'AUD', ledger_start: '2026-07-01' };
    await assert.rejects(() => B.openingMonthGate(stub('hard_locked'), 'e1', setting, '2026-07-01'), (err) => err.code === 'PERIOD_LOCKED' || /lock/i.test(err.message));
    await B.openingMonthGate(stub('open'), 'e1', setting, '2026-07-01');
    await B.openingMonthGate({ query: async () => ({ rows: [] }) }, 'e1', setting, '2027-07-01');
  });
  await t('AP-F-04: once the opening entry has its reversal the same file gets a new key; while it stands the key is the replay key', async () => {
    const entries = { 'opening:movein:tb:2026-07-01': 'e-1', 'reverse:e-1': 'r-1' };
    const conn = { query: async (_sql, args) => ({ rows: entries[args[1]] ? [{ entry_id: entries[args[1]] }] : [] }) };
    assert.strictEqual(await MI.freeOpeningRef(conn, 'ent', 'movein:tb:2026-07-01'), 'movein:tb:2026-07-01:again2');
    entries['reverse:e-1'] = undefined;
    assert.strictEqual(await MI.freeOpeningRef(conn, 'ent', 'movein:tb:2026-07-01'), 'movein:tb:2026-07-01');
  });
  await t('AP-F-08: a 15% line on an Australian bill is named and refused; 10 and 0 pass; no rate or an unbuilt country is not judged', () => {
    const L = require('../lib/tax-lines');
    const bad = L.unlistedRateOf('AU', [{ gst_rate: 10 }, { gst_rate: 15 }]);
    assert.deepStrictEqual([bad.index, bad.rate, bad.rates], [2, 15, [10]]);
    assert.strictEqual(L.unlistedRateOf('AU', [{ gst_rate: 0 }, { gst_rate: 10 }, { price: 1 }, { gst_rate: null }]), null);
    assert.strictEqual(L.unlistedRateOf('ZZ', [{ gst_rate: 15 }]), null);
  });
  await t("AP-F-07: a body currency_code is carried to the chit's money; an unknown code (ZZZ) is a worded MONEY_CURRENCY_UNKNOWN, never AUD", () => {
    const chits = require('../routes/chits');
    assert.strictEqual(chits.statedMoneyCarried({ bill_no: 'x' }, { currency_code: 'aed' }).currency, 'AED');
    assert.throws(() => chits.statedMoneyCarried({ currency: 'USD' }, { currency_code: 'AED' }), (err) => err.code === 'MONEY_CURRENCY_MISMATCH' && err.status === 422); /* AJ-F-02 wins over the AP-F-07 'carry the inside code': two different codes on one bill are refused in words, never silently one of them */
    assert.strictEqual(chits.statedMoneyCarried({ currency: 'AED' }, { currency_code: 'AED' }).currency, 'AED');
    assert.strictEqual(chits.statedMoneyCarried({ a: 1 }, {}).currency, undefined);
    assert.throws(() => chits.statedMoneyCarried({}, { currency_code: 'ZZZ' }), (err) => err.code === 'MONEY_CURRENCY_UNKNOWN' && err.status === 422);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
