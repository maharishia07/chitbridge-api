/**
 * detail-shot.cjs — is the order/task line really on TWO lines?
 *
 * Athi, 2026-09-01: *"the order / task page doesn't look good, it has to be designed well, in two lines, the
 * first line should have the product Name, (description), next line should have qty and price and the total
 * price."*
 *
 * ⚠️⚠️ A GUARD CANNOT ANSWER THIS. html-syntax, guard-static, token-check and theme-literals all pass on a row
 * that renders as one long line — the question is geometry, and geometry only exists once a browser has applied
 * the CSS. So this measures the y positions of the two boxes and compares them. Not the rule I wrote: the
 * OUTCOME, which is the only reading that survives the rule being overridden somewhere else.
 *
 * ⭐ NO CHIT, NO API, NO SEEDING. Three earlier versions of this probe tried to create a chit to look at, and
 * each failed on something that had nothing to do with the layout — an empty freshly-minted account, a wrong
 * endpoint, a "Failed to fetch". The page's REAL stylesheet and the page's REAL renderer are both present the
 * moment app.html loads; handing contentItems() a fixture and injecting the result needs neither a session nor
 * a server round trip, and tests exactly the same two things.
 *
 * ⚠️ It calls the renderer through the page, because `contentItems` is a top-level function DECLARATION and so
 * is genuinely on window — unlike `let UI`, which is not, and which is what made an earlier probe report
 * "no cart, no flow" about a screen that plainly had both.
 *
 * Run: node e2e/detail-shot.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = process.env.CB_WEB_BASE || 'http://localhost:5173';
const STATE = path.join(__dirname, '.auth', 'user.json');
const flat = (s) => String(s || '').replace(/[ \t\n\r]+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch();
    /* ⚠️ SIGNED IN ONLY SO THE SHELL RENDERS AND THE SCREENSHOT IS USABLE. The measurement itself needs no
     session — the stylesheet and the renderer are both present on the login screen too, and the first run
     proved it there. Nothing below reads any of the account's data. */
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  const say = (s) => console.log('  ' + s);

  await page.goto(BASE + '/app.html');
  await page.waitForTimeout(3000);

  const out = await page.evaluate(() => {
    /* The two shapes a line arrives in: one with a description, one without. */
    const entries = [
      { live: { particulars: 'Pallet wrap, 500mm roll', comment: 'clear, 20 micron', unit: 'roll',
                quantity: 4, price: 890, total: 3560 }, history: [], removed: false },
      { live: { particulars: 'Corrugated carton, 6-pack', unit: 'carton', quantity: 12, price: 250,
                total: 3000 }, history: [], removed: false },
    ];
    if (typeof fmtLine !== 'function' || typeof contentItems !== 'function') {
      return { err: 'fmtLine/contentItems not reachable on the page' };
    }
    const items = entries.map(fmtLine);
    const html = contentItems({ items: items, line_delivery: {}, canAmend: true });

    /* Inject into the real .itab container so the real rules apply. */
    const host = document.createElement('div');
    host.className = 'itab';
    host.id = '__probe_itab';
    host.innerHTML = html;
    (document.querySelector('.db') || document.querySelector('.detail') || document.body).appendChild(host);
    host.scrollIntoView();

    const rows = [];
    host.querySelectorAll('.ir').forEach((r, i) => {
      const nm = r.querySelector('.nm'), qt = r.querySelector('.qt');
      if (!nm || !qt) return rows.push({ i, note: 'row has no .nm/.qt' });
      const a = nm.getBoundingClientRect(), b = qt.getBoundingClientRect();
      rows.push({
        i,
        name: (nm.innerText || '').replace(/\s+/g, ' ').trim(),
        money: (qt.innerText || '').replace(/\s+/g, ' ').trim(),
        /* ⭐ THE CLAIM: the money starts BELOW the name, not beside it. */
        twoLines: Math.round(b.top) > Math.round(a.top) + 2,
        desc: (r.querySelector('.lndesc') || {}).innerText || '',
      });
    });
    const fold = { more: typeof dchipMore === 'function', shows: typeof dchipShows === 'function' };
    return { rows, fold, itemShape: items[0].length };
  });

  if (out.err) { say(out.err); await browser.close(); process.exit(1); }

  say('fmtLine returns ' + out.itemShape + ' parts (4 = no [4] split, 5 = name and description separate)');
  let bad = 0;
  out.rows.forEach((r) => {
    if (r.note) { say('line ' + r.i + ': ' + r.note); bad++; return; }
    if (!r.twoLines) bad++;
    say('line ' + r.i + (r.twoLines ? '  [two lines]' : '  [ONE LINE — not what was asked]'));
    say('    name : ' + flat(r.name));
    say('    money: ' + flat(r.money));
    say('    desc : ' + (r.desc ? '"' + flat(r.desc) + '" set apart' : '(none on this line)'));
  });
  say('the ⋯ fold: ' + (out.fold.more && out.fold.shows ? 'dchipMore + dchipShows present' : 'MISSING'));

  await page.screenshot({ path: path.join(__dirname, 'detail.png') });
  say('shot: e2e/detail.png');
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
