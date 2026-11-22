/**
 * till-inline-handler-xss.test.cjs — NO USER TEXT IN AN INLINE on*= HANDLER (AV-F-02, 2026-11-22).
 *
 * WHY. esc() writes ' as &#39;. The HTML parser decodes entities INSIDE an attribute value BEFORE the JS runs, so
 *   onclick="f('" + esc(name) + "')"   with name = ');alert(1);//   reaches the JS engine as   f('');alert(1);//')
 * Escaping HTML is the right defence in an HTML context and the wrong one in a JS string inside it (OWASP XSS Prevention
 * Cheat Sheet, rule #3 "JavaScript escape before inserting untrusted data into JavaScript data values", and its note that
 * an HTML attribute holding JS is two nested contexts: the JS value must be escaped first). The known-safe shape needs no
 * escaping decision at all: the text rides in a data-* attribute (HTML-escaped, a plain attribute context) and the handler is
 * a CONSTANT that reads it: onclick="parkedFix(this.dataset.no)".
 *
 * WHAT THIS HOLDS
 *   1. PROOF  the real parkedRowHTML() from till.html, rendered with a hostile bill number, parsed the way a browser parses it
 *             (entities decoded) and run as JS: no alert, and the handler receives the payload as plain text.
 *   2. GUARD  every interpolation inside an on*= value in the till master is one of: escJs(...) (the JS-string escaper that
 *             \uXXXX-encodes quotes first), or listed in tests/fixtures/inline-handler-allow.json (constant names, numbers and
 *             our own ids). A bare esc(...) or a variable assigned from esc(...) inside a handler fails, with no allowlist.
 *   3. CTRL   the unsafe pattern itself DOES run the payload (so test 1 is not vacuous).
 *
 * Run: node tests/till-inline-handler-xss.test.cjs   · no DB, no browser, no network.
 */
'use strict';
const assert = require('assert'),
  fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const API = path.join(__dirname, '..');
const KIT = path.join(API, 'tools', 'tally-connector');
const ALLOW = path.join(__dirname, 'fixtures', 'inline-handler-allow.json');
const PAYLOAD = "');alert(1);//";
let pass = 0;
const ok = (n) => (pass++, console.log('ok -', n));

/** the page's own esc / escJs, lifted from the master so the test uses what the till uses */
function lift(src) {
  const grab = (name) => {
    const m = src.match(new RegExp('^var ' + name + ' = .*$', 'm'));
    assert(m, name + ' not found in till.html');
    return m[0];
  };
  return grab('esc') + '\n' + grab('escJs').replace(/^var escJs/, 'var escJs');
}
function decode(v) {
  return v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
/** every on*="…" value of an HTML string and the data-* of its tag, decoded as a browser would */
function handlers(html) {
  const out = [];
  const tagRe = /<[a-z][^>]*>/gi;
  let t;
  while ((t = tagRe.exec(html))) {
    const tag = t[0];
    const data = {};
    for (const d of tag.matchAll(/\sdata-([a-z0-9-]+)="([^"]*)"/g)) data[d[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = decode(d[2]);
    for (const h of tag.matchAll(/\son([a-z]+)="([^"]*)"/g)) out.push({ ev: h[1], code: decode(h[2]), data });
  }
  return out;
}
function run(code, data, calls) {
  const sb = { alert: (x) => calls.push(['ALERT', x]), parkedFix: (x) => calls.push(['parkedFix', x]), parkedDrop: (x) => calls.push(['parkedDrop', x]) };
  vm.runInNewContext('(function(){' + code + '\n}).call(el)', Object.assign(sb, { el: { dataset: data } }));
}

const page = fs.readFileSync(path.join(KIT, 'till.html'), 'utf8');
const L = lift(page);

/* 3. CONTROL: the unsafe pattern runs the payload — proves the harness can see an attack */
{
  const ctx = vm.createContext({});
  vm.runInContext(L, ctx);
  const html = '<button onclick="parkedFix(\'' + vm.runInContext('esc', ctx)(PAYLOAD) + '\')">Fix</button>';
  const calls = [];
  for (const h of handlers(html)) run(h.code, h.data, calls);
  assert(calls.some((c) => c[0] === 'ALERT'), 'control: the esc()-in-a-JS-string pattern should run the payload');
  ok('control: onclick="f(\'"+esc(x)+"\')" with x = ' + PAYLOAD + ' executes alert(1)');
}

/* 1. PROOF on the real renderer */
{
  const m = page.match(/^function parkedRowHTML\(row\)\{[\s\S]*?^\}$/m);
  assert(m, 'parkedRowHTML not found');
  const ctx = vm.createContext({
    parkedItem: () => ({ id: 1 }),
    isRewardRow: () => false,
    parkedRewardWords: () => '',
    parkedName: () => 'Bill',
    parkedCustomer: () => null,
  });
  vm.runInContext(L + '\n' + m[0], ctx);
  for (const no of [PAYLOAD, '"><img src=x onerror=alert(1)>', "\\');alert(1);//", '&quot;);alert(1);//']) {
    const html = vm.runInContext('parkedRowHTML', ctx)({ no, _why: 'x' });
    const calls = [];
    const hs = handlers(html);
    assert(hs.length >= 2, 'expected the Fix and Drop handlers');
    for (const h of hs) run(h.code, h.data, calls);
    assert(!calls.some((c) => c[0] === 'ALERT'), 'payload ran as code: ' + JSON.stringify(no) + ' -> ' + JSON.stringify(hs.map((h) => h.code)));
    assert(!/<img/i.test(html.replace(/&lt;img/g, '')), 'markup broke out of the attribute');
    assert.deepStrictEqual(calls.map((c) => c[0]), ['parkedFix', 'parkedDrop']);
    assert(calls.every((c) => c[1] === no), 'the handler must receive the bill number exactly as typed');
  }
  ok('parkedRowHTML: hostile bill numbers reach the handlers as plain text, nothing runs');
}

/* 2. GUARD over the till master (and the other kit pages) */
function sites(src) {
  const lines = src.split('\n');
  const found = [];
  lines.forEach((ln, i) => {
    const re = /\bon[a-z]+=(\\?["'])/g;
    let m;
    while ((m = re.exec(ln))) {
      const seg = ln.slice(m.index + m[0].length);
      const end = seg.search(/>\s*['"`+<]|>$|\sdata-/);
      const s = end < 0 ? seg : seg.slice(0, end);
      const handler = (s.match(/^[^'"(]*\(?/) || [''])[0].replace(/[^A-Za-z0-9_.;(]/g, '').slice(0, 40);
      const exprs = [...s.matchAll(/'\s*\+\s*(.+?)\s*\+\s*'/g)].map((x) => x[1].trim()).concat([...s.matchAll(/\$\{([^}]+)\}/g)].map((x) => '${' + x[1] + '}'));
      for (const e of exprs) if (!/^escJs\(/.test(e)) found.push({ line: i + 1, handler, expr: e });
    }
  });
  return found;
}
function escVars(src) {
  /* names assigned from a bare esc( — never usable inside a handler */
  return new Set([...src.matchAll(/\bvar (\w+) = esc\(/g)].map((m) => m[1]));
}
{
  const files = fs.readdirSync(KIT).filter((f) => /^(till|promo)[^/]*\.(html|js)$/.test(f) && f !== 'till-slip.js');
  if (process.env.GEN_ALLOW) {
    /* review the output before committing: "esc" holds developer-written function names and digits only */
    const g = { esc: [], constant: [] };
    for (const f of files) {
      const src = fs.readFileSync(path.join(KIT, f), 'utf8');
      const ev = escVars(src);
      for (const s of sites(src)) {
        const key = f + '|' + s.handler + '|' + s.expr;
        const viaEsc = /^esc\(|^JSON\.stringify|^escHtml\(/.test(s.expr) || ev.has(s.expr);
        (viaEsc ? g.esc : g.constant).push(key);
      }
    }
    g.esc = [...new Set(g.esc)].sort();
    g.constant = [...new Set(g.constant)].sort();
    fs.mkdirSync(path.dirname(ALLOW), { recursive: true });
    fs.writeFileSync(ALLOW, JSON.stringify(g, null, 1) + '\n');
  }
  const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
  const bad = [];
  const unlisted = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(KIT, f), 'utf8');
    const ev = escVars(src);
    for (const s of sites(src)) {
      const key = f + '|' + s.handler + '|' + s.expr;
      const viaEsc = /^esc\(|^JSON\.stringify|^escHtml\(/.test(s.expr) || ev.has(s.expr);
      if (viaEsc && !(allow.esc || []).includes(key)) bad.push(key + '  (line ' + s.line + ')');
      else if (!viaEsc && !(allow.constant || []).includes(key)) unlisted.push(key + '  (line ' + s.line + ')');
    }
  }
  assert.deepStrictEqual(bad, [], 'user-text-capable esc() inside an inline handler — put it in a data-* attribute and read this.dataset.x:\n' + bad.join('\n'));
  assert.deepStrictEqual(unlisted, [], 'new interpolation inside an inline handler; use escJs(...) or data-*, or (constant names/numbers only) add it to tests/fixtures/inline-handler-allow.json:\n' + unlisted.join('\n'));
  ok('guard: no esc()/esc-variable inside an inline handler; every other interpolation is allow-listed or escJs');
}

console.log(pass + ' passed');
