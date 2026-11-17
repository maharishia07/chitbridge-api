/**
 * chip-audit.cjs — every chip, badge, pill, tag and icon: where it is used, what it says, and whether that
 * text can be translated.
 *
 * Athi, 2026-08-19: *"every screen, every panel has to be checked, how many chips we got, what is the purpose
 * of the chip… and where those chip, icon is used, and what it translates to. If you think something are dead
 * which can be removed, that also we have to do — mark it as dead and later if it is not accessed at all, then
 * remove."*
 *
 * ⭐ A CHIP IS THE DENSEST THING ON A SCREEN. It has to encode state a reader takes in at a glance. Twelve
 * class names doing that job means at least some of them grew independently for the same purpose, and a reader
 * has to learn each one separately. That is the blindspot this exercise is for.
 *
 * ⚠️ IT REPORTS, IT DOES NOT DELETE. "Defined in CSS, used nowhere" is EVIDENCE of death, not proof: a class can
 * be built by string concatenation ('cbpick-chip' + state), applied by a capability that loads lazily, or
 * referenced only from a spec. Everything here is marked DEAD? with a question mark and needs reading before
 * removal — the same rule dead-surface.cjs states, for the same reason: a false positive deletes a working
 * control and the person who finds out is a user.
 *
 * Run: node e2e/chip-audit.cjs [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const SEP = String.fromCharCode(92);
const rel = (p) => path.relative(WEB, p).split(SEP).join('/');

const FILES = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!/node_modules|illustrations|docs|vendor|_design/.test(f.name)) walk(p); }
    else if (/\.(html|js)$/.test(f.name) && !/\.min\./.test(f.name)) FILES.push(p);
  }
})(WEB);

const SRC = new Map();
for (const f of FILES) SRC.set(f, fs.readFileSync(f, 'utf8'));

/* ── every language pack, so "what it translates to" is answered from the loaded object ─────────────────── */
const PACKS = {};
for (const lang of ['ar', 'hi', 'ta', 'fr']) {
  const p = path.join(WEB, 'app', 'strings-' + lang + '.js');
  if (!fs.existsSync(p)) continue;
  const CBSTR = {};
  CBSTR[lang] = {};
  try { new Function('CBSTR', 'renderApp', fs.readFileSync(p, 'utf8'))(CBSTR, function () {}); } catch (_) {}
  PACKS[lang] = CBSTR[lang];
}

/* ── 1 · CHIP-LIKE CLASSES ──────────────────────────────────────────────────────────────────────────────── */
const CHIPWORD = /(chip|badge|pill|tag|flag|dot|swatch)/i;

/** class names that APPEAR in a class= attribute anywhere */
const used = new Map();      // class -> { count, files:Set, samples:[] }
/** class names DEFINED in a stylesheet rule */
const defined = new Map();   // class -> file

/* ── PASS 1 · every chip class CSS defines. Must complete before any usage is judged: a class
   defined in a later file would otherwise look undefined while scanning an earlier one. ── */
for (const [f, s] of SRC) {
  const defRe = /\.([a-zA-Z][\w-]*)\s*(?:,[^{]*)?\{/g;
  let m;
  while ((m = defRe.exec(s))) if (CHIPWORD.test(m[1]) && !defined.has(m[1])) defined.set(m[1], rel(f));
}

/* ── PASS 2 · where each defined class is applied ── */
for (const [f, s] of SRC) {
  let m;
  /**
   * ⚠️⚠️ A CLASS ATTRIBUTE IS USUALLY NOT A LITERAL IN THIS CODEBASE — IT IS BUILT BY CONCATENATION:
   *
   *     '<span class="cbdef-badge ' + st + '">'
   *     '<button class="cbdef-stdchip' + (on ? ' on' : '') + '"'
   *
   * The first version of this tool matched class="…" as a closed literal, so every concatenated one looked
   * unused. It reported EIGHT dead classes and all eight were live — exactly the false positive its own header
   * warns about, produced by its own scanner. An audit that confidently names working code as dead is worse
   * than no audit, because someone acts on it.
   *
   * So a usage is now any occurrence of the token that is NOT the CSS rule that defines it. That over-counts
   * slightly (a mention inside a comment reads as a use) and that is the right direction to be wrong in: this
   * tool's errors should keep code alive, never kill it.
   */
  const lines = s.split(/\r?\n/);
  const seenHere = new Map();
  lines.forEach((line) => {
    if (/^\s*\.[a-zA-Z][\w-]*[\s,{]/.test(line)) return;          // a CSS rule, not a usage
    const tokRe = /[a-zA-Z][\w-]*/g;
    let t;
    while ((t = tokRe.exec(line))) {
      const c = t[0];
      /**
       * ⚠️⚠️ THE AUTHORITATIVE LIST IS WHAT CSS DEFINES, NOT WHAT LOOKS CHIP-ISH. Relaxing the matcher to catch
       * concatenated classes swung it the other way: `flag`, `flags`, `flagged` are ordinary variable names and
       * `tag` appears in prose, so it reported 106 "chip classes" — noise. A noisy audit is as useless as a
       * wrong one, because nobody reads past the first screen of it.
       *
       * A chip that has no CSS rule is not a chip, it is a word. So the inventory is the DEFINED set, and this
       * pass only counts how often each defined class is applied.
       */
      if (!defined.has(c)) continue;
      seenHere.set(c, (seenHere.get(c) || 0) + 1);
      const rec = used.get(c) || { count: 0, files: new Set(), samples: [] };
      rec.files.add(rel(f));
      const txt = /(?:>|})([^<>{}`'"]{2,40})</.exec(line.slice(line.indexOf(c)));
      if (txt && /[A-Za-z]/.test(txt[1]) && rec.samples.length < 3) rec.samples.push(txt[1].trim());
      used.set(c, rec);
    }
  });
  for (const [c, n] of seenHere) used.get(c).count += n;
}

/* ── 2 · ICONS — the emoji and symbols that carry meaning in a label ─────────────────────────────────────── */
const ICON = /[\u{1F300}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const icons = new Map();     // icon -> { count, labels:Set }
for (const [f, s] of SRC) {
  const RE = /\btx\('((?:[^'\\]|\\.)*)'\)/g;
  let m;
  while ((m = RE.exec(s))) {
    const label = m[1].replace(/\\'/g, "'");
    const first = Array.from(label)[0];
    if (!first || !ICON.test(first)) continue;
    const rec = icons.get(first) || { count: 0, labels: new Set() };
    rec.count++;
    rec.labels.add(label);
    icons.set(first, rec);
  }
}

/* ── OUTPUT ─────────────────────────────────────────────────────────────────────────────────────────────── */
const rows = [];
const allClasses = new Set([...used.keys(), ...defined.keys()]);
for (const c of [...allClasses].sort()) {
  const u = used.get(c);
  rows.push({
    cls: c,
    css: defined.has(c) ? defined.get(c) : '—',
    uses: u ? u.count : 0,
    files: u ? [...u.files] : [],
    sample: u && u.samples.length ? u.samples[0] : '',
    verdict: !u ? 'DEAD?  defined, never applied'
           : !defined.has(c) ? 'no CSS rule — styled inline or by a parent'
           : 'live',
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ chips: rows, icons: [...icons].map(([i, r]) => ({ icon: i, count: r.count, labels: [...r.labels] })) }, null, 1));
  process.exit(0);
}

const pad = (s, n) => String(s).length >= n ? String(s).slice(0, n - 1) + '…' : String(s) + ' '.repeat(n - String(s).length);

console.log('\n  ══ CHIPS, BADGES, PILLS, TAGS ══\n');
console.log('  ' + pad('CLASS', 20) + pad('USES', 6) + pad('CSS RULE IN', 22) + 'VERDICT');
console.log('  ' + '-'.repeat(84));
for (const r of rows) console.log('  ' + pad(r.cls, 20) + pad(r.uses, 6) + pad(r.css, 22) + r.verdict);

console.log('\n  ══ ICONS THAT LEAD A TRANSLATABLE LABEL ══\n');
console.log('  ' + pad('ICON', 6) + pad('LABELS', 8) + 'EXAMPLE  →  ta');
console.log('  ' + '-'.repeat(84));
const iconRows = [...icons].sort((a, b) => b[1].count - a[1].count);
for (const [i, r] of iconRows.slice(0, 30)) {
  const ex = [...r.labels][0];
  const ta = (PACKS.ta && PACKS.ta[ex]) || '(not translated)';
  console.log('  ' + pad(i, 6) + pad(r.labels.size, 8) + pad(ex, 34) + ta);
}

const dead = rows.filter((r) => r.uses === 0);
console.log('\n  ' + rows.length + ' chip-ish classes · ' + icons.size + ' distinct icons · ' + dead.length + ' DEAD?\n');
console.log('  ⚠️ DEAD? IS EVIDENCE, NOT PROOF. A class can be built by concatenation, applied by a lazily');
console.log('     loaded capability, or referenced only from a spec. Read each before removing it.\n');
