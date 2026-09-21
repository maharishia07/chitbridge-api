// Shared: config, file walk, and the multi-parser string extractor.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

export const DEFAULTS = {
  roots: ['src'],
  extensions: ['.tsx', '.jsx', '.ts', '.js', '.html', '.vue', '.svelte', '.astro'],
  skipDirs: ['node_modules', 'dist', 'build', '.git', '.next', 'out', 'coverage', 'public', 'vendor'],
  skipFiles: ['*.test.*', '*.spec.*', '*.stories.*', '*.d.ts'],
  exemptScreenBudget: [],
  budget: { any: 20, button: 3, tag: 3, title: 6, screen: 50 },
  rules: { tooLong: true, duplicate: true, titleFullStop: true, serverMessage: true,
           httpCode: true, uuid: true, truncation: true, bannedWords: true, staleUnits: true }
};

export function loadConfig(path = 'copy-guard.config.json') {
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    const c = JSON.parse(readFileSync(path, 'utf8'));
    return { ...DEFAULTS, ...c,
      budget: { ...DEFAULTS.budget, ...(c.budget || {}) },
      rules:  { ...DEFAULTS.rules,  ...(c.rules  || {}) } };
  } catch { return { ...DEFAULTS }; }
}

const globLike = (pat, s) =>
  new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&')
                      .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*')
                      .replace(/\u0000/g, '.*') + '$').test(s);

export function walk(cfg) {
  const out = [];
  const visit = dir => {
    let entries; try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (cfg.skipDirs.includes(name)) continue;
      const full = join(dir, name);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) visit(full);
      else if (cfg.extensions.includes(extname(name))
               && !cfg.skipFiles.some(p => globLike(p, basename(name)))) out.push(full);
    }
  };
  for (const r of cfg.roots) if (existsSync(r)) visit(r);
  return out;
}

export const isExempt = (file, cfg) =>
  (cfg.exemptScreenBudget || []).some(p => globLike(p, file) || file.includes(p.replace(/\*/g, '')));

export const words = s => s.trim().split(/\s+/).filter(Boolean).length;

// Strings that a person can actually see. Several parsers, deliberately overlapping —
// a duplicate finding is cheap, a missed string is not.
const TEXT_ATTRS = 'title|label|placeholder|aria-label|alt|heading|subtitle|caption|message|text|tooltip|hint|description|cta|buttonLabel|actionLabel|emptyText|errorText|confirmText';

export function extract(src, file) {
  const ext = extname(file);
  const found = [];
  const push = (text, kind, index) => {
    const t = String(text).trim();
    if (!t || t.length < 3) return;
    if (!/[a-z]{2}/i.test(t)) return;            // not prose
    if (/^[{<$]/.test(t)) return;                 // an expression, not copy
    if (/^(https?:|\/|#|[a-z-]+\.(png|jpg|svg|css|js)$)/i.test(t)) return;
    if (/^[A-Z0-9_]{4,}$/.test(t)) return;        // CONSTANT_NAME
    found.push({ text: t, kind, line: src.slice(0, index).split('\n').length });
  };

  // 1 · JSX / HTML text nodes
  for (const m of src.matchAll(/>\s*([^<>{}\n][^<>{}]{2,})\s*</g)) push(m[1], 'text', m.index);

  // 2 · attributes — quote-aware, so apostrophes inside a string do not end it
  for (const m of src.matchAll(new RegExp(`\\b(${TEXT_ATTRS})\\s*=\\s*(["'\`])((?:(?!\\2)[^\\\\]|\\\\.){3,}?)\\2`, 'gi')))
    push(m[3], m[1].toLowerCase(), m.index);

  // 3 · JSX expression attributes: title={"…"} — also quote-aware
  for (const m of src.matchAll(new RegExp(`\\b(${TEXT_ATTRS})\\s*=\\s*\\{\\s*(["'\`])((?:(?!\\2)[^\\\\]|\\\\.){3,}?)\\2\\s*\\}`, 'gi')))
    push(m[3], m[1].toLowerCase(), m.index);

  // 4 · object literal copy keys:  label: 'Send now'
  for (const m of src.matchAll(new RegExp(`\\b(${TEXT_ATTRS})\\s*:\\s*(["'\`])((?:(?!\\2)[^\\\\]|\\\\.){3,}?)\\2`, 'gi')))
    push(m[3], m[1].toLowerCase(), m.index);

  // 5 · Vue / Svelte / Angular mustaches around literal text
  if (['.vue', '.svelte', '.html', '.astro'].includes(ext))
    for (const m of src.matchAll(/(?:^|\n)\s{0,40}([A-Z][^<>{}\n]{6,})\s*(?:\n|<)/g))
      push(m[1], 'text', m.index);

  // 6 · i18n-style dictionaries:  "key": "a sentence here"
  for (const m of src.matchAll(/["'`][\w.]+["'`]\s*:\s*["'`]([^"'`]{12,})["'`]/g))
    push(m[1], 'text', m.index);

  const seen = new Set();
  return found.filter(f => {
    const k = f.kind + '\u0000' + f.text;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

export const BANNED = [
  { id: 'httpCode',      re: /(?:^|[\s(])(40[0-9]|41[0-9]|42[0-9]|50[0-9])(?:[\s).]|$)/, why: 'HTTP status code visible' },
  { id: 'uuid',          re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/i,          why: 'UUID visible' },
  { id: 'serverMessage', re: /\b(err|error|e|res|response)\.(message|statusText|detail)\b/, why: 'raw server message rendered' },
  { id: 'bannedWords',   re: /\b(Oops|successfully|Whoops|Uh[- ]oh)\b|\bPlease\s/i,        why: 'banned word' },
  { id: 'truncation',    re: /(?:…|\.\.\.)\s*["'`]?\s*$/,                                  why: 'truncation baked into the string' },
  { id: 'staleUnits',    re: /\b(\d{3,})\s*(h|hours|hrs|s|sec|seconds|min|minutes)\b/i,    why: 'unit nobody thinks in' }
];

export const BUDGET_FOR = (kind, b) =>
  /button|cta|actionlabel|buttonlabel/.test(kind) ? b.button
  : /tag|chip|pill/.test(kind) ? b.tag
  : /title|heading/.test(kind) ? b.title
  : b.any;


// Some faults live in code, not in copy: a rendered server message, a status code
// in a template. Scan the raw source for those regardless of the extractor.
export const RAW_PATTERNS = [
  { id: 'serverMessage', re: /\{\s*(?:\w+\.)*(?:err|error|e|res|response)\.(?:message|statusText|detail)\s*\}/g,
    why: 'server message rendered straight into the UI — map it to a verdict' },
  { id: 'serverMessage', re: /(?:children|text|title|label)\s*[:=]\s*\{?\s*(?:\w+\.)*(?:err|error)\.(?:message|detail)/g,
    why: 'server message assigned to visible text' }
];
