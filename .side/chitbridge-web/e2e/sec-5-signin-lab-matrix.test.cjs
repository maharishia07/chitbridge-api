'use strict';
/* sec-5-signin-lab-matrix.test.cjs — SEC-5 (M14 practice mode): THE SIGN-IN LAB'S SWITCHER WALKS EVERY KIND × EVERY METHOD, THROUGH THE SCREEN.
 * OWNS      public/signin-lab.html mounts the one CBSignin window against the practice server (e2e/lib/signin-standin.cjs); the strip offers every person kind
 *           (owner · employee .br · customer .cr · network store · auditor · accountant · shared contact) × every method (mobile · e-mail · user id).
 *           e2e/signin-window.cjs walks the headline scenarios; THIS walks the whole matrix by CLICKING the strip's buttons: every button exists, a person with no such
 *           id says so, otherwise the typed id goes to /api/signin/ask exactly, the credential box opens EMPTY (nothing prefilled — PLT-13), and the right secret
 *           signs that person in (the chooser for the shared contact, the PIN step for a first-time employee). Laptop 1366×768 and phone 390×844.
 * CALLED BY SIT (sh toolset/sit-box-run.sh <box> e2e <branch> e2e/sec-5-signin-lab-matrix.test.cjs) and by hand · e2e/sec-proofs.red.cjs (mutants)
 *           NOT in ci.yml: the web CI job has no browser (the same reason e2e/signin-window.cjs is not there).
 * FLOW      serve public/ + practice server → click who × by → hint / ask call / box value → type secret → "Signed in" names the person
 * Run: node e2e/sec-5-signin-lab-matrix.test.cjs   (ports from the OS; nothing leaves the machine) */
const { chromium } = require('@playwright/test');
const path = require('path');
const { serve } = require('./lib/serve.cjs');
const practice = require('./lib/signin-standin.cjs');
const PEOPLE = practice.PEOPLE;

let bad = 0, checks = 0;
const say = (l, ok, d) => { checks++; console.log('  ' + String(l).padEnd(92) + (ok ? 'OK' : (bad++, '✗ FAILED ' + (d || '')))); };
/* the window sends a mobile as id, an e-mail as email, a user id as user_id (api routes/signin.js reads id || email || user_id) — always the typed text, untouched */
const sentId = (b) => b.id || b.email || b.user_id;
const METHODS = [['mobile', 'mobile'], ['email', 'email'], ['userid', 'userid']];
const DEVICES = [['laptop 1366x768', { viewport: { width: 1366, height: 768 } }],
  ['phone 390x844', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }]];

(async () => {
  const web = await serve(path.join(__dirname, '..', 'public'));
  const prac = await practice.start();
  const URL = 'http://127.0.0.1:' + web.port + '/signin-lab.html?who=owner&by=mobile&api=' + encodeURIComponent(prac.url);
  const b = await chromium.launch();
  const errs = [];
  for (const [dname, dev] of DEVICES) {
    console.log('\n── ' + dname + ' · every kind × every method, by clicking the strip ' + '─'.repeat(20));
    const ctx = await b.newContext(dev), p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(String(e)));
    const tap = (sel) => (dev.isMobile ? p.tap(sel) : p.click(sel));
    await p.goto(URL);
    await p.waitForSelector('[data-testid="signin-window"]', { state: 'attached', timeout: 15000 });
    const who = await p.$$eval('[data-who]', (els) => els.map((e) => e.dataset.who));
    const by = await p.$$eval('[data-by]', (els) => els.map((e) => e.dataset.by));
    say('the strip offers every kind the practice server has (' + Object.keys(PEOPLE).join(' · ') + ')', Object.keys(PEOPLE).every((k) => who.includes(k)) && who.length === Object.keys(PEOPLE).length, 'who=' + who);
    say('the strip offers every method: mobile · e-mail · user id', METHODS.every(([k]) => by.includes(k)) && by.length === 3, 'by=' + by);
    const kinds = new Set(Object.values(PEOPLE).map((x) => x.kind));
    say('the kinds covered are entity (owner · network) · actor (.br) · customer (.cr)', ['entity', 'actor', 'customer'].every((k) => kinds.has(k)), [...kinds].join(','));

    let combos = 0, signed = 0;
    for (const k of Object.keys(PEOPLE)) {
      const person = PEOPLE[k];
      for (const [m, field] of METHODS) {
        combos++;
        const tag = dname.split(' ')[0] + ' ' + k + ' × ' + m;
        /* each click on the strip re-asks /__practice and re-mounts the window: wait for that answer before the next click, then let the mount land */
        for (const sel of ['[data-who="' + k + '"]', '[data-by="' + m + '"]']) {
          await Promise.all([p.waitForResponse((r) => /__practice/.test(r.url()), { timeout: 10000 }), tap(sel)]);
        }
        await p.waitForFunction((a) => window.__lab.sel.who === a[0] && window.__lab.sel.by === a[1] && window.__lab.practice() && window.__lab.practice().who === a[0], [k, m], { timeout: 10000 });
        await p.waitForSelector('[data-testid="signin-id"]', { timeout: 10000 });
        await p.waitForTimeout(200);
        const want = person[field];
        const typedNode = await p.locator('[data-testid="lab-typed"]').count();
        if (!want) {
          const hint = await p.locator('#hint').textContent();
          say(tag + ': this person has no ' + m + ' — the lab says so and offers another way', typedNode === 0 && /has no/.test(hint), hint);
          continue;
        }
        const typed = await p.locator('[data-testid="lab-typed"]').textContent();
        if (typed !== want) { say(tag + ': the hint names the practice person\'s ' + m, false, typed + ' != ' + want); continue; }
        await tap('[data-testid="signin-id"]'); await p.keyboard.type(typed);
        await tap('[data-testid="signin-go"]');
        await p.waitForSelector('[data-testid="signin-code"], [data-testid="signin-pin"], [data-testid="signin-why"]', { timeout: 10000 });
        const asks = await p.evaluate(() => window.__lab.calls().filter((c) => c.path === '/api/signin/ask'));
        const box = (await p.locator('[data-testid="signin-code"]').count()) ? 'signin-code' : (await p.locator('[data-testid="signin-pin"]').count()) ? 'signin-pin' : null;
        const val = box ? await p.locator('[data-testid="' + box + '"]').inputValue() : null;
        say(tag + ': Continue sends exactly the typed id to /api/signin/ask; the secret box opens EMPTY', asks.length === 1 && sentId(asks[0].body) === typed && box && val === '', JSON.stringify({ asks: asks.length, sent: asks[0] && asks[0].body, box, val }));
        const cred = await p.evaluate(() => { const c = window.__lab.practice().person.cred; return c.pin || c.code; });
        await tap('[data-testid="' + box + '"]'); await p.keyboard.type(cred);
        await tap('[data-testid="signin-verify"]');
        await p.waitForSelector('[data-testid="signin-choice"], [data-testid="signin-pin1"], [data-testid="lab-signed-in"], [data-testid="signin-in"], [data-testid="signin-why"]', { timeout: 10000 });
        if (await p.locator('[data-testid="signin-choice"]').count()) {
          const i = await p.evaluate(() => Array.from(document.querySelectorAll('[data-testid="signin-choice"]')).findIndex((x) => x.textContent.includes('Alpha Timers')));
          await tap('[data-testid="signin-choice"] >> nth=' + Math.max(0, i));
          await p.waitForSelector('[data-testid="signin-pin1"], [data-testid="lab-signed-in"], [data-testid="signin-in"], [data-testid="signin-why"]', { timeout: 10000 });
        }
        if (await p.locator('[data-testid="signin-pin1"]').count()) {
          await tap('[data-testid="signin-pin1"]'); await p.keyboard.type('4826');
          await tap('[data-testid="signin-pin2"]'); await p.keyboard.type('4826');
          await tap('[data-testid="signin-pinsave"]');
        }
        await p.waitForSelector('[data-testid="lab-who"]', { timeout: 10000 }).catch(() => {});
        const name = await p.locator('[data-testid="lab-who"]').textContent().catch(() => null);
        const ok = name !== null && name.includes(person.name);
        if (ok) signed++;
        say(tag + ': the right secret signs ' + person.name + ' in (' + person.kind + ')', ok, 'who=' + name);
      }
    }
    say(dname.split(' ')[0] + ': all ' + combos + ' kind × method cells walked, ' + signed + ' signed in (the rest have no such id)', combos === Object.keys(PEOPLE).length * 3 && signed > 0);
    await ctx.close();
  }
  await b.close(); web.close(); await prac.close();
  say('no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));
  console.log('\n' + checks + ' checks · ' + (bad ? '✗ ' + bad + ' FAILED' : '✓ all good'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
