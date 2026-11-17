#!/usr/bin/env node
/**
 * scripts/country-ready.cjs — "WHERE CHITBRIDGE IS FOR <COUNTRY>", GENERATED (CL3, 2026-10-13). Never typed: two documents are read.
 *
 *   node scripts/country-ready.cjs                    write public/data/country-ready.json
 *   node scripts/country-ready.cjs --from <md>        the same, reading COUNTRY-COVERAGE.md from <md> (CX0 #170 not on this branch yet)
 *   node scripts/country-ready.cjs --check            exit 1 when public/data/country-ready.json is stale (the drift guard)
 *
 * READS
 *   public/data/country-matrix.json      the engines' matrix (CPS1), vendored by engines `node tools/country-matrix.cjs --web <web>` — never edited here.
 *                                        Gives each pack's line (name · version · verified · ✅ count of its members) and the "—" rows (A9 payroll).
 *   docs/design/standards/COUNTRY-COVERAGE.md §1 (CX0) — the PRODUCT side: every area × IN · AU · AE, each sub-area ✅ / ⚠️ / ❌ / —.
 *                                        The matrix has no areas; this table is the one place that has them.
 * THE ONE ROLL-UP (one calculation — screens paint it, never redo it): per area and country, over the sub-areas that apply (— left out):
 *   all ✅ → ok · all ❌ → missing · otherwise → partial · none apply → out. The line for a partial / missing area is the FIRST ❌ sub-area
 *   (else the first ⚠️), its label with code, paths and asides taken out — the document's own words, made short.
 * When the md is absent, --check verifies the matrix half and says the areas were last read from `coverage.sha`.
 */
/*
 * OWNS      public/data/country-ready.json, generated from the engines country matrix and COUNTRY-COVERAGE
 * CALLED BY by hand to write public/data/country-ready.json; its --check is run by e2e/docs-guard.cjs:31
 * CARD      15-tax-and-country-packs/country-setup-and-country-lab
 */
'use strict';
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const MATRIX = path.join(ROOT, 'public', 'data', 'country-matrix.json');
const MD = path.join(ROOT, 'docs', 'design', 'standards', 'COUNTRY-COVERAGE.md');
const OUT = path.join(ROOT, 'public', 'data', 'country-ready.json');
const SYM = { '✅': 'ok', '⚠️': 'partial', '⚠': 'partial', '❌': 'missing', '—': 'out' };

/** a doc label made short: no `code`, no (asides), no file:line, no ⚠️ notes, no trailing punctuation */
function plain(s) {
  return String(s || '')
    .replace(/\*\*/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[\w./-]+\.(js|html|sql|md)(:[\d, -]+)?/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·:—–-]+|[\s·:—–,;-]+$/g, '')
    .trim();
}
function cellState(c) {
  const text = String(c || '').trim();
  for (const k of Object.keys(SYM)) if (text.startsWith(k)) return SYM[k];
  return null;
}
/** COUNTRY-COVERAGE.md §1 → [{ area, rows: [{ label, cells: { IN, AU, AE } }] }] */
function parseCoverage(md) {
  const at = md.indexOf('## 1.'),
    end = md.indexOf('\n## ', at + 5);
  if (at < 0) throw new Error('COUNTRY-COVERAGE.md has no "## 1." section');
  const lines = md
    .slice(at, end < 0 ? undefined : end)
    .split('\n')
    .filter((item) => /^\|/.test(item));
  const head = lines[0].split('|').map((x) => x.trim());
  const cols = { IN: head.indexOf('IN'), AU: head.indexOf('AU'), AE: head.indexOf('AE') };
  if (cols.IN < 0 || cols.AU < 0 || cols.AE < 0) throw new Error('COUNTRY-COVERAGE.md §1 header lacks IN · AU · AE');
  const areas = [];
  lines.slice(2).forEach((item) => {
    const c = item.split('|').map((x) => x.trim());
    const first = c[1] || '',
      bold = /^\*\*([^*]+)\*\*(.*)$/.exec(first);
    if (bold) areas.push({ area: plain(bold[1]), rows: [] });
    if (!areas.length) return;
    const label = bold ? bold[2] : first.replace(/^[^·]*·/, '');
    const cells = {};
    Object.keys(cols).forEach((entry) => {
      cells[entry] = c[cols[entry]] || '';
    });
    areas[areas.length - 1].rows.push({ label: plain(label), cells });
  });
  return areas;
}
function rollUp(area, cc) {
  const on = area.rows.map((item) => ({ label: item.label, s: cellState(item.cells[cc]) })).filter((item) => item.s && item.s !== 'out');
  if (!on.length) return { area: area.area, state: 'out', line: '' };
  const n = (s) => on.filter((item) => item.s === s).length;
  const state = n('ok') === on.length ? 'ok' : n('missing') === on.length ? 'missing' : 'partial';
  const why = on.find((item) => item.s === 'missing') || on.find((item) => item.s === 'partial');
  /* a row with no sub-label (the area's own row, e.g. Connector) speaks through its cell: "❌ offered as if it works (…)" → "offered as if it works" */
  const words = why
    ? why.label ||
      plain(
        String(area.rows.find((item) => item.label === why.label).cells[cc])
          .replace(/^(✅|⚠️|⚠|❌|—)/, '')
          .split(/ — |;/)[0]
      )
    : '';
  return { area: area.area, state, line: state === 'ok' ? '' : words, works: n('ok'), of: on.length };
}
function build(nestedMdText) {
  const parsed = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  const areas = nestedMdText ? parseCoverage(nestedMdText) : null;
  const out = {
    source:
      'scripts/country-ready.cjs — public/data/country-matrix.json (engines ' +
      parsed.engines +
      ') × docs/design/standards/COUNTRY-COVERAGE.md §1; never edit by hand',
    engines: parsed.engines,
    coverage: nestedMdText ? { sha: crypto.createHash('sha256').update(nestedMdText).digest('hex').slice(0, 16) } : null,
    countries: {}
  };
  parsed.packs.forEach((item) => {
    const cnt = parsed.counts[item.id] || {},
      total = (cnt.ok || 0) + (cnt.partial || 0) + (cnt.missing || 0) + (cnt.out || 0);
    out.countries[item.id] = {
      pack: { name: item.name, version: item.version, verified: !!item.verified, ok: cnt.ok || 0, of: total - (cnt.out || 0) },
      areas: areas ? areas.map((a) => rollUp(a, item.id)).filter((entry) => entry.state !== 'out' || entry.line) : [],
      /* "— not offered here": the matrix's A9 rows (payroll) — out in the pack's own words, named so nobody is surprised */
      out: parsed.rows
        .filter((r) => r.sectionId === 'A9' && r.cells[item.id] && r.cells[item.id].state === 'out')
        .map((entry) => ({ member: entry.member, area: entry.member.charAt(0).toUpperCase() + entry.member.slice(1) }))
    };
  });
  return out;
}
const args = process.argv.slice(2),
  fromAt = args.indexOf('--from');
const mdPath = fromAt >= 0 ? args[fromAt + 1] : MD;
const mdText = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : null;
if (args.includes('--check')) {
  if (!fs.existsSync(OUT)) {
    console.log('country-ready: public/data/country-ready.json is missing — run node scripts/country-ready.cjs');
    process.exit(1);
  }
  const have = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (mdText) {
    const nestedWant = JSON.stringify(build(mdText), null, 1) + '\n';
    if (nestedWant !== fs.readFileSync(OUT, 'utf8')) {
      console.log('country-ready: STALE — the matrix or COUNTRY-COVERAGE.md moved; run node scripts/country-ready.cjs');
      process.exit(1);
    }
    console.log('country-ready: current (matrix ' + have.engines + ' · coverage ' + have.coverage.sha + ')');
    process.exit(0);
  }
  /* the md is not on this branch: the matrix half must still agree; the areas are what coverage.sha was read from */
  const want = build(null);
  const bad = Object.keys(want.countries).filter(
    (item) =>
      JSON.stringify(want.countries[item].pack) !== JSON.stringify((have.countries[item] || {}).pack) ||
      JSON.stringify(want.countries[item].out) !== JSON.stringify((have.countries[item] || {}).out)
  );
  if (want.engines !== have.engines || bad.length) {
    console.log(
      'country-ready: STALE against the matrix (' +
        (bad.join(' · ') || 'engines ' + have.engines + ' → ' + want.engines) +
        ') — run with --from <COUNTRY-COVERAGE.md>'
    );
    process.exit(1);
  }
  if (!have.coverage) {
    console.log('country-ready: no areas — run with --from <COUNTRY-COVERAGE.md>');
    process.exit(1);
  }
  console.log('country-ready: matrix half current; COUNTRY-COVERAGE.md not on this branch — areas as read from coverage ' + have.coverage.sha);
  process.exit(0);
}
if (!mdText) {
  console.log('country-ready: ' + path.relative(ROOT, mdPath) + ' not found — pass --from <COUNTRY-COVERAGE.md>');
  process.exit(1);
}
fs.writeFileSync(OUT, JSON.stringify(build(mdText), null, 1) + '\n');
console.log('wrote public/data/country-ready.json');
