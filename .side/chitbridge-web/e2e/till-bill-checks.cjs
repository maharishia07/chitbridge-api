/* till-bill-checks.cjs — THE BILL'S DATA CHECKS, in the real page (walk 2026-10-09, round 4a: BF1–BF4, BF8, TB1, TB4, TB9, TB10).
 *
 * Loads public/till.html (no network, no bill saved, window.print never reached) and drives the real functions with a shop's
 * data: a Mayur Bhavan whose address says Tamil Nadu but whose GSTIN is Karnataka's, an item with no rate, a chosen modifier, a
 * Dine-in order. Asserts what the cashier and the paper now say.
 *
 * Run: node e2e/till-bill-checks.cjs   (via sh C:/dev/toolset/e2e.sh <checkout> e2e/till-bill-checks.cjs)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(70) + '· ' + (d || '') + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e.stack||e).slice(0,600)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof slipHTML === 'function' && typeof shopStateClash === 'function' && window.CBProfileMap && window.CBTax, null, { timeout: 30000 });

  console.log('\n── BF1 · no tax rate: said at the till, and the slip does not claim a tax invoice');
  const r1 = await p.evaluate(() => {
    /* INT7a-GREEN: the stand-in STATES India (country IN) — the GSTIN state check, the GST word and the CGST/SGST split are India's
       pack's answers, and since W1-TILL the counter answers India only for a stated India (docCountry → shopPack, the one reader) */
    S = { shop: { name: 'Mayur Bhavan', gstin: '29ABCPE1234F1Z7', state_code: '29', reg_type: 'regular', country: 'IN', address: 'Karnataka Layout, Bengaluru 560001' }, slabs: [], items: [] };
    CART = [{ name: 'Poori', gst_rate: null, qty: 1 }, { name: 'Masala Dosa', gst_rate: 5, qty: 1 }];
    var warn = billWarnHTML();
    var bill = { kind: 'tax', no: 'C5/26-27/0001', at: Date.now(), total: 235, lines: [{ name: 'Poori', qty: 1, unit: 'plate', price: 50, net: 50, gst_rate: undefined }, { name: 'Masala Dosa', qty: 1, unit: 'plate', price: 185, net: 185, gst_rate: 5 }], payments: [], pos_state: '29' };
    /* M66: the place of supply is printed only on a REAL tax invoice — the same bill with every line rated */
    var rated = Object.assign({}, bill, { lines: bill.lines.map(function(l){ return Object.assign({}, l, { gst_rate: 5 }); }) });
    return { warn: warn, slip: slipHTML(bill, {}), ratedSlip: slipHTML(rated, {}) };
  });
  /* M40: one line, a count and Fix ›; the names and the sentence live behind Fix (billWarnFix) */
  say('the bill carries ONE line "⚠ 1 item has no tax rate · Fix ›"', /⚠ 1 item has no tax rate/.test(r1.warn) && /till-warn-norate-fix[^>]*>Fix ›/.test(r1.warn) && !/catalogue/.test(r1.warn), r1.warn.replace(/<[^>]+>/g, ' ').trim());
  say('the slip is headed NOT A TAX INVOICE and names the line', /NOT A TAX INVOICE/.test(r1.slip) && /GST charged on: Poori/.test(r1.slip) && !/>TAX INVOICE</.test(r1.slip), '');
  /* M66 (walk 2026-10-10): a slip that is NOT a tax invoice names no place of supply; a tax invoice names it with its state */
  say('place of supply prints with its state name — on the tax invoice, not on the slip that is not one', /29 Karnataka/.test(r1.ratedSlip) && !/Place of supply/.test(r1.slip), '');

  console.log('\n── BF2 · the shop\'s data contradicts itself');
  const r2 = await p.evaluate(() => {
    S.shop.address = 'Anna Nagar, Chennai, Tamil Nadu 600100';
    var clash = shopStateClash();
    CART = [{ name: 'Dosa', gst_rate: 5, qty: 1 }];
    return { clash: clash, warn: billWarnHTML() };
  });
  say('Tamil Nadu address + 29 GSTIN is caught, in words with the fix', !!r2.clash && /Karnataka/.test(r2.clash.words) && /Tamil Nadu/.test(r2.clash.words) && /Correct the address or the GSTIN/.test(r2.clash.fix), r2.clash && r2.clash.words);
  say('the cashier sees ONE line "⚠ GSTIN state ≠ address · Fix ›" before paying', /till-warn-state/.test(r2.warn) && /⚠ GSTIN state ≠ address/.test(r2.warn) && /till-warn-state-fix/.test(r2.warn) && !/Tamil Nadu/.test(r2.warn), r2.warn.replace(/<[^>]+>/g, ' ').trim());

  console.log('\n── M41 · a details mismatch never costs a sale; the self-contradicting TAX INVOICE still never goes out');
  /* the sale is driven through the real finish(); HOST.bill is the one stub (no disk, no network) and hands the body back as the bill */
  const sell = (cart) => p.evaluate(async (cart) => {
    var said = null, saved = null, realSay = window.say, realHost = HOST;
    window.say = function (m, t) { said = { m: m, t: t }; }; window.tillStopped = async function () { return false; };
    window.autoPrint = function () {}; window.load = function () {}; window.loadQuick = function () {}; window.menuFresh = function () {};
    HOST = Object.assign({}, realHost || {}, { bill: async function (body) { saved = Object.assign({ no: 'C5/26-27/0009', at: new Date().toISOString() }, body); return { ok: true, bill: saved }; } });
    CART = cart;
    try { await finish(); } catch (e) { said = said || { m: 'threw ' + e.message }; }
    window.say = realSay; HOST = realHost;
    var sw = document.getElementById('slipwarn'), dlg = document.getElementById('slipdlg');
    var out = { said: said, saved: saved ? { not_invoice: saved.not_invoice, kind: saved.kind, tax: saved.tax } : null,
                slip: (document.getElementById('slipbox') || {}).innerHTML || '', note: sw && !sw.hidden ? sw.textContent : '' };
    try { if (dlg && dlg.open) dlg.close(); } catch (e) {}
    return out;
  }, cart);
  const r2b = await sell([{ item_id: 'x', name: 'Dosa', unit: 'plate', price: 100, qty: 1, gst_rate: 5 }]);
  say('a TAXED bill with the clash is SAVED — no refusal dialog', !!r2b.saved && !(r2b.said && /cannot be a tax invoice/.test(r2b.said.m || r2b.said.t || '')), JSON.stringify(r2b.said || r2b.saved));
  say('it is recorded as not a tax invoice (not_invoice: shop_details)', r2b.saved && r2b.saved.not_invoice === 'shop_details' && r2b.saved.tax > 0, JSON.stringify(r2b.saved));
  say('the paper says BILL — NOT A TAX INVOICE, never TAX INVOICE', /BILL — NOT A TAX INVOICE/.test(r2b.slip) && !/>TAX INVOICE</.test(r2b.slip), '');
  say('the dialog says it in ONE line with Fix ›, outside the printed slip', /Not a tax invoice — shop details disagree/.test(r2b.note) && /Fix ›/.test(r2b.note) && !/shop details disagree/.test(r2b.slip), r2b.note);
  const r2c = await sell([{ item_id: 'y', name: 'Poori', unit: 'plate', price: 50, qty: 1, gst_rate: null }]);
  say('a bill that charges NO tax saves as a plain bill and says nothing about the clash', !!r2c.saved && !r2c.saved.not_invoice && !r2c.note, JSON.stringify(r2c.saved) + ' ' + r2c.note);
  const r2d = await p.evaluate(async () => {
    var said = null, called = false, realSay = window.say, realHost = HOST, realCBTax = window.CBTax;
    window.say = function (m) { said = m; }; HOST = Object.assign({}, realHost || {}, { bill: async function () { called = true; return { ok: true, bill: {} }; } });
    window.CBTax = undefined; CART = [{ item_id: 'x', name: 'Dosa', unit: 'plate', price: 100, qty: 1, gst_rate: 5 }];
    try { await finish(); } catch (e) { said = said || ('threw ' + e.message); }
    window.CBTax = realCBTax; window.say = realSay; HOST = realHost;
    return { said: said, called: called };
  });
  say('no invoice engine is still no sale', /Prices cannot be worked out/.test(r2d.said || '') && !r2d.called, String(r2d.said).slice(0, 60));

  console.log('\n── BF3 / BF8 · modifiers and the order type are on the paper');
  const r3 = await p.evaluate(() => {
    S.shop.address = 'Bengaluru, Karnataka 560001';
    var bill = { kind: 'tax', no: 'C5/26-27/0002', at: Date.now(), total: 185, lines: [{ name: 'Chilli Paneer', qty: 1, unit: 'plate', price: 185, net: 185, gst_rate: 5,
      mods: [{ group: 'Spice', option: 'Medium', price: 0 }] }], payments: [], order: { type: 'dine', table: '4' } };
    var t = slipHTML(bill, {});
    bill.order = { type: 'take' }; var t2 = slipHTML(bill, {});
    return { dine: t, take: t2 };
  });
  say('"Medium" is printed under Chilli Paneer', /till-slip-mods[^>]*>Medium</.test(r3.dine), '');
  say('"Dine-in · Table 4" is printed', /Dine-in · Table 4/.test(r3.dine), '');
  say('a takeaway bill says Takeaway, with no table', /Takeaway/.test(r3.take) && !/Table/.test(r3.take), '');

  console.log('\n── BF4 · one counter name, from the prefix the bills are numbered under');
  const r4 = await p.evaluate(async () => {
    ls.set('cb_till_name', 'Counter 1'); STATE = { till: { id: 'C5', name: 'Counter 1' } };
    tillIdSet('C5');
    var bill = { kind: 'cash', no: 'C5/26-27/0003', at: Date.now(), total: 10, lines: [], payments: [] };
    var opt = document.querySelector('#set_dating option[value="fy"]');
    try { paintSetup(); } catch (e) {}
    /* M54: on the web counter "Next bill" is the REAL next number, read from the store (nextNumber … peek) — it lands a tick later */
    var sn = document.getElementById('seriesnote');
    for (var i = 0; i < 40 && !(sn && /Next bill/.test(sn.textContent)); i++) await new Promise(function(r){ setTimeout(r, 50); });
    return { name: counterName(), slip: slipHTML(bill, {}), opt: opt && opt.textContent, note: (sn || {}).textContent };
  });
  say('the name is "Counter 5" while the prefix is C5', r4.name === 'Counter 5', r4.name);
  say('the slip says Counter 5 beside a C5 number', /Counter 5/.test(r4.slip) && /C5\/26-27\/0003/.test(r4.slip), '');
  say('Settings: the "Bill number" example and "Next bill" use the same C5', /^C5\//.test(r4.opt || '') && /Next bill: C5\//.test(r4.note || ''), (r4.opt || '') + ' | ' + (r4.note || ''));

  console.log('\n── TB4 · a recalled parked bill keeps its own payment and order type');
  const r5 = await p.evaluate(() => {
    PARKED = []; CART = [{ key: 'a', item_id: 'a', name: 'Dosa', unit: 'plate', price: 100, qty: 1 }];
    PICKED = 'Cash'; PAY_ASKED = true; PARTS = []; setOrderKind('dine'); setOrderTable('4');
    parkBill();
    // the NEXT customer pays by card, takeaway
    PICKED = 'Card'; PAY_ASKED = true; setOrderKind('take'); setOrderTable('');
    var afterPark = { picked: PICKED };
    unpark(0);
    var got = { picked: PICKED, otype: orderKind(), table: orderTable(), asked: PAY_ASKED };
    // an old parked bill with no stored payment resets to the default, not the previous bill's
    PARKED = [{ at: new Date().toISOString(), name: 'Bill 1', phone: '', cart: [{ key: 'b', item_id: 'b', name: 'Tea', unit: 'cup', price: 10, qty: 1 }] }];
    PICKED = 'Card'; setOrderKind('take'); CART = [];
    unpark(0);
    return { got: got, old: { picked: PICKED, otype: orderKind() } };
  });
  say('recalled: Cash / Dine-in / table 4 (its own), not Card / Takeaway', r5.got.picked === 'Cash' && r5.got.otype === 'dine' && r5.got.table === '4', JSON.stringify(r5.got));
  say('a bill parked before this shipped resets to the defaults', r5.old.picked === 'Cash' && r5.old.otype === 'dine', JSON.stringify(r5.old));

  console.log('\n── TB9 / TB10 · the day close says whether the day is closed; closing is its own button');
  const r6 = await p.evaluate(async () => {
    try { localStorage.clear(); } catch (e) {}
    HOST = { bills: async () => [] };
    ls.set(shopLs('cb_till_dayclosed'), 'null');
    await dayClose();
    var before = { title: document.getElementById('sliptitle').textContent, state: (document.querySelector('[data-testid="till-day-state"]') || {}).textContent,
                   closeBtn: !document.getElementById('slipdayclose').hidden, printBtn: document.getElementById('slipprint').textContent };
    dayCloseDo();
    var after = { title: document.getElementById('sliptitle').textContent, state: (document.querySelector('[data-testid="till-day-state"]') || {}).textContent,
                  closeBtn: !document.getElementById('slipdayclose').hidden, mark: !!dayClosedMark() };
    await dayClose();
    var again = { closeBtn: !document.getElementById('slipdayclose').hidden, state: (document.querySelector('[data-testid="till-day-state"]') || {}).textContent };
    return { before: before, after: after, again: again, btnText: document.getElementById('slipdayclose').textContent };
  });
  say('before: "not closed yet", a Close the day button, Print is separate', /not closed yet/.test(r6.before.title) && /NOT closed/.test(r6.before.state) && r6.before.closeBtn && r6.btnText === 'Close the day' && r6.before.printBtn === 'Print', JSON.stringify(r6.before));
  say('after pressing it: "Day closed", the button goes, the mark is kept', /^Day closed/.test(r6.after.title) && /DAY CLOSED at/.test(r6.after.state) && !r6.after.closeBtn && r6.after.mark, JSON.stringify(r6.after));
  say('reopening the report later still says closed', !r6.again.closeBtn && /DAY CLOSED/.test(r6.again.state), JSON.stringify(r6.again));
  say('"0 bills" and "1 bill" read right', /0 bills/.test(r6.before.title), r6.before.title);

  console.log('\n── TB1 · "in the combo" only on a combo');
  const r7 = await p.evaluate(() => {
    var item = { item_id: 'd', name: 'Chilli Paneer', price: 185, unit: 'plate',
      item_data: { modifiers: [{ name: 'Spice', title: 'Spice', required: true, min: 1, max: 1, options: [{ name: 'Mild', price: 0 }, { name: 'Medium', price: 0 }, { name: 'Hot', price: 0 }] }] } };
    S.items = [item];
    var groups = [{ name: 'Spice', title: 'Spice', required: true, min: 1, max: 1, options: [{ name: 'Mild', price: 0 }, { name: 'Medium', price: 0 }, { name: 'Hot', price: 0 }] }];
    MOD_FOR = { item: item, qty: 1, groups: groups }; MOD_PICK = { Spice: [] }; MOD_EDIT = null;
    modPaint();
    return { text: document.getElementById('modbody').textContent };
  });
  say('a single dish with Mild · Medium · Hot says nothing about a combo', !/in the combo/.test(r7.text) && /Mild/.test(r7.text), r7.text.slice(0, 80));

  console.log('\n── BUY1 · a walk-in at the counter is taxed INSIDE the shop\'s country (border packs: AU, AE)');
  /* billMoney() hands the engine a buyer; the real CBTax.determine is wrapped to CAPTURE that buyer and answer as before. The web's
     engine is still tax v1.20.0 (India, no AU / AE pack), so the border pack's own answer — supply 'domestic' — is SIMULATED on the
     real result for the UAE shop, to prove the note path; the India shop runs the real engine untouched. */
  const r8 = await p.evaluate(() => {
    var realDet = CBTax.determine, seen = [], simulateBorder = false;
    CBTax.determine = function(inp){ seen.push(JSON.parse(JSON.stringify(inp.buyer))); var r = realDet(inp);
      if (simulateBorder && r && r._cb) r._cb.supply = 'domestic'; return r; };
    try {
      S = { shop: { name: 'Souq', gstin: '100000000000003', state_code: '', reg_type: 'regular', country: 'ae' }, customers: [], slabs: [], items: [] };
      CART = [{ name: 'Dates', gst_rate: 5, qty: 1, price: 100 }];
      simulateBorder = true; var ae = billMoney(); simulateBorder = false;
      S.shop = { name: 'Mayur Bhavan', gstin: '29ABCPE1234F1Z7', state_code: '29', reg_type: 'regular', country: 'IN' };
      CART = [{ name: 'Dosa', gst_rate: 5, qty: 1, price: 100 }];
      var inn = billMoney();
      S.shop = { name: 'No country yet', gstin: '29ABCPE1234F1Z7', state_code: '29', reg_type: 'regular' };
      var none = billMoney();
      return { ae: { buyer: seen[0], supply: ae.supply, notes: (ae.invoice && ae.invoice._cb && ae.invoice._cb.notes) || [] },
               inn: { buyer: seen[1], supply: inn.supply, cgst: inn.byRate['5'] && inn.byRate['5'].cgst, sgst: inn.byRate['5'] && inn.byRate['5'].sgst, notes: (inn.invoice && inn.invoice._cb && inn.invoice._cb.notes) || [] },
               none: { engineCalls: seen.length - 2, noCountry: none.noCountry === true, invoice: none.invoice, supply: none.supply, notes: (none.invoice && none.invoice._cb && none.invoice._cb.notes) || [] } };
    } finally { CBTax.determine = realDet; }
  });
  say('a UAE shop\'s walk-in reaches the engine with Country AE — the shop\'s own, upper-cased', r8.ae.buyer.Country === 'AE' && r8.ae.buyer.RegType === 'unregistered', JSON.stringify(r8.ae.buyer));
  say('…and when the border decides (domestic), the invoice notes "Walk-in: taxed as a sale inside AE."', r8.ae.supply === 'domestic' && r8.ae.notes.indexOf('Walk-in: taxed as a sale inside AE.') >= 0, JSON.stringify(r8.ae.notes));
  say('an Indian shop\'s walk-in: Country IN, place of supply 29 (the counter), CGST + SGST — and NO walk-in note (the state rule, not a guess)', r8.inn.buyer.Country === 'IN' && r8.inn.buyer.Pos === '29' && r8.inn.supply === 'intra' && r8.inn.cgst > 0 && r8.inn.cgst === r8.inn.sgst && !r8.inn.notes.some(function(n){ return /^Walk-in/.test(n); }), JSON.stringify(r8.inn));
  say('a shop with no country on record never reaches the engine and has no invoice — nothing is invented (api #966)', r8.none.engineCalls === 0 && r8.none.noCountry === true && r8.none.invoice === null && !r8.none.notes.some(function(n){ return /^Walk-in/.test(n); }), JSON.stringify(r8.none));

  say('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  console.log(bad ? '\n' + bad + ' FAILED' : '\nthe bill\'s data checks hold in the real page');
  await b.close(); srv.close();
  process.exit(bad ? 1 : 0);
})();
