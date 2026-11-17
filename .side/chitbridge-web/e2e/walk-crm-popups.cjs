#!/usr/bin/env node
/**
 * e2e/walk-crm-popups.cjs - the 12 CRM popups open through the one library popup (ui.dialog, CMP002) and behave like one (UX-137 popups, web-popups-1).
 *
 * OWNS      one real check per popup of crm.html (the order is the register's POP095..POP106): it opens from a focused opener; the header is the library's
 *           (data-cbsid CMP002-D01) and carries the popup's own register code (data-pop + the chip); focus is inside; Tab and Shift+Tab never leave it;
 *           Escape closes it; focus is back on the opener; every text block is inside the text budget (140 characters, 2 sentences).
 *           Not a keyword check: each popup is opened by its real function with the page's own state, and read back from the live DOM.
 * CALLED BY by hand and the QA gate: NODE_PATH=<playwright> node e2e/walk-crm-popups.cjs      (--show to watch)
 * FLOW      serve this checkout -> stand-in api inside the page -> crm.html#/leads -> for each popup: focus an opener, call the opener, press keys, read the DOM
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const crmApi = require('./lib/crm-api.cjs');
const J = C.json;

/** [id, register code, the page function that opens it, the statement run in the page that opens it, the testid of the body] */
const POPUPS = [
  ['P01', 'POP095', 'crmAddOpen', "crmAddOpen('')", 'crm-add-sheet'],
  ['P02', 'POP096', 'crmCallPick', "crmCallPick({ party_name: 'Asha Stores' }, { ask: true, key: Object.keys(CALL_WORD)[0], presets: ['today', 'tomorrow'] })", 'crm-call-ask'],
  ['P03', 'POP097', 'crmFuAddOpen', 'crmFuAddOpen(null, null, null)', 'crm-fu-sheet'],
  ['P04', 'POP098', 'crmGroupOpen', "crmGroupOpen('')", 'crm-grp-sheet'],
  ['P05', 'POP099', 'crmImportOpen', 'crmImportOpen()', 'crm-import-sheet'],
  ['P06', 'POP100', 'crmLeadAddOpen', 'crmLeadAddOpen()', 'crm-lead-sheet'],
  ['P07', 'POP101', 'crmLogOpen', "crmLogOpen({ party_id: 'p-1', display_name: 'Asha Stores' })", 'crm-log-sheet'],
  ['P08', 'POP102', 'crmPrivAnswerOpen', "PRV.rows = [{ request_id: 'r-1', who: 'Asha', kind: 'access', due_at: '2026-12-01' }]; PRV.mayAnswer = true; crmPrivAnswerOpen('r-1')", 'crm-prv-answer-sheet'],
  ['P09', 'POP103', 'crmPrivReqOpen', 'crmPrivReqOpen()', 'crm-prv-sheet'],
  ['P10', 'POP104', 'crmSendOpen', "crmSendOpen({ name: 'Regulars', count: 3 }, null)", 'crm-send-sheet'],
  ['P11', 'POP105', 'crmShareGroup', "GROUPS.loaded = true; GROUPS.rows = [{ key: 'g-1', name: 'Regulars', count: 3 }]; crmShareGroup()", 'crm-sc-groups'],
  ['P12', 'POP106', 'crmStageOpen', "crmStageOpen({ lead: { stage: 'lead', moves: ['demo', 'trial'] } }, null)", 'crm-stage-sheet']
];

async function route(r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
  if (p === '/api/crm/followups' && m === 'GET') return J(r, 200, Object.assign(crmApi.followups([]), { may: crmApi.mayOf(r) }));
  if (p === '/api/crm/parties' && m === 'GET') return J(r, 200, crmApi.listPage([], { leads_migrated: true }));
  return J(r, 404, { error: 'not found' });
}

/** run in the page: the facts of the open sheet that the checks read */
const READ = (testid) => {
  const sheet = document.getElementById('crm_sheet'), head = sheet && sheet.querySelector('.mhd'), active = document.activeElement;
  const blocks = [...(sheet ? sheet.querySelectorAll('p,.hint,.sub,.t,label,.kv,button') : [])].filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const over = blocks.filter((t) => t.length > 140 || (t.match(/[.!?](\s|$)/g) || []).length > 2);
  return {
    open: !!(sheet && sheet.open), body: !!(sheet && sheet.querySelector('[data-testid="' + testid + '"]')),
    lib: !!(head && head.getAttribute('data-cbsid') === 'CMP002-D01'), pop: head ? head.getAttribute('data-pop') : null,
    chip: head && head.querySelector('[data-testid="popup-code"]') ? head.querySelector('[data-testid="popup-code"]').textContent : null,
    inside: !!(sheet && active && sheet.contains(active)), outside: active && !(sheet && sheet.contains(active)) ? active.tagName + (active.id ? '#' + active.id : '') : null, onOpener: !!(active && active.id === 'walk-opener'), over: over.map((t) => t.length + ' chars: ' + t.slice(0, 40)), blocks: blocks.length
  };
};

W.run('crm-popups', async (w) => {
  const { page, ctx, base } = w;
  await ctx.route('**/api/**', (r) => route(C.wrap(r)));
  await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', s); } } catch (_) {} }, W.session('Walk Owner', 'Fixture Shop'));
  await page.goto(base + '/crm.html#/leads');
  await page.waitForSelector('[data-testid="crm-leads"]', { timeout: 15000 });
  await page.waitForTimeout(500);

  for (const [id, code, fn, call, testid] of POPUPS) {
    await page.evaluate(() => { try { closeModal(); } catch (_) {} const old = document.getElementById('walk-opener'); if (old) old.remove(); const b = document.createElement('button'); b.id = 'walk-opener'; b.textContent = 'opener'; document.body.appendChild(b); b.focus(); });
    await w.step(id, code + ' ' + fn + ' -> opens through the library popup, carries its code, focus goes in', async () => {
      await page.evaluate((c) => { (0, eval)(c); }, call);
      await page.waitForTimeout(250);
      const s = await page.evaluate(READ, testid);
      return { ok: s.open && s.body && s.lib && s.pop === code && s.chip === code && s.inside, saw: JSON.stringify({ open: s.open, body: s.body, library: s.lib, pop: s.pop, chip: s.chip, focusInside: s.inside }) };
    });
    await w.step(id + 'k', fn + ' -> Tab and Shift+Tab stay inside', async () => {
      const left = []; let chrome = 0; /* a Tab past the last control of a native modal dialog lands on BODY = the browser's own chrome, not a leak (toolset/web-done.cjs, 11 Nov measure); any other element outside is a leak */
      for (let i = 0; i < 14; i++) { await page.keyboard.press(i < 10 ? 'Tab' : 'Shift+Tab'); const s = await page.evaluate(READ, testid); if (!s.inside) { if (s.outside === 'BODY') chrome++; else left.push(i + ':' + s.outside); } }
      return { ok: left.length === 0, saw: left.length ? 'focus left the popup on key press ' + left.join(',') : '14 key presses, focus never reached another element' + (chrome ? ' (' + chrome + ' went through the browser chrome)' : '') };
    });
    await w.step(id + 'w', fn + ' -> every text block is inside the budget (140 characters, 2 sentences)', async () => {
      const s = await page.evaluate(READ, testid);
      return { ok: s.blocks > 0 && s.over.length === 0, saw: s.blocks + ' blocks' + (s.over.length ? ' · over: ' + s.over.join(' | ') : '') };
    });
    await w.step(id + 'e', fn + ' -> Escape closes it and focus is back on the opener', async () => {
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      const s = await page.evaluate(READ, testid);
      return { ok: !s.open && s.onOpener, saw: 'open=' + s.open + ' focusOnOpener=' + s.onOpener };
    });
  }
});
