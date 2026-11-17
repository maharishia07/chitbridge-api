'use strict';
/**
 * layout-honest.cjs — text that overlaps, text that is clipped, columns with no name.
 *
 * ── ⭐⭐⭐ WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"think — what is better, and complete the report and the lab. When I try to make the
 * product visible and make it better, I encounter a lot of problems and I kept drifting."*
 *
 * ⚠️⚠️ HE IS DESCRIBING MY WORKING METHOD, NOT HIS. Every fault on the board this week was found by ATHI
 * LOOKING AT A SCREENSHOT: a purpose cut mid-sentence, a row where the chips ran into the name, a header that
 * scrolled away, "CASESPASSEDFAILED", a filter that never announced itself. Each one I fixed where he pointed,
 * and the next screenshot found the next one. That is not him drifting — that is me using him as the test
 * harness for a class of fault a machine can measure.
 *
 * ⭐ SO THIS MEASURES IT. Four checks, all of them things a person sees instantly and no parser can:
 *
 *   1 OVERLAP    two cells in a row whose boxes intersect — "CASESPASSEDFAILED"
 *   2 CLIPPED    an element whose content is wider than its box with nothing to scroll it — the chip riding
 *                over the name, a sentence cut at "for a ."
 *   3 UNNAMED    a grid of values with no header above it — the case rows under PASSED / FAILED / NOT RUN
 *   4 SIDEWAYS   the page itself scrolling horizontally, as opposed to a table that declares it does
 *
 * ⚠️ IT MEASURES A RENDERED PAGE, so it needs the browser and a session. That is the cost of checking the one
 * thing static analysis cannot see, and it is why every previous guard missed all of this: html-syntax,
 * app-syntax, dup-functions and undeclared all pass on a page whose columns are unreadable.
 *
 * ⚠️ AND IT IS NOT A LINTER FOR BEAUTY. It has no opinion about spacing, colour or hierarchy. It reports only
 * where the page is telling the reader something FALSE — a word on top of another word, a value under the
 * wrong heading, a sentence that stops early.
 *
 *   node e2e/layout-honest.cjs                 the deployed Report
 *   node e2e/layout-honest.cjs http://localhost:4173/testing.html?api=http://localhost:4173
 */
const { chromium } = require('@playwright/test');

/* ⚠ NOT named URL: that shadows the global URL constructor, and `new URL(...)` two lines later
   throws 'URL is not a constructor'. The same name-collision this file is built to catch, in this file. */
const PAGE = process.argv[2] || 'https://chitbridge-web.vercel.app/testing.html';
const TOKEN = process.env.CB_SESS || '';

/**
 * ⭐ THE WHOLE CHECK, RUN IN THE PAGE. It has to be in-page: every one of these is a question about boxes the
 * browser has already laid out, and there is no way to ask that from outside.
 */
const PROBE = `(() => {
  const out = { overlap: [], clipped: [], unnamed: [], sideways: null };
  const name = (el) => el.tagName.toLowerCase()
    + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : '')
    + ' “' + (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 28) + '”';

  /* 1 · two cells of one row whose boxes intersect */
  document.querySelectorAll('tr, .chead, .tnode').forEach((row) => {
    const kids = [...row.children].filter((k) => k.getBoundingClientRect().width > 0);
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      if (b.left < a.right - 1.5 && b.top < a.bottom - 1.5 && b.bottom > a.top + 1.5) {
        out.overlap.push(name(kids[i - 1]) + '  OVER  ' + name(kids[i]));
      }
    }
  });

  /**
   * 2 · content wider than its box, with nothing able to scroll it.
   * ⚠️ An element inside an overflow:auto ancestor is FINE — that is a declared scroll, not a clip. Without
   * this exemption every wide table in a .scroll wrapper reports as broken, which is how a guard earns the
   * reputation that gets it switched off.
   */
  const scrollable = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p);
      if (/auto|scroll/.test(o.overflowX) || /auto|scroll/.test(o.overflow)) return true;
    }
    return false;
  };
  document.querySelectorAll('td, th, span, div, b, p').forEach((el) => {
    if (el.children.length) return;                       /* leaves only — a wrapper's overflow is its child's */
    const txt = (el.textContent || '').trim();
    if (txt.length < 4) return;
    if (el.scrollWidth > el.clientWidth + 2 && !scrollable(el)) {
      const o = getComputedStyle(el);
      out.clipped.push(name(el) + '  needs ' + el.scrollWidth + 'px in ' + el.clientWidth
        + (o.textOverflow === 'ellipsis' ? '  (ellipsised)' : '  (CUT, no ellipsis)'));
    }
  });

  /* 3 · a table whose header count does not match its rows */
  document.querySelectorAll('table').forEach((t) => {
    /* ⚠ NOT 'tr:first-child th, thead th' — a table with a <thead> matches BOTH and every header is
       counted twice, which reported "35 headers vs 17 cells" on a table that is perfectly well formed. The
       first guard finding of the day was the guard. */
    /**
     * ⚠️⚠️ :scope, OR IT WALKS INTO A NESTED TABLE. The matrix opens with a bare <tr> and has no <thead> of
     * its own, while the table INSIDE its expanded rows does — so querySelector('thead') found the nested
     * one and reported "3 headers vs 17 cells" on a table that is correct. Both of this guard's header bugs
     * have now been the same mistake: counting cells that belong to a different table.
     */
    const head = t.querySelector(':scope > thead') 
      || t.querySelector(':scope > tbody > tr') || t.querySelector(':scope > tr');
    const th = head ? head.querySelectorAll('th').length : 0;
    const row = [...t.querySelectorAll(':scope > tbody > tr, :scope > tr')]
      .find((r) => r.querySelectorAll(':scope > td').length > 1);
    if (!row) return;
    const td = [...row.querySelectorAll(':scope > td')]
      .reduce((n, c) => n + (parseInt(c.getAttribute('colspan'), 10) || 1), 0);
    if (th && td !== th) out.unnamed.push(name(t) + '  ' + th + ' headers vs ' + td + ' cells');
    if (!th) out.unnamed.push(name(t) + '  NO HEADER ROW at all (' + td + ' columns)');
  });

  /* 4 · the page itself scrolling sideways */
  if (document.body.scrollWidth > window.innerWidth + 2) {
    out.sideways = document.body.scrollWidth + 'px of page in a ' + window.innerWidth + 'px window';
  }
  return out;
})()`;

(async () => {
  const browser = await chromium.launch();
  /* ⭐ the width is an ARGUMENT: 1280 was clean and Athi's screen was not, and a guard that only checks
     the width I happen to have proves nothing about the one he has. */
  const W = Number(process.argv[3]) || 1280;
  const page = await browser.newPage({ viewport: { width: W, height: 900 } });

  const origin = new URL(PAGE).origin;
  if (TOKEN) {
    await page.goto(origin + '/testing.html');
    await page.evaluate((t) => localStorage.setItem('cb_sess', t), TOKEN);
  }
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const views = ['cases', 'summary', 'report', 'reliability'];
  let bad = 0;
  console.log('\n══ IS THE PAGE TELLING THE TRUTH ABOUT ITS OWN LAYOUT ══');
  console.log('   ' + PAGE + '   ' + W + ' wide\n');

  /**
   * ⭐⭐ AND AT THE BIGGEST TEXT SIZE THE PAGE OFFERS, not only the default. Athi reported overlapping headers
   * that 1280 and 820 both render cleanly — because he had pressed A+, and every column on this page is sized
   * in em. A layout guard that only checks the default size checks the one case the user is least likely to
   * be in once you have given them a control.
   */
  const SIZES = [100, 145];
  for (const pct of SIZES) {
  try { await page.evaluate((p2) => { document.documentElement.style.fontSize = p2 + '%'; }, pct); } catch (_) {}
  await page.waitForTimeout(400);
  console.log('  ── text at ' + pct + '%');
  for (const v of views) {
    try { await page.evaluate((x) => (typeof setView === 'function' ? setView(x) : null), v); } catch (_) {}
    await page.waitForTimeout(2500);
    try { await page.evaluate(() => (typeof foldAll === 'function' ? foldAll(true) : null)); } catch (_) {}
    await page.waitForTimeout(1500);

    const r = await page.evaluate(PROBE);
    const n = r.overlap.length + r.clipped.length + r.unnamed.length + (r.sideways ? 1 : 0);
    bad += n;
    console.log('  ' + (v + '            ').slice(0, 13) + (n ? '✗ ' + n : '✓ clean'));
    const show = (label, list) => list.slice(0, 5).forEach((x) => console.log('        ' + label + ' ' + x));
    show('OVERLAP ', r.overlap);
    show('CLIPPED ', r.clipped);
    show('UNNAMED ', r.unnamed);
    if (r.sideways) console.log('        SIDEWAYS ' + r.sideways);
    [r.overlap, r.clipped, r.unnamed].forEach((l) => {
      if (l.length > 5) console.log('        … and ' + (l.length - 5) + ' more');
    });
  }

  }

  await browser.close();
  console.log('\n  ' + bad + ' finding(s)\n');
  /**
   * ⚠️ REPORT-ONLY FOR NOW, and deliberately. A brand-new layout guard that fails a suite on its first run
   * teaches people to skip the suite. It earns the right to gate once its findings have been read once and
   * the false ones are gone — which is the discipline `undeclared.cjs` had to learn the hard way.
   */
  process.exitCode = 0;
})();
