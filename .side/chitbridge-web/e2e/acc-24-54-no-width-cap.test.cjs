/**
 * acc-24-54-no-width-cap.test.cjs — ACC-24 and ACC-54 (proof 2026-11-14): at 1920 wide, Accounts (accounts.html) and CRM (crm.html) carry NO content max-width cap, and nothing forces a sideways scroll.
 * OWNS      the proof on the real page CSS (no browser: the <style> blocks are flattened into rules, each @media condition is evaluated at a 1920 x 1080 viewport, @media print / @container / @keyframes dropped):
 *           (1) the layout chain (body, .main, .content, .screen, #bk_body) gives no max-width and no fixed width, so a wide screen is used, not left empty beside a 1400 / 1100 px column;
 *           (2) every max-width in px that applies at 1920 is a PROSE or card cap (<= 820: .card 560, .todo 760, .pe-card 820) - nothing from 900 up, the old 1400 / 1100 caps are gone;
 *           (3) nothing sets a fixed min-width / width of 1000 px or more on the layout chain, and no overflow-x scroll on it, so the table is not pushed sideways;
 *           (4) tables sit under max-width:100% (accounts), the one width rule a table needs.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/acc-24-54-no-width-cap.test.cjs
 *
 * THE HAND CASE: viewport 1920. The old caps were 1400 (accounts, ACC-24) and 1100 (crm, ACC-54): 1920 - 1400 = 520 px, 1920 - 1100 = 820 px of empty screen. With no cap the content box is
 * the whole main column, so the widest px cap left on either page is the 820 px .pe-card (prose), well under the 900 px floor of a content cap.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const VIEW_W = 1920;
let bad = 0;
const ok = (c, m, why) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (!c && why ? '\n          ' + why : '')); if (!c) bad++; };

/** every <style> block of the page, and its own sheet linked from /app/ ((?:accounts|crm)-page.css), in page order */
const styleOf = (file) => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
  const parts = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|<link rel="stylesheet" href="\/app\/((?:accounts|crm)-page.css)">/g)].map((m) => m[1] || fs.readFileSync(path.join(__dirname, '..', 'public', 'app', m[2]), 'utf8'));
  return parts.map((css) => css.replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
};

/** does a media condition hold at VIEW_W? only width queries are understood; anything else (print, prefers-*, hover) is treated as not applying to this screen view */
function mediaHolds(cond) {
  const c = cond.trim().toLowerCase();
  if (/print|prefers-|hover|pointer|orientation|forced/.test(c)) return false;
  const parts = c.replace(/^only\s+screen\s+and\s*/, '').replace(/^screen\s+and\s*/, '').split(/\band\b/);
  return parts.every((p) => {
    const m = p.match(/\(\s*(min|max)-width\s*:\s*([\d.]+)px\s*\)/);
    if (!m) return false;
    return m[1] === 'min' ? VIEW_W >= Number(m[2]) : VIEW_W <= Number(m[2]);
  });
}

/** flatten css text into [{ sel, body }] for the rules that apply at VIEW_W */
function rulesAt(css) {
  const out = [];
  let i = 0;
  const readBlock = (start) => { let d = 0; for (let j = start; j < css.length; j++) { if (css[j] === '{') d++; else if (css[j] === '}') { d--; if (d === 0) return j; } } return css.length - 1; };
  (function walk(text, applies) {
    let k = 0;
    while (k < text.length) {
      const open = text.indexOf('{', k);
      if (open < 0) break;
      const head = text.slice(k, open).trim();
      let d = 0, close = open;
      for (let j = open; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}') { d--; if (d === 0) { close = j; break; } } }
      const inner = text.slice(open + 1, close);
      if (/^@media/i.test(head)) walk(inner, applies && mediaHolds(head.replace(/^@media/i, '')));
      else if (/^@/.test(head)) { /* @container, @keyframes, @font-face, @supports: not a screen rule of the page at this width */ }
      else if (applies) out.push({ sel: head.replace(/\s+/g, ' '), body: inner });
      k = close + 1;
    }
  })(css, true);
  return out;
}
const decl = (body, prop) => [...body.matchAll(new RegExp('(?:^|[;{\\s])' + prop + '\\s*:\\s*([^;}]+)', 'g'))].map((m) => m[1].trim());
const px = (v) => { const m = /^([\d.]+)px$/.exec(v); return m ? Number(m[1]) : null; };

const CHAIN = /^(body|html|\.main|\.content|\.screen|#bk_body|\.wrap|\.app|main|\.page)$/;
for (const [file, tag, expectContent] of [['accounts.html', 'ACC-24', /\.content\{padding:24px 40px 120px/], ['crm.html', 'ACC-54', /\.content\{padding:20px 24px 120px/]]) {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app', file.replace('.html', '-page.css')), 'utf8');
  const rules = rulesAt(styleOf(file));
  ok(rules.length > 40, tag + ' ' + file + ': the page CSS is read (' + rules.length + ' rules apply at ' + VIEW_W + ')');
  ok(rules.some((r) => r.sel === '.content'), tag + ' ' + file + ': the .content rule is among them');
  ok(expectContent.test(raw.replace(/\s+/g, ' ').replace(/\{ /g, '{')), tag + ' ' + file + ': .content is padding + flex column and carries no max-width (the rule as written)');

  const chainRules = rules.filter((r) => r.sel.split(',').some((s) => CHAIN.test(s.trim())));
  const chainCaps = chainRules.filter((r) => decl(r.body, 'max-width').some((v) => v !== 'none' && v !== '100%'));
  ok(chainCaps.length === 0, tag + ' ' + file + ': the layout chain (body, .main, .content, .screen, #bk_body) carries no max-width', chainCaps.map((r) => r.sel + ' ' + r.body).join(' | '));

  const caps = [];
  for (const r of rules) for (const v of decl(r.body, 'max-width')) if (px(v) != null) caps.push([r.sel, px(v)]);
  const wide = caps.filter(([, n]) => n >= 900);
  ok(wide.length === 0, tag + ' ' + file + ': no px max-width of 900 or more applies at ' + VIEW_W + ' (widest: ' + (caps.map((c) => c[1]).sort((a, b) => b - a)[0] || 'none') + ' px)', wide.map((c) => c.join(' ')).join(' | '));
  ok(!caps.some(([, n]) => n === 1400 || n === 1100), tag + ' ' + file + ': the old 1400 / 1100 px caps are gone');

  const fixed = chainRules.filter((r) => [...decl(r.body, 'min-width'), ...decl(r.body, 'width')].some((v) => px(v) != null && px(v) >= 1000));
  ok(fixed.length === 0, tag + ' ' + file + ': no fixed width / min-width of 1000 px or more on the layout chain', fixed.map((r) => r.sel + ' ' + r.body).join(' | '));
  const sideways = chainRules.filter((r) => decl(r.body, 'overflow-x').concat(decl(r.body, 'overflow')).some((v) => /scroll|auto/.test(v)));
  ok(sideways.length === 0, tag + ' ' + file + ': no overflow-x scroll on the layout chain (the page does not scroll sideways)', sideways.map((r) => r.sel + ' ' + r.body).join(' | '));
  if (file === 'accounts.html') ok(rules.some((r) => /#bk_body table/.test(r.sel) && decl(r.body, 'max-width').includes('100%')), tag + ' accounts.html: tables sit under max-width:100%');
}
process.exitCode = bad ? 1 : 0;
