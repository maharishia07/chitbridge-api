/* till-receive-bill.cjs — F10 · F11: A RECEIPT THAT CARRIES THE SUPPLIER'S BILL, AND THE SUPPLIER THE DOOR KNOWS
 *
 * Athi, 14 Oct ("yes to F10, build it"): the Receive form asks for their bill no. + total, the slip echoed them — and afterwards the books
 * said "You owe nobody". F11: typing "Sri Ganesh" at the door did not suggest the known supplier "Sri Ganesh Provisions".
 *
 * Drives the real Receive pane of public/till.html (the vendored copy) on the cloud host:
 *   · the snapshot's supplier names fill the door's suggestion list (datalist suplist) — "Sri Ganesh" is in "Sri Ganesh Provisions"
 *   · a part-typed name picks nobody; the full name (what a pick types) carries the party's id, and their GSTIN's state fills the state box
 *   · Confirm → the slip shows their bill, what it says, and that it waits in the books to accept
 *   · the chit that goes to the server carries party.party_id, their_bill, and each line's gst_rate (the books tax their bill from it)
 *   · a receipt WITHOUT their bill says nothing about the books
 *
 *   · FX-F10W2: their total is compared with goods + tax by the ONE rule (CBTheirBill — the books' Waiting row asks the same file); the
 *     slip says the screen's sentence; inclusive rates; Receive at 390 px (light + dark) does not scroll sideways
 *
 * Run: NODE_PATH=$PWD/e2e/node_modules node e2e/till-receive-bill.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
            '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(70) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const SG = '33333333-3333-4333-8333-333333333333';

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1366, height: 880 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function' && typeof window.rcvConfirm === 'function', null, { timeout: 30000 });

  await p.evaluate(({ api, sg }) => {
    CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
    HOST.drain = function () {};                       /* the chit is read from the queue below, not sent */
    ls.set(tillGivenKey(), 'C1');
    WHO = { id: 'w1', name: 'Bala', kind: 'coassist', since: new Date().toISOString() };
    window.S = { shop: { country: 'IN', name: 'Mayur Stores', currency: 'INR', state_code: '33', gstin: '33AAAAA0000A1Z5', reg_type: 'regular', pay: [{ id: 'cash', label: 'Cash' }] },
                 at: new Date().toISOString(), items: [], offers: [], customers: [],
                 suppliers: [{ party_id: sg, name: 'Sri Ganesh Provisions', state: '33', party_no: 'P-00001' }, { party_id: '44444444-4444-4444-8444-444444444444', name: 'Lakshmi Agencies' }] };
    window.__q = [];
    var put0 = DB.put; DB.put = function (st, row) { if (st === 'queue' && row && row.chitBody) window.__q.push(JSON.parse(JSON.stringify(row.chitBody))); return put0(st, row); };
    paintCustomers(); setMode('receive');
  }, { api: base, sg: SG });

  console.log('\n── F11 · the door suggests the shop\'s own suppliers ───────────');
  const sug = await p.evaluate(() => ({
    list: document.getElementById('rcv_vendor').getAttribute('list'),
    opts: Array.prototype.map.call(document.querySelectorAll('#suplist option'), (o) => o.value),
  }));
  say('the supplier box suggests from the snapshot\'s suppliers (datalist suplist)', sug.list === 'suplist' && sug.opts.indexOf('Sri Ganesh Provisions') >= 0, JSON.stringify(sug));
  say('"Sri Ganesh" is in the suggestion the browser offers as it is typed', sug.opts.some((o) => o.toLowerCase().indexOf('sri ganesh') >= 0), 'found');

  await p.click('[data-testid="rcv-vendor"]');
  await p.keyboard.type('Sri Ganesh', { delay: 20 });
  const part = await p.evaluate(() => ({ party: RCV.vendor_party, vendor: RCV.vendor }));
  say('a part-typed name picks nobody (never a guess)', part.party === null && part.vendor === 'Sri Ganesh', JSON.stringify(part));
  await p.fill('[data-testid="rcv-vendor"]', 'Sri Ganesh Provisions');   /* what picking the suggestion types */
  const pick = await p.evaluate(() => ({ party: RCV.vendor_party, state: RCV.vendor_state, box: document.getElementById('rcv_vstate').value }));
  say('picking "Sri Ganesh Provisions" carries the party\'s id', pick.party === SG, String(pick.party));
  say('…and their GSTIN\'s state fills the empty state box (CGST/SGST vs IGST)', pick.state === '33' && pick.box === '33', JSON.stringify(pick));

  console.log('\n── F10 · their bill, captured at the door → the slip ───────────');
  await p.evaluate(() => {
    rcvAdd({ item_id: 'i1', name: 'Rice 25kg', unit: 'bag', price: 100 }, 10);
    RCV.lines[0].gst_rate = 18; RCV.lines[0].rate = 100; paintReceive();
  });
  await p.fill('[data-testid="rcv-billno"]', 'SG-101');
  await p.fill('[data-testid="rcv-billtotal"]', '1180');
  await p.evaluate(async () => { await rcvConfirm(); });
  const slip = await p.evaluate(() => ({ open: document.getElementById('slipdlg').open, text: document.getElementById('slipbox').innerText.replace(/\s+/g, ' '),
    books: !!document.querySelector('#slipbox [data-testid="rcv-slip-books"]') }));
  say('Confirm opens the receipt slip', slip.open === true, 'open');
  say('the slip names their bill and what it says', /Their bill\s*SG-101/.test(slip.text) && /Their bill says\s*₹\s?1,180/.test(slip.text), slip.text.slice(0, 120));
  say('…and that it waits in the books for the owner to accept', slip.books && /waits in the books for you to accept/.test(slip.text), String(slip.books));
  const chit = await p.evaluate(() => window.__q.filter((c) => c.purpose === 'receipt').pop() || null);
  const bj = (chit && chit.business_json) || {};
  say('the chit to the server is a receipt carrying their bill (no. + total)', chit && bj.their_bill && bj.their_bill.no === 'SG-101' && Number(bj.their_bill.total) === 1180, JSON.stringify(bj.their_bill));
  say('…naming the supplier by id (party.party_id), never only a typed name', bj.party && bj.party.party_id === SG && bj.party.name === 'Sri Ganesh Provisions', JSON.stringify(bj.party));
  say('…each line carrying the GST rate on their bill (line_items[].gst_rate)', chit && chit.line_items && chit.line_items[0].gst_rate === 18 && chit.line_items[0].price === 100 && chit.line_items[0].quantity === 10, JSON.stringify(chit && chit.line_items && chit.line_items[0]));
  say('…and the input tax with the supplier\'s state', bj.input_tax && bj.input_tax.vendor_state === '33' && bj.input_tax.tax === 180, JSON.stringify(bj.input_tax));
  await p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });

  console.log('\n── a receipt WITHOUT their bill stays a goods receipt ───────────');
  await p.evaluate(async () => {
    rcvClear(); RCV.vendor = 'Lakshmi Agencies'; document.getElementById('rcv_vendor').value = RCV.vendor; rcvVendorPick();
    rcvAdd({ item_id: 'i2', name: 'Dal 1kg', unit: 'piece', price: 120 }, 5); await rcvConfirm();
  });
  const plain = await p.evaluate(() => ({ books: !!document.querySelector('#slipbox [data-testid="rcv-slip-books"]'), chit: window.__q.filter((c) => c.purpose === 'receipt').pop() }));
  say('no bill no. / total → the slip says nothing about the books', plain.books === false, String(plain.books));
  say('…and the chit carries no bill (their_bill no and total empty)', plain.chit && plain.chit.business_json.their_bill && !plain.chit.business_json.their_bill.no && plain.chit.business_json.their_bill.total == null,
    JSON.stringify(plain.chit && plain.chit.business_json.their_bill));
  say('…the second known supplier is carried by id too', plain.chit && plain.chit.business_json.party.party_id === '44444444-4444-4444-8444-444444444444', JSON.stringify(plain.chit && plain.chit.business_json.party));

  console.log('\n── STK-FIX1b · a second scanned batch of the same product is its own receiving line ───────────');
  const two = await p.evaluate(async () => {
    rcvClear(); RCV.vendor = 'Lakshmi Agencies'; document.getElementById('rcv_vendor').value = RCV.vendor; rcvVendorPick();
    const pill = { item_id: 'i9', name: 'Paracetamol 500', unit: 'strip', price: 10 };
    rcvAdd(pill, 10, { batch: 'AC2431', expiry: '2028-03-31' });   /* what lotFromScan hands over for a GS1 (10)…(17)… pack */
    rcvAdd(pill, 5, { batch: 'AC2432', expiry: '2027-01-31' });
    rcvAdd(pill, 2, { batch: 'ac2431' });                           /* the first batch again, as the scanner may type it */
    const rows = document.querySelectorAll('#rcv_lines [data-testid^="rcv-line-"]').length;
    const lines = RCV.lines.map((l) => [l.counted, l.lot && l.lot.batch, l.lot && l.lot.expiry]);
    await rcvConfirm();
    const chit = window.__q.filter((c) => c.purpose === 'receipt').pop();
    return { rows, lines, items: chit ? chit.line_items.map((x) => [x.quantity, x.item_data && x.item_data.lot]) : null };
  });
  say('two batches → two lines on the screen (not merged onto line 1)', two.rows === 2 && two.lines.length === 2, JSON.stringify(two.lines));
  say('…each with its own code, count and expiry; the rescan added to ITS line', JSON.stringify(two.lines) === JSON.stringify([[12, 'AC2431', '2028-03-31'], [5, 'AC2432', '2027-01-31']]), JSON.stringify(two.lines));
  say('…and the chit carries two lines, each item_data.lot = { batch, expiry } (what stock-from-chit.lotOf reads)',
    !!two.items && two.items.length === 2 && two.items[0][1].batch === 'AC2431' && two.items[1][1].batch === 'AC2432' && two.items[1][1].expiry === '2027-01-31', JSON.stringify(two.items));
  await p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });

  console.log('\n── FX-F10W · a snapshot stored by an older counter (no suppliers) is read again once on start ───────────');
  const heal = await p.evaluate(async () => {
    const calls = []; const was = { refresh: HOST.refresh, state: HOST.state, lineUp: window.lineUp };
    HOST.refresh = async function () { calls.push('refresh'); return { ok: true }; };
    window.lineUp = function () { return true; };
    const run = async (snap) => { FIRST_READ = false; HOST.state = async function () { return { snapshot: snap }; }; calls.length = 0; await load(); await new Promise((r) => setTimeout(r, 50)); return calls.length; };
    const base = JSON.parse(JSON.stringify(S));
    const old = JSON.parse(JSON.stringify(base)); delete old.suppliers;
    const out = { lacks: snapLacks(old), has: snapLacks(base), oldRefreshed: await run(old) };
    out.again = await (async () => { calls.length = 0; await load(); await new Promise((r) => setTimeout(r, 50)); return calls.length; })();   /* once per page: FIRST_READ */
    out.newRefreshed = await run(base);
    HOST.refresh = was.refresh; HOST.state = was.state; window.lineUp = was.lineUp;
    return out;
  });
  say('a stored snapshot without `suppliers` is lacking a key this build reads (SNAP_NEEDS)', heal.lacks === true && heal.has === false, JSON.stringify(heal));
  say('…so the counter refreshes once on start — the existing HOST.refresh, no new route', heal.oldRefreshed === 1, String(heal.oldRefreshed));
  say('…and only once per page (the same FIRST_READ guard a blank counter uses)', heal.again === 0, String(heal.again));
  say('a snapshot that carries every key is not read again on start', heal.newRefreshed === 0, String(heal.newRefreshed));

  console.log('\n── STD1 · ONE name rule at the counter (oneByName): custKnown and rcvSupplierKnown both ask it ───────────');
  const nm = await p.evaluate(() => {
    const L = [{ party_id: 'a', name: 'Sri Ganesh Provisions', nickname: 'SGP' }, { party_id: 'b', name: 'Lakshmi Agencies' }, { party_id: 'c', name: 'Lakshmi Agencies ' }, { name: 'No Id Traders' }];
    const out = { exact: (oneByName(L, '  sri ganesh provisions ', 'party_id') || {}).party_id, nick: (oneByName(L, 'sgp', 'party_id') || {}).party_id,
      two: oneByName(L, 'Lakshmi Agencies', 'party_id'), noId: oneByName(L, 'No Id Traders', 'party_id'), part: oneByName(L, 'Sri Ganesh', 'party_id'), empty: oneByName(L, '  ', 'party_id') };
    const was = S.suppliers; S.suppliers = L; out.rcv = (rcvSupplierKnown('SGP') || {}).party_id; S.suppliers = was;
    const wasC = S.customers, cn = document.getElementById('cname'), cp = document.getElementById('cphone'), keep = [cn && cn.value, cp && cp.value];
    S.customers = [{ identity_id: 'k1', name: 'Kumar', phone: '9876543210' }, { identity_id: 'k2', name: 'Kumar' }, { identity_id: 'k3', name: 'Meena', nickname: 'Meena Akka' }];
    if (cn && cp) { cn.value = 'kumar'; cp.value = ''; out.custTwo = custKnown(); cn.value = ' meena akka '; out.custNick = (custKnown() || {}).identity_id; cn.value = 'Kumar'; cp.value = '98765 43210'; out.custPhone = (custKnown() || {}).identity_id; cn.value = keep[0]; cp.value = keep[1]; }
    S.customers = wasC;
    return out;
  });
  say('exactly one by name — trimmed, case aside — or by the shop\'s nickname', nm.exact === 'a' && nm.nick === 'a', JSON.stringify(nm));
  say('two of the same name is nobody; a row with no id, a part of a name, or nothing typed is nobody', nm.two === null && nm.noId === null && nm.part === null && nm.empty === null, JSON.stringify(nm));
  say('the Receive door asks it (rcvSupplierKnown)', nm.rcv === 'a', String(nm.rcv));
  say('the customer box asks it too (custKnown: two Kumars is nobody; the phone still wins first)', nm.custTwo === null && nm.custNick === 'k3' && nm.custPhone === 'k1', JSON.stringify(nm));

  console.log('\n── FX-F10W2 · ONE comparison: their total against goods + tax (CBTheirBill — the books ask the same file) ───────────');
  const sg = await p.evaluate(async () => {
    const out = {};
    rcvClear(); RCV.vendor = 'Sri Ganesh Provisions'; document.getElementById('rcv_vendor').value = RCV.vendor; rcvVendorPick();
    rcvAdd({ item_id: 'i3', name: 'Toor dal', unit: 'kg', price: 105 }, 4); RCV.lines[0].gst_rate = 5; RCV.lines[0].rate = 105;
    RCV.bill_no = 'SG-201'; document.getElementById('rcv_billno').value = 'SG-201';
    const read = () => { const el = document.querySelector('[data-testid="rcv-check"]'); return el ? { code: el.getAttribute('data-code'), text: el.textContent } : null; };
    const rule = (t) => CBTheirBill.check({ total: t, taxable: 420, tax: 21, currency: 'INR', no: 'SG-201', say: money });
    RCV.bill_total = 420; paintReceive(); out.at420 = read(); out.rule420 = rule(420);
    RCV.bill_total = 441; paintReceive(); out.at441 = read(); out.rule441 = rule(441);
    RCV.bill_total = 442; paintReceive(); out.at442 = read();
    out.loaded = !!window.CBTheirBill && MISSING.indexOf('their-bill') < 0;
    RCV.bill_total = 441; paintReceive();
    await rcvConfirm();
    const sl = document.querySelector('#slipbox [data-testid="rcv-slip-check"]');
    out.slip = sl ? { code: sl.getAttribute('data-code'), text: sl.textContent } : null;
    try { document.getElementById('slipdlg').close(); } catch (_) {}
    rcvClear(); RCV.tax_inclusive = true; rcvAdd({ item_id: 'i3', name: 'Toor dal', unit: 'kg', price: 110.25 }, 4); RCV.lines[0].gst_rate = 5; RCV.lines[0].rate = 110.25;
    RCV.bill_total = 441; paintReceive(); out.incl = read(); out.inclTax = rcvTax();
    RCV.tax_inclusive = false; rcvClear();
    return out;
  });
  say('the page loads /app/their-bill.js (CBTheirBill) — not reported missing', sg.loaded, String(sg.loaded));
  say('SG-201 · ₹420 typed (the goods BEFORE tax) → "apart", never "agrees"', sg.at420 && sg.at420.code === 'apart' && /₹\s?21(\.00)? apart/.test(sg.at420.text), JSON.stringify(sg.at420));
  say('…its words are the rule\'s own, word for word (the books\' Waiting row starts with the same sentence)', sg.at420 && sg.at420.text === sg.rule420.sentence, sg.rule420.sentence);
  say('SG-201 · ₹441 (goods ₹420 + tax ₹21) → agrees', sg.at441 && sg.at441.code === 'agrees' && sg.at441.text === sg.rule441.sentence, JSON.stringify(sg.at441));
  say('…₹442 is within one rupee → their round-off (the books post it so)', sg.at442 && sg.at442.code === 'round_off', JSON.stringify(sg.at442));
  say('the slip says the same sentence as the screen (₹441 agrees)', sg.slip && sg.slip.code === 'agrees' && sg.slip.text === sg.rule441.sentence, JSON.stringify(sg.slip));
  say('inclusive rates (₹110.25 × 4 with 5% inside) → taxable ₹420 + tax ₹21 = their ₹441 agrees', sg.incl && sg.incl.code === 'agrees' && sg.inclTax.taxable === 420 && sg.inclTax.tax === 21, JSON.stringify([sg.incl, sg.inclTax.taxable, sg.inclTax.tax]));

  console.log('\n── FX-F10W2 · Receive at 390 px: no sideways scroll, "Confirm receipt" on screen (light and dark) ───────────');
  for (const theme of ['light', 'dark']) {
    const n = await (await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme })).newPage();
    await n.goto(base + '/till.html');
    await n.waitForFunction(() => typeof window.rcvConfirm === 'function', null, { timeout: 30000 });
    const m = await n.evaluate(() => {
      CloudHost.key = 'demo-key'; HOST = CloudHost; HOST.drain = function () {}; ls.set(tillGivenKey(), 'C1');
      WHO = { id: 'w1', name: 'Bala', kind: 'coassist' };
      window.S = { shop: { country: 'IN', name: 'Mayur Stores', currency: 'INR', state_code: '33', gstin: '33AAAAA0000A1Z5', reg_type: 'regular', pay: [{ id: 'cash', label: 'Cash' }] }, at: new Date().toISOString(), items: [], offers: [], customers: [], suppliers: [] };
      setMode('receive'); rcvAdd({ item_id: 'i1', name: 'Toor dal premium 25kg', unit: 'bag', price: 105 }, 4); RCV.lines[0].gst_rate = 5; RCV.lines[0].rate = 105; RCV.bill_total = 420; paintReceive();
      const pane = document.getElementById('pane_receive'), r = document.getElementById('rcv_save').getBoundingClientRect();
      return { page: document.documentElement.scrollWidth, pane: pane.scrollWidth - pane.clientWidth, btn: [Math.round(r.left), Math.round(r.right)], vw: innerWidth };
    });
    say('390 px ' + theme + ': the page and the Receive pane do not scroll sideways', m.page <= m.vw && m.pane <= 0, JSON.stringify(m));
    say('390 px ' + theme + ': "Confirm receipt" is wholly on screen', m.btn[0] >= 0 && m.btn[1] <= m.vw, JSON.stringify(m.btn));
    await n.context().close();
  }

  say('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
  await b.close(); srv.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED' : '✓ till-receive-bill: all checks passed') + '\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('✗ threw: ' + (e && e.stack)); process.exit(1); });
