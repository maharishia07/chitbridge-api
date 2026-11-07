/**
 * acc-230-expense-gst.test.cjs — ACC-230: AN EXPENSE CHIT WITH GST POSTS NET + INPUT TAX, NOT GROSS.
 *
 *   business_json.expense.input_tax = { <head>: amount } (the pack's heads: AU gst; IN cgst+sgst / igst / cess), amount = what was PAID.
 *   classify hands the engine's existing expense event net = amount − tax with input_tax (the shape the bill path's use lines already
 *   pass); a head the books do not post, or tax not below the amount, WAITS in words. No key = as before. Runs on the in-memory twin
 *   for an AU shop (the BAS 1B ledger gst_paid) and an IN shop (CGST+SGST input).
 * Run: node tests/acc-230-expense-gst.test.cjs
 */
'use strict';
const path = require('path');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const IN_SHOP = '11111111-1111-4111-8111-230230230230', AU_SHOP = 'aaaaaaaa-2222-4111-8111-230230230230';
const S_IN = { enabled: true, walkin_grain: 'day', country: 'IN', functional_currency: 'INR' };
const S_AU = { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD', fy_start_month: 7 };

(async () => {
  console.log('\n══ ACC-230 · an expense with GST posts net + input tax ══\n');
  const X = H.load();
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const exp = (cur, expense) => ({ chit_id: 'e1', purpose: 'expense', currency_code: cur, created_at: '2026-10-17T05:00:00Z', business_json: { till: { id: 'C1' }, expense } });
  const run = (setting, cur, expense) => K.classify({ chit: exp(cur, expense), entry: {}, setting });

  /* ── classify: the event the engine gets ── */
  const au = run(S_AU, 'AUD', { what: 'Electricity', mode: 'Bank', amount: 165, class: 'electricity', input_tax: { gst: 15 } });
  eq('AU · A$165 incl A$15 GST → net 150 + input_tax gst 15', [au.kind, au.event.amount, au.event.input_tax], ['post', 150, { gst: 15 }]);
  const inn = run(S_IN, 'INR', { what: 'Repairs', mode: 'Cash', amount: 118, input_tax: { cgst: 9, sgst: 9 } });
  eq('IN · ₹118 incl 9+9 → net 100 + cgst 9 + sgst 9', [inn.kind, inn.event.amount, inn.event.input_tax], ['post', 100, { cgst: 9, sgst: 9 }]);
  const igst = run(S_IN, 'INR', { what: 'Courier', mode: 'Cash', amount: 118, input_tax: { igst: 18 } });
  eq('IN · inter-state ₹118 incl igst 18 → net 100', [igst.event.amount, igst.event.input_tax], [100, { igst: 18 }]);
  const none = run(S_AU, 'AUD', { what: 'Tea', mode: 'Cash', amount: 40 });
  eq('no input_tax → exactly as before (gross amount, no input_tax)', [none.event.amount, 'input_tax' in none.event], [40, false]);
  const zero = run(S_AU, 'AUD', { what: 'Tea', mode: 'Cash', amount: 40, input_tax: { gst: 0 } });
  eq('input_tax of 0 → as before', [zero.event.amount, 'input_tax' in zero.event], [40, false]);
  const auCgst = run(S_AU, 'AUD', { what: 'x', mode: 'Cash', amount: 110, input_tax: { cgst: 5, sgst: 5 } });
  ok('AU · an Indian head (cgst) the AU books do not post WAITS, in words', auCgst.kind === 'queue' && /cgst/.test(auCgst.why), JSON.stringify(auCgst));
  const inGst = run(S_IN, 'INR', { what: 'x', mode: 'Cash', amount: 118, input_tax: { gst: 18 } });
  ok('IN · a bare "gst" (no intra/inter split known) WAITS — never guessed', inGst.kind === 'queue' && /gst/.test(inGst.why), JSON.stringify(inGst));
  const big = run(S_AU, 'AUD', { what: 'x', mode: 'Cash', amount: 15, input_tax: { gst: 15 } });
  ok('tax equal to the amount paid WAITS', big.kind === 'queue' && /not less than/.test(big.why), JSON.stringify(big));
  const bad = run(S_AU, 'AUD', { what: 'x', mode: 'Cash', amount: 15, input_tax: 15 });
  ok('a bare number instead of heads WAITS', bad.kind === 'queue' && /tax heads/.test(bad.why), JSON.stringify(bad));
  const credit = run(S_AU, 'AUD', { what: 'x', mode: 'On credit', supplier: 'S1', amount: 110, input_tax: { gst: 10 } });
  eq('on credit to a supplier → same split, supplier carried', [credit.event.amount, credit.event.input_tax, credit.event.supplier], [100, { gst: 10 }, 'S1']);

  /* ── through the hook onto the twin books: balanced entry, tax on the input ledger ── */
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); const wasC = TC.copyOf; let now = null;
  TC.copyOf = async () => now;
  const shop = async (id, s, row) => { X.T.identities.push(Object.assign({ identity_id: id, display_name: 'Shop ' + id.slice(-4) }, row));
    await X.store.saveSetting(X.db, id, s); await X.B.enable(X.db, id, { by: id, today: '2026-10-17' }); K.forget(id); };
  const lines = (id) => { const e = X.T.entries.find((x) => x.entity_id === id && x.source_ref === 'chit:e1'); if (!e) return null;
    return X.T.lines.filter((l) => l.entry_id === e.entry_id).map((l) => { const a = X.T.accounts.find((y) => y.account_id === l.account_id); return [a && (a.role || a.code), Number(l.dr_minor || 0), Number(l.cr_minor || 0)]; }); };
  const sum = (ls, i) => ls.reduce((t, l) => t + l[i], 0);
  const drs = (ls) => ls.filter((l) => l[1]).map((l) => l[1]).sort((p, q) => p - q);
  await shop(AU_SHOP, S_AU, { country: 'AU', currency_code: 'AUD', timezone: 'Australia/Sydney', policy_flags: {} });
  now = exp('AUD', { what: 'Electricity', mode: 'Bank', amount: 165, class: 'electricity', input_tax: { gst: 15 } });
  const ra = await K.postChit(AU_SHOP, 'e1', {});
  const la = lines(AU_SHOP);
  console.log('        AU lines:', JSON.stringify(la));
  ok('AU · posted (not queued)', !ra.queued && !!la, JSON.stringify(ra));
  eq('AU · Dr electricity 150 + Dr GST paid 15 · Cr bank 165 (balanced; 1B = 15)', [sum(la, 1), sum(la, 2), drs(la)], [16500, 16500, [1500, 15000]]);
  X.T.entries.length = 0; X.T.lines.length = 0;
  await shop(IN_SHOP, S_IN, { country: 'IN', currency_code: 'INR', gstn: null, timezone: 'Asia/Kolkata', policy_flags: {} });
  now = exp('INR', { what: 'Repairs', mode: 'Cash', amount: 118, input_tax: { cgst: 9, sgst: 9 } });
  const ri = await K.postChit(IN_SHOP, 'e1', {});
  const li = lines(IN_SHOP);
  console.log('        IN lines:', JSON.stringify(li));
  ok('IN · posted', !ri.queued && !!li, JSON.stringify(ri));
  eq('IN · Dr expense 100 + CGST 9 + SGST 9 · Cr cash 118', [sum(li, 1), sum(li, 2), drs(li)], [11800, 11800, [900, 900, 10000]]);
  TC.copyOf = wasC;
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
