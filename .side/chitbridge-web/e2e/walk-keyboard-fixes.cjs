/* walk-keyboard-fixes.cjs - the keyboard findings of the UX-137 stamps 6-12, proved in a browser (cb-ux-locale).
 *
 * OWNS      one walk with a case per finding: (1) the list search draws its own focus ring; (2) on the four step-flow design labs (cart-design.html, network-design.html, supplier-design.html,
 *           storefront-design.html) every control that has a click handler is reachable by Tab and pressed by Enter and Space: the step rail, the Change links, the remove
 *           marks and the network store rows; (3) the cart-design close and remove marks reach 4.5:1 on white through a token.
 *           The modal focus return is a vm test (modal-focus-return.test.cjs); the real rail's markup is step-press.test.cjs.
 * CALLED BY the cloud walks (walk-*.cjs) and by hand: NODE_PATH=<dir with @playwright/test> node e2e/walk-keyboard-fixes.cjs   (KBD_ROOT=<checkout> to point at another tree)
 * FLOW      serve public/ -> open each page at 1366x768 and 390x844 -> audit click handlers -> press with Tab/Enter/Space -> read the state back
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/design-system
 */
'use strict';
const { chromium } = require('@playwright/test');
const path = require('path');
const { serve } = require('./lib/serve.cjs');

const ROOT = process.env.KBD_ROOT ? path.join(process.env.KBD_ROOT, 'public') : undefined;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const SIZES = [[1366, 768], [390, 844]];
const PAGES = ['/cart-design.html', '/network-design.html', '/supplier-design.html', '/storefront-design.html'].map((p) => p.slice(1, -5));

/** every element in the page that carries an onclick and is not a native control: it must be a tab stop with a button role */
const unreachable = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[onclick]')).filter((el) => {
  if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') return false;
  if (el.classList.contains('ov') || el.classList.contains('cbcart-ov') || el.classList.contains('mover')) return false; /* a backdrop: Escape and the close button are its keyboard way */
  return !(el.getAttribute('role') === 'button' && el.tabIndex >= 0);
}).map((el) => el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + ' "' + (el.textContent || '').trim().slice(0, 18) + '"'));

(async () => {
  const s = await serve(ROOT);
  const b = await chromium.launch();
  try {
    for (const [w, h] of SIZES) {
      const page = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(String(e)));

      console.log('\n-- ' + w + 'x' + h + ' (1) the list search has its own focus ring');
      await page.goto(s.url('/list-lab.html')); await page.waitForSelector('[data-cbl-q]', { timeout: 15000 });
      await page.focus('[data-cbl-q]');
      const ring = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('[data-cbl-q]')); /* the ring is the input's own (list-ctl.js, 870bd20b: a ring on the pill around it did not count as the focused element's) */ return { style: c.outlineStyle, width: parseFloat(c.outlineWidth), color: c.outlineColor }; });
      ok(ring.style !== 'none' && ring.width >= 2 && !/rgba\(0, 0, 0, 0\)|transparent/.test(ring.color), 'focused search box draws a ' + ring.width + 'px ' + ring.style + ' ring (' + ring.color + ')');

      console.log('\n-- ' + w + 'x' + h + ' (2) the step-flow labs: handlers are keyboard-reachable');
      for (const name of PAGES) {
        await page.goto(s.url('/' + name + '.html')); await page.waitForTimeout(700);
        const steps = await page.evaluate(() => (typeof STEPS !== 'undefined' ? STEPS.length : 0));
        for (let i = 0; i < Math.max(steps, 1); i++) {
          await page.evaluate((k) => { if (typeof S !== 'undefined') { S.step = k; if (typeof go === 'function') go(k); } }, i);
          await page.waitForTimeout(120);
          const bad = await unreachable(page);
          ok(bad.length === 0, name + ' step ' + (i + 1) + ': every click handler is a tab stop' + (bad.length ? ' - not: ' + bad.slice(0, 4).join(', ') : ''));
        }
        ok(errs.length === 0, name + ': no page errors' + (errs.length ? ' ' + errs[0].slice(0, 80) : ''));
      }

      console.log('\n-- ' + w + 'x' + h + ' (2b) pressing: Enter on a finished step, Space on Change, Enter on a remove mark');
      await page.goto(s.url('/cart-design.html')); await page.waitForTimeout(500);
      await page.evaluate(() => { S.step = 1; go(1); });
      await page.evaluate(() => { document.getElementById('tov').value = 'Ravi'; addTo('To'); });
      ok((await page.evaluate(() => S.to.length)) >= 1, 'a recipient was added to remove');
      await page.focus('.rm'); await page.keyboard.press('Enter');
      ok((await page.evaluate(() => S.to.filter((x) => x.name === 'Ravi').length)) === 0, 'Enter on the recipient remove mark removes it');
      await page.evaluate(() => { S.step = 2; go(2); });
      await page.focus('.st.done'); await page.keyboard.press('Enter');
      ok((await page.evaluate(() => S.step)) === 0, 'Enter on the first (finished) step goes back to it');
      await page.evaluate(() => { S.step = 2; go(2); });
      await page.evaluate(() => { document.querySelectorAll('.rev').length; S.step = 3; go(3); });
      await page.focus('.rev [data-cbname="edit"]'); await page.keyboard.press('Space');
      ok((await page.evaluate(() => S.step)) !== 3, 'Space on a Change link goes back to that step');

      console.log('\n-- ' + w + 'x' + h + ' (2c) network design: a store row takes Enter');
      await page.goto(s.url('/network-design.html')); await page.waitForSelector('.st0', { timeout: 10000 });
      await page.focus('.st0'); await page.keyboard.press('Enter');
      ok(await page.evaluate(() => !!(S.st && S.st.id)), 'Enter on a store row picks the store');


      console.log('\n-- ' + w + 'x' + h + ' (2c) the shared cart: bar, clear, add all and remove are pressed from the keyboard');
      await page.goto(s.url('/cart-design.html')); await page.waitForTimeout(500);
      await page.evaluate(() => { S.step = 0; go(0); }); await page.waitForTimeout(300);
      await page.focus('.cbcart-grp'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
      ok((await page.locator('.cbcart-bar.on').count()) > 0, 'Enter on "add all" puts the group in the cart');
      await page.focus('.cbcart-bag[role=button]'); await page.keyboard.press('Space'); await page.waitForTimeout(250);
      ok((await page.locator('.cbcart-ov.on').count()) > 0, 'Space on the cart bar opens the cart');
      const rowsBefore = await page.locator('[data-cbsid="CMP008"]').count();
      await page.focus('[data-cbsid="CMP008"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
      ok(rowsBefore > 0 && (await page.locator('[data-cbsid="CMP008"]').count()) < rowsBefore, 'Enter on a remove mark takes the line out of the cart (' + rowsBefore + ' lines before)');
      await page.keyboard.press('Escape');
      await page.evaluate(() => CBCart.ensureChipCss()); /* the lab paints its own overlay and never opens the shared host, which is what injects the cart's stylesheet on shop and the app */
      await page.focus('.cbcart-grp'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); /* reached by keyboard, so :focus-visible applies */
      const cartRing = await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return c.outlineStyle + ' ' + c.outlineWidth; });
      ok(/solid 2px/.test(cartRing), 'a focused cart control draws a 2px ring (' + cartRing + ')');
      console.log('\n-- ' + w + 'x' + h + ' (3) the cart-design close and remove marks reach 4.5:1');
      await page.goto(s.url('/cart-design.html')); await page.waitForTimeout(500);
      await page.evaluate(() => { S.step = 2; go(2); document.querySelector('.shell').insertAdjacentHTML('beforeend', '<span class="chip" id="rmprobe"><span class="rm">x</span></span>'); });
      const colours = await page.evaluate(() => ['.x', '#rmprobe .rm'].map((q) => getComputedStyle(document.querySelector(q)).color));
      const lum = (c) => { const v = c.match(/\d+/g).slice(0, 3).map((n) => { const x = +n / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      colours.forEach((c, i) => { const ratio = 1.05 / (lum(c) + 0.05); ok(ratio >= 4.5, ['close mark', 'remove mark'][i] + ' ' + c + ' on white = ' + ratio.toFixed(2) + ':1'); });
      const fromToken = await page.evaluate(() => /var\(--grey\)/.test(Array.from(document.styleSheets).flatMap((st) => Array.from(st.cssRules)).map((r) => r.cssText).join('\n').match(/\.x\{[^}]*\}|\.x \{[^}]*\}/)?.[0] || ''));
      ok(fromToken, 'the close mark colour is a token (var(--grey)), not a hex value');
      ok(errs.length === 0, 'no page errors');

      console.log('\n-- ' + w + 'x' + h + ' (3b) the other labs close marks use the token, and the token reaches 4.5:1');
      for (const name of ['network-design', 'supplier-design', 'storefront-design']) {
        await page.goto(s.url('/' + name + '.html')); await page.waitForTimeout(400);
        const mark = await page.evaluate(() => { const own = document.documentElement.outerHTML.match(/<button (?:data-cbsid="[^"]*" )?onclick="closeOv\(\)" style="[^"]*"/g) || []; return { n: own.length, hex: own.filter((t) => /color:#[0-9a-f]{3,6}/i.test(t)).length, grey: getComputedStyle(document.documentElement).getPropertyValue('--grey').trim() }; });
        ok(mark.n > 0 && mark.hex === 0, name + ': ' + mark.n + ' close mark(s), ' + mark.hex + ' with a hex colour');
        const lumG = (c) => { const v = [1, 3, 5].map((i) => parseInt(c.substr(i, 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        ok(/^#[0-9a-f]{6}$/i.test(mark.grey) && 1.05 / (lumG(mark.grey) + 0.05) >= 4.5, name + ': --grey ' + mark.grey + ' on white = ' + (1.05 / (lumG(mark.grey) + 0.05)).toFixed(2) + ':1');
      }

      console.log('\n-- ' + w + 'x' + h + ' (4) AA contrast of the controls made keyboard-reachable, and no request that could fail without words');
      for (const name of PAGES) {
        await page.goto(s.url('/' + name + '.html')); await page.waitForTimeout(500);
        await page.evaluate(() => { if (typeof S !== 'undefined') { S.step = 2; if (typeof go === 'function') go(2); } });
        const low = await page.evaluate(() => {
          const lum = (c) => { const v = c.match(/[0-9.]+/g).slice(0, 3).map((n) => { const x = +n / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
          const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba[(]0, 0, 0, 0[)]|transparent/.test(c)) return c; } return 'rgb(255, 255, 255)'; };
          return Array.from(document.querySelectorAll('[role="button"][tabindex]')).filter((el) => el.getBoundingClientRect().width > 0 && (el.textContent || '').trim()).map((el) => {
            const a = lum(getComputedStyle(el).color), b = lum(bgOf(el)), r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            return { who: el.className.toString().split(' ')[0] + ' "' + el.textContent.trim().slice(0, 14) + '"', ratio: r };
          }).filter((x) => x.ratio < 4.5);
        });
        ok(low.length === 0, name + ': text of every keyboard control is at least 4.5:1' + (low.length ? ' - below: ' + low.slice(0, 3).map((x) => x.who + ' ' + x.ratio.toFixed(2)).join(', ') : ''));
        const src = await (await fetch(s.url('/' + name + '.html'))).text();
        ok(!/fetch[(]|XMLHttpRequest|sendBeacon/.test(src.replace(/<!--[^]*?-->/g, '')) || name === 'network-design', name + ': the mock sends no request, so no read could fail without saying so in words' + (name === 'network-design' ? ' (network-design does call the server; its failure line is checked in ui-codes-network-design.test.cjs)' : ''));
      }
    }
  } finally { await b.close(); s.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
