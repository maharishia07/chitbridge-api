'use strict';
/**
 * e2e/walk-country-profiles.cjs — THE COUNTRY LAB'S "COUNTRIES" VIEW (R6, 2026-10-16; RUNBOOK-ADD-A-COUNTRY Q11).
 * Athi: "left side panel, country name and right side all the attributes, documents, filling, govt norms" · "there should not be any leakage of
 * other country details". For EVERY registered country (read from the page's own engines — the walk lists none itself):
 *   P1 · the list holds every pack; picking one paints its head and the nine cards
 *   P2 · nothing of another country shows: no other pack's currency code or tax-ID word in the cards
 *   P3 · the tax-ID box refuses "x" with the pack's own check — or says it is checked on save
 *   P4 · rule 13: cream and dark, 1366 and 390 px — AA contrast, no sideways scroll, the phone picker's name fits
 *   P5 · the Books card: a country whose books build its return shows the filled boxes, the due date and Pay/Refund; the statements balance; India says its return is read from the invoices
 *   P7 · every counted / named cell opens what it counts (chart · filled return · statements · a sample invoice · supply kinds)
 *   P6 · All countries: one table, a row per rule (CBCountries.rulesTable), a column per country; on a phone one country as two columns
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-country-profiles.cjs [--show]
 */
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const theme = async (page, key) => { await page.evaluate((k) => { CBAvatar.applyTheme(k); }, key); await page.waitForTimeout(120); };
const contrast = async (page) => { const pairs = await page.evaluate(measure); return { n: pairs.length, bad: pairs.filter((x) => !x.grad && x.ratio < x.need) }; };
const CARDS = ['books', 'money', 'tax', 'taxid', 'documents', 'filing', 'rules', 'locale', 'payments', 'gaps'];

const walk = async (w) => {
  const { page, base } = w;
  await page.goto(base + '/country-lab.html'); await page.waitForSelector('[data-testid="cp-side"]', { timeout: 15000 });
  /* the countries and the words that belong to each, from the page's engines (CBRegulation · CBCountries) */
  const all = await page.evaluate(() => CBRegulation.list().map((p) => ({ id: p.id, cur: p.currency, word: CBCountries.taxId(p).word, hint: CBCountries.taxId(p).hint, check: !!CBCountries.taxId(p).check })));

  await w.step('P1', 'the list holds every registered country; each paints its head and the ten cards', async () => {
    const listed = await page.$$eval('[data-testid^="cp-pick-"]', (b) => b.map((x) => x.dataset.cc)), miss = [];
    for (const c of all) {
      await page.click('[data-testid="cp-pick-' + c.id + '"]'); await page.waitForTimeout(150);
      const head = await page.locator('[data-testid="cp-head"]').innerText(), cards = await page.$$eval('.cp-card', (x) => x.map((y) => y.dataset.testid.replace('cp-', '')));
      if (!head.includes(c.id) || CARDS.some((k) => !cards.includes(k))) miss.push(c.id);
    }
    return { ok: listed.join() === all.map((c) => c.id).join() && !miss.length, saw: listed.join(' · ') + (miss.length ? ' · incomplete ' + miss.join(',') : ' · 10 cards each') };
  });
  await w.step('P2', 'no leak: a country\'s cards never show another pack\'s currency code or tax-ID word', async () => {
    const leaks = [];
    for (const c of all) {
      await page.click('[data-testid="cp-pick-' + c.id + '"]'); await page.waitForTimeout(120);
      const txt = await page.locator('[data-testid="cp-main"]').innerText();
      all.filter((o) => o.id !== c.id).forEach((o) => {
        if (o.cur !== c.cur && new RegExp('\\b' + o.cur + '\\b').test(txt)) leaks.push(c.id + '→' + o.cur);
        if (o.word && o.word !== c.word && o.word.length > 2 && new RegExp('\\b' + o.word.replace(/[^\w]/g, '.') + '\\b').test(txt)) leaks.push(c.id + '→' + o.word);
      });
    }
    return { ok: !leaks.length, saw: leaks.length ? 'LEAK ' + leaks.join(' · ') : all.length + ' countries clean' };
  });
  await w.step('P3', 'the tax-ID box refuses "x" with the pack\'s own check (or says "checked on save" where the pack carries no check)', async () => {
    const out = [];
    for (const c of all) {
      await page.click('[data-testid="cp-pick-' + c.id + '"]'); await page.waitForTimeout(100);
      if (!c.check) { out.push(c.id + ' on save ' + /checked on save/.test(await page.locator('[data-testid="cp-idverdict"]').innerText())); continue; }
      await page.fill('[data-testid="cp-idbox"]', 'x'); const bad = await page.locator('[data-testid="cp-idverdict"]').innerText();
      out.push(c.id + ' x→' + (/✕/.test(bad) ? 'refused' : 'PASSED?'));
    }
    return { ok: out.every((s) => /refused|on save true/.test(s)), saw: out.join(' · ') };
  });
  await w.step('P5', 'the Books card: the filled return (boxes, due, pay or refund) where the books build it; the sample statements balance; India names its rail return', async () => {
    const out = [];
    for (const c of all) {
      await page.click('[data-testid="cp-pick-' + c.id + '"]'); await page.waitForSelector('[data-testid="cp-books"]', { timeout: 8000 }); await page.waitForTimeout(150);
      const card = await page.locator('[data-testid="cp-books"]').innerText(), boxes = await page.locator('[data-testid="cp-boxes"] tbody tr').count();
      const due = /Due\s+\d{4}-\d{2}-\d{2}/.test(card), settled = /(Pay|Refund)\s/.test(card), total = /Total assets = equity \+ liabilities/.test(card);
      out.push({ id: c.id, ok: total && (c.id === 'IN' ? /read from the invoices/.test(card) : boxes > 0 && due && settled), saw: c.id + ' ' + (c.id === 'IN' ? 'rail' : boxes + ' boxes') });
    }
    return { ok: out.every((x) => x.ok), saw: out.map((x) => x.saw + (x.ok ? '' : ' ✗')).join(' · ') };
  });
  await w.step('P6', 'All countries: a row per rule, a column per country (the rules table) — the currency symbol row among them', async () => {
    await page.goto(base + '/country-lab.html?view=all#/all'); await page.waitForSelector('[data-testid="cp-all-table"]', { timeout: 15000 });
    const cols = await page.$$eval('[data-testid="cp-all-table"] thead th', (t) => t.length - 1), rows = await page.$$eval('[data-testid="cp-all-table"] tbody tr', (t) => t.map((x) => x.dataset.rule));
    const want = await page.evaluate(() => CBCountries.rulesTable({ year: 2026 }).rules.length);
    return { ok: cols === all.length && rows.length === want && rows.includes('symbol'), saw: rows.length + ' rules × ' + cols + ' countries' };
  });
  await w.step('P6b', '(CTRY-43) the Depreciation row says the law in words, once per law - never a pack code, never "?" - and so does Asset lives, for every country', async () => {
    await page.goto(base + '/country-lab.html?view=all#/all'); await page.waitForSelector('[data-testid="cp-all-table"]', { timeout: 15000 });
    const cells = await page.$$eval('[data-testid="cp-all-table"] tbody tr[data-rule="depreciation"] td, [data-testid="cp-all-table"] tbody tr[data-rule="lives"] td', (t) => t.map((x) => x.textContent.trim()).filter(Boolean));
    const bad = cells.filter((x) => /\b(div40|it_act_wdv|schedule_ii|ias16|straight_line|sole_trader)\b|undefined|NaN|[?]/.test(x));
    return { ok: cells.length >= 14 && !bad.length && cells.some((x) => /^Capital allowances \(Division 40\) — company, sole trader, partnership, trust/.test(x)), saw: cells.length + ' cells · codes or placeholders: ' + (bad.join(' | ') || 'none') };
  });
  await w.step('P7', 'every counted or named cell opens what it counts: the chart, the filled return, the statements, a sample invoice billed live, the supply kinds — for every country', async () => {
    const out = [];
    for (const c of all) for (const k of ['chart', 'return', 'statements', 'invoice', 'kinds', 'receipt']) {
      const sel = '[data-testid="cp-open-' + k + '-' + c.id + '"]'; if (!(await page.locator(sel).count())) { out.push(c.id + ' ' + k + ' (no cell)'); continue; }
      /* it opens in the overlay, over the table — the table does not move (Athi, 2026-10-17) — and Esc closes it */
      /* the click's own scroll-into-view is not the overlay moving the table — centre the cell, clear of the frozen header row and Rule column */
      await page.locator(sel).first().evaluate((cell) => cell.scrollIntoView({ block: 'center', inline: 'center' }));
      const y0 = await page.evaluate(() => document.querySelector('[data-testid="cp-all-table"]').getBoundingClientRect().top);
      await page.click(sel); await page.waitForSelector('dialog.cp-more[open] .cp-chartslot .cp-chart', { timeout: 5000 }); const txt = await page.locator('dialog.cp-more .cp-chartslot').innerText();
      const y1 = await page.evaluate(() => document.querySelector('[data-testid="cp-all-table"]').getBoundingClientRect().top);
      /* the overlay's title bar is frozen: scrolled to its end, the title is still at its top (Athi, 2026-10-17: "header has to freeze … always the rule") */
      const frozen = await page.evaluate(() => { const d = document.querySelector('dialog.cp-more'), h = d.querySelector('.cp-head'); d.scrollTop = d.scrollHeight; return Math.abs(h.getBoundingClientRect().top - d.getBoundingClientRect().top) <= 2; });
      await page.keyboard.press('Escape'); const shut = await page.evaluate(() => !document.querySelector('dialog.cp-more').open);
      if (txt.length < 30 || /error:/.test(txt) || Math.abs(y1 - y0) > 1 || !shut || !frozen) out.push(c.id + ' ' + k + ' ✗' + (Math.abs(y1 - y0) > 1 ? ' (table moved ' + Math.round(y1 - y0) + 'px)' : '') + (shut ? '' : ' (did not close)') + (frozen ? '' : ' (title scrolled away)'));
    }
    const bad = out.filter((x) => /✗/.test(x));
    return { ok: !bad.length, saw: (all.length * 6 - out.length) + ' panels opened' + (out.length ? ' · ' + out.join(', ') : '') };
  });
  await w.step('P8', '(CTRY-42) All countries: a tick per country chooses the columns, remembered; the last one stays; a folded cell ends in "contd" and the full text opens in a popup', async () => {
    await page.goto(base + '/country-lab.html?view=all#/all'); await page.waitForSelector('[data-testid="cp-all-table"]', { timeout: 15000 });
    await page.evaluate(() => localStorage.removeItem('cb_cl_shown')); await page.reload(); await page.waitForSelector('[data-testid="cp-show"]', { timeout: 15000 });
    const cols = () => page.$$eval('[data-testid="cp-all-table"] thead th', (t) => t.length - 1), n0 = await cols();
    await page.click('[data-testid="cp-show-AU"]'); await page.click('[data-testid="cp-show-JP"]');
    const n1 = await cols(), gone = !(await page.locator('[data-testid="cp-all-table"] thead th', { hasText: 'AU' }).count()) ;
    await page.reload(); await page.waitForSelector('[data-testid="cp-show"]', { timeout: 15000 }); const n2 = await cols();
    const ids = await page.$$eval('.cp-show-box', (b) => b.map((x) => x.dataset.show));
    for (const id of ids) { const box = page.locator('[data-testid="cp-show-' + id + '"]'); if (!(await box.isChecked())) await box.click(); }
    for (const id of ids.slice(0, -1)) { const box = page.locator('[data-testid="cp-show-' + id + '"]'); if (await box.isChecked()) await box.click(); }
    const last = page.locator('[data-testid="cp-show-' + ids[ids.length - 1] + '"]'); await last.click(); const stays = await last.isChecked(), note = await page.locator('[data-testid="cp-show-note"]').innerText();
    for (const id of ids) { const box = page.locator('[data-testid="cp-show-' + id + '"]'); if (!(await box.isChecked())) await box.click(); }
    const folded = page.locator('[data-more]').first(); const hasContd = (await folded.count()) > 0 && /contd/.test(await folded.innerText());
    let popup = false; if (hasContd) { await folded.scrollIntoViewIfNeeded(); await folded.click(); await page.waitForSelector('dialog.cp-more[open] .cp-morelist li', { timeout: 5000 }); popup = (await page.locator('dialog.cp-more .cp-morelist li').count()) > 3; await page.keyboard.press('Escape'); }
    const noMore = !(await page.locator('[data-more]', { hasText: /more$/ }).count());
    await page.evaluate(() => localStorage.removeItem('cb_cl_shown'));
    return { ok: n0 === ids.length && n1 === n0 - 2 && gone && n2 === n1 && stays && /at least one/i.test(note) && hasContd && popup && noMore, saw: n0 + ' → ' + n1 + ' columns · remembered ' + n2 + ' · last stays ' + stays + ' · contd ' + hasContd + ' → popup ' + popup };
  });
  await w.step('P9', '(CTRY-44) the Counter slip title opens a sample sales receipt per country: shop head, the lines the law needs, the pack title, number and date, tax lines, total, rounding and pay footer', async () => {
    await page.goto(base + '/country-lab.html?view=all#/all'); await page.waitForSelector('[data-testid="cp-all-table"]', { timeout: 15000 });
    const out = [];
    for (const c of all) {
      const sel = '[data-testid="cp-open-receipt-' + c.id + '"]'; await page.locator(sel).first().evaluate((cell) => cell.scrollIntoView({ block: 'center', inline: 'center' }));
      await page.click(sel); await page.waitForSelector('dialog.cp-more[open] [data-testid="cp-receipt-' + c.id + '"]', { timeout: 5000 });
      const txt = await page.locator('dialog.cp-more [data-testid="cp-receipt-' + c.id + '"]').innerText();
      const needsId = await page.evaluate((id) => CBCountries.meta(CBRegulation.get ? CBRegulation.get(id) : CBRegulation.list().find((p) => p.id === id)).invoice.requiredLines.includes('tax_id'), c.id);
      const slip = await page.evaluate((id) => CBCountries.rulesTable({ year: 2026 }).rules.find((r) => r.key === 'slip').values[id], c.id);
      const okTxt = txt.includes('Sample shop') && txt.includes(slip) && (!needsId || txt.includes(c.word || '')) && /Cash rounds to/.test(txt) && /Thank you/.test(txt) && /Item A/.test(txt) && !/NaN|undefined|₹/.test(c.id === 'IN' ? txt.replace(/₹/g, '') : txt);
      const foreign = all.filter((o) => o.id !== c.id && o.cur !== c.cur && new RegExp('\b' + o.cur + '\b').test(txt)).map((o) => o.cur);
      await page.keyboard.press('Escape'); if (!okTxt || foreign.length) out.push(c.id + ' ✗' + (foreign.length ? ' foreign ' + foreign : ''));
    }
    return { ok: !out.length, saw: (all.length - out.length) + ' receipts' + (out.length ? ' · ' + out.join(', ') : '') };
  });
  await w.step('P10', '(CTRY-48) money() with no or a malformed code never prints the rupee: the shop own country currency, else the plain amount - on the engine every screen (embed, store, cart, lab) prints through', async () => {
    await page.goto(base + '/country-lab.html'); await page.waitForSelector('[data-testid="cp-side"]', { timeout: 15000 });
    const r = await page.evaluate(() => {
      const L = CBLocale, out = {}, bad = [undefined, null, '', 'RUPEES', 'x1', {}, "INR'); DROP--"];
      const run = (region) => { L.quietly(() => L.setRegion(region)); return bad.map((c) => String(L.money(1234.5, c)).replace(/[‎‏؜ s]/g, '')); };
      out.none = run(''); out.au = run('AU'); out.ae = run('AE'); out.in = run('IN'); L.quietly(() => L.setRegion(''));
      out.good = String(L.money(1234.5, 'INR')).replace(/s/g, '');
      return out;
    });
    const rupee = [].concat(r.none, r.au, r.ae).filter((x) => /₹|INR/.test(x));
    return { ok: !rupee.length && r.none.every((x) => x === '1,234.50') && r.au.every((x) => x === 'A$1,234.50') && r.ae.every((x) => x === 'AED1,234.50') && r.in.every((x) => x === '₹1,234.50') && r.good === '₹1,234.50', saw: 'no country ' + r.none[0] + ' · AU ' + r.au[0] + ' · AE ' + r.ae[0] + ' · IN ' + r.in[0] + ' · INR given ' + r.good };
  });
  await page.goto(base + '/country-lab.html'); await page.waitForSelector('[data-testid="cp-side"]', { timeout: 15000 });
  for (const [t, wd] of [['cream', 1366], ['dark', 1366], ['cream', 390], ['dark', 390]]) {
    await w.step('P4·' + t + '·' + wd, 'rule 13 · ' + t + ' · ' + wd + ' px: AA contrast, no sideways scroll, the picker fits', async () => {
      await page.setViewportSize({ width: wd, height: 1000 }); await theme(page, t);
      const r = await contrast(page), side = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const pickFits = wd > 760 ? true : await page.evaluate(() => { const s = document.querySelector('.cp-select'); return !!s && s.scrollHeight <= s.clientHeight + 2; });
      return { ok: !r.bad.length && side <= 0 && pickFits, saw: r.n + ' texts' + (r.bad.length ? ' · LOW ' + r.bad.slice(0, 3).map((x) => x.text + ' ' + x.ratio).join(', ') : ' · AA') + ' · sideways ' + side + ' · picker fits ' + pickFits };
    });
  }
  await theme(page, 'cream'); await page.setViewportSize({ width: 1366, height: 900 });
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('country-profiles', walk);
