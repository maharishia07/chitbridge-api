/**
 * connector-purchase.test.cjs — the BUYER's side against fake Tally: one chit, the buyer's books.
 *   node e2e/connector-purchase.test.cjs
 * The buyer (Karnataka) bought from a Tamil Nadu seller and marked the chit completed. The buyer's connector: creates the
 * seller under Sundry Creditors with their GSTIN and state; creates the material it never stocked (unit + HSN + GST rate);
 * posts a Purchase voucher — goods in, the purchase ledger, Input IGST as the ITC claim, the supplier credited for goods + tax
 * against a New Ref that carries the seller's reference; the arithmetic (voucher input tax = our ledger's ITC) agrees;
 * a second pass books nothing twice; an order not yet completed is left alone.
 * CARD      23-connectors-and-integrations/zoho-gofrugal-b2b-purchase
 */
const { spawn } = require('child_process'); const path = require('path'); const os = require('os'); const fs = require('fs');
const KIT = path.join(process.env.CB_API_REPO ? path.resolve(process.env.CB_API_REPO) : path.join(__dirname, '..', '..', 'chitbridge-api'), 'tools', 'tally-connector');   /* CI checks the api out beside the web (CB_API_REPO) */
const port = 9400 + Math.floor(Math.random() * 90);
const fake = spawn(process.execPath, [path.join(KIT, 'fake-tally.js'), String(port)], { stdio: 'ignore' });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };
const get = (p) => fetch('http://localhost:' + port + p).then((r) => r.json());
(async () => {
  await new Promise((r) => setTimeout(r, 700));
  const T = require(path.join(KIT, 'adapters', 'tally.js')); const core = require(path.join(KIT, 'core.js'));
  const adapter = T({ role: 'buyer', tally: { url: 'http://localhost:' + port, role: 'buyer' }, log: () => {} });
  const receipts = new core.Receipts(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-pur-')), 'r.jsonl'));
  const logs = []; const log = (m) => logs.push(m);

  await adapter.ensure();
  const m0 = await get('/_masters');
  ok(m0.some((m) => m.name === 'Purchase' && m.parent === 'Purchase Accounts') && m0.some((m) => m.name === 'Input IGST' && m.duty === 'IGST'), 'ensure (buyer role): Purchase + Input CGST/SGST/IGST ledgers: ' + m0.map((m) => m.name).join(' · '));

  /* the buyer's copy of the chit and its invoice, as the API answers them (seller = Chennai Stores, TN; buyer = KA) */
  const chitId = 'pur1aaaa-0000-0000-0000-000000000001';
  const invoice = { chit_id: chitId, direction: 'sent', sells: false, status: 'completed', frozen: true,
    seller: { Gstin: '33ABCDE1234F1Z7', LglNm: 'Chennai Stores' }, buyer: { Gstin: '29ABCDE1234F1Z5', LglNm: 'Kumar Traders Pvt Ltd' },
    invoice: { SellerDtls: { Gstin: '33ABCDE1234F1Z7', LglNm: 'Chennai Stores', Addr1: '5 Mount Road', Loc: 'Chennai', Pin: '600002', State: '33' }, BuyerDtls: { Gstin: '29ABCDE1234F1Z5', LglNm: 'Kumar Traders Pvt Ltd', State: '29', Pos: '29' },
      ItemList: [{ SlNo: '1', PrdDesc: 'Idli Rice 25kg', HsnCd: '1006', Qty: 4, Unit: 'bag', UnitPrice: 1200, TotAmt: 4800, Discount: 0, AssAmt: 4800, GstRt: 5, IgstAmt: 240, CgstAmt: 0, SgstAmt: 0, TotItemVal: 5040 },
                 { SlNo: '2', PrdDesc: 'Basmati 25kg', HsnCd: '1006', Qty: 1, Unit: 'bag', UnitPrice: 2000, TotAmt: 2000, Discount: 200, AssAmt: 1800, GstRt: 5, IgstAmt: 90, CgstAmt: 0, SgstAmt: 0, TotItemVal: 1890 }],
      ValDtls: { AssVal: 6600, IgstVal: 330, CgstVal: 0, SgstVal: 0, TotInvVal: 6930 }, _cb: { supply: 'inter', place_of_supply: '29' }, frozen_at: '2026-09-05T12:00:00Z' },
    heads: { taxable: 6600, cgst: 0, sgst: 0, igst: 330, cess: 0, total: 6930, tax: 330 } };
  const pending = { chit_id: 'pur2bbbb-0000-0000-0000-000000000002', purpose: 'order', current_status: 'pending' };
  /* the buyer's SENT copies stay "pending"; the seller's completion shows on my copy's state_log — that is the trigger */
  const cb = { sent: async () => ({ chits: [{ chit_id: chitId, purpose: 'order', current_status: 'pending' }, pending] }),
               chit: async (id) => ({ header: { chit_id: id, current_status: 'pending', receiver_display_name: 'Chennai Stores' }, state_log: id === chitId ? [{ action: 'status', previous_status: 'pending', new_status: 'completed', action_by_display_name: 'Chennai Stores' }] : [] }),
               invoice: async () => invoice };

  const out = await core.syncPurchases({ cb, adapter, receipts, log });
  const mine = out.find((x) => x.chit_id === chitId);
  ok(mine && mine.outcome === 'ok' && mine.itc === 330, 'the completed order booked as a purchase with ITC 330: ' + JSON.stringify(mine));
  ok(out.length === 2 && out.find((x) => x.chit_id === pending.chit_id).outcome === 'waiting', 'the order the seller has not completed is left waiting (no receipt written)');
  const m1 = await get('/_masters');
  const sup = m1.find((m) => m.name === 'Chennai Stores');
  ok(sup && sup.parent === 'Sundry Creditors' && sup.gstin === '33ABCDE1234F1Z7' && sup.state === 'Tamil Nadu', 'the seller became a supplier ledger with GSTIN + state: ' + JSON.stringify(sup));
  const idli = m1.find((m) => m.kind === 'item' && m.name === 'Idli Rice 25kg');
  ok(idli && idli.unit === 'bag' && idli.hsn === '1006' && idli.igst === '5', 'the material never stocked was created with unit · HSN · 5%: ' + JSON.stringify(idli));
  ok(!m1.some((m) => m.kind === 'item' && m.name === 'Basmati 25kg'), 'the material already stocked (Basmati 25kg is in the fake) was not re-created');
  const v = (await get('/_vouchers')).find((x) => x.vtype === 'Purchase' && x.ref === 'CB-pur1aaaa');
  ok(v && v.party_gstin === '33ABCDE1234F1Z7' && v.place_of_supply === 'Karnataka', 'the Purchase voucher: seller GSTIN, place of supply Karnataka (mine): ' + JSON.stringify(v && { g: v.party_gstin, pos: v.place_of_supply }));
  const party = v && v.ledgers.find((l) => l.ledger === 'Chennai Stores'), igst = v && v.ledgers.find((l) => l.ledger === 'Input IGST');
  ok(party && !party.dr && Number(party.amount) === 6930, 'the supplier is credited goods + tax 6930 (New Ref CB-pur1aaaa)');
  ok(igst && igst.dr && Number(igst.amount) === -330 && !v.ledgers.some((l) => /Input CGST|Input SGST/.test(l.ledger)), 'Input IGST 330 debited = the ITC claim; no CGST/SGST across states');
  ok(v && v.items.length === 2 && v.items[1].discount === '10' && v.items[1].amount === '-1800', 'the discounted line keeps the seller\'s amount (1800, discount 10%)');
  ok(!logs.some((l) => /ITC arithmetic/.test(l)), 'the arithmetic agrees: voucher input tax = our ledger ITC (no warning)');

  const again = await core.syncPurchases({ cb, adapter, receipts, log });
  ok(again.find((x) => x.chit_id === chitId).outcome === 'duplicate' && (await get('/_vouchers')).filter((x) => x.vtype === 'Purchase').length === 1, 'second pass: duplicate, no second voucher');

  console.log((fail ? 'RED ' : 'GREEN ') + pass + ' passed · ' + fail + ' failed');
  fake.kill(); setTimeout(() => process.exit(fail ? 1 : 0), 200);
})().catch((e) => { console.log('FAIL exception: ' + (e && e.stack || e.message)); fake.kill(); setTimeout(() => process.exit(1), 200); });
