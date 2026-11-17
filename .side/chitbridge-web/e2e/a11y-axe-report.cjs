#!/usr/bin/env node
/**
 * OWNS  e2e/a11y-axe-report.cjs: the accessibility BASELINE REPORT, axe over every screen the checkout serves, 3 themes x 2 text sizes.
 * CALLED BY hand on the SIT box (npm run a11y:axe -> docs/testing/A11Y-BASELINE.md) and .github/workflows/a11y-report.yml (workflow_dispatch, never blocking).
 * CARD  none yet (a function card is the librarian's to cut)
 *
 * Athi, 8 Nov 2026: accessibility check built into how we build; step 1 = the automatic check + a baseline across all screens.
 * It is a REPORT, not a gate: it always exits 0 unless it cannot run at all. The proposed gate is in docs/testing/A11Y-BASELINE.md.
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/a11y-axe-report.cjs [--out <dir>] [--only <substr,substr>] [--themes cream,dark,hc] [--sizes m,xl]
 *                                                                [--limit N] [--baseline <a11y.json>]
 *   Writes <out>/a11y-axe.json (everything) and <out>/a11y-axe.md (the short summary). --baseline adds a "new since the baseline" section.
 *
 * WHAT IT VISITS: every row of docs/SCREEN-LIST.md "Small apps" (the register's addresses: /accounts.html#todo ...). A row whose "how to reach it" is an
 *   address is visited at that address; any other row (reached by a press inside a page) is checked at its page, which is said in the report. Sheets
 *   (opened by a press) are not reached by address and are listed as not visited. The site is this checkout's public/ served by e2e/lib/serve.cjs,
 *   the api is the walks' stand-in (e2e/lib/standin.cjs) answering INSIDE the page, signed in as the fixture shop ("Mayur Bhavan"): nothing leaves
 *   the runner, the same set-up the frame-every-width and walk-* harnesses use. The stand-in shop is small, so a screen full of rows in real life
 *   is checked here in its empty/ordinary state: the report says so in its header.
 * THEMES/SIZES: cream, dark, hc (High Contrast) x text size m and xl, set the way a person sets them (localStorage cb_theme / cb_fs, the keys
 *   avatar.js reads), and CONFIRMED on <html data-theme> after the page loads: a screen that did not take the theme is reported, not silently counted.
 * ONE browser, one context per theme x size, screens in sequence (RAM is tight: run on the SIT box, never on the laptop).
 */
'use strict';
const fs = require('fs'), path = require('path');
const A = require('./lib/a11y-check.cjs');
const { serve } = require('./lib/serve.cjs');
const { standIn, route } = require('./lib/standin.cjs');

const WEB = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(__dirname, 'shots', 'a11y')));
const ONLY = String(arg('only', '')).split(',').filter(Boolean);
const THEMES = String(arg('themes', 'cream,dark,hc')).split(',');
const SIZES = String(arg('sizes', 'm,xl')).split(',');
const LIMIT = Number(arg('limit', 0)) || 0;
const BASELINE = arg('baseline', null);
const IMPACTS = ['critical', 'serious', 'moderate', 'minor'];
/* a screen counts as PAINTED (so a clean result means something) only with this much visible text, no sign-in window and no placeholder address */
const PAINTED_MIN = 300;
const isPlaceholder = (url) => /[<>…]/.test(url);
const paintedOk = (r) => !r.error && !!r.painted && r.painted.text >= PAINTED_MIN && !r.painted.signin && !isPlaceholder(r.url);
const THEME_NAME = { cream: 'Cream', dark: 'Dark', hc: 'High Contrast' };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const OWNER = { token: b64({ alg: 'none' }) + '.' + b64({ identity_id: 'ent-M', identity_type: 'entity' }), role: 'entity', name: 'Mayur', entity: 'Mayur Bhavan' };

/** the screens: the "Small apps" table of docs/SCREEN-LIST.md, one entry per ADDRESS, carrying every code that lives there */
function screens() {
  const md = fs.readFileSync(path.join(WEB, 'docs', 'SCREEN-LIST.md'), 'utf8');
  const sec = md.split(/^## /m).find((s) => /^Small apps/.test(s)) || '';
  const byUrl = new Map();
  let sheets = 0;
  for (const line of sec.split('\n')) {
    const c = line.split('|').map((x) => x.trim());
    if (!/^[A-Z]{3}\d{3}$/.test(c[1] || '')) continue;
    const reach = c[5] || '', page = c[4] || '/';
    const direct = /^\//.test(reach) ? reach.split(' ')[0] : null;   /* "/accounts.html#todo · Accounts › To do" -> the address */
    const url = direct || page;
    if (!direct) sheets++;
    const e = byUrl.get(url) || { url, codes: [], names: [], viaPress: !direct };
    e.codes.push(c[1]); e.names.push(c[2]); if (direct) e.viaPress = false;
    byUrl.set(url, e);
  }
  let list = Array.from(byUrl.values());
  if (ONLY.length) list = list.filter((s) => ONLY.some((o) => s.url.includes(o) || s.codes.some((k) => k.includes(o))));
  if (LIMIT) list = list.slice(0, LIMIT);
  return { list, pressRows: sheets };
}

async function main() {
  const t0 = Date.now();
  const { list, pressRows } = screens();
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = require('playwright');   /* here, not at the top: summary() is read without a browser (docs regeneration) */
  const site = await serve(), browser = await chromium.launch();
  const runs = [];   /* one per screen x theme x size */
  const errors = [];
  for (const theme of THEMES) for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    const off = [];
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { off.push(r.request().url()); return r.abort(); });   /* nothing leaves the runner; web fonts fall back */
    const S = standIn();
    await ctx.route('**/api/**', (r) => route(S, r));
    await ctx.addInitScript((v) => { try { localStorage.setItem('cb_sess', JSON.stringify(v.owner)); localStorage.setItem('cb_theme', v.theme); localStorage.setItem('cb_fs', v.size); } catch (_) {} }, { owner: OWNER, theme, size });
    const page = await ctx.newPage();
    page.on('pageerror', () => {});
    for (const s of list) {
      const rec = { url: s.url, codes: s.codes, viaPress: s.viaPress, theme, size };
      try {
        await page.goto('about:blank');
        await page.goto(site.url(s.url), { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(700);
        rec.applied = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme') || null, fs: (localStorage.getItem('cb_fs') || null) }));
        rec.themeTaken = rec.applied.theme === theme;
        rec.paintedText = null;
        rec.painted = await page.evaluate(() => ({ text: (document.body.innerText || '').trim().length, chip: (document.querySelector('[data-testid="screen-id"][data-cbsid]') || {}).textContent ? document.querySelector('[data-testid="screen-id"]').getAttribute('data-cbsid') : null, signin: !!document.querySelector('[data-testid="signin-id"]'), title: document.title.slice(0, 50) }));
        rec.paintedText = rec.painted.text;
        const r = await A.check(page, { maxNodes: 8 });
        rec.violations = r.violations; rec.incomplete = r.incomplete.map((v) => ({ id: v.id, impact: v.impact, count: v.count })); rec.counts = r.counts;
      } catch (e) { rec.error = String(e.message || e).split('\n')[0].slice(0, 200); errors.push(rec.theme + '/' + rec.size + ' ' + s.url + ': ' + rec.error); }
      runs.push(rec);
      process.stdout.write('  ' + theme + '/' + size + ' ' + s.url.padEnd(34) + (rec.error ? ' ERROR ' + rec.error : ' ' + IMPACTS.map((i) => (rec.counts.byImpact[i] || 0) + i[0]).join(' ') + (rec.themeTaken ? '' : '  [theme not taken: ' + rec.applied.theme + ']')) + '\n');
    }
    if (off.length) console.log('  (refused ' + off.length + ' off-host requests, e.g. ' + off[0] + ')');
    await ctx.close();
  }
  await browser.close(); site.close();
  const secs = Math.round((Date.now() - t0) / 1000);
  const doc = { generated: new Date().toISOString(), axe: A.source().meta.version, tags: A.TAGS, themes: THEMES, sizes: SIZES, screens: list.length, pressRowsCheckedAtPage: pressRows,
    standIn: 'fixture shop (Mayur Bhavan) via e2e/lib/standin.cjs; not a real database', seconds: secs, errors, runs };
  fs.writeFileSync(path.join(OUT, 'a11y-axe.json'), JSON.stringify(doc, null, 1));
  fs.writeFileSync(path.join(OUT, 'a11y-axe.md'), summary(doc));
  console.log('A11Y-AXE DONE ' + runs.length + ' runs, ' + list.length + ' screens, ' + errors.length + ' errors, ' + secs + ' s -> ' + OUT);
}

/** the short markdown: totals by combination, top rules, then one line per screen */
function summary(d) {
  const ok = d.runs.filter((r) => !r.error);
  const tot = (rs, f) => IMPACTS.map((i) => rs.reduce((a, r) => a + f(r, i), 0));
  const inst = (r, i) => r.counts.byImpact[i] || 0, nodes = (r, i) => r.counts.nodesByImpact[i] || 0;
  const L = [];
  L.push('# Accessibility baseline (axe-core ' + d.axe + ', WCAG 2.2 AA tags ' + d.tags.join(' + ') + ')', '');
  L.push('Generated ' + d.generated + ' · ' + d.screens + ' screens (addresses from docs/SCREEN-LIST.md) x ' + d.themes.map((t) => THEME_NAME[t] || t).join(', ') + ' x text size ' + d.sizes.join(', ') + ' = ' + d.runs.length + ' runs, ' + d.seconds + ' s · ' + d.errors.length + ' run(s) failed to load.');
  L.push('Set-up: ' + d.standIn + '. axe finds about 57% of accessibility issues (its README): this is a floor, not a pass.');
  L.push('A *violation* = one rule failing on one screen in one theme+size; *nodes* = the elements it names. ' + d.pressRowsCheckedAtPage + ' register rows are reached by a press inside a page, so they are checked at their page only; sheets are not visited.', '');
  const notTaken = ok.filter((r) => !r.themeTaken).length;
  const urls = Array.from(new Set(d.runs.map((r) => r.url)));
  const paintedUrls = urls.filter((u) => d.runs.filter((r) => r.url === u).every(paintedOk));
  const cleanPainted = paintedUrls.filter((u) => d.runs.filter((r) => r.url === u).every((r) => r.counts && r.counts.violations === 0));
  const placeholders = urls.filter(isPlaceholder).length, signins = urls.filter((u) => d.runs.some((r) => r.url === u && r.painted && r.painted.signin)).length;
  const thin = urls.filter((u) => !isPlaceholder(u) && d.runs.some((r) => r.url === u && r.painted && !r.painted.signin && r.painted.text < PAINTED_MIN)).length;
  L.push('**Clean means painted and clean:** of ' + urls.length + ' addresses, ' + paintedUrls.length + ' painted at least ' + PAINTED_MIN + ' characters of text in every run; ' + cleanPainted.length + ' of those are clean to axe. The other ' + (urls.length - paintedUrls.length) + ' are not counted as clean: ' + placeholders + ' placeholder address(es) shown as visited, ' + signins + ' sign-in window, ' + thin + ' near-empty in the stand-in shop (under ' + PAINTED_MIN + ' characters). Their zero means nothing was there to check.', '');
  if (notTaken) L.push('Theme not confirmed on <html> in ' + notTaken + ' run(s): those runs measured the default look.', '');
  L.push('## Totals by theme and text size', '', '| Theme | Size | Runs | critical | serious | moderate | minor | incomplete (needs a person) |', '|---|---|---|---|---|---|---|---|');
  for (const t of d.themes) for (const s of d.sizes) {
    const rs = ok.filter((r) => r.theme === t && r.size === s);
    L.push('| ' + (THEME_NAME[t] || t) + ' | ' + s + ' | ' + rs.length + ' | ' + tot(rs, inst).join(' | ') + ' | ' + rs.reduce((a, r) => a + r.counts.incomplete, 0) + ' |');
  }
  const all = ok;
  L.push('| **All** | | ' + all.length + ' | ' + tot(all, inst).map((n) => '**' + n + '**').join(' | ') + ' | ' + all.reduce((a, r) => a + r.counts.incomplete, 0) + ' |', '', 'Elements (nodes) behind those violations: ' + IMPACTS.map((i, k) => tot(all, nodes)[k] + ' ' + i).join(', ') + '.', '');
  const rules = new Map();
  for (const r of ok) for (const v of r.violations) {
    const e = rules.get(v.id) || { id: v.id, impact: v.impact, help: v.help, wcag: v.wcag, runs: 0, nodes: 0, screens: new Set() };
    e.runs++; e.nodes += v.count; e.screens.add(r.url); rules.set(v.id, e);
  }
  const ranked = Array.from(rules.values()).sort((a, b) => (IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact)) || (b.screens.size - a.screens.size) || (b.nodes - a.nodes));
  const byScreens = Array.from(rules.values()).sort((a, b) => (b.runs - a.runs) || (b.nodes - a.nodes));
  L.push('## Top 10 rules (by runs that fail it)', '', '| Rule | Impact | WCAG | Screens | Runs | Nodes | What |', '|---|---|---|---|---|---|---|');
  for (const e of byScreens.slice(0, 10)) L.push('| ' + e.id + ' | ' + e.impact + ' | ' + (e.wcag.join(', ') || '-') + ' | ' + e.screens.size + ' | ' + e.runs + ' | ' + e.nodes + ' | ' + e.help + ' |');
  L.push('', 'All rules seen: ' + ranked.map((e) => e.id + ' (' + e.impact + ')').join(', ') + '.', '');
  L.push('## Per screen (distinct rules failing in any theme/size, by impact; worst run in brackets)', '', '| Screen | Address | Painted (chars) | crit | serious | mod | minor | Top rules (nodes, worst run) |', '|---|---|---|---|---|---|---|---|');
  const per = new Map();
  for (const r of d.runs) { const a = per.get(r.url) || { codes: r.codes, runs: [] }; a.runs.push(r); per.set(r.url, a); }
  for (const [url, a] of per) {
    if (a.runs.every((r) => r.error)) { L.push('| ' + a.codes.slice(0, 3).join(' ') + ' | ' + url + ' | load failed | | | | | ' + a.runs[0].error + ' |'); continue; }
    const rr = a.runs.filter((r) => !r.error), seen = new Map();
    for (const r of rr) for (const v of r.violations) { const e = seen.get(v.id) || { id: v.id, impact: v.impact, n: 0 }; e.n = Math.max(e.n, v.count); seen.set(v.id, e); }
    const vs = Array.from(seen.values());
    const c = IMPACTS.map((i) => vs.filter((v) => v.impact === i).length);
    const top = vs.sort((x, y) => (IMPACTS.indexOf(x.impact) - IMPACTS.indexOf(y.impact)) || (y.n - x.n)).slice(0, 3).map((v) => v.id + ' (' + v.n + ')').join(', ');
    const worst = rr.slice().sort((x, y) => IMPACTS.reduce((s, i) => s + (inst(y, i) - inst(x, i)) * (100 - 10 * IMPACTS.indexOf(i)), 0))[0];
    const chars = Math.min(...rr.map((x) => (x.painted ? x.painted.text : 0)));
    const tag = isPlaceholder(url) ? ' placeholder' : (rr.some((x) => x.painted && x.painted.signin) ? ' sign-in' : (chars < PAINTED_MIN ? ' thin' : ''));
    L.push('| ' + a.codes.slice(0, 3).join(' ') + (a.codes.length > 3 ? ' +' + (a.codes.length - 3) : '') + ' | ' + url + (a.runs[0].viaPress ? ' (page)' : '') + ' | ' + chars + tag + ' | ' + c.join(' | ') + ' | ' + (top || 'none') + (worst ? ' [' + worst.theme + '/' + worst.size + ']' : '') + ' |');
  }
  if (BASELINE) L.push('', newSince(d));
  return L.join('\n') + '\n';
}

/** critical/serious rule+screen pairs present now and absent from the baseline file: the numbers the proposed gate would act on */
function newSince(d) {
  let b; try { b = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (e) { return '## New since the baseline\n\nbaseline file unreadable: ' + e.message + '\n'; }
  const key = (doc) => { const s = new Set(); for (const r of doc.runs) for (const v of (r.violations || [])) if (v.impact === 'critical' || v.impact === 'serious') s.add(r.url + ' | ' + v.id); return s; };
  const was = key(b), now = key(d), fresh = Array.from(now).filter((k) => !was.has(k)), gone = Array.from(was).filter((k) => !now.has(k));
  return '## New critical/serious since the baseline\n\n' + fresh.length + ' new, ' + gone.length + ' fixed (screen + rule pairs).\n' + fresh.map((k) => '- ' + k).join('\n') + '\n';
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { screens, summary, paintedOk };
