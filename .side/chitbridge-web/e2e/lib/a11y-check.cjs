/**
 * OWNS  e2e/lib/a11y-check.cjs: THE ONE automatic accessibility check for a Playwright page (axe-core, vendored and pinned).
 * CALLED BY e2e/a11y-axe-report.cjs (the baseline report); any walk may call check(page) after it has painted its screen.
 * CARD  none yet (a function card is the librarian's to cut)
 *
 * Athi, 8 Nov 2026: accessibility assessment becomes a built-in, reusable part of how we build. This is the engine of step 1.
 * The baseline is WCAG 2.2 AA: axe tags wcag2a + wcag2aa + wcag21aa + wcag22aa. axe finds about 57% of issues by its own README: a clean result is
 * "nothing axe can see", never "accessible". Pair it with e2e/a11y-contrast.cjs (the themes' declared levels) and the manual keyboard/screen-reader walk.
 *
 *   const A = require('./lib/a11y-check.cjs');
 *   const r = await A.check(page, { include: '#modalhost' });   // → { axe, tags, url, violations[], incomplete[], counts }
 *   violations[i] = { id, impact, help, helpUrl, wcag:[sc], count, nodes:[{ target, screen, html }] }   (nodes capped at maxNodes, count is the true number)
 *
 * ⭐ VENDORED, NEVER A CDN: e2e/vendor/axe-core/axe.min.js (+ LICENSE MPL-2.0, VERSION.json with the sha256). The file's hash is checked on every
 *    load against VERSION.json, so a changed copy is refused rather than run. It is injected with page.evaluate (not a <script> tag), so a page's
 *    own Content-Security-Policy cannot block it and nothing is fetched.
 * ⭐ SCREEN CODE: each node carries the UX-137 code where the element has one: the nearest ancestor's data-cbsid (a component element code such as
 *    APP002-B01), else the page chip's code (screen-id.js: [data-testid=screen-id] data-cbsid), else null.
 * Self-test: node e2e/lib/a11y-check.cjs --self-test  (checks the hash and that a known-bad page is caught by Playwright, when it is installed).
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'vendor', 'axe-core');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
let cached = null;

/** the vendored source, after its sha256 is checked against VERSION.json */
function source(dir) {
  if (!dir && cached) return cached;   /* `dir` is for tests/a11y-check.test.cjs: a temp copy, never cached */
  const meta = JSON.parse(fs.readFileSync(path.join(dir || DIR, 'VERSION.json'), 'utf8'));
  const bytes = fs.readFileSync(path.join(dir || DIR, meta.file));
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha !== meta.sha256) throw new Error('a11y-check: vendored ' + meta.file + ' sha256 ' + sha + ' is not the recorded ' + meta.sha256 + ' (VERSION.json): refusing to run a changed copy');
  const got = { src: bytes.toString('utf8'), meta };
  if (!dir) cached = got;
  return got;
}

/** a WCAG success criterion from axe's tag: wcag143 -> 1.4.3, wcag2411 -> 2.4.11 (levels wcag2a/wcag2aa/wcag21aa are not criteria) */
function criterion(tag) {
  const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
  return m ? m[1] + '.' + m[2] + '.' + m[3] : null;
}

function shape(list, maxNodes) {
  return list.map((v) => ({
    id: v.id, impact: v.impact || null, help: v.help, helpUrl: v.helpUrl,
    wcag: (v.tags || []).map(criterion).filter(Boolean),
    count: v.nodes.length,
    nodes: v.nodes.slice(0, maxNodes).map((n) => ({ target: (n.target || []).join(' '), screen: n.screen || null, html: String(n.html || '').slice(0, 160) })),
  }));
}

/**
 * check(page, { include, tags, maxNodes }) → the axe result for the page as it is now.
 * Waits for nothing: the caller has painted the screen. Never throws on a violation (a report, not a gate); throws only if axe cannot run.
 */
async function check(page, o) {
  o = o || {};
  const { src, meta } = source();
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.evaluate(src);
  const maxNodes = o.maxNodes || 10;
  const tags = o.tags || TAGS;
  const raw = await page.evaluate(async ({ include, tags }) => {
    const ctx = include ? { include: [[include]] } : document;
    const r = await window.axe.run(ctx, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations', 'incomplete'] });
    const chip = document.querySelector('[data-testid="screen-id"][data-cbsid]');
    const tag = (list) => list.map((v) => Object.assign({}, v, { nodes: v.nodes.map((n) => {
      const sel = (n.target || []).length === 1 ? n.target[0] : null;   /* a node in an iframe or shadow root has a longer target: the page chip stands for it */
      let e = null; try { e = sel ? document.querySelector(sel) : null; } catch (_) { e = null; }
      const own = e && e.closest ? e.closest('[data-cbsid]') : null;
      return { target: n.target, html: n.html, screen: own ? own.getAttribute('data-cbsid') : (chip ? chip.getAttribute('data-cbsid') : null) };
    }) }));
    return { violations: tag(r.violations), incomplete: tag(r.incomplete) };
  }, { include: o.include || null, tags });
  const violations = shape(raw.violations, maxNodes), incomplete = shape(raw.incomplete, maxNodes);
  const by = (list, f) => list.reduce((a, v) => { const k = v.impact || 'unknown'; a[k] = (a[k] || 0) + f(v); return a; }, {});
  return { axe: meta.version, tags, url: page.url(), violations, incomplete,
    counts: { violations: violations.length, byImpact: by(violations, () => 1), nodesByImpact: by(violations, (v) => v.count), incomplete: incomplete.length } };
}

module.exports = { check, source, criterion, TAGS };

if (require.main === module && process.argv.includes('--self-test')) {
  (async () => {
    const { meta } = source();
    console.log('ok  vendored axe-core ' + meta.version + ' sha256 matches VERSION.json (' + meta.license + ')');
    let pw; try { pw = require('playwright'); } catch (_) { try { pw = require('@playwright/test'); } catch (__) { console.log('--  playwright not installed here: the page part of the self-test is skipped'); return; } }
    const b = await pw.chromium.launch(), p = await b.newPage();
    await p.setContent('<html lang="en"><head><title>t</title></head><body><main><img src="x.png"><button></button><p style="color:#bbb;background:#fff">low contrast text</p></main></body></html>');
    const r = await check(p), ids = r.violations.map((v) => v.id);
    await b.close();
    const miss = ['image-alt', 'button-name', 'color-contrast'].filter((w) => !ids.includes(w));
    if (miss.length) { console.log('XX  a known-bad page was not caught: missing ' + miss.join(', ') + ' (found ' + ids.join(', ') + ')'); process.exit(1); }
    console.log('ok  a known-bad page is caught: ' + ids.join(', '));
  })().catch((e) => { console.error(e); process.exit(1); });
}
