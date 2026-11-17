/* till-netsim.cjs — A LINE YOU CAN TURN DOWN ([TILL-116])
 *
 * Athi: *"give an icon to set-up network capability like switch off network reduce the speed to 2g and so on,
 * so we can see how it works… you will be able to simulate the combinations, can you?"*
 *
 * ⚠️⚠️ THE SIMULATOR IS ONLY WORTH HAVING IF IT IS FAITHFUL. Almost every "should I queue a bill, offer Send
 * now, try at all" decision asks lineUp() now (Phase 4.1, see till-lineup.cjs), not `navigator.onLine` — but
 * lineUp() itself still bottoms out on the flag as its "no interface" floor, so this override is exactly as
 * load-bearing as it always was. A simulator that only slowed fetch would leave the whole page believing the
 * line was fine and produce behaviour no real outage causes, so the assertions below are mostly about that:
 * does the page BELIEVE it.
 *
 * ⚠️⚠️⚠️ AND A COUNTER LEFT IN "off" MUST NOT LOOK BROKEN. It persists across a reload on purpose — testing
 * whether an offline bill survives a restart is the point — so the banner is the thing that stops somebody
 * debugging a counter that was never faulty.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const SHOTS = process.argv.includes('--shots');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log(String(l).padEnd(28) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

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
  const ctx = await b.newContext({ viewport: { width: 1280, height: 880 } });
  const p = await ctx.newPage();
  const URL = 'http://127.0.0.1:' + srv.address().port + '/till.html';
  await p.goto(URL);
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  console.log('\n── the settings on offer ' + '─'.repeat(36));
  const opts = await p.evaluate(() => Object.keys(NETS).map((k) => k + '=' + NETS[k].label));
  say('the line can be turned down', opts.length >= 4, opts.join('  '));

  /* ══ ⚠️⚠️ OFF MEANS OFF EVERYWHERE, not merely slow ═══════════════════════════════════════════════════ */
  console.log('\n── switched off ' + '─'.repeat(45));
  const off = await p.evaluate(async () => {
    netSet('off');
    const before = navigator.onLine;
    let threw = null;
    try { await fetchBy('/till.html', {}, 5000); } catch (e) { threw = e.name || 'Error'; }
    return { onLine: before, threw,
             banner: (document.getElementById('netbar') || {}).hidden,
             text: (document.getElementById('netbar') || { innerText: '' }).innerText.replace(/\s+/g, ' ').trim(),
             shifted: document.body.classList.contains('neton') };
  });
  /* ⭐ THE PAGE BELIEVES IT — this is what makes the simulation faithful rather than cosmetic */
  say('the page believes it is off', off.onLine === false, 'navigator.onLine is ' + off.onLine);
  say('and a request really fails', off.threw === 'TypeError', 'fetchBy rejected with ' + off.threw);
  /* ⚠️⚠️ AND IT SAYS SO — a counter quietly on a fake dead line is indistinguishable from a broken one.
     ⚠️ /pretend/, not /simulator/ (design-handoff/03-the-line §4, Phase 3.4) — the banner's own copy moved
     to "Pretending: X", the spec's exact wording; this check moved with it rather than being dropped. */
  say('the banner is up', off.banner === false && /pretend/i.test(off.text), '"' + off.text.slice(0, 74) + '"');
  say('and nothing is covered', off.shifted, 'the shell moves down for the banner');

  /* ══ ⭐ A SLOW LINE DELAYS RATHER THAN FAILS ══════════════════════════════════════════════════════════ */
  console.log('\n── very slow · 2G ' + '─'.repeat(43));
  const slow = await p.evaluate(async () => {
    netSet('g2');
    const t0 = Date.now();
    let ok = false;
    try { await fetchBy('/till.html', {}, 20000); ok = true; } catch (_) {}
    return { ms: Date.now() - t0, ok, onLine: navigator.onLine };
  });
  say('2G is slow, not broken', slow.ok && slow.ms >= 1800, 'the request took ' + slow.ms + 'ms and succeeded');
  /* ⚠️ a slow line is still a line — the page must NOT think it is offline and start queueing */
  say('and still counts as online', slow.onLine === true, 'navigator.onLine stays true');

  /* ══ ⚠️⚠️ IT SURVIVES A RELOAD, which is the point — and must announce itself when it does ═══════════ */
  console.log('\n── after a restart ' + '─'.repeat(42));
  const p2 = await ctx.newPage();
  await p2.goto(URL);
  await p2.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
  await p2.waitForTimeout(400);
  const after = await p2.evaluate(() => ({
    now: netNow(),
    banner: (document.getElementById('netbar') || {}).hidden,
    text: (document.getElementById('netbar') || { innerText: '' }).innerText.replace(/\s+/g, ' ').trim(),
  }));
  say('the setting survives', after.now === 'g2', 'it came back on "' + after.now + '"');
  /**
   * ⚠️⚠️⚠️ AND ANNOUNCES ITSELF IMMEDIATELY. A persisted setting with no banner is the whole hazard: the person
   * who finds the counter is not the person who set it, and they will debug a fault that does not exist.
   */
  say('and says so on load', after.banner === false && /pretend/i.test(after.text), '"' + after.text.slice(0, 70) + '"');

  /* ══ ⭐ AND ONE CLICK BACK ════════════════════════════════════════════════════════════════════════════ */
  const back = await p2.evaluate(async () => {
    document.querySelector('[data-testid="till-net-off"]').click();
    await new Promise((r) => setTimeout(r, 100));
    return { now: netNow(), banner: (document.getElementById('netbar') || {}).hidden, onLine: navigator.onLine };
  });
  say('one click restores it', back.now === 'full' && back.banner === true, 'back to full speed, banner gone');

  /* ══ ⚠️⚠️⚠️ AND A REFRESH ON A DEAD LINE SAYS SO ([TILL-143]) ══════════════════════════════════════════
   *
   * Athi: *"when i set the network speed to stop, and when i try to refresh the shop, what it is suppose to
   * say?"* It said NOTHING — netGate rejects, nobody caught it, the busy box vanished and the rejection went
   * unhandled. A counter that swallows a failed read teaches its owner that the button does nothing.
   *
   * ⚠️ AND THE SERVER-ERROR PATH LIED: {ok:false,status:500} fell through and toasted "up to date".
   */
  console.log('\n── a refresh that could not happen ' + '─'.repeat(26));
  /**
   * ⚠️ MOVED, NOT DELETED ([TILL-157]). These read the footer line, because that is where [TILL-143] put the
   * message. Athi, later: *"when the reload is not working, no message is appearing… in icon format?"* — the
   * footer is where a counter puts things nobody has to notice, and a reload that did not happen is the
   * opposite of that. The properties below are the ones they always were; only the surface changed.
   */
  const fail = await p2.evaluate(async () => {
    netSet('off');
    CloudHost.key = 'test-key'; CloudHost.api = location.origin; HOST = CloudHost;
    flashHide();
    await refresh();
    const el = document.getElementById('flash');
    return { shown: !el.hidden, text: el.innerText.replace(/\s+/g, ' ').trim(),
             ico: (el.querySelector('.fico') || {}).innerText,
             go: (el.querySelector('.fgo') || {}).innerText,
             ok: (el.querySelector('.fx') || {}).innerText,
             busy: (document.getElementById('busy') || {}).hidden };
  });
  say('it does not fail silently', fail.shown, '"' + fail.text + '"');
  /* ⭐ SEEN, NOT READ — the symbol carries it for somebody who cannot read the words */
  say('it leads with a symbol', /[\u{1F300}-\u{1FAFF}⚠✕]/u.test(fail.ico || ''), 'icon "' + fail.ico + '"');
  /* ⭐ AND IT OFFERS THE NEXT MOVE, not a description of the problem */
  say('and offers what to do', !!fail.go, 'button "' + fail.go + '"');
  /* ⚠️⚠️ IT STAYS UNTIL OK ([TILL-157]) — Athi: *"it has to stay until click ok."* */
  say('and it waits for OK', /^ok$/i.test(fail.ok || ''), 'dismissed by "' + fail.ok + '", never by a timer');
  say('and the busy box gets out of the way', fail.busy === true, 'busyDone ran');

  /**
   * ⚠️⚠️⚠️ THE CAUSE PICKS THE MESSAGE. Athi: *"depends on what the issue is — say not signed in, network
   * issue, whatever it may be."* One message for every failure is never wrong and never helps: a revoked key
   * and a dead line look identical and need completely different things done about them.
   */
  const causes = await p2.evaluate(async () => {
    const out = {};
    [[0, 'line'], [401, 'key'], [500, 'shop']].forEach(function (pair) {
      flashHide(); refreshFailed(pair[0]);
      const el = document.getElementById('flash');
      out[pair[1]] = { ico: el.querySelector('.fico').innerText, go: el.querySelector('.fgo').innerText,
                         slashed: !!el.querySelector('.noico') };
    });
    flashHide();
    return out;
  });
  /**
   * ⚠️ MOVED ([TILL-158]). This asked for the glyph 🚫. Athi: *"change to No Network with the network symbol
   * crossed — image as much as possible."* A generic prohibition sign is not a picture of a network; the bars
   * with a line through them are. The property is that it is the NETWORK symbol and that it is CROSSED.
   */
  say('no network shows crossed bars', causes.line.slashed && /📶/.test(causes.line.ico),
      JSON.stringify(causes.line));
  /**
   * ⚠️⚠️ MOVED ([TILL-187]). This asked for the literal words "sign in" — and that literal was the defect
   * Athi reported: *"There is a real confusion in sign-in procedure in the counter application."* A refused
   * KEY is not a person failing to sign in, and telling a shopkeeper to sign in when the problem is the key
   * on the PC sends them to the wrong screen. The property worth holding is that the flash offers the
   * DEVICE door — whichever this surface has — and that it is a different word from a dead line.
   * lib/signin.js owns that word now, so the check asks the engine rather than restating it.
   * [[feedback-improvise-update-cases]]
   */
  const KEYWORD = await p2.evaluate(() => window.keyWord());
  say('a dead key offers the KEY door', causes.key.go === KEYWORD,
      JSON.stringify(causes.key) + ' — the engine calls it "' + KEYWORD + '"');
  say('⭐ and not the same word as a dead line', causes.key.go !== causes.line.go,
      '"' + causes.key.go + '" vs "' + causes.line.go + '"');
  say('and a silent shop is a third thing', /try again/i.test(causes.shop.go), JSON.stringify(causes.shop));
  say('the three are told apart by the symbol alone',
      new Set([causes.line.ico, causes.key.ico, causes.shop.ico]).size === 3,
      [causes.line.ico, causes.key.ico, causes.shop.ico].join(' '));

  const lied = await p2.evaluate(async () => {
    netSet('full');
    HOST = { mode: 'cloud', refresh: async () => ({ ok: false, status: 500 }) };
    flashHide();
    await refresh();
    const el = document.getElementById('flash');
    return { shown: !el.hidden, text: el.innerText.replace(/\s+/g, ' ').trim(),
             note: document.getElementById('lastnote').textContent };
  });
  /* ⚠️⚠️ a refused read reporting success is the one answer that stops somebody looking */
  say('a refused read is not "up to date"', lied.shown && !/up to date/i.test(lied.note),
      '"' + lied.text + '"');
  /* ══ ⭐⭐⭐ AND IT SAYS WHAT IT BREAKS, AT THE PLACE YOU SWITCH IT ON ([TILL-144] → [TILL-153]) ═══════
   *
   * Athi: *"can you bring what are to be affected in the test location itself?"* A simulator that will not
   * name its consequences makes a tester guess which failures are theirs, and a guess goes wrong both ways.
   *
   * ⚠️ MOVED, NOT DELETED. These asserted a bullet list that no longer exists: the panel was rebuilt for
   * somebody who cannot read ([TILL-152]) into a face, three counts and one button, and the names now live
   * behind the tile you tap. Every property below is the one it always was — that the consequences are
   * NAMED, that what still works is said, and that billing is never among the casualties.
   */
  console.log('\n── what the simulation affects ' + '─'.repeat(30));
  const what = await p2.evaluate(async () => {
    netSet('off');
    LINE_TRIES = []; for (let i = 0; i < 20; i++) lineNote(false);
    document.querySelector('[data-testid="till-net-what"]').click();
    await new Promise((r) => setTimeout(r, 400));
    const dlg = document.getElementById('linedlg');
    /* ⭐ DRIVE THE CONTROL: the names are behind the locked tile, exactly as a person would find them */
    document.querySelector('[data-testid="till-line-tile-need"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const locked = document.querySelector('[data-testid="till-line-tell-need"]');
    document.querySelector('[data-testid="till-line-tile-ok"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const ok = document.querySelector('[data-testid="till-line-tell-ok"]');
    return { open: !!(dlg && dlg.open),
             stopText: locked ? locked.innerText.replace(/\s+/g, ' ') : '',
             stop: locked ? locked.querySelectorAll('.lcard').length : 0,
             okText: ok ? ok.innerText.replace(/\s+/g, ' ') : '',
             head: (document.querySelector('[data-testid="till-line-banner"]') || { innerText: '' }).innerText };
  });
  say('the panel opens from the bar', what.open, 'one panel, opened where the line is set');
  say('and it is specific, not "things may not work"', what.stop >= 4, what.stop + ' named consequences');
  /* ⭐ THE HALF A TESTER NEEDS MOST — what is still expected to work, so a real fault stands out */
  say('it also says what still works', /Selling and billing/.test(what.okText), 'the working list is there');
  say('and that billing is not at risk', /Selling and billing/.test(what.okText) && /Taking money/.test(what.okText),
      'selling and taking money are listed as carrying on');
  /* ⚠️⚠️ THE ROWS THAT COST REAL MONEY IF A TESTER DOES NOT KNOW THEY STOPPED */
  ['Closing the counter', 'Changes made by other counters'].forEach((n) => {
    say('it names: ' + n.toLowerCase(), what.stopText.indexOf(n) >= 0, 'listed');
  });
  /* ⚠️⚠️ AND EVERY BLOCKED ROW CARRIES ITS WAY ROUND IT, ON ITS OWN CARD (spec §8.2) */
  say('each blocked row says what to do instead', /Keep the counter open/.test(what.stopText),
      'the way round it is on the card');
  /* ⭐ NEVER "believes", never "REFUSED", never "the server" — the package bans all three by name (§4) */
  say('and it does not hedge or shout', !/believes|REFUSED/i.test(what.stopText + what.head),
      '"' + what.head.replace(/\n/g, ' ') + '"');
  await p2.evaluate(() => lineClose());

  /* ══ ⚠️⚠️⚠️ AND THE WATCHDOG REPORTS THE SAME ROWS WHEN ONE REALLY STOPS ════════════════════════════ */
  console.log('\n── the watchdog ' + '─'.repeat(45));
  const dog = await p2.evaluate(async () => {
    netSet('full');
    WATCH_WAS = null;
    document.getElementById('lastnote').textContent = '';   /* the previous section left a line here */
    watchTick();                                  /* the baseline — must say nothing */
    const first = document.getElementById('lastnote').textContent;
    /* ⚠️ a REAL fault, not a simulated one: the device stops being able to save */
    MEM.fail = true;
    document.getElementById('lastnote').textContent = '';
    watchTick();
    const spoke = document.getElementById('lastnote').textContent;
    document.getElementById('lastnote').textContent = '';
    watchTick();                                  /* nothing changed — must not repeat itself */
    const again = document.getElementById('lastnote').textContent;
    MEM.fail = false;
    /* ⚠️ the state comes from the last 20 ATTEMPTS now ([TILL-151]) — a line is not back until something gets through */
    LINE_TRIES = []; for (let i = 0; i < 5; i++) lineNote(true);
    document.getElementById('lastnote').textContent = '';
    watchTick();
    const back = document.getElementById('lastnote').textContent;
    return { first, spoke, again, back, rows: watchNow().length };
  });
  say('one list, both readers', dog.rows >= 10, dog.rows + ' rows watched');
  say('the first reading is a baseline', dog.first === '', 'it does not announce the state it started in');
  say('a real fault is reported', /Saving a bill/.test(dog.spoke) && /ring for help/i.test(dog.spoke),
      '"' + dog.spoke + '"');
  /* ⚠️ a line that repeats every 15s is wallpaper, and wallpaper is how the next real one is missed */
  say('and it does not repeat itself', dog.again === '', 'silent while nothing changes');
  say('and it says when it comes back', /working again/i.test(dog.back), '"' + dog.back + '"');

  /* ⚠️⚠️ NEVER DIAGNOSE A FAULT SOMEBODY CHOSE ([TILL-140]) — except the one that loses work */
  const quiet = await p2.evaluate(async () => {
    netSet('off');
    WATCH_WAS = null; watchTick();
    document.getElementById('lastnote').textContent = '';
    WATCH_WAS = '';                                /* pretend everything was fine a moment ago */
    watchTick();
    const said = document.getElementById('lastnote').textContent;
    MEM.fail = true;
    document.getElementById('lastnote').textContent = '';
    WATCH_WAS = '';
    watchTick();
    const loud = document.getElementById('lastnote').textContent;
    MEM.fail = false; netSet('full');
    return { said, loud };
  });
  say('it stays quiet about a simulated outage', quiet.said === '', 'the bar is already saying so');
  say('but never about losing work', /Saving a bill/.test(quiet.loud), '"' + quiet.loud + '"');

  /* ══ ⚠️⚠️⚠️ AND NOTHING HANGS OVER THE COUNTER AT REST ([TILL-148]) ═══════════════════════════════════
   *
   * Athi sent a screenshot of a live shop with an empty white box across the header and a thin orange strip
   * above it. `.netbar` and `.netwhat` set `display`, which beats the user agent's `[hidden]{display:none}`,
   * so BOTH drew on every counter whether the simulator was on or not. The banner had done so since it was
   * built.
   *
   * ⚠️⚠️ THE OLD CHECK SAID "banner gone" — it read el.hidden, which was true the whole time. The property
   * was right and the pixels were wrong. And when the fix was first written it landed INSIDE the multi-line
   * .netbar rule, breaking the CSS; the source guard passed on that too. Only geometry settles it.
   */
  console.log('\n── at rest ' + '─'.repeat(50));
  const rest = await p2.evaluate(() => {
    netSet('full');
    const box = (id) => { const r = document.getElementById(id).getBoundingClientRect();
                          return Math.round(r.width) + 'x' + Math.round(r.height); };
    return { bar: box('netbar'), what: box('netwhat') };
  });
  say('the banner takes no space', rest.bar === '0x0', 'netbar measures ' + rest.bar);
  say('and nor does the affects panel', rest.what === '0x0', 'netwhat measures ' + rest.what);

  /* ══ ⭐⭐⭐ THE CONSEQUENCES OPEN WHERE THE LINE IS SET ([TILL-149]) ═══════════════════════════════════ */
  console.log('\n── at the switch ' + '─'.repeat(44));
  const inline = await p2.evaluate(async () => {
    netSet('off');
    openStuck();
    await new Promise((r) => setTimeout(r, 400));
    const el = document.querySelector('[data-testid="till-net-inline"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const sel = document.querySelector('[data-testid="till-net-sim"]');
    const sr = sel ? sel.getBoundingClientRect() : null;
    return { hidden: el.hidden, tiles: el.querySelectorAll('.ltile').length, h: Math.round(r.height),
             below: sr ? r.top >= sr.top : false,
             text: el.innerText.replace(/\s+/g, ' ').trim() };
  });
  say('the list is at the switch', !!inline && !inline.hidden, 'it renders in the panel that sets the line');
  say('and it is under the control', !!inline && inline.below, 'below the Line chooser, not elsewhere');
  /* ⚠️ MOVED ([TILL-153]): it is the same PANEL now, not a second list — which is the stronger property */
  say('and it is the same panel', !!inline && inline.tiles === 3, (inline || {}).tiles + ' tiles, as on the pill');

  /* ⭐ IT FOLLOWS THE SWITCH — the consequence is on screen before the person looks away from the control.
     ⚠️ W1 (2026-10-12): the panel paints what the counter MEASURES (§4 "nothing in the grid is pretend"): with the line
     set to Stop the face is "Keep selling" (the device says it has no line); at 2G a send that has not happened yet is
     not a failure, so the face stays measured and the BANNER names the pretence ("Very slow · 2G"). The old check read
     "Slow" off a 2G panel that had never sent anything — a number the counter does not have. */
  say('changing the setting changes the panel', !!inline && /Keep selling/i.test(inline.text),
      'Stop: the face says Keep selling — "' + ((inline || {}).text || '').slice(0, 60) + '"');
  const followed = await p2.evaluate(async () => {
    netSet('g2');
    await new Promise((r) => setTimeout(r, 200));
    const el = document.querySelector('[data-testid="till-net-inline"]');
    const bar = (document.getElementById('netbar') || {}).innerText || '';
    const slow = { shown: !el.hidden, text: el.innerText.replace(/\s+/g, ' ').trim(), bar: bar.replace(/\s+/g, ' ').trim() };
    netSet('full');
    await new Promise((r) => setTimeout(r, 200));
    return { slow, gone: el.hidden };
  });
  say('…2G keeps the panel, and the banner names the pretence', followed.slow.shown && /Very slow/i.test(followed.slow.bar),
      '2G: panel shown=' + followed.slow.shown + ' · banner "' + followed.slow.bar.slice(0, 50) + '"');
  /* ⭐ IT FOLLOWS THE SWITCH — back at full speed the same panel says all is well rather than emptying */
  say('and full speed says so', followed.gone === false, 'the panel stays and reports a good line');

  if (SHOTS) {
    await p2.evaluate(() => netSet('off'));
    const out = path.join(__dirname, '..', 'png', 'NetSim.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await p2.screenshot({ path: out });
    console.log('  shot                        · png/NetSim.png');
  }

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\nthe line can be turned down, and it says so while it is');
  process.exit(bad ? 1 : 0);
})();
