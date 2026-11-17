/* needsyou-live.cjs — l16-needsyou · W15-113..117 against a REAL api (a SIT box's throwaway api, e2e/lib/live-harbour.cjs, seed ny-seed9: 300 customers with names, 60 suppliers whose bills claim GST with no tax invoice, 8 years).
 * Proves: a party row shows its NAME · the Needs column and the header line · the ⚑ Needs you toggle is FIRST in the toolbar, its number is the server's and equals the rows it leaves · Next › steps · the party's Needs you / Open / All tabs
 * (server counts, why + ONE action, clean bills folded) · a phone shows each bill as a 2-line card and the age chips two to a row · Attach on a held bill offers "Release the hold?" · the Day book's ⚑ count is the /attention count.
 * Shots 1366x768 and 390x844 into $OUT. env: API, OUT, HANDLE (harbour-plumbing-au), TOKEN. Never production. */
'use strict';
const { chromium } = require('@playwright/test'), fs = require('fs'), path = require('path');
const L = require('./lib/live-harbour.cjs');
const OUT = process.env.OUT || 'e2e/shots';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const num = (s) => Number(String(s || '').replace(/[^0-9]/g, ''));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (process.env.TOKEN) fs.writeFileSync(path.join(OUT, 'token.json'), JSON.stringify({ token: process.env.TOKEN }));
  const { base } = await L.serve(), token = await L.signIn(process.env.HANDLE || 'harbour-plumbing-au');
  const get = async (p) => (await L.call('GET', p, token)).body;
  let dues = await get('/api/books/dues');
  let serverCust = dues.needs.customer, serverSup = dues.needs.supplier;
  ok(serverCust && serverCust.parties > 0 && serverSup && serverSup.parties > 0 && serverSup.no_tax_invoice > 0, 'the server counts who needs you: customers ' + (serverCust && serverCust.parties) + ' · suppliers ' + (serverSup && serverSup.parties) + ' (' + (serverSup && serverSup.no_tax_invoice) + ' tax invoices missing)');
  const jones = (dues.parties || []).find((x) => /Jones Plumbing/.test(x.name || ''));
  ok(!!jones && jones.needs && jones.needs.no_tax_invoice > 0, 'Jones Plumbing Supplies (a real chit bill) carries a tax invoice missing: ' + JSON.stringify(jones && jones.needs));
  /* a hold on one of Jones' bills (the auditor's mark), so the Attach path has a hold to offer to release */
  const jb = jones ? await get('/api/books/party/' + jones.party_id + '/bills?side=supplier&tab=needs') : { bills: [] };
  const target = (jb.bills || []).find((x) => x.chit_id && x.entry_id && x.reasons.includes('no_tax_invoice') && x.mark && x.mark.class === 'hold');
  ok(!!target, 'Jones has a bill with a chit, no tax invoice, and the auditor\'s hold (put in by the rig): ' + (target && target.bill_no));
  /* a walk-in day entry (seeded WD-1: it covers a counter bill, no chit of its own) is SOURCED: not "no source", but "no file" */
  const wd = async (kind) => ((await get('/api/books/attention?from=2000-01-01&to=2099-12-31&kind=' + kind + '&limit=100')).entries || []).some((e) => e.entry_no === 'WD-1');
  ok(!(await wd('nodoc')) && (await wd('none')), 'a walk-in day entry is not counted "no source"; it is "no file" (it has a source: the counter bills it covers)');
  const b = await chromium.launch();
  for (const vp of [{ width: 1366, height: 768, tag: '1366' }, { width: 390, height: 844, tag: '390' }]) {
    dues = await get('/api/books/dues'); serverCust = dues.needs.customer; serverSup = dues.needs.supplier;
    const { ctx, page: p } = await L.open(b, base, token, vp, undefined, '/accounts.html#receivables', 'body');
    const shot = async (name) => { await p.screenshot({ path: path.join(OUT, name + '-' + vp.tag + '.png') }); };
    const fit = async (name) => { const s = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth })); ok(s.sw <= s.iw + 1, name + ' ' + vp.tag + ': no sideways page scroll (' + s.sw + '/' + s.iw + ')'); };
    const toolbarFirst = async (name) => p.evaluate(() => { const t = document.querySelector('.cbl-tools'); if (!t) return 'no toolbar'; const first = t.firstElementChild; return first && first.hasAttribute('data-cbl-needs') ? 'first' : 'first is ' + (first && (first.className || first.tagName)); });

    /* ── Receivables ── */
    await p.waitForSelector('.cbl-row', { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(1500);
    await shot('recv-list');
    const names = await p.locator('.cbl-row[aria-expanded] .cbl-cell').first().innerText().catch(() => '');
    const firstRowText = flat(await p.locator('.cbl-row[aria-expanded]').first().innerText().catch(() => ''));
    ok(/(Harbour|Northside|Westgate|Coastal|Summit|Ridge|Bayview|Granite) .*Pty Ltd/.test(firstRowText) && /C-\d{5}/.test(firstRowText), 'Receivables ' + vp.tag + ': a party row shows its NUMBER AND NAME — "' + firstRowText.slice(0, 60) + '"');
    ok((await toolbarFirst()) === 'first', 'Receivables ' + vp.tag + ': the ⚑ Needs you toggle is FIRST in the toolbar (' + (await toolbarFirst()) + ')');
    const toggle = p.locator('[data-cbl-needs]').first();
    const label = flat(await toggle.innerText());
    ok(num(label) === serverCust.parties && /Needs you/.test(label), 'Receivables ' + vp.tag + ': the toggle says the SERVER count — "' + label + '" (api: ' + serverCust.parties + ')');
    ok((await toggle.getAttribute('aria-pressed')) === 'false', 'the toggle is aria-pressed false until pressed');
    const head = flat(await p.locator('[data-testid="needs-head"]').innerText().catch(() => ''));
    ok(new RegExp(serverCust.parties + ' customers need you').test(head), 'the header line says it: "' + head + '"');
    ok(/\d+ (overdue|no terms)/.test(await p.locator('.bk-needs').first().innerText().catch(() => '')) || (await p.locator('.bk-needs .bk-need').count()) > 0, 'a party row carries its Needs chips');
    /* the toggle: the rows left are the server's count */
    await toggle.click(); await p.waitForTimeout(700);
    ok((await toggle.getAttribute('aria-pressed')) === 'true', 'pressed: aria-pressed true');
    const shown = num((await p.locator('.cbl-count').first().innerText()).split(' ')[0]);
    ok(shown === serverCust.parties, 'with ⚑ on, the list holds exactly the server count: ' + shown + ' = ' + serverCust.parties);
    const prog0 = flat(await p.locator('.cbl-needs-prog').innerText());
    ok(new RegExp('^0 of ' + serverCust.parties + ' done$').test(prog0), 'the stepper says "' + prog0 + '"');
    await shot('recv-needs-on');
    /* keyboard: the toggle and Next › by keys alone */
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) { await p.keyboard.press('Tab'); reached = await p.evaluate(() => !!document.activeElement && document.activeElement.hasAttribute('data-cbl-needs-next')); }
    ok(reached, 'keyboard: Tab reaches Next ›');
    if (reached) { await p.keyboard.press('Enter'); await p.waitForTimeout(900); }
    const open1 = await p.locator('.cbl-row[aria-expanded="true"]').count();
    ok(open1 === 1, 'Next › by Enter opens ONE party (' + open1 + ')');
    await p.waitForSelector('[data-pb]', { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(600);
    const tabsText = flat(await p.locator('[data-pb] [data-b="tab-strip"]').first().innerText().catch(() => ''));
    ok(/Needs you \d+ Open \d+ All \d+/.test(tabsText), 'the party opens on tabs: "' + tabsText + '"');
    ok((await p.locator('[data-pb] [data-b="tab-needs"][aria-pressed="true"]').count()) === 1, 'the default tab is Needs you');
    const rowsN = await p.locator('[data-pb] .cbl-ntrow').count();
    const needsN = num(await p.locator('[data-pb] [data-b="tab-needs"] b').first().innerText());
    ok(rowsN === Math.min(25, needsN), 'Needs you lists ' + rowsN + ' bills = the server count ' + needsN + (needsN > 25 ? ' (first page of 25)' : ''));
    ok(await p.locator('[data-pb] [data-b^="need-act-"]').count() >= 1, 'each bill carries ONE action (' + (await p.locator('[data-pb] [data-b^="need-act-"]').count()) + ' buttons)');
    ok((await p.locator('[data-pb] [data-testid="bills-in-order"]').count()) >= 0, 'clean bills fold into one line');
    await p.locator('[data-pb]').first().scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(300);
    await shot('recv-needs-tab');
    if (vp.tag === '390') {
      const cardOk = await p.evaluate(() => { const w = document.querySelector('[data-pb] .bk-tabwrap'); const rows = [...document.querySelectorAll('[data-pb] .cbl-ntrow')].slice(0, 3); const wide = w && w.scrollWidth > w.clientWidth + 1; const heights = rows.map((r) => Math.round(r.getBoundingClientRect().height)); return { wide, heights }; });
      ok(!cardOk.wide, '390: the bills do not scroll sideways');
      console.log('  ..  390: Needs you rows (with their action) are ' + cardOk.heights.join('/') + ' px high');
      const dueSeen = await p.evaluate(() => { const r = document.querySelector('[data-pb] .cbl-ntrow'); if (!r) return false; const c = r.querySelector('[data-ln="2"]'); if (!c) return false; const b = c.getBoundingClientRect(), wb = document.documentElement.clientWidth; return b.right <= wb + 1 && b.left >= 0; });
      ok(dueSeen, '390: the Due date is on screen, not clipped');
    }
    /* Open / All tabs */
    await p.locator('[data-pb] [data-b="tab-open"]').click(); await p.waitForTimeout(1200);
    const bandRows = await p.evaluate(() => { const strip = document.querySelector('[data-pb] .bk-bands'); if (!strip) return -1; const kids = [...strip.querySelectorAll('.bk-band')]; return new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top))).size; });
    ok(vp.tag === '1366' ? bandRows >= 0 : bandRows > 0 && bandRows <= 3, vp.tag + ': the ' + (await p.locator('[data-pb] .bk-band').count()) + ' age chips sit in ' + bandRows + ' row(s)' + (vp.tag === '390' ? ' (not one a line)' : ''));
    await p.locator('[data-pb]').first().scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(300);
    if (vp.tag === '390') { const hs = await p.evaluate(() => [...document.querySelectorAll('[data-pb] .cbl-ntrow')].filter((r) => !r.querySelector('[data-b^="need-act-"]')).slice(0, 4).map((r) => Math.round(r.getBoundingClientRect().height))); ok(hs.length > 0 && hs.every((h) => h <= 70), '390: a bill without an action is a 2-line card (heights ' + hs.join('/') + ' px)'); }
    await shot('recv-open');
    await p.locator('[data-pb] [data-b="tab-all"]').click(); await p.waitForTimeout(1200);
    ok((await p.locator('[data-pb] [data-b="paid-filter"]').count()) === 1, 'All carries Paid as a filter inside it');
    await p.locator('[data-pb]').first().scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(300);
    await shot('recv-all');
    await fit('receivables');

    /* ── Payables: the tax invoice, the hold, Attach, Release ── */
    await p.goto(base + '/accounts.html#payables'); await p.waitForSelector('.cbl-row', { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(1500);
    const phead = flat(await p.locator('[data-testid="needs-head"]').innerText().catch(() => ''));
    ok(new RegExp(serverSup.parties + ' suppliers need you').test(phead) && new RegExp(serverSup.no_tax_invoice + ' no tax invoice').test(phead), 'Payables header line: "' + phead + '"');
    ok((await toolbarFirst()) === 'first', 'Payables ' + vp.tag + ': ⚑ first in the toolbar');
    const ptoggle = p.locator('[data-cbl-needs]').first();
    ok(num(await ptoggle.innerText()) === serverSup.parties, 'Payables toggle = the server count ' + serverSup.parties);
    await shot('pay-list');
    if (vp.tag === '1366' && target) {
      await ptoggle.click(); await p.waitForTimeout(600);
      await p.fill('input[data-cbl-q]', 'Jones'); await p.waitForTimeout(600);
      await p.locator('.cbl-row[aria-expanded]').first().click();
      await p.waitForSelector('[data-pb]', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(900);
      const heldChip = await p.locator('[data-pb] [data-b="mark-hold"]').first().innerText().catch(() => '');
      ok(/On hold · no tax invoice/.test(heldChip), 'the held bill says it ONCE: "' + flat(heldChip) + '"');
      await shot('pay-held');
      const attach = p.locator('[data-testid="bill-act-' + target.ref + '"]');
      ok(/Attach/.test(await attach.innerText().catch(() => '')), 'its one action is Attach');
      const [chooser] = await Promise.all([p.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null), attach.click()]);
      ok(!!chooser, 'Attach opens the file picker');
      if (chooser) {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        await chooser.setFiles({ name: 'tax-invoice.png', mimeType: 'image/png', buffer: png });
        await p.waitForFunction(() => /Ask them to release it/.test(document.body.innerText) || !!document.querySelector('[data-testid="release-body"]'), null, { timeout: 25000 }).catch(() => {});
        const said = (flat(await p.evaluate(() => document.body.innerText).catch(() => '')).match(/Held by [^.]*. Ask them to release it./) || [''])[0];
        ok((/^Held by .+. Ask them to release it.$/.test(said) && !/attached/.test(said)) || (await p.locator('[data-testid="release-body"]').count()) === 1, 'after the file is attached the page does not offer a button the owner would be refused: "' + said.slice(0, 90) + '"');
        await shot('pay-after-attach');
        const after = await get('/api/books/party/' + jones.party_id + '/bills?side=supplier&tab=open');
        const row = (after.bills || []).find((x) => x.ref === target.ref);
        ok(row && !row.reasons.includes('no_tax_invoice'), 'afterwards the bill has its tax invoice (server: reasons ' + JSON.stringify(row && row.reasons) + '; the auditor\'s hold is theirs to lift)');
        await shot('pay-after');
      }
    }
    await fit('payables');

    /* ── Day book: ⚑ is the /attention count ── */
    await p.goto(base + '/accounts.html#daybook'); await p.waitForSelector('[data-testid="attn-strip"]', { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(2500);
    const from = await p.locator('#bk_attn_db').getAttribute('data-from'), to = await p.locator('#bk_attn_db').getAttribute('data-to');
    const att = await get('/api/books/attention?from=' + from + '&to=' + to);
    ok(typeof att.needs === 'number', 'the Day book strip asks the server: needs = ' + att.needs + ' (' + att.no_tax_invoice + ' tax invoices + ' + att.open_queries + ' queries)');
    ok((await toolbarFirst()) === 'first', 'Day book ' + vp.tag + ': ⚑ first in the toolbar');
    const dtoggle = p.locator('[data-cbl-needs]').first();
    const dlabel = flat(await dtoggle.innerText());
    ok(att.needs === 0 ? /All clear/.test(dlabel) : num(dlabel) === att.needs, 'the toggle shows the server count — "' + dlabel + '"');
    await shot('daybook-needs');
    if (att.needs > 0) {
      await dtoggle.click(); await p.waitForTimeout(800);
      const n = num((await p.locator('.cbl-count').first().innerText()).split(' ')[0]);
      ok(n === att.needs, 'with ⚑ on the Day book holds exactly ' + n + ' = ' + att.needs + ' entries');
      await shot('daybook-needs-on');
    }
    await fit('daybook');
    await ctx.close();
  }
  await b.close();
  console.log('\n  ' + pass + ' ok, ' + fail + ' XX');
  process.exit(fail ? 1 : 0);
})();
