#!/usr/bin/env node
/**
 * Copy lint — fails the build on text a shopkeeper should never have to read.
 * No dependencies. Node 18+.
 *
 *   node scripts/lint-copy.mjs            report + exit 1 on findings
 *   node scripts/lint-copy.mjs --json     machine-readable, for the fix loop
 *   node scripts/lint-copy.mjs --detect   print the roots and file types it can see
 *   node scripts/lint-copy.mjs --quiet    counts only
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { loadConfig, walk, extract, words, BANNED, BUDGET_FOR, isExempt, DEFAULTS, RAW_PATTERNS } from './copy-core.mjs';

const argv = new Set(process.argv.slice(2));
const cfg = loadConfig();

if (argv.has('--detect')) {
  const seen = {}; const roots = [];
  const look = (dir, depth = 0) => {
    if (depth > 3) return;
    let e; try { e = readdirSync(dir); } catch { return; }
    for (const n of e) {
      if (DEFAULTS.skipDirs.includes(n)) continue;
      const f = join(dir, n);
      let st; try { st = statSync(f); } catch { continue; }
      if (st.isDirectory()) { if (depth === 0 && /^(src|app|components|pages|ui|client|web)$/.test(n)) roots.push(f); look(f, depth + 1); }
      else { const x = extname(n); if (x) seen[x] = (seen[x] || 0) + 1; }
    }
  };
  look('.');
  console.log('Likely source roots :', roots.length ? roots.join(', ') : '(none found — set "roots" by hand)');
  console.log('File types present  :', Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([k, v]) => `${k} ${v}`).join('  '));
  console.log('\nWrite the roots you want into copy-guard.config.json, then run the lint.');
  process.exit(0);
}

const files = walk(cfg);
if (!files.length) {
  console.error(`No source files under ${cfg.roots.join(', ')}.`);
  console.error('Run:  node scripts/lint-copy.mjs --detect');
  process.exit(2);
}

const findings = [];
const add = (file, line, rule, text, detail) =>
  findings.push({ file, line, rule, text: text.slice(0, 120), detail });

for (const file of files) {
  let src; try { src = readFileSync(file, 'utf8'); } catch { continue; }
  // raw-source faults the extractor cannot see
  if (cfg.rules.serverMessage)
    for (const p of RAW_PATTERNS)
      for (const m of src.matchAll(p.re))
        add(file, src.slice(0, m.index).split('\n').length, p.id, m[0], p.why);

  const strings = extract(src, file);
  const seen = new Map();
  let screenWords = 0;

  for (const s of strings) {
    screenWords += words(s.text);

    if (cfg.rules.tooLong) {
      const max = BUDGET_FOR(s.kind, cfg.budget);
      if (words(s.text) > max)
        add(file, s.line, 'tooLong', s.text, `${words(s.text)} words, max ${max} for ${s.kind}`);
    }

    if (cfg.rules.titleFullStop && /title|heading/.test(s.kind) && /[.!]$/.test(s.text))
      add(file, s.line, 'titleFullStop', s.text, 'a title is a noun phrase, not a sentence');

    for (const b of BANNED)
      if (cfg.rules[b.id] && b.re.test(s.text))
        add(file, s.line, b.id, s.text, b.why);

    if (cfg.rules.duplicate) {
      const k = s.text.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(k)) add(file, s.line, 'duplicate', s.text, `also at line ${seen.get(k)}`);
      else seen.set(k, s.line);
    }
  }

  if (cfg.rules.tooLong && !isExempt(file, cfg) && screenWords > cfg.budget.screen)
    add(file, 0, 'screenTooLong', `${screenWords} words on first view`,
        `max ${cfg.budget.screen} — cut before shipping`);
}

if (argv.has('--json')) {
  console.log(JSON.stringify({ files: files.length, findings }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

const byRule = findings.reduce((a, f) => (a[f.rule] = (a[f.rule] || 0) + 1, a), {});
const byFile = findings.reduce((a, f) => (a[f.file] = (a[f.file] || 0) + 1, a), {});

if (!argv.has('--quiet')) {
  for (const f of findings.slice(0, 200))
    console.error(`✗ ${f.file}:${f.line}  [${f.rule}]  ${f.detail}\n    "${f.text}"`);
  if (findings.length > 200) console.error(`… and ${findings.length - 200} more`);
}

console.error(`\n${files.length} files scanned.`);
if (!findings.length) { console.log('✓ copy within budget'); process.exit(0); }

console.error(`${findings.length} finding(s):`);
for (const [r, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.error(`   ${String(n).padStart(4)}  ${r}`);
console.error('\nWorst files:');
for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.error(`   ${String(n).padStart(4)}  ${f}`);
const hot = files.length >= 5 ? Object.entries(byRule).find(([, n]) => n > files.length * 0.4) : null;
if (hot) console.error(`\nNote: "${hot[0]}" fires on most files. Loosen its budget in copy-guard.config.json rather than disabling it.`);
console.error('\nShorten the strings. Never widen the boxes.');
process.exit(1);
