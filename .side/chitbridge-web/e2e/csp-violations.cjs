/**
 * e2e/csp-violations.cjs — K-SEC PR A (SEC-68, critic C11): ONE PASS OVER THE TOUR SCREENS WITH THE REPORT-ONLY CSP, COUNTING
 * EVERY VIOLATION. Zero violations is the evidence that enforcing the policy on Vercel is safe; until then it stays report-only.
 *
 * The policy is read from vercel.json (Content-Security-Policy-Report-Only), so the pass checks exactly what Vercel sends. It is
 * injected into each page's own response here — the local server sends no Vercel headers — with report-uri / report-to
 * removed, so a local pass never posts to the production api's report door. Each violation is caught twice:
 *   · the page's own `securitypolicyviolation` event (directive · blocked URI · source line), and
 *   · the console's "Refused to …" line (what a person debugging would see).
 *
 * Run (needs Playwright: `cd e2e && npm ci && npx playwright install chromium`, then from the repo root):
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/csp-violations.cjs                 → serves public/ itself (no api: screens load,
 *                                                                                 api calls fail — script/style/font/img rules still count)
 *   CB_WEB_BASE=http://localhost:8124 NODE_PATH=… node e2e/csp-violations.cjs   → over the local stack, signed-in screens included
 * Writes e2e/shots/csp-violations.json; exits 1 when any violation was seen (0 = the policy can be enforced as it is).
 * ⚠️ Check free RAM first (≥ 2 GB): one Chromium, one page at a time.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const { serve } = require('./lib/serve.cjs');

const SCREENS = ['/', '/app.html', '/accounts.html', '/crm.html', '/finance.html', '/operations.html', '/catalogue.html', '/tasks.html',
  '/settings.html', '/employees.html', '/network.html', '/shop.html', '/store.html', '/till.html', '/promo.html', '/signin-lab.html'];
const SETTLE_MS = 2500;
const OUT = path.join(__dirname, 'shots', 'csp-violations.json');

/** policyOf() → vercel.json's report-only policy, without its reporting directives (a local pass never reports to production) */
function policyOf() {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const all = vercel.headers.flatMap((block) => block.headers);
  const found = all.find((header) => header.key === 'Content-Security-Policy-Report-Only');
  if (!found) throw new Error('vercel.json has no Content-Security-Policy-Report-Only header');
  return found.value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !/^report-(uri|to)\b/.test(part))
    .join('; ');
}

/** visit(page, url) → the violations one screen raised */
async function visit(page, url) {
  const seen = [];
  const onConsole = (message) => {
    if (/Refused to/.test(message.text())) seen.push({ via: 'console', text: message.text().slice(0, 300) });
  };
  page.on('console', onConsole);
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(SETTLE_MS);
    const fromPage = await page.evaluate(() => window.__cspSeen || []);
    fromPage.forEach((item) => seen.push(Object.assign({ via: 'event' }, item)));
  } catch (problem) {
    seen.push({ via: 'load', text: 'the screen did not load: ' + String((problem && problem.message) || problem).slice(0, 200) });
  }
  page.off('console', onConsole);
  return seen;
}

(async () => {
  const policy = policyOf();
  const local = process.env.CB_WEB_BASE ? null : await serve();
  const base = process.env.CB_WEB_BASE || local.url('');
  const browser = await chromium.launch();
  const report = { at: new Date().toISOString(), base, policy, screens: {} };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(() => {
      window.__cspSeen = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__cspSeen.push({ directive: event.effectiveDirective, blocked: event.blockedURI, source: event.sourceFile, line: event.lineNumber });
      });
    });
    /* the policy rides on every HTML answer, exactly as Vercel would send it */
    await ctx.route('**/*', async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue();
      const answer = await route.fetch();
      const headers = Object.assign({}, answer.headers(), { 'content-security-policy-report-only': policy });
      return route.fulfill({ response: answer, headers });
    });
    const page = await ctx.newPage();
    for (const screen of SCREENS) {
      const seen = await visit(page, base + screen);
      report.screens[screen] = seen;
      console.log('  ' + screen.padEnd(20) + (seen.length ? seen.length + ' violation(s)' : 'clean'));
    }
  } finally {
    await browser.close();
    if (local) local.close();
  }
  const total = Object.values(report.screens).reduce((sum, list) => sum + list.length, 0);
  report.total = total;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n  ' + total + ' violation(s) over ' + SCREENS.length + ' screens → ' + path.relative(process.cwd(), OUT));
  process.exit(total ? 1 : 0);
})();
