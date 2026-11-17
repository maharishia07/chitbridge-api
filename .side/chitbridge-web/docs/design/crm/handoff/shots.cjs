/* CB CRM handoff — screenshots + the layout checks SYSTEM.md §4 names, run against the static prototype (file://).
   No server, no API, never the live site. Playwright is NOT a dependency of this repo:
     mkdir /tmp/pw && cd /tmp/pw && npm i @playwright/test@1.61.0
     NODE_PATH=/tmp/pw/node_modules node docs/design/crm/handoff/shots.cjs
   Exit code 0 only when every shot passes: phone scrollWidth === 390, no sideways scroll on the laptop, no text under
   11px, every text run at WCAG AA contrast, no "accounting" / "books of account", every alert carries a button, no page error. */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');

const DIR = __dirname;
const URL = 'file://' + path.join(DIR, 'index.html');
const OUT = path.join(DIR, 'png');
const LAP = { width: 1280, height: 800 }, PHONE = { width: 390, height: 844 };

/* [file, hash] — the ten the task names, then one per state */
const MAIN = [
  ['home', '#/parties'],
  ['record', '#/party/P-0002'],
  ['timeline', '#/party/P-0002/timeline'],
  ['compose', '#/party/P-0003/mail'],
  ['followups', '#/followups'],
];
const STATES = [
  ['home-grouped', '#/parties?group=rail'], ['home-select', '#/parties?select=1'], ['home-empty', '#/parties?state=empty'],
  ['home-loading', '#/parties?state=loading'], ['home-error', '#/parties?state=error'], ['home-migration', '#/parties?state=migration'],
  ['home-ledger-off', '#/parties?ledger=off'], ['home-viewer', '#/parties?role=viewer'], ['home-add', '#/parties/add?q=ravi'],
  ['record-local', '#/party/P-0003'], ['record-gstin-late', '#/party/P-0001'], ['record-inactive', '#/party/P-0011'],
  ['record-pref-off', '#/party/P-0005'], ['record-walkin', '#/party/walkin-9876500021'], ['record-no-contact', '#/party/P-0013'],
  ['record-merged', '#/party/P-0008'], ['record-more', '#/party/P-0002?menu=more'], ['record-loading', '#/party/P-0002?state=loading'],
  ['record-error', '#/party/P-0002?state=error'], ['record-viewer', '#/party/P-0002?role=viewer'], ['record-ledger-off', '#/party/P-0002?ledger=off'],
  ['record-edit', '#/party/P-0003/edit'], ['record-edit-dup', '#/party/P-0004/edit?estate=dup'], ['record-log', '#/party/P-0003/log'],
  ['timeline-local', '#/party/P-0003/timeline'], ['timeline-linked', '#/party/P-0001/timeline'], ['timeline-arrive', '#/party/P-0002/timeline?state=arrive'],
  ['timeline-empty', '#/party/P-0013/timeline'], ['timeline-loading', '#/party/P-0002/timeline?state=loading'], ['timeline-error', '#/party/P-0002/timeline?state=error'],
  ['compose-to', '#/party/P-0003/mail?step=to'], ['compose-review', '#/party/P-0003/mail?step=review'], ['compose-on-chitbridge', '#/party/P-0002/mail'],
  ['compose-not-set-up', '#/party/P-0003/mail?mstate=notsetup'], ['compose-no-email', '#/party/P-0013/mail?step=to&mstate=noemail'],
  ['compose-pref-off', '#/party/P-0005/mail?step=to'], ['compose-marketing', '#/party/P-0003/mail?mstate=marketing'],
  ['compose-sending', '#/party/P-0003/mail?step=review&mstate=sending'], ['compose-failed', '#/party/P-0003/mail?step=review&mstate=failed'],
  ['compose-cap', '#/party/P-0003/mail?step=review&mstate=cap'], ['compose-offline', '#/party/P-0003/mail?mstate=offline'],
  ['followups-mine', '#/followups?role=editor'], ['followups-add', '#/followups/add'], ['followups-nothing-today', '#/followups?state=alldone'],
  ['followups-empty', '#/followups?state=empty'], ['followups-loading', '#/followups?state=loading'], ['followups-error', '#/followups?state=error'],
];
/* screenshots show the whole page, not one viewport: let .main grow instead of scrolling inside itself */
const SHOT_CSS = '.app{height:auto;min-height:100vh;overflow:visible}.main{height:auto;overflow:visible}.side{height:auto;align-self:stretch}@media (max-width:620px){.actbar.pin{position:static;order:99}.mfoot{position:static}}.scrim{position:absolute;top:0;left:0;right:0;bottom:auto;min-height:100%;overflow:visible}';
/* ↑ the phone's pinned action bar is drawn at the END of the record in a full-page shot (on a phone it sits at the bottom of the screen) */

(async () => {
  fs.mkdirSync(path.join(OUT, 'states'), { recursive: true });
  // the cloud image ships its own Chromium; use it when present instead of downloading one
  const pre = '/opt/pw-browsers/chromium';
  const opts = fs.existsSync(pre) ? { executablePath: pre } : {};
  const browser = await chromium.launch(opts);
  /* the fonts are Google Fonts (as CB Accounts). Fetched from Node — which honours NODE_EXTRA_CA_CERTS / HTTPS_PROXY in a
     proxied sandbox — and handed to the page; TLS verification is never switched off. Offline: the fallback fonts draw. */
  const ctx = await browser.newContext();
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, async (r) => { try { await r.fulfill({ response: await r.fetch() }); } catch (_) { await r.abort(); } });
  const fails = [];
  async function shoot(name, hash, vp, file) {
    const page = await ctx.newPage();
    await page.setViewportSize(vp);
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(URL + hash + (hash.includes('?') ? '&' : '?') + 'shot=1', { waitUntil: 'load' }).catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const main = document.getElementById('main');
      const tooSmall = [];
      document.querySelectorAll('body *').forEach((el) => {
        if (!el.childNodes.length || el.closest('#rowpeek,.hof,[hidden]')) return;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own || !el.getClientRects().length) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 11) tooSmall.push(el.tagName + '.' + el.className + ' ' + fs + 'px');
      });
      /* WCAG AA on every visible text run: 4.5:1, or 3:1 for large text (≥24px, or ≥18.66px bold) */
      const rgb = (c) => { const m = c.match(/[\d.]+/g) || [0, 0, 0, 0]; return m.map(Number).concat(m.length < 4 ? [1] : []); };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bgOf = (el) => { let out = [255, 255, 255]; const stack = []; for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } }
        stack.reverse().forEach((c) => { out = out.map((v, i) => v * (1 - c[3]) + c[i] * c[3]); }); return out; };
      const lowContrast = [];
      document.querySelectorAll('body *').forEach((el) => {
        if (el.closest('#rowpeek,.hof,[hidden],.scrim ~ *') || !el.getClientRects().length) return;
        if (el.closest('.app') && document.querySelector('.scrim') && !el.closest('.scrim')) return;   // under a sheet's scrim: dimmed on purpose
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!own) return;
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.6 || el.closest('[disabled]')) return;
        const fg = rgb(cs.color), bg = bgOf(el), l1 = lum(fg), l2 = lum(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
        const need = (size >= 24 || (bold && size >= 18.66)) ? 3 : 4.5;
        if (ratio < need) lowContrast.push((el.className || el.tagName) + ' "' + el.textContent.trim().slice(0, 24) + '" ' + ratio.toFixed(2));
      });
      const text = document.body.innerText.toLowerCase();
      const alertsNoFix = [...document.querySelectorAll('.alert, .banner.red, .banner.amber')].filter((a) => !a.querySelector('button, a.act')).map((a) => a.innerText.slice(0, 60));
      return {
        sw: document.documentElement.scrollWidth, iw: innerWidth, msw: main.scrollWidth, mcw: main.clientWidth,
        tooSmall: tooSmall.slice(0, 5), lowContrast: [...new Set(lowContrast)].slice(0, 6), banned: /accounting|books of account/.test(text), alertsNoFix,
      };
    });
    const tag = name + ' @' + vp.width;
    if (r.sw !== r.iw) fails.push(tag + ': document scrollWidth ' + r.sw + ' ≠ ' + r.iw);
    if (r.msw > r.mcw + 1) fails.push(tag + ': content scrolls sideways (' + r.msw + ' > ' + r.mcw + ')');
    if (r.tooSmall.length) fails.push(tag + ': text under 11px ' + r.tooSmall.join(', '));
    if (r.lowContrast.length) fails.push(tag + ': text under WCAG AA ' + r.lowContrast.join(', '));
    if (r.banned) fails.push(tag + ': banned word on screen');
    if (r.alertsNoFix.length) fails.push(tag + ': alert without its fix button: ' + r.alertsNoFix.join(' | '));
    if (errs.length) fails.push(tag + ': page error ' + errs.join(' | '));
    await page.addStyleTag({ content: SHOT_CSS });
    await page.screenshot({ path: file, fullPage: true });
    await page.close();
  }
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;   // e.g. ONLY=^record to re-shoot one screen
  const want = (n) => !only || only.test(n);
  for (const [n, h] of MAIN.filter(([n]) => want(n))) {
    await shoot(n, h, LAP, path.join(OUT, n + '-laptop.png'));
    await shoot(n, h, PHONE, path.join(OUT, n + '-phone.png'));
  }
  for (const [n, h] of STATES.filter(([n]) => want(n))) {
    await shoot(n, h, LAP, path.join(OUT, 'states', n + '-laptop.png'));
    await shoot(n, h, PHONE, path.join(OUT, 'states', n + '-phone.png'));
  }
  await browser.close();
  const total = (MAIN.filter(([n]) => want(n)).length + STATES.filter(([n]) => want(n)).length) * 2;
  if (fails.length) { console.log('FAIL ' + fails.length + ' of ' + total + ' shots\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('OK ' + total + ' shots · WCAG AA text · phone scrollWidth 390 · no sideways scroll · ≥11px · no banned words · every alert has a fix');
})().catch((e) => { console.error(e); process.exit(2); });
