/* till-shopedit.cjs — THE COUNTER FILLS IN ITS OWN SHOP ([TILL-105])
 *
 * Athi, 2026-09-19, across several messages that are one design:
 *   *"yes, counter can edit the shop profile… counter has no password, use the till key alone for the time being."*
 *   *"for initial set-up and anything which requires hard core rule, then do not hesitate to restrict."*
 *   *"if the gstn is given, we can call the validation module from till application and confirm."*
 *   *"if the information is validated and then we can sync to backoffice."*
 *   *"if no gstn, say this shop is not GSTN shop… service tax not registered."*
 *   *"GSTN registration is required only if your sale crosses so and so… not a threat."*
 *
 * ⭐ SO THE TEST IS THE SAME SHAPE AS THE FEATURE: what the counter confirms BEFORE it sends, and what it
 * refuses to send at all. The server's own refusal is covered by snapshot-wire; this is the counter's half.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = process.argv.includes('--shots');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(26) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

/* ⚠️ computed with the module's own algorithm rather than invented — my first four hand-written GSTINs were
   all refused, including the one meant to be valid, which would have made the gate untestable. */
const GOOD = '33AABCU9603R1ZU';         /* Tamil Nadu (33), PAN AABCU9603R */
const BADSUM = '33AABCU9603R1ZX';       /* one character out */

(async () => {
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  /* an unregistered shop — the front door, and the commonest case for a small trader */
  await p.evaluate(() => {
    window.S = { shop: { name: 'Anbu Vegetables', currency: 'INR', country: 'IN', missing: ['gstin', 'address'] },
      items: [], offers: [], at: new Date().toISOString() };
    setMode('sell'); applyLook();
  });

  /* ── the engines that make the confirmation possible ──────────────────────────────────────────────── */
  const eng = await p.evaluate(() => ({
    pm: !!(window.CBProfileMap && CBProfileMap.gstinChecksum),
    ju: !!(window.CBJurisdiction && CBJurisdiction.registrationRule),
    gv: !!(window.CBGov && CBGov.countryOf && CBGov.sense),
  }));
  say('the checker is on the page', eng.pm, 'CBProfileMap.gstinChecksum');
  say('the jurisdiction layer', eng.ju, 'CBJurisdiction.registrationRule');
  say('country from the device', eng.gv, 'CBGov.countryOf(sense())');

  /* ── the panel: unregistered is a STATE, not a gap, and it says when that changes ──────────────────── */
  const panel = await p.evaluate(() => { paintShop(); return (document.getElementById('shopbox') || {}).innerText || ''; });
  say('not a missing field', panel.indexOf('Not registered') >= 0 && panel.indexOf('not set') < 0,
    '"' + panel.split('\n').filter((l) => /regist/i.test(l)).join(' / ') + '"');
  say('the threshold, as info', /40 lakh/.test(panel) && /hill states/.test(panel),
    panel.indexOf('40 lakh') >= 0 ? 'the panel names the threshold and its caveat' : 'no threshold shown');

  /* ── the form opens and offers exactly the fields the server accepts ───────────────────────────────── */
  const form = await p.evaluate(() => {
    shopEditOpen();
    const ks = [...document.querySelectorAll('#shopform input[data-shop]')].map((i) => i.getAttribute('data-shop'));
    return { ks, open: document.getElementById('shopdlg').open,
             note: (document.querySelector('#shopform .note') || {}).innerText || '' };
  });
  say('the form opens', form.open, form.ks.length + ' fields: ' + form.ks.join(' '));
  /* ⚠️ THE TWO A COUNTER MAY NEVER SET — each changes what a bill CHARGES, not what it says */
  say('no currency box', form.ks.indexOf('currency') < 0, 'currency is an installation-layer choice');
  say('no registration box', form.ks.indexOf('reg_type') < 0, 'regular vs composition decides whether tax applies');
  say('and it says why', /changed in ChitBridge/.test(form.note), 'the reason is shown, not hidden');

  /* ── an empty GSTIN says what the shop IS ───────────────────────────────────────────────────────────── */
  const empty = await p.evaluate(() => { shopCheck(); return document.getElementById('shopsay').innerText; });
  say('no GSTIN is an answer', /not registered for GST/i.test(empty), '"' + empty.slice(0, 95) + '…"');
  /**
   * ⭐⭐ THE ₹40 LAKH FIGURE MOVED BEHIND "Why?", AND THIS ASSERTION MOVED WITH IT (2026-09-27).
   * It used to require the threshold paragraph in the default message; the design package Athi brought
   * calls that out by name — "a 47-word GST paragraph pinned at the bottom... tax education, not a form" —
   * so it is now one tap away instead of always on screen. ⚠️ Still asserted, in BOTH directions: the fact
   * a shopkeeper may actually need must remain REACHABLE, and "moved behind a toggle" is one small edit
   * away from "quietly dropped".
   */
  say('the threshold paragraph is no longer pinned to the message', !/40 lakh/.test(empty), 'out of the way');
  const why = await p.evaluate(() => { document.querySelector('[data-testid=till-shop-why]').click();
    return document.getElementById('shopsay').innerText; });
  say('⭐ but "Why?" still produces it, in full', /40 lakh/.test(why) && /register/i.test(why),
    '"' + why.replace(/\s+/g, ' ').slice(-90) + '"');
  await p.evaluate(() => { document.querySelector('[data-testid=till-shop-why]').click(); });   /* fold it back */
  /* ⭐ the document a bill will actually be headed with, said as the badge — the design move the sheet turns on */
  say('and the slip it will print is named, not described', /CASH MEMO/.test(empty), empty.split('·')[0].trim());

  /* ── a mistyped GSTIN is caught HERE, before anything is sent ───────────────────────────────────────── */
  const wrong = await p.evaluate((g) => {
    const i = document.querySelector('#shopform input[data-shop="gstin"]');
    i.value = g; i.dispatchEvent(new Event('input'));
    return { said: document.getElementById('shopsay').innerText,
             bad: document.getElementById('shopsay').className.indexOf('bad') >= 0,
             sendable: shopCheck() };
  }, BADSUM);
  say('a mistyped GSTIN', !wrong.sendable && wrong.bad, '"' + wrong.said.slice(0, 70) + '…"');

  /* ── ⭐ and a good one is CONFIRMED in words the shopkeeper owns ─────────────────────────────────────── */
  const right = await p.evaluate((g) => {
    const i = document.querySelector('#shopform input[data-shop="gstin"]');
    i.value = g; i.dispatchEvent(new Event('input'));
    return { said: document.getElementById('shopsay').innerText, sendable: shopCheck() };
  }, GOOD);
  say('a good one confirms', right.sendable && /Tamil Nadu/.test(right.said) && /AABCU9603R/.test(right.said),
    '"' + right.said + '"');
  /**
   * ⚠️⚠️⚠️ AND IT DOES NOT CLAIM MORE THAN IT DID (2026-09-27). Athi: *"in the GSTN, we are verifying only
   * the checksum, not against registry? correct?"* Correct — so this line must never say "Verified", which
   * in lib/profile-map's own ladder ['declared','copied','checked','verified'] is the rung ABOVE the one
   * assess() gives a passing checksum ('checked'). It is a number printed on a tax invoice; the copy must
   * not round the rung up. This asserts the claim stays honest even if somebody reaches for a stronger word.
   */
  say('⭐ and claims only what it checked — never "verified"', !/verified/i.test(right.said),
    right.said.split('·')[1] ? right.said.split('·')[1].trim() : right.said.slice(0, 30));
  const caveat = await p.evaluate(() => {
    const b = [...document.querySelectorAll('#shopsay b')].find((x) => /checks out/i.test(x.textContent));
    return b ? b.getAttribute('title') || '' : '';
  });
  say('the registry caveat rides in title=, where a fact guarding a number belongs',
    /registry/i.test(caveat), '"' + caveat.slice(-58) + '"');

  /**
   * ── ⚠️⚠️ THE ONE A CHECKSUM CANNOT CATCH: a valid Tamil Nadu GSTIN beside a Kerala PIN code. Both fields are
   * individually correct and the pair is wrong, which is the shape of a real typo.
   */
  const clash = await p.evaluate(() => {
    const pin = document.querySelector('#shopform input[data-shop="pincode"]');
    pin.value = '682001'; pin.dispatchEvent(new Event('input'));   /* Kochi, Kerala (32) */
    return document.getElementById('shopsay').innerText;
  });
  say('state vs PIN disagree', /One of the two is wrong/.test(clash), '"' + clash.slice(-80) + '"');

  /**
   * ⚠️⚠️⚠️ THE SAVE BUTTON MUST BE ON THE SCREEN. Every check above passed while it sat below the fold —
   * nine fields made the dialog taller than the viewport and the primary action was simply not reachable.
   * Only a rect against the viewport catches that; no amount of text assertion will. [[feedback-open-the-render-first]]
   */
  const fit = await p.evaluate(() => {
    const btn = document.querySelector("[data-testid='till-shop-save']");
    const d = document.getElementById("shopdlg");
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    return { found: true, bottom: Math.round(r.bottom), vh: window.innerHeight,
             onScreen: r.bottom <= window.innerHeight + 1 && r.top >= -1 && r.width > 0,
             dlgH: Math.round(d.getBoundingClientRect().height) };
  });
  say("the save button is reachable", fit.found && fit.onScreen,
    fit.found ? ("its bottom is at " + fit.bottom + "px on a " + fit.vh + "px screen (dialog " + fit.dlgH + "px)")
              : "the save button is not in the dialog at all");

  if (SHOTS) {
    const out = path.join(__dirname, '..', 'png', 'ShopEdit.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await p.screenshot({ path: out });
    console.log('  shot                      · png/ShopEdit.png');
  }

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nthe counter sets up its own shop, and checks it first');
  process.exit(bad ? 1 : 0);
})();
