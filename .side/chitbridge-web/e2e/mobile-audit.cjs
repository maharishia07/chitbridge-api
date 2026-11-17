/**
 * mobile-audit.cjs — a STOCK-TAKE of mobile friendliness, measured in a phone-sized browser.
 *
 * ⚠️ MEASURED, NOT READ OFF THE CSS. "Is it responsive" cannot be answered by grepping for @media: this app drives
 * its layout from a JS flag (UI.vp), so a page with zero media queries may be fine and a page with ten may still
 * push content off the side. Everything below is taken from a real render at 390×844 (iPhone 14-class).
 *
 * What it counts, and why each one is the thing that actually hurts on a phone:
 *   OVERFLOW  — document wider than the screen. The page scrolls sideways; headers detach from content. The single
 *               worst mobile defect and the easiest to miss on a laptop.
 *   WIDEST    — the specific element causing it, so the fix has an address rather than a page name.
 *   TAP<40    — interactive targets under ~40px. Below that, thumbs miss. (Apple says 44, Google 48; 40 is a floor.)
 *   TEXT<12   — body text under 12px is where people start pinch-zooming.
 *
 * RUN:  node e2e/mobile-audit.cjs            (public pages only)
 *       node e2e/mobile-audit.cjs --app      (also signs in and walks the in-app screens)
 */
const { chromium, devices } = require('@playwright/test');
const F = require('./fixtures.js');

const WEB = process.env.CB_WEB || 'https://chitbridge-web.vercel.app';
const PHONE = { width: 390, height: 844 };

const PUBLIC = [
  'shop.html', 'store.html', 'network.html', 'intake.html', 'know-your-business.html',
  'authority-forms.html', 'lifecycle-test.html', 'iot-howitworks.html', 'embed.html',
  'design-mock.html', 'cart-design.html', 'supplier-design.html', 'network-design.html', 'storefront-design.html',
];
const SCREENS = ['task', 'order', 'catalogue', 'suppliers', 'network', 'intake', 'settings'];

/** Everything measured in one pass, inside the page. */
const PROBE = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const overflow = Math.max(0, de.scrollWidth - vw);
  let widest = null, worst = 0;
  const small = [];
  const tiny = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;                         // hidden
    if (r.right > vw + 1 && r.width > worst) {
      worst = r.width;
      widest = (el.tagName.toLowerCase()
        + (el.id ? '#' + el.id : '')
        + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''))
        .slice(0, 60) + ' (' + Math.round(r.width) + 'px, right ' + Math.round(r.right) + ')';
    }
    const tag = el.tagName.toLowerCase();
    const clickable = tag === 'button' || tag === 'a' || tag === 'select' || tag === 'input' ||
      (el.getAttribute && el.getAttribute('onclick'));
    if (clickable && r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40)) {
      small.push(tag + (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : '')
        + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
    }
    if (el.children.length === 0 && (el.textContent || '').trim().length > 3) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs && fs < 12) tiny.push(Math.round(fs * 10) / 10 + 'px: ' + (el.textContent || '').trim().slice(0, 28));
    }
  }
  return { vw, overflow, widest, tapSmall: small.length, tapExamples: small.slice(0, 3),
           tiny: tiny.length, tinyExamples: tiny.slice(0, 2) };
};

const row = (name, r) => {
  const flag = r.overflow > 0 ? '\x1b[31m' : (r.tapSmall > 12 || r.tiny > 25 ? '\x1b[33m' : '\x1b[32m');
  console.log('  ' + flag + (r.overflow > 0 ? 'OVERFLOW' : (r.tapSmall > 12 || r.tiny > 25 ? 'WARN    ' : 'ok      ')) + '\x1b[0m '
    + name.padEnd(26) + ' overflow ' + String(r.overflow + 'px').padEnd(8)
    + ' tap<40 ' + String(r.tapSmall).padEnd(5) + ' text<12 ' + r.tiny);
  if (r.overflow > 0 && r.widest) console.log('           ↳ widest: ' + r.widest);
  if (r.tapExamples && r.tapExamples.length && (r.tapSmall > 12)) console.log('           ↳ e.g. ' + r.tapExamples.join(' · '));
};

(async () => {
  const withApp = process.argv.includes('--app');
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: PHONE, baseURL: WEB });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());

  console.log('\n  MOBILE STOCK-TAKE — measured at ' + PHONE.width + '×' + PHONE.height + ' (iPhone 14-class)\n');
  console.log('  ── public pages ──────────────────────────────────────────────────────────────');
  for (const page of PUBLIC) {
    try {
      const res = await p.goto(WEB + '/' + page, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!res || res.status() >= 400) { console.log('  \x1b[90m—       \x1b[0m ' + page.padEnd(26) + ' (' + (res ? res.status() : 'no response') + ')'); continue; }
      await p.waitForTimeout(1200);
      row(page, await p.evaluate(PROBE));
    } catch (e) { console.log('  \x1b[90m—       \x1b[0m ' + page.padEnd(26) + ' ' + String(e.message).slice(0, 50)); }
  }

  if (withApp) {
    console.log('\n  ── in-app screens (signed in) ────────────────────────────────────────────────');
    await p.goto(WEB + '/app.html');
    await F.mintEntity(p, { email: 'beta@test-cb.com', name: 'Beta Fresh' });
    await p.waitForTimeout(2500);
    for (const s of SCREENS) {
      try {
        await p.evaluate((k) => navTo(k), s);
        await p.waitForTimeout(3000);
        row('app · ' + s, await p.evaluate(PROBE));
      } catch (e) { console.log('  \x1b[90m—       \x1b[0m app · ' + s + ' ' + String(e.message).slice(0, 40)); }
    }
    // The compose modal is the densest surface in the product — measure it open, not just the screen behind it.
    try {
      await p.evaluate(() => navTo('task'));
      await p.waitForTimeout(1500);
      await p.evaluate(() => compose({}));
      await p.waitForTimeout(4000);
      row('app · compose (modal)', await p.evaluate(PROBE));
    } catch (e) { console.log('  \x1b[90m—       \x1b[0m app · compose ' + String(e.message).slice(0, 40)); }
  }

  console.log('\n  OVERFLOW = the page scrolls sideways on a phone. That is the one to fix first.\n');
  await b.close();
})();
