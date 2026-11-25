/**
 * tests/ufo2-1130.test.cjs — U-F-02 (P1, retest 1129): a CREDIT NOTE on a cash walk-in sale posts for EVERY walkin_grain.
 *   Cause: chitPosted() (the one "is this sale in my books" test) did not know bill:<chit>, the entry a walkin_grain=bill sale posts under, so the note waited for ever.
 * Hand figures, AU, minor units (cents): sale A$55.00 incl. GST = taxable 5000 + GST 500, cash 5500.
 * Credit note A$11.00 incl. = taxable 1000 + GST 100, refunded in cash 1100. Books after both: GST (output) 400, sales 4000 (5000 - 1000 returns), cash 4400.
 * Books are insert-only: the note adds its own entry; the sale's entry is never edited (entry count 2).
 * Run: node tests/ufo2-1130.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const DAY = '2026-11-05', AT = DAY + 'T05:00:00Z';
const inv = (taxable, gst, total) => ({ currency: 'AUD', _cb: { scheme: 'GST' }, ItemList: [{ GstRt: 10, AssAmt: taxable, CgstAmt: 0, SgstAmt: 0, IgstAmt: 0, TaxAmt: gst, CesAmt: 0 }], ValDtls: { TotInvVal: total } });

(async () => {
  console.log('\n══ U-F-02 · credit note on a cash walk-in sale posts at walkin_grain bill AND day ══\n');
  for (const grain of ['bill', 'day']) {
    const SHOP = grain === 'bill' ? '11111111-1111-4111-8111-0000000b1130' : '11111111-1111-4111-8111-0000000d1130';
    const X = H.load();
    if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
    const K = require(path.join(H.API, 'lib', 'books-hooks'));
    const TC = require(path.join(H.API, 'lib', 'tax-copy'));
    const q0 = X.db.query.bind(X.db);
    X.db.query = async (sql, p) => /SELECT chit_id FROM chit_header WHERE entity_id = [$]1 AND sender_entity_id/.test(sql) ? (p[1] === 'C1-0001' ? { rows: [{ chit_id: 's1' }], rowCount: 1 } : { rows: [], rowCount: 0 }) : q0(sql, p);
    const sale = { chit_id: 's1', purpose: 'order', currency_code: 'AUD', created_at: AT, current_status: 'delivered', business_json: { bill_no: 'C1-0001', till: { id: 'C1' }, billed_at: AT, payment: { parts: [{ how: 'Cash', amount: 55 }] } } };
    const note = { chit_id: 'n1', purpose: 'credit_note', currency_code: 'AUD', created_at: AT, current_status: 'pending', business_json: { till: { id: 'C1' }, bill_no: 'CN-1', against: 'C1-0001', billed_at: AT, refund: { parts: [{ how: 'Cash', amount: 11 }] } } };
    const copies = { s1: sale, n1: note };
    TC.copyOf = async (id) => copies[id] || null;
    TC.entryFor = async (c) => ({ sells: true, invoice: c.chit_id === 'n1' ? inv(10, 1, 11) : inv(50, 5, 55) });
    X.store.countersBilling = async () => ['C1'];
    X.store.counterBills = async () => [sale];
    X.T.identities.push({ identity_id: SHOP, gstn: '51824753556', display_name: 'AU shop', country: 'AU', policy_flags: { gst_registration: 'regular' } });
    const setting = { enabled: true, walkin_grain: grain, country: 'AU', functional_currency: 'AUD', fy_start_month: 7 };
    await X.store.saveSetting(X.db, SHOP, setting);
    await X.B.enable(X.db, SHOP, { by: SHOP, today: DAY }); K.forget(SHOP);
    const net = () => { const out = {};
      for (const e of X.T.entries.filter((x) => x.entity_id === SHOP)) for (const l of X.T.lines.filter((x) => x.entry_id === e.entry_id)) {
        const a = X.T.accounts.find((x) => x.account_id === l.account_id); const k = a ? a.role : '?'; out[k] = (out[k] || 0) + Number(l.dr_minor || 0) - Number(l.cr_minor || 0); }
      return out; };

    if (grain === 'bill') { const s = await K.postChit(SHOP, 's1', {}); ok('[bill] the sale posts under bill:s1', !s.queued && X.T.entries.some((e) => e.source_ref === 'bill:s1'), JSON.stringify(s)); }
    else { const d = await K.postDay(SHOP, 'C1', DAY, { setting }); ok('[day] the day close posts the sale', !!(d && d.entry_no), JSON.stringify(d)); }
    const before = X.T.entries.filter((e) => e.entity_id === SHOP).length;
    const n = await K.postChit(SHOP, 'n1', {});
    ok('[' + grain + '] the credit note posts (not queued)', !n.queued, JSON.stringify(n));
    const gst = Object.keys(net()).filter((k) => /output|gst/.test(k));
    const t = net();
    eq('[' + grain + '] books GST 400 (500 - 100), sales 4000 net of returns, cash 4400', [gst.reduce((s, k) => s + t[k], 0), (t.sales || 0) + (t.sales_returns || 0), t.cash], [-400, -4000, 4400]);
    eq('[' + grain + '] insert-only: the note added ONE entry, the sale entry untouched', X.T.entries.filter((e) => e.entity_id === SHOP).length - before, 1);
  }
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });
