/* walk-list-tap.cjs - THE LIST CONTROL'S CONTROLS MEET THE ONE TAP RULE AND CARRY THEIR CODES (Athi 10 Nov, wave 2 customer side step 1, UX-137)
 * Renders public/list-lab.html (the list control on a bare page) and measures the BOX of every visible control the list draws (getBoundingClientRect), the way
 * walk-topbar-tap.cjs does for the main bar. Words in the page's CSS say nothing: only the drawn size counts.
 *   390 x 844 and 390 x 740 at the four text sizes (--k 1, 1.1, 1.2, 1.32 as cb_fs s m l xl): every button, select and search box >= 44 px high, the icon buttons
 *   and tick boxes >= 44 wide, nothing scrolls sideways, the head stays within HEAD_PHONE of the window (30% at text S and M; HEAD_PHONE_LARGE_TEXT at L and XL,
 *   an explicit limit named here and in the PR, not an exemption), the popovers' controls too (Filters, View).
 *   1366 x 768: every control >= 32 px high (the compact size), the head stays within 20%, nothing under 24 px is drawn at all.
 *   CODES: every control carries data-cbsid; each selector below maps to ITS code; every code is in the closed set of ui.js ACTION_SET; with a screen chip on the
 *   page (injected before the list paints) every control carries its mount <screen>-U1nn.
 *   FORCED COLOURS (emulated): the drawn 22 px tick keeps a visible checked state in system colours.
 * Run: NODE_PATH=<dir with @playwright/test> node e2e/walk-list-tap.cjs        (exits 1 on a failure)                                                  */
'use strict';
const { chromium } = require('@playwright/test');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { serve } = require('./lib/serve.cjs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const SIZES = [['s', 1], ['m', 1.1], ['l', 1.2], ['xl', 1.32]];
const HEAD_PHONE = 30, HEAD_PHONE_LARGE_TEXT = 33; /* percent of the window; the large-text limit is its own named number */
const SCREEN = 'LAB001';
/* selector -> the code it must carry (the list unit's identity, one line each); the code must also be in ui.js's closed set */
const CODE_OF = [
  ['[data-cbl-q]', 'CMP045-I01'], ['[data-cbl-pop="filt"]', 'CMP033-B01'], ['[data-cbl-pop="view"]', 'CMP033-B01'], ['[data-cbl-pop="cols"]', 'CMP033-B01'],
  ['[data-gsel]', 'CMP035-S01'], ['[data-group]', 'CMP034-B01'], ['[data-view]', 'CMP034-B01'], ['[data-cbl-exp]', 'CMP034-B01'], ['[data-cbl-csv]', 'CMP037-B01'],
  ['[data-cbl-selmode]', 'CMP034-B01'], ['[data-cbl-selall]', 'CMP037-B03'], ['[data-bulk]', 'CMP037-B04'], ['[data-sort]', 'CMP039-B01'], ['[data-rz]', 'CMP039-B02'],
  ['[data-selrow]', 'CMP045-I03'], ['[data-cbl-more]', 'CMP037-B05'], ['[data-filt]', 'CMP035-S01'], ['[data-cbl-sort]', 'CMP035-S01'], ['[data-cbl-clearf]', 'CMP014-B01'],
  ['[data-cbl-resetcols]', 'CMP037-B02'], ['[data-mv]', 'CMP039-B03'], ['[data-col]', 'CMP045-I03'], ['[data-view-tab]', 'CMP036-K01'], ['[data-act]', 'CMP038-B01'], ['[data-cbl-from]', 'CMP045-I02']
];

/** the closed set: every component code and element code ui.js's ACTION_SET knows (the elements of a component are its `elements`, else its one `element`) */
function closedSet() {
  const sandbox = { window: {}, document: undefined };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'ui.js'), 'utf8'), sandbox);
  const set = new Set();
  Object.values(sandbox.window.ui.components).forEach((c) => { set.add(c.code); (c.elements || [c.element.slice(7)]).forEach((e) => set.add(c.code + '-' + e)); });
  return set;
}

/** every visible control inside .cbl and its box and codes */
const measure = (page, table) => page.evaluate(([pairs, SCREEN_]) => {
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const out = [];
  document.querySelectorAll('.cbl button, .cbl select, .cbl input, .cbl [role="button"]').forEach((el) => {
    if (!shown(el) || el.type === 'hidden') return;
    const b = el.getBoundingClientRect();
    out.push({ tag: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''), cls: (el.className || '').toString().slice(0, 30), id: el.getAttribute('data-cbsid'), mount: el.getAttribute('data-cbmount'),
      w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, handle: /cbl-rz/.test(el.className || ''), tick: el.type === 'checkbox', name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) });
  });
  const wrong = [];
  pairs.forEach(([sel, code]) => document.querySelectorAll('.cbl ' + sel).forEach((el) => { if (el.getAttribute('data-cbsid') !== code) wrong.push(sel + ' is ' + el.getAttribute('data-cbsid') + ', expected ' + code); }));
  const head = document.querySelector('.cbl-title') && document.querySelector('.cbl-tools') ? document.querySelector('.cbl-tools').getBoundingClientRect().bottom - document.querySelector('.cbl-title').getBoundingClientRect().top : 0;
  const mountless = Array.from(document.querySelectorAll('.cbl [data-cbsid]')).filter((el) => {
    const chip = document.querySelector('[data-testid="screen-id"][data-cbsid]'); const want = (chip ? chip.getAttribute('data-cbsid') : SCREEN_) + '-U1' + el.getAttribute('data-cbsid').slice(0, 6).slice(-2);
    return el.getAttribute('data-cbmount') !== want;
  }).map((el) => el.getAttribute('data-cbsid') + ' -> ' + el.getAttribute('data-cbmount'));
  return { controls: out, wrong, mountless, sideways: document.documentElement.scrollWidth - window.innerWidth, head, ih: window.innerHeight };
}, [table, SCREEN]);

(async () => {
  const known = closedSet();
  const S = await serve();
  const browser = await chromium.launch();
  try {
    for (const [label, vw, vh, minH, minW] of [['phone 390x844', 390, 844, 44, 44], ['phone 390x740', 390, 740, 44, 44], ['laptop 1366', 1366, 768, 32, 24]]) {
      for (const [sz, k] of SIZES) {
        if (vw === 1366 && sz !== 's' && sz !== 'xl') continue;
        const page = await browser.newPage({ viewport: { width: vw, height: vh } });
        /* a screen chip on the page before the list paints: the mounts come from it */
        await page.addInitScript((screen) => {
          new MutationObserver(() => {
            if (document.body && !document.querySelector('[data-testid="screen-id"]')) {
              const chip = document.createElement('span'); chip.setAttribute('data-testid', 'screen-id'); chip.setAttribute('data-cbsid', screen); chip.hidden = true; document.body.appendChild(chip);
            }
          }).observe(document.documentElement, { childList: true, subtree: true });
        }, SCREEN);
        await page.goto(S.url('/list-lab.html'));
        await page.waitForSelector('[data-plist]');
        await page.evaluate((kk) => { document.documentElement.style.setProperty('--k', String(kk)); }, k);
        for (const list of ['daybook', 'dues', 'big']) {
          await page.click('[data-plist="' + list + '"]'); await page.waitForTimeout(150);
          const pops = vw <= 700 ? [null, '[data-cbl-pop="filt"]', '[data-cbl-pop="view"]'] : [null, '[data-cbl-pop="filt"]', '[data-cbl-pop="cols"]'];
          /* the bulk list in select mode draws the row ticks, which must meet the tap rule too (a 44 px hit area on a phone) */
          if (list === 'big') { const sel = await page.$('[data-cbl-selmode]'); if (sel) { await sel.click(); await page.waitForTimeout(100); } }
          for (const pop of pops) {
            if (pop) { const b = await page.$(pop); if (!b) continue; await b.click(); await page.waitForTimeout(100); }
            const m = await measure(page, CODE_OF);
            const tag = label + ' · ' + sz + ' · ' + list + (pop ? ' · ' + pop.replace(/.*pop="(\w+)".*/, '$1') + ' open' : '');
            const tickMin = vw <= 700 ? 44 : 24;
            const smallTicks = m.controls.filter((c) => c.tick && (c.h < tickMin || c.w < tickMin));
            const small = m.controls.filter((c) => !c.tick && !c.handle && (c.h < minH || (c.tag === 'button' && c.cls.indexOf('cbl-seg') < 0 && /cbl-ico|cbl-mv|cbl-hf/.test(c.cls) && c.w < minW)));
            ok(small.length === 0, tag + ': every control draws >= ' + minH + ' px' + (small.length ? ' (small: ' + small.slice(0, 4).map((c) => c.name + ' ' + c.w + 'x' + c.h).join(', ') + ')' : ' (' + m.controls.length + ' measured)'));
            ok(smallTicks.length === 0, tag + ': every tick box has a ' + tickMin + ' px hit area (' + m.controls.filter((c) => c.tick).length + ' measured)' + (smallTicks.length ? ' (small: ' + smallTicks.slice(0, 3).map((c) => c.w + 'x' + c.h).join(', ') + ')' : ''));
            ok(m.controls.every((c) => c.id && known.has(c.id)), tag + ': every control carries a code of the closed set' + (m.controls.some((c) => !c.id || !known.has(c.id)) ? ' (not: ' + m.controls.filter((c) => !c.id || !known.has(c.id)).slice(0, 3).map((c) => c.tag + ' ' + c.name + ' ' + c.id).join(', ') + ')' : ''));
            ok(m.wrong.length === 0, tag + ': each control carries ITS code' + (m.wrong.length ? ' (' + m.wrong.slice(0, 3).join('; ') + ')' : ''));
            ok(m.mountless.length === 0, tag + ': every control carries its mount ' + SCREEN + '-U1nn' + (m.mountless.length ? ' (' + m.mountless.slice(0, 3).join('; ') + ')' : ''));
            ok(m.controls.every((c) => c.h >= 24 && (c.w >= 24 || c.tick || c.handle)), tag + ': nothing under 24 px is drawn');
            ok(m.sideways <= 0, tag + ': no sideways scroll (' + m.sideways + ')');
            if (!pop && list !== 'big') {
              const limit = vw > 700 ? 20 : sz === 'l' || sz === 'xl' ? HEAD_PHONE_LARGE_TEXT : HEAD_PHONE;
              ok(Math.round((m.head / m.ih) * 100) <= limit, tag + ': the head is ' + Math.round((m.head / m.ih) * 100) + '% of the window (<= ' + limit + '%)');
            }
            if (pop) await page.keyboard.press('Escape');
          }
        }
        await page.close();
      }
    }
    /* NARROW AND LONG: the daybook head on a 375 px phone, and with a long translated title, a long period and a 3-digit notices count (the words are swapped after the paint:
       it is the drawn width that counts); the same budget as above, 30% at text S and M, HEAD_PHONE_LARGE_TEXT at L and XL */
    for (const [label, vw, longWords] of [['phone 375x740', 375, false], ['phone 390x740 long words', 390, true], ['phone 375x740 long words', 375, true]]) {
      for (const [sz, k] of SIZES.filter((s2) => s2[0] === 'm' || s2[0] === 'l')) {
        const page = await browser.newPage({ viewport: { width: vw, height: 740 } });
        await page.goto(S.url('/list-lab.html')); await page.waitForSelector('[data-plist]');
        await page.evaluate((kk) => { document.documentElement.style.setProperty('--k', String(kk)); }, k);
        await page.click('[data-plist="daybook"]'); await page.waitForTimeout(150);
        if (longWords) {
          await page.evaluate(() => {
            const set = (sel, txt) => { const e = document.querySelector(sel); if (e) e.firstChild.textContent = txt; };
            set('.cbl-title h1', 'Journal des écritures comptables');
            set('.cbl-chip.period', '1 avr. 2025 – 2 oct. 2026 ▾');
            set('[data-cbl-pop="notes"]', '1 avr. 2025 – 2 oct. 2026 · 128 notifications ▾');
          });
        }
        const m = await measure(page, CODE_OF);
        const limit = sz === 'l' || sz === 'xl' ? HEAD_PHONE_LARGE_TEXT : HEAD_PHONE;
        const pct = Math.round((m.head / m.ih) * 100);
        ok(pct <= limit, label + ' · ' + sz + ' · daybook: the head is ' + pct + '% of the window (<= ' + limit + '%) (' + Math.round(m.head) + ' px)');
        ok(m.sideways <= 0, label + ' · ' + sz + ' · daybook: no sideways scroll (' + m.sideways + ')');
        if (!longWords) ok(/Apr/.test(await page.$eval('[data-cbl-pop="notes"]', (e) => e.textContent)), label + ' · ' + sz + ' · daybook: the folded chip names the period');
        if (!longWords) ok(!(await page.$('.cbl-chip.period')), label + ' · ' + sz + ' · daybook: no second period chip beside the folded one');
        await page.close();
      }
    }
    /* forced colours (Windows high contrast): the drawn tick keeps a visible checked state */
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, forcedColors: 'active' });
      const page = await ctx.newPage();
      await page.goto(S.url('/list-lab.html')); await page.waitForSelector('[data-plist]');
      await page.click('[data-plist="big"]'); await page.waitForTimeout(150);
      await page.click('[data-cbl-selmode]'); await page.waitForTimeout(100);
      const state = await page.evaluate(() => {
        const box = document.querySelector('.cbl input[data-selrow]'); const look = () => { const s = getComputedStyle(box, '::before'); return { bg: s.backgroundColor, content: s.content, border: s.borderTopColor }; };
        const before = look(); box.click(); const after = look(); return { before, after, forced: matchMedia('(forced-colors: active)').matches };
      });
      ok(state.forced, 'forced colours are emulated');
      ok(state.after.content.indexOf('✓') >= 0 && (state.after.bg !== state.before.bg || state.after.border !== state.before.border), 'forced colours: a ticked box shows its mark and a different system colour (' + state.before.bg + ' -> ' + state.after.bg + ')');
      await ctx.close();
    } catch (e) { ok(false, 'forced colours emulation failed: ' + e.message.split('\n')[0]); }
  } finally {
    await browser.close(); S.close && S.close();
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
