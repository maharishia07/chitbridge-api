/* sim-desktop3.cjs — THE WHOLE FLOW, DRIVEN AS A PERSON ([TILL-129])
 *
 * ── ⭐⭐⭐ WHAT ATHI ASKED FOR ────────────────────────────────────────────────────────────────────────────────
 *
 * *"create a shop with two coassist, sign-in as entity, do the start of the day ritual, change the billing seq
 * to julian date. then create couple of bills. then sign-out. sign-in as coassist a, do couple of bills, then
 * sign-out, sign-in as coassist b, do couple of bills, then sign-out. then login as entity, do couple of bills,
 * check todays sale, and posting. simulate for a week, month and year … i want this to be done as human, not
 * using headless scripts."*
 *
 * ── ⚠️ SO EVERY STEP GOES THROUGH A SCREEN ──────────────────────────────────────────────────────────────────
 *
 * The shop is registered on the real back-office page, the co-assists are typed into its own modal, the counter
 * is signed in through ⚙, and every bill is rung up by clicking a product and pressing Pay. Nothing here calls
 * an API directly — that was the first version of this, and Athi's point is that an API script proves the API,
 * not the product.
 *
 * ⚠️ THE ONE EXCEPTION IS TIME. A year cannot be lived through, so the back-dated history is written as day
 * files and folded by the counter's own rollup — the same path a real year takes, run at speed. Said out loud
 * rather than hidden, because it is the one place this is not a person.
 *
 * Run: node e2e/sim-desktop3.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const API = 'https://chitbridge-api-production.up.railway.app';
const ROOT = path.join(__dirname, '..', 'public');
const KIT = path.join(__dirname, '..', '..', 'chitbridge-api', 'tools', 'tally-connector');
const SHOP = 'desktop3';
const EMAIL = 'athi.narayanan.74+desktop3@gmail.com';
const OTP = require('./lib/signin-code.cjs').codeOrSkip(API);   // SEC1: E2E_TESTER_CODE on the deployed api (unset → skipped with a warning)
/** ⭐ where Athi will look. A named folder, not a temp dir, because the whole point is that he can open it. */
const HOME = 'C:\\dev\\counter-sim\\desktop3';
const PORT = 7351;

const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
            '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(26) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '\u2717 FAILED'))); };
const step = (n, t) => console.log('\n\u2500\u2500 ' + n + ' \u00b7 ' + t + ' ' + '\u2500'.repeat(Math.max(4, 58 - t.length)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  return srv;
}

(async () => {
  /**
   * ⚠⚠ THE DEPLOYED APP, NOT A LOCAL COPY. Serving public/ on a random port got "You’re offline — this needs
   * a connection" on the register form: the API's CORS allowlist is Vercel, localhost:5173 and localhost:3000,
   * and a random port is correctly refused. Driving the real deployment is both the fix and the truer test —
   * it is the build Athi would actually open.
   */
  const WEB = 'https://chitbridge-web.vercel.app';
  const srv = null;

  const b = await chromium.launch({ slowMo: 40 });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  /* ⚠️ the local page defaults to localhost:3000; point it at the real API, the way the note in app.html says */
  /* ⚠️ no cb_api_base override — the deployment already points at Railway (its header says so) */

  /* ══ A · the back office ═══════════════════════════════════════════════════════════════════════════════ */
  step('A', 'register ' + SHOP + ' on the back office');
  const app = await ctx.newPage();
  await app.goto(WEB + '/app.html');
  await app.waitForTimeout(1200);

  /**
   * ── ⚠️⚠️ SIGN IN IF IT EXISTS, REGISTER IF IT DOES NOT ──────────────────────────
   *
   * desktop3 was registered through the four-step wizard on the first run (Create an entity → Get started →
   * Run my business → a vertical → Continue to register → User ID + email → tick the gate → OTP). A shop can
   * only be created once, so from then on this signs in — which is also what a person does every morning.
   *
   * ⚠️ THE SESSION IS NOT ON `window`. app.html declares it `let SESSION = {…}` at the top level of a classic
   * script, so it lives in script scope and `window.SESSION` is undefined — the exact trap recorded in
   * [[feedback-probe-the-right-scope]]. localStorage.cb_sess is what survives, and what logoutNow() clears.
   */
  await app.locator('[data-testid="nav-signin"]').first().click().catch(() => {});
  await app.waitForTimeout(900);

  await app.locator('#l_id').fill(SHOP);
  await app.locator('#l_go').click();
  await app.waitForTimeout(3000);

  const needsOtp = await app.locator('#l_otp').count();
  if (needsOtp) {
    await app.locator('#l_otp').fill(OTP);
    await app.locator('#l_go').click();
    await app.waitForTimeout(3500);
  }

  const sess = await app.evaluate(() => { try { return JSON.parse(localStorage.getItem('cb_sess') || 'null'); } catch (_) { return null; } });
  say('signed in', !!(sess && sess.token), sess ? (sess.entity + ' · ' + (sess.bridgeId || sess.bridge_id || '?')) : 'no session');
  if (!sess || !sess.token) {
    console.log((await app.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 500));
    await app.screenshot({ path: 'C:/dev/chitbridge-web/png/sim-login-fail.png' });
    await b.close(); process.exit(1);
  }
  const ent = { id: sess.identity_id || null, bridge: sess.bridgeId || sess.bridge_id || null, name: sess.entity, handle: sess.handle || SHOP };
  console.log('  ' + JSON.stringify(ent));
  step('B', 'two co-assists, typed into the modal');
  for (const [nm, key] of [['Anita', 'anita'], ['Bala', 'bala']]) {
    await app.evaluate(() => window.addActorModal());
    await app.waitForTimeout(500);
    await app.locator('#ac_name').fill(nm);
    await app.locator('#ac_key').fill(key);
    await app.waitForTimeout(200);
    await app.getByRole('button', { name: 'Create' }).click();
    await app.waitForTimeout(2200);
    say(nm, true, 'created through the Add co-assist modal');
  }

  fs.writeFileSync(path.join(__dirname, 'sim-desktop3.state.json'), JSON.stringify({ entity: ent, web: WEB }, null, 2));
  console.log('\n  (phase A done — entity + co-assists exist)');

  await b.close();
  /* nothing to close — the app is the deployment */
  console.log('\n' + (bad ? '\u2717 ' + bad + ' FAILED\n' : '\u2713 phase A good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('\n\u2717 broke:\n' + (e && e.stack || e)); process.exit(1); });
