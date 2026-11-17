/**
 * connector-b2b.test.cjs — the B2B voucher, end to end against fake Tally, with a hand-made invoice (no API).
 *   node e2e/connector-b2b.test.cjs
 * A registered buyer in Karnataka (29…) buys from a Tamil Nadu seller: the party ledger is created with the GSTIN and the
 * state; the Sales voucher carries PARTYGSTIN, Place of Supply Karnataka, an IGST line (inter-state) and the party owes
 * goods + tax against a New Ref bill. Then the same buyer within the state: CGST + SGST lines, no IGST. Then a walk-in
 * order books exactly as before (no tax lines, party Cash).
 * CARD      23-connectors-and-integrations/zoho-gofrugal-b2b-purchase
 */
const { spawn } = require('child_process'); const path = require('path'); const os = require('os'); const fs = require('fs');
const KIT = path.join(process.env.CB_API_REPO ? path.resolve(process.env.CB_API_REPO) : path.join(__dirname, '..', '..', 'chitbridge-api'), 'tools', 'tally-connector');   /* CI checks the api out beside the web (CB_API_REPO) */
const port = 9500 + Math.floor(Math.random() * 300);
const fake = spawn(process.execPath, [path.join(KIT, 'fake-tally.js'), String(port)], { stdio: 'ignore' });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } };
const get = (p) => fetch('http://localhost:' + port + p).then((r) => r.json());
(async () => {
  await new Promise((r) => setTimeout(r, 700));
  const T = require(path.join(KIT, 'adapters', 'tally.js')); const core = require(path.join(KIT, 'core.js'));
  const adapter = T({ tally: { url: 'http://localhost:' + port, partyLedger: 'Walk-in customers', salesLedger: 'Sales' }, log: () => {} });
  const receipts = new core.Receipts(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-b2b-')), 'r.jsonl'));

  const e = await adapter.ensure();
  const masters0 = await get('/_masters');
  ok(masters0.some((m) => m.name === 'IGST' && m.parent === 'Duties & Taxes' && m.duty === 'IGST') && masters0.some((m) => m.name === 'SGST' && m.duty === 'SGST/UTGST'), 'ensure created the GST tax ledgers with duty heads: ' + masters0.map((m) => m.name).join(' · '));

  const lines = [{ name: 'Basmati Rice 25kg', code: 'RIC', qty: 2, unit: 'bag', price: 1000, total: 2000, gst_rate: 5 }];
  const inter = { chit_id: 'b2b1aaaa-0000', at: '2026-09-05T10:00:00Z', buyer: 'Kumar Traders Pvt Ltd', total: 2000, lines,
    b2b: { buyer: { name: 'Kumar Traders Pvt Ltd', gstin: '29ABCDE1234F1Z5', state_code: '29', addr: '12 Market Road', loc: 'Bengaluru', pin: '560001', reg_type: 'Regular' },
           place_of_supply: '29', supply: 'inter', taxes: { cgst: 0, sgst: 0, igst: 100, cess: 0 }, taxable: 2000, total: 2100,
           items: [{ name: 'Basmati Rice 25kg', hsn: '1006', rate: 5, ass: 2000, cgst: 0, sgst: 0, igst: 100 }] } };
  const pr = await adapter.ensureParty(inter.b2b.buyer);
  const masters1 = await get('/_masters'); const party = masters1.find((m) => m.name === 'Kumar Traders Pvt Ltd');
  ok(pr.created === 'Kumar Traders Pvt Ltd' && party && party.parent === 'Sundry Debtors' && party.gstin === '29ABCDE1234F1Z5' && party.state === 'Karnataka', 'party ledger created under Sundry Debtors with GSTIN + state: ' + JSON.stringify(party));
  const pr2 = await adapter.ensureParty(inter.b2b.buyer); ok(pr2.created === null, 'second ensureParty: already there, nothing created');

  const r1 = await adapter.pushOrder(inter); const v = (await get('/_vouchers')).find((x) => x.ref === 'CB-b2b1aaaa');
  ok(v && v.party_gstin === '29ABCDE1234F1Z5' && v.place_of_supply === 'Karnataka', 'the voucher carries PARTYGSTIN + Place of Supply Karnataka: ' + JSON.stringify(v && { gstin: v.party_gstin, pos: v.place_of_supply }));
  const igst = v && v.ledgers.find((l) => l.ledger === 'IGST'); const partyLine = v && v.ledgers.find((l) => l.ledger === 'Kumar Traders Pvt Ltd');
  ok(igst && Number(igst.amount) === 100 && !igst.dr && !(v.ledgers.some((l) => l.ledger === 'CGST')), 'IGST 100 credited, no CGST/SGST (inter-state): ' + JSON.stringify(v && v.ledgers));
  ok(partyLine && partyLine.dr && Number(partyLine.amount) === -2100, 'the party owes goods + tax = 2100');

  const intra = JSON.parse(JSON.stringify(inter)); intra.chit_id = 'b2b2bbbb-0000'; intra.b2b.buyer = { name: 'Chennai Stores', gstin: '33ABCDE1234F1Z7', state_code: '33', reg_type: 'Regular' };
  intra.b2b.place_of_supply = '33'; intra.b2b.supply = 'intra'; intra.b2b.taxes = { cgst: 50, sgst: 50, igst: 0, cess: 0 };
  await adapter.ensureParty(intra.b2b.buyer); await adapter.pushOrder(intra);
  const v2 = (await get('/_vouchers')).find((x) => x.ref === 'CB-b2b2bbbb');
  ok(v2 && v2.place_of_supply === 'Tamil Nadu' && v2.ledgers.some((l) => l.ledger === 'CGST' && Number(l.amount) === 50) && v2.ledgers.some((l) => l.ledger === 'SGST' && Number(l.amount) === 50) && !v2.ledgers.some((l) => l.ledger === 'IGST'), 'within the state: CGST 50 + SGST 50, no IGST');

  const walk = { chit_id: 'walk3ccc-0000', at: '2026-09-05T10:00:00Z', buyer: 'Priya', total: 2000, lines };
  await adapter.pushOrder(walk); const v3 = (await get('/_vouchers')).find((x) => x.ref === 'CB-walk3ccc');
  ok(v3 && !v3.party_gstin && v3.ledgers.some((l) => l.ledger === 'Walk-in customers' && Number(l.amount) === -2000) && !v3.ledgers.some((l) => /GST/.test(l.ledger)), 'a walk-in order books as before: party Walk-in customers, no tax lines, no GSTIN');

  /* offers: Tally has none — the voucher carries the listed rate, the discount %, the chit's amount; the narration names the offer */
  const offer = { chit_id: 'offr4ddd-0000', at: '2026-09-05T10:00:00Z', buyer: 'Priya', total: 550, lines: [
    { name: 'Basmati Rice 25kg', code: 'RIC', qty: 2, unit: 'bag', price: 200, total: 300, offer: { label: 'Buy 2 save 100', off: 100 } },
    { name: 'Toor Dal 1kg', code: 'DAL', qty: 1, unit: 'kg', price: 250, list_price: 250, total: 250 },
    { name: 'Groundnut Oil 1L', code: 'OIL', qty: 1, unit: 'count', price: 0, total: 0, offer: { label: 'Free oil over 500', off: 240 } } ] };
  await adapter.pushOrder(offer); const v4 = (await get('/_vouchers')).find((x) => x.ref === 'CB-offr4ddd');
  const rice = v4 && v4.items.find((i) => /Basmati/.test(i.item)), oil = v4 && v4.items.find((i) => /Oil/.test(i.item));
  ok(rice && rice.rate === '200/bag' && rice.discount === '25' && rice.amount === '300', 'an offer line: listed 200, discount 25%, amount 300 (the chit): ' + JSON.stringify(rice));
  ok(oil && oil.rate === '0/count' && oil.amount === '0' && oil.qty === '1 count', 'a free item: zero-rate line, still leaves stock: ' + JSON.stringify(oil));
  ok(v4 && v4.ledgers.some((l) => l.ledger === 'Walk-in customers' && Number(l.amount) === -550), 'the party owes the chit total 550, not rate × qty 650');
  ok(v4 && /offers: Buy 2 save 100 −100, Free oil over 500 −240/.test(v4.narration), 'the narration names the offers: ' + (v4 && v4.narration));

  console.log((fail ? 'RED ' : 'GREEN ') + pass + ' passed · ' + fail + ' failed');
  fake.kill(); setTimeout(() => process.exit(fail ? 1 : 0), 200);
})().catch((e) => { console.log('FAIL exception: ' + e.message); fake.kill(); setTimeout(() => process.exit(1), 200); });
