'use strict';
/* ── e2e/selfbill.cjs — RECORD A SALE, END TO END ──────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-02: *"when I did a self chit, i clicked two items, but the chit came out with zero item… self
 * chit is very complicated. if you assume self chit is kind of billing application, so almost all the details
 * are available, so no need of too many forms, just select the items and confirm the total and send. other
 * items like date and other things are not must or may be on a picker. not too many clicks."*
 *
 * ⭐⭐ WHAT THIS ASSERTS IS THE PRESS COUNT, not merely that a chit exists. Open · + · + · Record — four presses,
 * and it fails if any of them stops carrying its weight: no search box, an unstyled list, a total the reader
 * cannot see, a primary that does not name what it will do, or a chit that comes out with the wrong lines.
 *
 * ── ⚠️ THREE THINGS THIS PROBE GOT WRONG BEFORE IT GOT THEM RIGHT ─────────────────────────────────────────────
 *
 * 1. **It counted the OFFERED rows.** The first version trusted that a cart holding a catalogue must be showing
 *    one. It was not: `sb_pick` was zero bytes long because the cart does not paint itself on create, and every
 *    other screen happens to repaint immediately after creating one. Counting rows found it in a single run.
 *
 * 2. **It read `STORE.chits`, which holds only the OPEN TAB.** A self-chit landing in another tab read as
 *    "nothing was created" — and reported a send that had gone through, toast and all, as a failure. The proof
 *    of a write is the API, never a view that may not be looking at it.
 *
 * 3. **It slept 7 seconds instead of waiting on the write.** That passed against a warm API and failed against a
 *    cold one, and the failure is indistinguishable from "the button did nothing". Wait on the modal detaching.
 *
 * Run: node e2e/selfbill.cjs          (needs the dev server on :5173 and e2e/.auth/user.json)
 * Writes sb-1..6*.png beside itself — the screenshots are the point as much as the exit code.
 */
const { chromium } = require('@playwright/test');
const { attachSession } = require('./session.cjs');
const path = require('path');
const shot = (n) => path.join(__dirname, 'sb-' + n + '.png');
const say = (s) => console.log('  ' + s);

/**
 * ⚠️ SEED WHAT THE PROBE NEEDS. An earlier version leaned on the shared account happening to hold products —
 * true until the session was re-minted, after which every assertion failed on an empty catalogue and read as a
 * broken screen. A probe that depends on leftover data is a probe that expires without telling anyone.
 */
async function seedCatalogue(p, wanted) {
  const have = await p.evaluate(async (want) => {
    await ensureCatalogue(true);
    const names = (STORE.catalogue || []).map((x) => x.particulars);
    const missing = want.filter((w) => !names.includes(w.name));
    for (const m of missing) {
      await api('prodAdd', { body: { item_data: { name: m.name, unit: 'piece', price: m.price } } }).catch(() => null);
    }
    await ensureCatalogue(true);
    return (STORE.catalogue || []).length;
  }, wanted);
  return have;
}

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ storageState: path.join(__dirname, '.auth', 'user.json'), viewport: { width: 1180, height: 800 } });
  /* ⚠️ SIGN IN AND PIN THE API BEFORE THE FIRST goto — see session.cjs; both are inherited accidents otherwise. */
  const where = await attachSession(c);
  const p = await c.newPage();
  p.on('pageerror', (e) => say('PAGEERROR ' + String(e.message || e).slice(0, 240)));
  say('session   · minted for ' + where.origin + ' · API ' + where.apiBase);
  await p.goto('http://localhost:5173/app.html');
  await p.waitForTimeout(4200);
  const stock = await seedCatalogue(p, [{ name: 'Sugar, 1kg', price: 52 }, { name: 'Tea, 250g packet', price: 180 }]);
  say('catalogue · ' + stock + ' product(s) to sell');

  await p.screenshot({ path: shot('1-rail'), clip: { x: 0, y: 100, width: 300, height: 620 } });
  say('1  rail       · "Record a sale" sits under CATALOGUE');

  await p.evaluate(() => selfBillOpen());
  await p.waitForTimeout(3800);
  await p.screenshot({ path: shot('2-open') });
  const a = await p.evaluate(() => ({
    rows: document.querySelectorAll('#sb_list .cbcat-row').length,
    search: !!document.querySelector('[data-testid="sb-search"]'),
    css: !!document.getElementById('cbcat_css'),
    primary: (document.getElementById('sb_go') || {}).textContent || '',
  }));
  say('2  opened     · ' + a.rows + ' rows · search=' + a.search + ' · styles=' + a.css + ' · primary "' + a.primary.trim() + '"');

  await p.fill('[data-testid="sb-search"]', 'tea');
  await p.waitForTimeout(1300);
  const nf = await p.evaluate(() => document.querySelectorAll('#sb_list .cbcat-row').length);
  await p.screenshot({ path: shot('3-search') });
  say('3  typed tea  · ' + nf + ' row(s) left of ' + a.rows);

  await p.fill('[data-testid="sb-search"]', '');
  await p.waitForTimeout(1200);
  const ids = await p.evaluate(() => [...document.querySelectorAll('#sb_list .cbcat-row')].map((r) => r.dataset.testid).slice(0, 2));
  for (const id of ids) {
    await p.locator('[data-testid="' + id + '"] [data-testid="cart-add"]').click();
    await p.waitForTimeout(1000);
  }
  await p.screenshot({ path: shot('4-picked') });
  const t = await p.evaluate(() => ({
    total: (document.querySelector('[data-testid="sb-total"]') || {}).innerText || '',
    lines: UI._sbCart.lines(),
    primary: (document.getElementById('sb_go') || {}).textContent || '',
    subject: (document.querySelector('[data-testid="sb-subject"]') || {}).value || '',
    /* ⭐ THE TOTAL MUST BE ON SCREEN, not merely in the DOM — that is the whole of "confirm the total". */
    totalSeen: (function () { const e = document.querySelector('[data-testid="sb-total"]'); if (!e) return false;
      const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })(),
  }));
  say('4  two presses· total ' + t.total + ' · primary "' + t.primary.trim() + '" · subject "' + t.subject + '"');

  await p.evaluate(() => { const d = document.querySelector('#sb_foot details'); if (d) d.open = true; });
  await p.waitForTimeout(500);
  await p.screenshot({ path: shot('5-more') });
  say('5  "more"     · date + note, closed by default');

  await p.click('[data-testid="sb-record"]');
  /* ⚠️ WAIT ON THE WRITE, NOT ON A CLOCK. A fixed 7s passed on a warm API and failed on a cold one, and the
     failure reads identically to 'the button did nothing'. */
  await p.waitForSelector('[data-testid="selfbill"]', { state: 'detached', timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(2500);
  const after = await p.evaluate(async () => {
    const modal = !!document.querySelector('[data-testid="selfbill"]');
    /* ⭐ INBOX, NOT SENT — a self-chit is delivered TO you, so your own copy is what proves it landed. */
    const r = await api('inbox', { query: { page: 1, limit: 5, sort: 'date', dir: 'desc' } }).catch((e) => ({ err: String(e && e.message || e) }));
    /* ⚠️ inbox answers with a BARE ARRAY here, not {chits:[…]} — reading .chits off it gave n=0 and read as
       'nothing was created' twice in a row. */
    const arr = Array.isArray(r) ? r : ((r && (r.chits || r.items)) || []);
    const top = arr[0] || {};
    let full = null;
    if (top.chit_id) full = await api('chit', { params: { id: top.chit_id } }).catch(() => null);
    /* the chit detail carries its lines under `detail`, not `line_items` */
    /* ⚠️ `detail` is an OBJECT holding the lines, not the array itself — a fair reminder that a key name is
       not a shape. */
    const d = full && full.detail;
    const li = (Array.isArray(d) ? d : (d && (d.line_items || d.lines || d.items))) || (full && full.line_items) || null;
    const dkeys = d && !Array.isArray(d) ? Object.keys(d).join(',') : '(array)';
    const fkeys = full ? Object.keys(full).join(',') : 'null';
    const recips = (top.all_recipients || (full && full.header && full.header.all_recipients) || []).map((x) => x.role + ':' + (x.display_name || x.bridge_id || x.name || '?'));
    return {
      fkeys: fkeys + ' detail{' + dkeys + '}', err: r && r.err, keys: r ? Object.keys(r).join(',') : 'null', modal: modal, n: arr.length,
      subject: top.manual_subject || top.subject || (full && full.header && (full.header.manual_subject || full.header.subject)) || '',
      items: li ? li.length : -1,
      names: li ? li.map((l) => l.particulars || l.item_name || l.name) : [],
      recips: recips,
    };
  });
  await p.evaluate(() => { try { navTo('order'); } catch (e) {} });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: shot('6-recorded') });
  say('6  recorded   · modal closed=' + !after.modal + (after.err ? ' · API ' + after.err : '') + ' · sent keys [' + after.keys + '] n=' + after.n);
  say('             newest sent: "' + after.subject + '" · ' + after.items + ' line(s) ' + JSON.stringify(after.names) + ' · detail keys [' + after.fkeys + ']');
  say('             recipients : ' + JSON.stringify(after.recips));

  const ok = a.css && a.rows > 1 && a.search && nf < a.rows
    && t.lines === 2 && /2 items/.test(t.primary) && t.totalSeen
    && !after.modal && after.items === 2;
  say(ok ? '\n  + four presses end to end: open · + · + · Record' : '\n  x check the numbers above');
  await b.close();
  process.exit(ok ? 0 : 1);
})();
