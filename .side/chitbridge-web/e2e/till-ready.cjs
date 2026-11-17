/* till-ready.cjs — AN UNREADY COUNTER SAYS SO, AND SIGNING OUT DOES NOT STRAND MONEY ([TILL-127])
 *
 * ── ⭐⭐⭐ ATHI'S BRIEF ───────────────────────────────────────────────────────────────────────────────────────
 *
 * *"when the app in use, it should see all the required parameters are intact. if an empty shop is called for
 * load and other initiatives, it has to give a pop up message that store is not signed in yet, sign-in prompt
 * has to showcase. if they are signing out, then that also has to be synced or the couldn't sync due to network
 * has to be informed and close the shop."*
 *
 * ── ⚠️⚠️ THE TWO FAULTS THIS DEFENDS ────────────────────────────────────────────────────────────────────────
 *
 *   1. A SILENT NO-OP. On a counter with no shop, add() found nothing in an empty list and returned without a
 *      word. The key did nothing and said nothing, so the person pressed it again and then blamed the PC.
 *
 *   2. A SIGN-OUT THAT STRANDS SALES. The queue can only be sent by the key that took it, so forgetting the key
 *      with bills waiting abandons them — the same shape as the re-pairing fault that once left five orphaned
 *      stores on one device, except deliberate.
 *
 * Run: node e2e/till-ready.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', 'public');
const KIT = path.join(__dirname, '..', '..', 'chitbridge-api', 'tools', 'tally-connector');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
            '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(30) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (p) => b64({ alg: 'HS256' }) + '.' + b64(p) + '.stub';

(async () => {
  /* ══ PART 1 · the page, blank, in a browser ═══════════════════════════════════════════════════════════ */
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 880 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:' + srv.address().port + '/till.html');
  await p.waitForFunction(() => typeof window.shopReady === 'function', null, { timeout: 30000 });
  await p.waitForTimeout(900);

  console.log('\n── every required parameter, in one answer ' + '─'.repeat(25));
  const rd = await p.evaluate(() => window.shopReady());
  say('it knows it is unfit', rd.ok === false, 'shopReady().ok is false on a blank counter');
  /* ⚠️ [TILL-193] the wording moved again, on purpose — a browser counter's "not signed in" no longer names
   * the mechanism ("key"), it says "due to maintenance" and points at the one fix (sign in again). See that
   * commit's own comment on shopReady() for why. Assertion moved, not deleted.
   * ⭐ M08 (round W1, 2026-10-12): moved once more — a browser with NOTHING on it is a fresh phone, not a fault.
   * "Due to maintenance" is now the KEY holder's story (refreshFailed / keyWatch, till-plain-signin.cjs); a blank
   * phone says "Nobody has signed in on this phone yet" and what that means: sign in, and it bills as you. */
  say('it names the first thing', /nobody has signed in on this phone/i.test(rd.stops[0].why),
    '"' + rd.stops[0].why + '"');
  say('what it MEANS', /sign in with your user id/i.test(rd.stops[0].means) && /bills as you/i.test(rd.stops[0].means),
    'and what that costs, in the shopkeeper’s terms: "' + rd.stops[0].means + '"');
  /**
   * ⚠️⚠️ THE WORD MOVED, AND THE MOVE IS THE POINT ([TILL-187]). This asserted "Sign in" — and so did the
   * fix on a wrong-kind key, and so did the fix for nobody standing at the counter. Three identical
   * instructions for three unrelated problems, which is what Athi walked into: *"There is a real confusion
   * in sign-in procedure in the counter application."*
   *
   * This is a BROWSER counter with no key, so the act it needs is not signing in at all — it is a key, which
   * a browser cannot fetch by signing in. lib/signin.js door() decides the word now, so the assertion asks
   * the same engine the page asks rather than restating a literal that can drift away from it.
   * [[feedback-improvise-update-cases]]
   */
  /**
   * ⚠️⚠️ MOVED, NOT DELETED ([TILL-188]). This asserted act === 'signinOpen'. On a BROWSER counter that
   * function opened a paragraph naming four menu steps in ChitBridge and left the reader to walk them —
   * so the assertion was passing on a fix that could not fix anything, which is the defect it was written
   * to catch. Athi: *"even though it says pair the key, no way of pairing the key."*
   * ⭐ pairAgain() is the one that FINISHES on either host: the OTP flow on the shop PC, and — since [TILL-190]
   * — the SAME sign-in on a browser, which now mints its own key on success (becomeShop(), via usignShopMove()) instead of
   * sending the person to a manual key box. The check now also asserts the page really has that function.
   * [[feedback-improvise-update-cases]]
   */
  const DOORWORD = await p.evaluate(() => window.signDoor().label);
  const CANFIX = await p.evaluate(() => typeof window.pairAgain === 'function');
  say('and what to DO', rd.stops[0].fix === DOORWORD && rd.stops[0].act === 'pairAgain' && CANFIX,
    'the fix is a button, not a sentence about a button — and it says "' + DOORWORD + '"');
  say('⭐ and the button it names is one that can finish', CANFIX,
    'pairAgain() exists on the page — a named act that is not a function is a dead button');
  say('⭐ and it is NOT the same word as signing a person in', DOORWORD !== 'Sign in',
    'a blank browser counter needs a key, not a sign-in');

  /**
   * ⚠️⚠️ NOBODY SIGNED IN MOVED FROM WARN TO **STOP** ([TILL-128]). Athi: *"each counter has to be signed in,
   * at the entity level or at the coassist level. a counter without sign-in is not a right thing — so we can
   * record at this counter who is doing the sale."*
   *
   * ⚠️ IT COULD ONLY BE CLOSED ONCE THERE WAS A WAY THROUGH. A shop with no co-assists had nothing to pick, so
   * refusing would have been a dead end that no shopkeeper could escape; the entity option — "the shop itself,
   * the owner is at the counter" — is what makes the refusal fair.
   */
  const whoStop = rd.stops.find((x) => /Nobody is signed in/i.test(x.why));
  say('nobody is a STOP', !!whoStop, 'a counter with no one signed in may not put anything on a bill');
  /**
   * ⚠️⚠️ THE FIX MOVED FROM openWho TO whoAct ([TILL-187]), and the old wiring was the bug in miniature: a
   * STOP that exists because nobody is signed in offered the one screen that cannot sign anybody in. The
   * picker puts a NAME on a bill — its own last line says *"it is not a sign-in"* — so pressing the fix
   * satisfied the check without the thing the check is for ever happening.
   *
   * ⭐ THE ENTITY OPTION IS NOT LOST, which is what [TILL-128] turned this from a warn into a stop for. It
   * moved UP: lib/signin.js signs an entity in exactly as it signs an employee in — same endpoint, same
   * path, `kind` recorded — so "the owner is at the counter" is now an authenticated answer rather than a
   * choice off a list. [[feedback-improvise-update-cases]]
   */
  say('and it can be fixed', !!(whoStop && whoStop.act === 'whoAct'),
    'the fix opens whichever door this counter actually needs — engine-decided, not hard-wired');

  console.log('\n── ⚠️⚠️ what a blank counter says AT LOAD ' + '─'.repeat(27));
  /**
   * ⚠️⚠️⚠️ NOT A MODAL, AND THAT WAS LEARNED THREE TIMES. A dialog at boot put a box over a counter nobody
   * could click — 13 harnesses timed out on "needdlg intercepts pointer events", and a real blank counter
   * could not have reached ⚙ either. The load-time announcement is the SHELF ([TILL-119], e2e/till-blank.cjs);
   * the modal is for INTENT, which the next block checks.
   */
  say('no box over the counter', await p.evaluate(() => { const d = document.getElementById('needdlg'); return !(d && d.open); }),
    'nothing is covering a blank counter at load');
  say('the shelf says it instead', /not connected to a shop/i.test(await p.evaluate(() => document.body.innerText)),
    'the empty shelf carries the message, where a blank counter has nothing else to show');
  say('with a way forward', await p.locator('[data-testid="till-connect"]').count() > 0,
    'and a Connect button on it');

  console.log('\n── ⚠️ and no keypress is a silent no-op ' + '─'.repeat(28));
  await p.evaluate(() => window.needClose());
  const gated = await p.evaluate(async () => {
    await window.add(0);                       /* on a blank counter this used to do nothing at all */
    const d = document.getElementById('needdlg');
    return !!(d && d.open);
  });
  say('add() speaks up', gated, 'putting something on the bill raises the prompt instead of doing nothing');
  await p.evaluate(() => window.needClose());
  /**
   * ⚠⚠⚠ AND payOpen() DELIBERATELY DOES **NOT** GATE. A gate was put there and taken out: by the time there
   * is a cart the shop has loaded, and if a key were revoked mid-sale the customer is still standing there
   * holding money. A till that refuses to complete a sale is worse than useless — the bill queues locally and
   * goes when it can. add() is the door; pay is not. This asserts the absence so nobody re-adds it.
   */
  say('pay is NOT gated', await p.evaluate(() => {
    const src = String(window.payOpen);
    return src.indexOf('needShop') < 0;
  }), 'taking money is never blocked — a sale in progress must always complete');
  await b.close(); await new Promise((r) => srv.close(r));

  /* ══ PART 2 · signing out, on the real program ════════════════════════════════════════════════════════ */
  console.log('\n── ⚠️⚠️⚠️ signing out must not strand money ' + '─'.repeat(23));
  const dead = { on: false };
  const cb = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const j = (c2, o) => { r.writeHead(c2, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (dead.on) return j(503, { message: 'refusing on purpose' });
    if (q.url.split('?')[0] === '/api/till/snapshot') return j(200, { at: new Date().toISOString(), shop: { country: 'IN', name: 'Anbu' }, items: [] });
    if (q.url.startsWith('/api/till/engine/')) { r.writeHead(200, { 'content-type': 'application/javascript' }); return r.end('//'); }
    return j(200, { chit_id: 'c1', ok: true });
  });
  await new Promise((r) => cb.listen(0, '127.0.0.1', r));
  const api = 'http://127.0.0.1:' + cb.address().port;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cbready-'));
  const key = token({ identity_id: 'e1', bridge_id: 'CB-OUT', display_name: 'Anbu', kind: 'api_key', scopes: ['till'] });
  fs.writeFileSync(path.join(home, 'connector.json'), JSON.stringify({ api, key, till: { id: 'C1' }, printer: 'KeepMe' }, null, 2));
  const dir = path.join(home, 'till-data', '127.0.0.1-' + cb.address().port, 'CB-OUT');
  fs.mkdirSync(dir, { recursive: true });
  /* two sales this counter took and ChitBridge has never seen */
  fs.writeFileSync(path.join(dir, 'queue.jsonl'),
    JSON.stringify({ no: 'Q-1', total: 500, at: new Date().toISOString(), lines: [] }) + '\n'
    + JSON.stringify({ no: 'Q-2', total: 250, at: new Date().toISOString(), lines: [] }) + '\n');

  const start = async () => {
    const pr = spawn(process.execPath, [path.join(KIT, 'till.js'), '--config', path.join(home, 'connector.json'), '--port', '7341'],
      { cwd: KIT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; pr.stdout.on('data', (d) => { out += d; }); pr.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 90; i++) { try { const x = await fetch('http://127.0.0.1:7341/api/state'); if (x.ok) return { pr, out: () => out }; } catch (_) {} await sleep(150); }
    throw new Error('counter never answered\n' + out);
  };
  const stop = (c) => new Promise((r) => { if (!c || c.pr.exitCode !== null) return r(); c.pr.once('exit', r); c.pr.kill(); });
  const out = (force) => fetch('http://127.0.0.1:7341/api/signout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: !!force }) }).then((x) => x.json());

  dead.on = true;                                  /* the line is there, ChitBridge refuses — nothing can drain */
  let c = await start();
  const refused = await out(false);
  say('IT REFUSES', refused.ok === false, 'a sign-out over unsent bills is refused, not performed');
  say('it says how many', refused.queued === 2, 'and names the number: ' + refused.queued + ' bill(s)');
  say('and which wall', typeof refused.online === 'boolean', 'reporting whether the line or ChitBridge is the problem');
  say('the key is still there', !!JSON.parse(fs.readFileSync(path.join(home, 'connector.json'), 'utf8')).key,
    'the counter is still signed in after a refused sign-out');

  console.log('\n── ⚠️ forced: told, and recoverable ' + '─'.repeat(31));
  const forced = await out(true);
  say('forcing works', forced.ok === true && forced.left === 2, 'it signs out and reports ' + forced.left + ' left behind');
  say('it says they are KEPT', /sign back in/i.test(forced.message || ''),
    '"' + String(forced.message).slice(0, 72) + '…"');
  const cfgAfter = JSON.parse(fs.readFileSync(path.join(home, 'connector.json'), 'utf8'));
  say('the key is gone', !cfgAfter.key, 'the counter is no longer signed in');
  /* ⚠️ MERGE-PATCH: everything else this PC was set up with must survive */
  say('the rest survived', cfgAfter.printer === 'KeepMe' && cfgAfter.api === api,
    'the printer and the API base are untouched');
  /**
   * ⚠️⚠️ AND NOTHING WAS DELETED. This is what makes a forced sign-out recoverable, and the whole reason the
   * folder is named after the SHOP rather than the key ([TILL-120]).
   */
  say('THE BILLS ARE STILL THERE', fs.readFileSync(path.join(dir, 'queue.jsonl'), 'utf8').indexOf('Q-1') >= 0,
    'both unsent bills are still in the shop’s own folder, ready for the next sign-in');

  await stop(c);

  console.log('\n── a clean sign-out, with nothing waiting ' + '─'.repeat(26));
  fs.writeFileSync(path.join(home, 'connector.json'), JSON.stringify({ api, key, till: { id: 'C1' } }, null, 2));
  fs.writeFileSync(path.join(dir, 'queue.jsonl'), '');
  dead.on = false;
  c = await start();
  const clean = await out(false);
  say('it just goes', clean.ok === true && !clean.left, 'nothing waiting, so no question is asked');
  say('and says so plainly', /reached the server/i.test(clean.message || ''), '"' + clean.message + '"');

  await stop(c); await new Promise((r) => cb.close(r));
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('\n✗ harness itself broke:\n' + (e && e.stack || e)); process.exit(1); });
