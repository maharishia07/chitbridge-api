/**
 * tests/in-export-3b.test.cjs - A STATED EXPORT FROM INDIA IS GSTR-3B 3.1(b), NOT 3.1(a) (VERIFY-GF-TAX F6, batch 1128). IGST Act s.16(1)(a), CGST Rules r.96A (LUT), GSTR-3B 3.1(b), GSTR-1 SupTyp EXPWOP.
 * Hand figures (rupees): export of 5,00,000.00 stated at 18% to a UAE buyer -> tax 0.00; 3.1(b) txval 5,00,000.00; 3.1(a) txval 0.00 (before: 5,00,000.00 in 3.1(a) with tax 0).
 * Run: CB_ENGINES_DIR=../chitbridge-engines node tests/in-export-3b.test.cjs   (without the checkout the test SKIPs, said)
 */
'use strict';
const fs = require('fs'), path = require('path');
const engines = process.env.CB_ENGINES_DIR ? path.join(path.resolve(process.env.CB_ENGINES_DIR), 'src') : path.join(__dirname, '..', '..', 'chitbridge-engines', 'src');
if (!fs.existsSync(path.join(engines, 'gst-returns.js'))) { console.log('skip: no engines checkout (set CB_ENGINES_DIR)'); process.exit(0); }
const T = require(path.join(engines, 'tax'));
require('./support/engines-checkout.cjs');
const TL = require('../lib/tax-lines');
let pass = 0, fail = 0;
const eq = (name, got, want) => { const good = JSON.stringify(got) === JSON.stringify(want); good ? pass++ : fail++; if (!good) process.exitCode = 1; console.log((good ? '   ok   ' : '   FAIL ') + name + (good ? '' : '\n          got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
const seller = { Gstin: '33AABCY1234F1Z5', LglNm: 'Walk Shop', State: '33', Pos: '33', Country: 'IN' }, me = { Gstin: seller.Gstin, Country: 'IN' };
const frozen = (extra) => JSON.parse(JSON.stringify(T.determine(Object.assign({ seller, buyer: { Country: 'AE', LglNm: 'Dubai LLC' }, lines: [{ name: 'Goods', qty: 1, unit_price: 500000, rate: 18, hsn: '1905', unit: 'NOS' }] }, extra))));
/* batch 1128 fold: GSTR-3B is built by the one builder from the ledger's documents, so the month is a real ledger of one sent bill (TL.ledger), not a hand-made row */
const month = (invoice) => { const led = TL.ledger([{ chit_id: 'x1', direction: 'sent', sells: true, purpose: 'invoice', invoice, provisional: false, seller: Object.assign({ entity_id: 'me' }, seller), buyer: { entity_id: 'b1', LglNm: 'Dubai LLC', Country: 'AE' }, at: '2026-11-10T05:00:00.000Z' }], me); led.rows.forEach((row) => { row.day = '2026-11-10'; }); return led; };
const stated = frozen({ isExport: true });
stated.BuyerDtls = Object.assign({}, stated.BuyerDtls, { Pos: '96' }); stated._cb = Object.assign({}, stated._cb, { supply: 'inter', place_of_supply: '96' }); /* batch 1128 fold: the till's export bill carries its supply type; the one-builder GSTR-3B (and GSTR-1) leave out a document whose supply is 'unknown' (see BATCH-1128: does a real stated export carry it?) */
eq('the engine says EXPWOP and tax 0', [stated.TranDtls.SupTyp, stated.ValDtls.TaxVal], ['EXPWOP', 0]);
const b = TL.gstr3b(month(stated), me, '112026');
eq('3.1(b) 5,00,000.00, 3.1(a) 0.00', [b.sup_details.osup_zero.txval, b.sup_details.osup_det.txval], [500000, 0]);
const unstated = TL.gstr3b(month(frozen({})), me, '112026');
eq('an unstated sale to a foreign buyer is not 3.1(b)', unstated.sup_details.osup_zero.txval, 0);
console.log('\n' + pass + ' checks' + (fail ? ', ' + fail + ' FAILED' : ''));
