/**
 * connector-zoho.test.cjs — the Zoho Books adapter to the same level as Tally, against fake Zoho (no API, no OAuth).
 *   node e2e/connector-zoho.test.cjs
 * ensure() creates the one Walk-in contact; a registered buyer gets a contact with gst_no + place_of_contact once; the
 * invoice carries customer_id · gst_treatment business_gst · gst_no · place_of_supply (two-letter) · the org's GST tax
 * group per line (Zoho splits CGST/SGST vs IGST itself); an offer is a discount on the line; a walk-in invoice books under
 * the Walk-in contact with gst_treatment consumer; Mark paid → a Customer Payment applied to that invoice, once.
 * CARD      23-connectors-and-integrations/zoho-gofrugal-b2b-purchase
 */
const { spawn } = require('child_process'); const path = require('path'); const os = require('os'); const fs = require('fs');
const KIT = path.join(process.env.CB_API_REPO ? path.resolve(process.env.CB_API_REPO) : path.join(__dirname, '..', '..', 'chitbridge-api'), 'tools', 'tally-connector');   /* CI checks the api out beside the web (CB_API_REPO) */
const port = 9900 + Math.floor(Math.random() * 90);
const fake = spawn(process.execPath, [path.join(KIT, 'fake-zoho.js'), String(port)], { stdio: 'ignore' });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };
const H = { Authorization: 'Zoho-oauthtoken t' };
const get = (p) => fetch('http://localhost:' + port + p, { headers: H }).then((r) => r.json());
(async () => {
  await new Promise((r) => setTimeout(r, 700));
  const Z = require(path.join(KIT, 'adapters', 'zoho.js')); const core = require(path.join(KIT, 'core.js'));
  const a = Z({ zoho: { base: 'http://localhost:' + port, token: 't', org: '1' }, log: () => {} });
  const receipts = new core.Receipts(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-zoho-')), 'r.jsonl'));

  const e1 = await a.ensure(); const e2 = await a.ensure();
  const contacts0 = await get('/_contacts');
  ok(e1.created[0] === 'Walk-in' && e2.existing[0] === 'Walk-in' && contacts0.length === 1 && contacts0[0].gst_treatment === 'consumer', 'ensure: the Walk-in contact once (consumer)');

  const lines = [{ name: 'Basmati Rice 25kg', code: 'RIC', qty: 2, unit: 'bag', price: 1000, total: 2000, gst_rate: 5, hsn: '1006' }];
  const inter = { chit_id: 'zb2b1aaa-0000', at: '2026-09-05T10:00:00Z', buyer: 'Kumar Traders Pvt Ltd', total: 2000, lines,
    b2b: { buyer: { name: 'Kumar Traders Pvt Ltd', gstin: '29ABCDE1234F1Z5', state_code: '29', addr: '12 Market Road', loc: 'Bengaluru', pin: '560001', reg_type: 'Regular' },
           place_of_supply: '29', supply: 'inter', taxes: { cgst: 0, sgst: 0, igst: 100, cess: 0 }, taxable: 2000, total: 2100, items: [{ name: 'Basmati Rice 25kg', hsn: '1006', rate: 5, ass: 2000, cgst: 0, sgst: 0, igst: 100 }] } };
  const r1 = await a.pushOrder(inter);
  const contacts1 = await get('/_contacts'); const kumar = contacts1.find((c) => c.contact_name === 'Kumar Traders Pvt Ltd');
  ok(kumar && kumar.gst_treatment === 'business_gst' && kumar.gst_no === '29ABCDE1234F1Z5' && kumar.place_of_contact === 'KA' && kumar.billing_address && kumar.billing_address.state === 'KA', 'the buyer contact: business_gst · gst_no · place_of_contact KA: ' + JSON.stringify(kumar && { t: kumar.gst_treatment, g: kumar.gst_no, p: kumar.place_of_contact }));
  const inv = (await get('/_invoices')).find((i) => i.reference_number === 'CB-zb2b1aaa');
  ok(inv && inv.customer_id === kumar.contact_id && inv.gst_treatment === 'business_gst' && inv.gst_no === '29ABCDE1234F1Z5' && inv.place_of_supply === 'KA', 'the invoice: customer_id of the buyer · business_gst · place_of_supply KA: ' + JSON.stringify(inv && { c: inv.customer_id, pos: inv.place_of_supply }));
  ok(inv && inv.line_items[0].tax_id === 'gst5' && inv.line_items[0].hsn_or_sac === '1006', 'the line names the org GST5 tax group and the HSN: ' + JSON.stringify(inv && inv.line_items[0]));
  ok(r1.their_id === inv.invoice_id && r1.their_party === kumar.contact_id, 'pushOrder returns their_id + their_party for the receipt later');
  await a.pushOrder(Object.assign({}, inter, { chit_id: 'zb2b2bbb-0000' }));
  ok((await get('/_contacts')).filter((c) => c.contact_name === 'Kumar Traders Pvt Ltd').length === 1, 'second order from the same buyer: no second contact');

  const walk = { chit_id: 'zwalk3cc-0000', at: '2026-09-05T10:00:00Z', buyer: 'Priya', total: 300, lines: [{ name: 'Basmati Rice 25kg', code: 'RIC', qty: 2, unit: 'bag', price: 200, total: 300, offer: { label: 'Buy 2 save 100', off: 100 } }] };
  await a.pushOrder(walk); const winv = (await get('/_invoices')).find((i) => i.reference_number === 'CB-zwalk3cc');
  ok(winv && winv.customer_id === contacts0[0].contact_id && winv.gst_treatment === 'consumer' && winv.line_items[0].discount === '25%' && !winv.line_items[0].tax_id && /offers: Buy 2 save 100/.test(winv.notes), 'a walk-in order: the Walk-in contact, consumer, the offer as a 25% discount, named in the notes: ' + JSON.stringify(winv && { c: winv.customer_id, d: winv.line_items[0].discount }));

  receipts.add({ kind: 'order', ref: 'zb2b1aaa-0000', hash: 'h', outcome: 'ok', their_ref: r1.ref, their_id: r1.their_id, their_party: r1.their_party });
  const fakeCb = { chit: async () => ({ header: { chit_id: 'zb2b1aaa-0000', business_json: { payment: { method: 'upi', ref: 'UPI-77', amount: 2100, at: '2026-09-05T11:00:00Z' } }, summary_json: { total_value: 2100 } }, detail: { line_items: [] } }) };
  const p1 = await core.pushReceipt({ cb: fakeCb, adapter: a, receipts, log: () => {}, chit_id: 'zb2b1aaa-0000' });
  const pays = await get('/_payments');
  ok(p1.outcome === 'ok' && pays.length === 1 && pays[0].customer_id === kumar.contact_id && pays[0].invoices[0].invoice_id === inv.invoice_id && Number(pays[0].amount) === 2100, 'Mark paid → a Customer Payment applied to the buyer\'s invoice');
  const p2 = await core.pushReceipt({ cb: fakeCb, adapter: a, receipts, log: () => {}, chit_id: 'zb2b1aaa-0000' });
  ok(p2.outcome === 'duplicate' && (await get('/_payments')).length === 1, 'second push: duplicate, no second payment');

  /* the buyer's side: the seller as a vendor, the purchase as a Bill with the tax group per line (my ITC) */
  const purchase = { chit_id: 'zpur5eee-0000', at: '2026-09-05T12:00:00Z', ref: 'CB-zpur5eee', seller: { name: 'Chennai Stores', gstin: '33ABCDE1234F1Z7', state_code: '33', addr: '5 Mount Road', loc: 'Chennai', pin: '600002' },
    items: [{ name: 'Idli Rice 25kg', hsn: '1006', qty: 4, unit: 'bag', rate: 1200, ass: 4800, gst_rate: 5, igst: 240, cgst: 0, sgst: 0 }], taxes: { cgst: 0, sgst: 0, igst: 240, cess: 0 }, taxable: 4800, total: 5040, itc_claim: 240, buyer_state: '29' };
  const pr1 = await a.pushPurchase(purchase); const vend = (await get('/_contacts')).find((c) => c.contact_name === 'Chennai Stores'); const bill = (await get('/_bills'))[0];
  ok(vend && vend.contact_type === 'vendor' && vend.gst_no === '33ABCDE1234F1Z7' && vend.place_of_contact === 'TN', 'the seller became a vendor contact with GSTIN + TN: ' + JSON.stringify(vend && { t: vend.contact_type, g: vend.gst_no }));
  ok(bill && bill.vendor_id === vend.contact_id && bill.bill_number === 'CB-zpur5eee' && bill.source_of_supply === 'TN' && bill.destination_of_supply === 'KA' && bill.line_items[0].tax_id === 'gst5' && pr1.input_tax === 240, 'the Bill: vendor · seller ref as bill number · TN → KA · GST5 on the line · ITC 240: ' + JSON.stringify(bill && { v: bill.vendor_id, n: bill.bill_number, s: bill.source_of_supply, d: bill.destination_of_supply }));
  await a.pushPurchase(purchase); ok((await get('/_contacts')).filter((c) => c.contact_name === 'Chennai Stores').length === 1, 'the vendor is created once');

  console.log((fail ? 'RED ' : 'GREEN ') + pass + ' passed · ' + fail + ' failed');
  fake.kill(); setTimeout(() => process.exit(fail ? 1 : 0), 200);
})().catch((e) => { console.log('FAIL exception: ' + e.message); fake.kill(); setTimeout(() => process.exit(1), 200); });
