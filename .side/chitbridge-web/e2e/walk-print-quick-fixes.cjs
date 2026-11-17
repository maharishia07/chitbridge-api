#!/usr/bin/env node
/**
 * e2e/walk-print-quick-fixes.cjs — PRINT-1 slice 0 (walk 22 Oct, P6 · P7 · P15), on an AU stand-in. Black box: presses what an owner presses.
 *   P6   the Save button is always in view (390 and 1280 wide, nothing covering it); NOTHING is stored until Save is pressed (no autosave); Save says "Print setup saved."
 *   P7   the Logo tick is greyed with "Add a logo first" while the logo is empty; a typed logo + tick + Save survives a reload; an emptied logo is unticked, unsaved, never printed
 *   P15  a footer with doubled spaces is saved and printed with single spaces
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-print-quick-fixes.cjs [--show]
 * OWNS the slice-0 checks of public/app/cap-print.js · CALLED BY the web e2e shards (walks) · FLOW stand-in vault → Print setup → edit → Save → reload.
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const J = C.json;

const ME = { display_name: 'Austore One', gstn: '51824753556', address: '12 Pitt Street, Sydney', phone: '02 9000 0000', business_status: 'active', currency_code: 'AUD', country_code: 'AU', country: 'AU', supplies: 'both' };
const LOGO_URL = 'https://example.test/logo.png';
const SAVED_WORDS = 'Print setup saved.';

/** merge a vault merge-patch into the stand-in's vault (rows by "t:<tag>"), the way the api's writer does */
function applyPatch(vault, patch) {
  const sections = (patch && patch.sections) || {};
  Object.keys(sections).forEach((key) => {
    const type = key.split('|')[0];
    let section = vault.sections.find((s) => s.type === type);
    if (!section) { section = { type, label: '', rows: [] }; vault.sections.push(section); }
    Object.keys(sections[key].rows || {}).forEach((rowKey) => {
      const tag = rowKey.replace(/^t:/, ''), row = sections[key].rows[rowKey];
      section.rows = section.rows.filter((r) => r.tag !== tag);
      if (row) section.rows.push({ name: row.name, tag, value: row.value });
    });
  });
}

const walk = async (w) => {
  const { page, ctx, base } = w;
  const S = { version: 1001, vault: { sections: [] }, puts: [] };
  await ctx.route('**/api/**', async (r) => {
    const q = r.request(), p = new URL(q.url()).pathname, m = q.method();
    let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) { /* a stand-in reads what it can */ }
    if (p === '/api/entities/me') return J(r, 200, { entity: ME });
    if (p === '/api/governance/profile' && m === 'GET') return J(r, 200, { vault: S.vault, vault_version: String(S.version), vault_encrypted: true });
    if (p === '/api/governance/profile/vault' && m === 'PUT') {
      S.puts.push(body); applyPatch(S.vault, body.patch); S.version += 1;
      return J(r, 200, { vault: S.vault, version: String(S.version) });
    }
    return J(r, 200, {});
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) { /* no storage: the page tells */ } }, W.session('Fixture Owner', 'Austore One'));

  const rowOf = (put, tag) => (((put.patch.sections['signature|'] || {}).rows || {})['t:' + tag] || {}).value;
  const go = async () => { await page.goto(base + '/settings.html?cc=AU&t=' + Date.now() + '#/print'); await page.waitForSelector('[data-testid="pr-editor"]', { timeout: 20000 }); await page.waitForTimeout(700); }; // clock-ok: cache-buster suffix on the URL
  const slipText = async () => {
    const f = page.frames().find((x) => /bill-print\.html/.test(x.url()));
    return f ? (await f.locator('#slip').innerText().catch(() => '')).replace(/\s+/g, ' ') : '';
  };
  /** is the Save button wholly inside the window, and is it the thing at its own centre (nothing floats over it)? */
  const saveInView = () => page.evaluate(() => {
    const button = document.querySelector('[data-testid="pr-save"]');
    if (!button) return { ok: false, saw: 'no Save button' };
    const box = button.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y), visible = getComputedStyle(button).display !== 'none' && !button.hidden;
    const inside = box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth;
    return { ok: visible && inside && (top === button || button.contains(top)), saw: 'top ' + Math.round(box.top) + ' bottom ' + Math.round(box.bottom) + ' of ' + window.innerHeight + ' · covered by ' + (top && top !== button ? (top.getAttribute('data-testid') || top.tagName) : 'nothing') };
  });

  await go();
  for (const [id, width, height] of [['Q1', 1280, 800], ['Q2', 390, 780]]) {
    await w.step(id, 'P6 · ' + width + ' wide: the Save button is in view on opening, and still in view after scrolling to the bottom of the page', async () => {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(300);
      const first = await saveInView();
      await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); document.querySelectorAll('*').forEach((n) => { if (n.scrollHeight > n.clientHeight + 40 && getComputedStyle(n).overflowY !== 'visible') n.scrollTop = n.scrollHeight; }); });
      await page.waitForTimeout(250);
      const last = await saveInView();
      return { ok: first.ok && last.ok, saw: 'opening: ' + first.saw + ' | scrolled: ' + last.saw };
    });
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  await w.step('Q3', 'P6 · a change is NOT stored by itself: no PUT after a pause; Save sends one PUT and says "' + SAVED_WORDS + '"', async () => {
    await page.fill('[data-testid="pr-in-footer"]', 'Thanks'); await page.selectOption('[data-testid="pr-paper"]', '58');
    await page.waitForTimeout(1600);
    const before = S.puts.length;
    await page.click('[data-testid="pr-save"]'); await page.waitForTimeout(900);
    const said = await page.locator('body').innerText();
    return { ok: before === 0 && S.puts.length === 1 && said.includes(SAVED_WORDS), saw: 'PUTs before Save ' + before + ' · after ' + S.puts.length + ' · confirm shown ' + said.includes(SAVED_WORDS) };
  });

  await w.step('Q4', 'P7 · no logo yet: the Logo tick is greyed and unticked, "Add a logo first" beside it; typing a logo wakes it, clearing it greys it again', async () => {
    const tick = page.locator('[data-testid="pr-show-logo"]'), hint = page.locator('[data-testid="pr-logo-hint"]');
    const off = (await tick.isDisabled()) && !(await tick.isChecked()) && (await hint.isVisible()) && /Add a logo first/.test(await hint.innerText());
    await page.fill('[data-testid="pr-in-logo"]', LOGO_URL);
    const woke = !(await tick.isDisabled()) && !(await hint.isVisible());
    await page.fill('[data-testid="pr-in-logo"]', '');
    const greyAgain = (await tick.isDisabled()) && (await hint.isVisible());
    return { ok: off && woke && greyAgain, saw: 'empty: greyed+hint ' + off + ' · typed: awake ' + woke + ' · cleared: greyed again ' + greyAgain };
  });

  await w.step('Q5', 'P7 · a typed logo + its tick + Save survives a reload (the tick is ticked and awake, the logo is the head of the sample)', async () => {
    await page.fill('[data-testid="pr-in-logo"]', LOGO_URL); await page.check('[data-testid="pr-show-logo"]');
    await page.click('[data-testid="pr-save"]'); await page.waitForTimeout(800);
    const put = S.puts[S.puts.length - 1];
    await go();
    const tick = page.locator('[data-testid="pr-show-logo"]');
    return { ok: rowOf(put, 'logo') === LOGO_URL && /logo/.test(rowOf(put, 'order')) && (await tick.isChecked()) && !(await tick.isDisabled()) && (await page.inputValue('[data-testid="pr-in-logo"]')) === LOGO_URL, saw: 'saved logo "' + rowOf(put, 'logo') + '" · order "' + rowOf(put, 'order') + '" · after reload ticked ' + (await tick.isChecked()) };
  });

  await w.step('Q6', 'P7 · the logo emptied then Save: the saved order drops the logo, a reload shows the tick greyed and unticked, nothing of a logo prints', async () => {
    await page.fill('[data-testid="pr-in-logo"]', '');
    await page.click('[data-testid="pr-save"]'); await page.waitForTimeout(800);
    const put = S.puts[S.puts.length - 1];
    await go(); await page.waitForTimeout(500);
    const tick = page.locator('[data-testid="pr-show-logo"]'), slip = page.frames().find((x) => /bill-print\.html/.test(x.url()));
    const logoOnPaper = slip ? await slip.locator('img, [data-testid="slip-head-logo"]').count() : -1;
    return { ok: !/logo/.test(rowOf(put, 'order')) && (await tick.isDisabled()) && !(await tick.isChecked()) && logoOnPaper === 0, saw: 'order "' + rowOf(put, 'order') + '" · greyed ' + (await tick.isDisabled()) + ' · logo on paper ' + logoOnPaper };
  });

  await w.step('Q7', 'P7 · a vault saved earlier with the logo ticked but empty is opened: the tick shows unticked and greyed', async () => {
    const sig = S.vault.sections.find((s) => s.type === 'signature');
    sig.rows = sig.rows.filter((r) => r.tag !== 'order').concat([{ name: 'Order', tag: 'order', value: 'logo,trade_name,address,tax_id' }]);
    await go();
    const tick = page.locator('[data-testid="pr-show-logo"]');
    return { ok: (await tick.isDisabled()) && !(await tick.isChecked()), saw: 'greyed ' + (await tick.isDisabled()) + ' · ticked ' + (await tick.isChecked()) };
  });

  await w.step('Q8', 'P15 · a footer typed with doubled spaces is saved with single spaces and printed with single spaces', async () => {
    if (!(await page.locator('[data-testid="pr-show-footer"]').isChecked())) await page.check('[data-testid="pr-show-footer"]');
    await page.fill('[data-testid="pr-in-footer"]', 'Thank You  &   Visit  Again'); await page.waitForTimeout(500);
    const onPaper = await slipText();
    await page.click('[data-testid="pr-save"]'); await page.waitForTimeout(800);
    const put = S.puts[S.puts.length - 1];
    return { ok: rowOf(put, 'footer') === 'Thank You & Visit Again' && /Thank You & Visit Again/.test(onPaper) && !/Thank You {2}/.test(onPaper), saw: 'saved "' + rowOf(put, 'footer') + '" · paper has "' + (onPaper.match(/Thank You.{0,22}/) || [''])[0] + '"' };
  });

  await w.step('Q9', 'P15 · a footer saved earlier with doubled spaces opens single-spaced', async () => {
    const sig = S.vault.sections.find((s) => s.type === 'signature');
    sig.rows.find((r) => r.tag === 'footer').value = 'Come  again   soon';
    await go();
    const shown = await page.inputValue('[data-testid="pr-in-footer"]');
    return { ok: shown === 'Come again soon', saw: '"' + shown + '"' };
  });
};
walk.opts = { viewport: { width: 1280, height: 800 } };
W.run('print-quick-fixes', walk);
