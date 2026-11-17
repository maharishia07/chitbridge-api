/* booksfu-live.cjs - l16 booksfu (W15-85a · W15-89b) against a REAL api (a SIT box's throwaway api: bf-setup.sh), Harbour Plumbing's books.
 * Run on the box (bf-e2e.sh in C:/dev/shots/l16-booksfu/box): web = this checkout's public/, api = $API (the l16/booksfu-api branch), owner = harbour-plumbing-au. Shots: $OUT (1366x768 and 390x844).
 * EXPECTED (by hand, before the run): a receipt from a customer posted into LOCKED October moves to the first open month with its own day as doc_date and the note "October locked" in its narration (a payment line too,
 * not only an entry); the ledger of the bank account then says, on that line, the other side (the customers ledger) and the customer by name; an expense with no party says only its expense ledger; no page scroll sideways at 1366 or 390. */
'use strict';
const { chromium } = require('@playwright/test'), fs = require('fs'), path = require('path');
const L = require('./lib/live-harbour.cjs');
const OUT = process.env.OUT || 'e2e/shots';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { base } = await L.serve(), token = await L.signIn(process.env.HANDLE || 'harbour-plumbing-au');
  const api = (m, u, b) => L.call(m, u, token, b);
  const send = async (u, b) => { const r = await fetch(L.API + u, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, 'idempotency-key': 'bf-' + Math.random().toString(36).slice(2) + Date.now() }, body: JSON.stringify(b) }); let j; try { j = await r.json(); } catch (_) { j = null; } return { status: r.status, ok: r.ok, body: j }; };
  const parties = (await api('GET', '/api/crm/parties')).body.parties || [];
  const cust = parties.find((x) => /Coogee/.test(x.display_name)) || parties[0];
  const accounts = (await api('GET', '/api/books/accounts')).body, list = accounts.accounts || accounts.rows || accounts;
  const bank = list.find((x) => x.role === 'bank');
  console.log('   bank ' + (bank && bank.code) + ' ' + (bank && bank.name) + ' · customer ' + (cust && cust.display_name));
  const periods = (await api('GET', '/api/books/periods')).body.periods || [];
  for (const r of periods.filter((x) => Number(x.period) >= 1 && String(x.end_date).slice(0, 10) <= '2026-10-31').sort((x, y) => String(x.start_date).localeCompare(String(y.start_date)))) if (r.status === 'open') await api('POST', '/api/books/periods/' + r.fiscal_year + '/' + r.period + '/lock', { reason: 'BAS lodged' });
  const ref = 'bank:bf' + Date.now().toString(36);
  const rc = await send('/api/books/payments', { party_id: cust.party_id, direction: 'in', amount_minor: 4400, mode: 'bank', received_at: '2026-10-20', allocate: 'none', acknowledge: ['same_again'], client_ref: ref + '-1', if_locked: 'next_open' });
  console.log('   receipt into locked October -> ' + rc.status + ' ' + JSON.stringify(rc.body).slice(0, 200));
  ok(rc.status === 200, 'a receipt dated in locked October posts with if_locked next_open');
  const fee = await send('/api/books/events', { kind: 'expense', class: 'bank_charges', amount: 15, paid_from: 'bank', date: '2026-10-21', narration: 'MONTHLY ACCOUNT FEE', client_ref: ref + '-2', if_locked: 'next_open' });
  ok(fee.status === 200 && fee.body.moved === true, 'an expense dated in locked October posts moved too (' + fee.status + ')');
  const day = (await api('GET', '/api/books/daybook?from=2026-10-01&to=2026-12-31&limit=300')).body;
  const mine = (day.entries || []).filter((e) => e.doc_date && e.posting_date && String(e.posting_date).slice(0, 7) > String(e.doc_date).slice(0, 7));
  console.log('   moved entries: ' + JSON.stringify(mine.map((e) => [e.event_type, e.doc_date, e.posting_date, e.narration])));
  ok(mine.length >= 2 && mine.every((e) => /October locked$/.test(e.narration || '')), 'every moved entry says "October locked", a payment line included (' + mine.length + ')');
  const pay = mine.find((e) => /payment/.test(e.event_type));
  ok(!!pay && /October locked$/.test(pay.narration), 'the receipt (event ' + (pay && pay.event_type) + ') carries the note: "' + (pay && pay.narration) + '"');
  const led = (await api('GET', '/api/books/ledger/' + bank.code + '?from=2026-04-01&to=2027-06-30')).body;
  const lines = led.lines || [];
  const recLine = lines.find((x) => pay && x.entry_no === pay.entry_no), feeLine = lines.find((x) => x.entry_no === fee.body.entry_no);
  console.log('   ledger lines ' + lines.length + ' · receipt line ' + JSON.stringify(recLine && { what: recLine.what, other: recLine.other, party_name: recLine.party_name }) + ' · fee line ' + JSON.stringify(feeLine && { what: feeLine.what, other: feeLine.other, party_name: feeLine.party_name }));
  ok(recLine && recLine.other && recLine.party_name === cust.display_name, 'the receipt line says its other side (' + (recLine && recLine.other && recLine.other.name) + ') and the customer by name (' + (recLine && recLine.party_name) + ')');
  ok(feeLine && feeLine.other && feeLine.other.code && feeLine.party_name === null, 'the fee line says its expense ledger (' + (feeLine && feeLine.other && feeLine.other.name) + ') and no party');
  const odd = lines.find((x) => x.other && x.other.code == null);
  if (odd) { const en = (await api('GET', '/api/books/daybook?from=' + odd.date + '&to=' + odd.date + '&limit=300')).body.entries.find((e) => e.entry_no === odd.entry_no); console.log('   a Split line: ' + odd.what + ' ' + JSON.stringify(odd.other) + ' entry lines ' + JSON.stringify(((en && en.lines) || []).map((l) => [l.code, l.name, l.dr_minor, l.cr_minor, l.rate]))); }
  ok(!odd, 'a bill with its tax line reads as ONE other ledger, never Split (' + (odd ? odd.what + ' ' + JSON.stringify(odd.other) : 'no Split line') + ')');
  const b = await chromium.launch();
  for (const vp of [{ width: 1366, height: 768, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
    const { ctx, page: p } = await L.open(b, base, token, vp, undefined, '/accounts.html#ledgers', '[data-testid="lg-acc-' + bank.code + '"]');
    await p.waitForTimeout(1500);
    if (!(await p.locator('[data-testid^="stmt-amt-"]').count())) await p.click('[data-testid="lg-acc-' + bank.code + '"]');
    await p.waitForSelector('[data-testid^="stmt-amt-"]', { timeout: 20000 });
    await p.waitForTimeout(1500);
    const texts = await p.$$eval('[data-testid^="stmt-amt-"]', (els) => els.map((e) => { let n = e; for (let i = 0; i < 6 && n && !/^(TR|LI)$/.test(n.tagName) && !(n.getAttribute && /row/.test(n.getAttribute('role') || '')); i++) n = n.parentElement; return (n || e).innerText.replace(/\s+/g, ' ').trim(); }));
    console.log('   ' + vp.tag + ' rows: ' + JSON.stringify(texts.filter((t) => /Coogee|charge|Customers|Split/i.test(t)).slice(0, 6)));
    ok(texts.some((t) => /·/.test(t) && /Coogee/.test(t)), vp.tag + ': Details reads "<ledger> · <customer>" on the receipt line');
    const g = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(g.sw <= g.iw, vp.tag + ': nothing scrolls sideways (' + JSON.stringify(g) + ')');
    await p.screenshot({ path: path.join(OUT, 'bf-ledger-details-' + vp.tag + '.png') });
    await ctx.close();
  }
  await b.close();
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
