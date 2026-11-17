#!/usr/bin/env node
// tools/sig-stars.cjs — SIG-style maintainability stars (1–5) for one or more repos.            STD-MEASURE, 2026-10-15
//
// owns:      the eight SIG properties (volume · duplication · unit size · unit complexity · unit interfacing · module coupling ·
//            component balance · test code ratio), their risk bands, and the star roll-up (ISO 25010 sub-characteristics).
// called by: a person / CI report — `node tools/sig-stars.cjs web=. api=../chitbridge-api engines=../chitbridge-engines [--json]`
// reuses:    tools/graph/scan.cjs (KG1 lexer + function scanner) — not a second parser. No dependency. Read-only.
// FLOW       list files (git) → drop vendored/generated → scanJs per file → units → eight measures → stars → table
//
// ⚠ THIS IS A MODEL, NOT THE SIG CERTIFICATE. The band edges below are the published SIG/TÜViT shape as recalled WITHOUT web
//   access (the runner had none); volume and duplication edges are the ones we are surest of, the share-of-code tables for
//   unit size / complexity / interfacing / coupling are approximate. Re-calibrate against SIG's Evaluation Criteria before quoting a
//   number outside the company. The point is the TREND between runs, which this script makes repeatable.
// Honest limits: complexity = 1 + decision tokens on lexer-blanked code (no AST); duplication = built-in 6-line window finder
//   (jscpd is in no lockfile; the brief forbids a new dependency); fan-in = distinct OTHER files that require the module or call
//   one of its uniquely-named functions (SIG counts calls; distinct files is steadier on a one-window app).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanJs, scanHtml, matchBracket } = require('./graph/scan.cjs');

/* ── the bands ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
const STAR_FOR = { '++': 5, '+': 4, o: 3, '-': 2, '--': 1 };
const BAND_ORDER = ['++', '+', 'o', '-'];
// volume: thousand lines of (production) code, SIG's Java-equivalent man-year edges 66 / 246 / 665 / 1310 KLOC
const VOLUME_KLOC = { '++': 66, '+': 246, o: 665, '-': 1310 };
// duplication: % of production lines that sit in a repeated 6-line block
const DUPLICATION_PCT = { '++': 3, '+': 5, o: 10, '-': 20 };
// unit risk bands (inclusive upper edges): low · moderate · high · very high
const UNIT_BANDS = {
  size: [15, 30, 60], // lines of code per unit
  complexity: [5, 10, 25], // McCabe per unit
  interfacing: [2, 4, 6], // parameters per unit (the brief's "> 4" is the high band)
  coupling: [10, 21, 49] // fan-in (distinct other files) per module
};
// max % of code (or units) allowed in [moderate-or-worse, high-or-worse, very-high] to earn each rating (approximate)
const SHARE_EDGES = {
  size: { '++': [19.5, 10.9, 3.9], '+': [26.0, 15.5, 6.5], o: [34.1, 22.2, 11.0], '-': [45.9, 31.4, 18.1] },
  complexity: { '++': [17.9, 9.9, 3.3], '+': [23.4, 16.9, 6.7], o: [31.3, 22.8, 14.6], '-': [39.1, 30.5, 22.5] },
  interfacing: { '++': [12.1, 5.4, 1.2], '+': [16.6, 9.1, 3.0], o: [24.0, 14.4, 6.0], '-': [33.0, 22.0, 12.0] },
  coupling: { '++': [19.5, 10.9, 3.9], '+': [26.0, 15.5, 6.5], o: [34.1, 22.2, 11.0], '-': [45.9, 31.4, 18.1] }
};
// test code ÷ production code: lower edges for ++ + o -
const TEST_RATIO = { '++': 1.0, '+': 0.5, o: 0.25, '-': 0.1 };
const DUP_WINDOW_LINES = 6;
const DUP_MIN_CHARS = 120; // a 6-line window shorter than this is closing braces, not copied logic
const VENDOR_MARKER = /ADOPTED from chitbridge-engines|VENDORED from|vendored from the api|DO NOT EDIT.*vendor/i;
const SKIP_PATH =
  /(^|\/)(node_modules|fixtures?|docs|design-[\w-]+|vendor|png|pics|illustrations|data|dist|build|out|\.github)\/|\.min\.[cm]?js$|(^|\/)public\/engine\/|(^|\/)public\/till\.html$/;
const TEST_PATH = /(^|\/)(tests?|e2e|__tests__|spec)\/|\.(test|spec)\.[cm]?js$|(^|\/)(jest\.setup|guard[\w-]*)\.[cm]?js$/;
const CODE_EXT = /\.(js|cjs|mjs|html)$/;
const DECISION = /\b(?:if|for|while|case|catch)\b|&&|\|\||\?\?|\?(?![.?:])/g;

/* ── files ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
// tracked files of a repo (git), or a directory walk when it is not a git checkout
function listFiles(root) {
  try {
    return execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\n')
      .filter(Boolean);
  } catch (e) {
    process.stderr.write('sig-stars: ' + root + ' is not a git checkout (' + e.message.split('\n')[0] + ') — walking the folder\n');
    const out = [];
    const walk = (dir) =>
      fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((item) => {
        const rel = path.posix.join(dir, item.name);
        if (item.name === '.git' || item.name === 'node_modules') return;
        if (item.isDirectory()) walk(rel);
        else out.push(rel);
      });
    walk('.');
    return out.map((item) => item.replace(/^\.\//, ''));
  }
}

// every measured source file: { rel, isTest, scripts:[{src,baseLine}] }; vendored/generated copies are listed in `skipped`
function readScope(root) {
  const files = [],
    skipped = { vendored: [], generated: 0 };
  for (const rel of listFiles(root)) {
    if (!CODE_EXT.test(rel)) continue;
    if (SKIP_PATH.test(rel)) {
      skipped.generated++;
      if (/public\/(engine|till)/.test(rel)) skipped.vendored.push(rel);
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (e) {
      process.stderr.write('sig-stars: cannot read ' + rel + ': ' + e.message + '\n');
      continue;
    }
    if (VENDOR_MARKER.test(text.slice(0, 1500))) {
      skipped.vendored.push(rel);
      continue;
    }
    const scripts = rel.endsWith('.html') ? scanHtml(text).inline.map((item) => ({ src: item.code, baseLine: item.baseLine })) : [{ src: text, baseLine: 1 }];
    files.push({ rel, isTest: TEST_PATH.test(rel), scripts });
  }
  return { files, skipped };
}

/* ── units ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
// non-blank lines of `text` that are not comment-only, judged against the lexer-blanked `code` of the same length
function countCodeLines(text, code) {
  const orig = text.split('\n'),
    blank = code.split('\n');
  let count = 0;
  for (let index = 0; index < orig.length; index++) {
    const raw = orig[index].trim();
    if (!raw) continue;
    if (!blank[index].trim() && /^(\/\/|\/\*|\*)/.test(raw)) continue;
    count++;
  }
  return count;
}

// parameters of the function whose list opens at `paren` (a destructured `{a,b}` counts as one)
function countParams(code, paren) {
  if (code[paren] !== '(') return 1;
  const close = matchBracket(code, paren);
  const inner = code.slice(paren + 1, close < 0 ? paren + 1 : close).trim();
  if (!inner) return 0;
  let depth = 0,
    count = 1;
  for (const ch of inner) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && !depth) count++;
  }
  return count;
}

// the functions of one script with their OWN text (nested functions are separate units, as in Java inner methods)
function unitsOf(scan, src, file) {
  const fns = scan.functions.slice().sort((first, second) => first.start - second.start || second.end - first.end);
  const stack = [],
    units = [];
  for (const fn of fns) {
    while (stack.length && fn.start > stack[stack.length - 1].end) stack.pop();
    const unit = { name: fn.name, file, line: fn.line, start: fn.start, end: fn.end, kids: [], paramsAt: fn.paramsAt };
    if (stack.length) stack[stack.length - 1].kids.push(unit);
    stack.push(unit);
    units.push(unit);
  }
  for (const unit of units) {
    let text = '',
      origOwn = '',
      cursor = unit.start;
    for (const kid of unit.kids) {
      text += scan.code.slice(cursor, kid.start);
      origOwn += src.slice(cursor, kid.start);
      cursor = kid.end + 1;
    }
    text += scan.code.slice(cursor, unit.end + 1);
    origOwn += src.slice(cursor, unit.end + 1);
    unit.lines = countCodeLines(origOwn, text);
    unit.complexity = 1 + (text.match(DECISION) || []).length;
    unit.params = countParams(scan.code, unit.paramsAt);
  }
  return units;
}

/* ── measures ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
// which band (0 low · 1 moderate · 2 high · 3 very high) a value falls in
const bandOf = (value, edges) => (value <= edges[0] ? 0 : value <= edges[1] ? 1 : value <= edges[2] ? 2 : 3);

// rating symbol for "share of code at or above each band" against a table of max shares
function rateShares(shares, table) {
  for (const rating of BAND_ORDER) if (shares.every((share, index) => share <= table[rating][index])) return rating;
  return '--';
}

// {shares:[≥moderate, ≥high, very high] in %, rating} for units weighted by `weight(unit)`
function profile(units, valueOf, edges, table, weight) {
  const totals = [0, 0, 0, 0];
  for (const unit of units) totals[bandOf(valueOf(unit), edges)] += weight(unit);
  const sum = totals.reduce((total, item) => total + item, 0) || 1;
  const shares = [totals[1] + totals[2] + totals[3], totals[2] + totals[3], totals[3]].map((item) => +((100 * item) / sum).toFixed(1));
  return { shares, bands: totals, rating: rateShares(shares, table) };
}

// rating where lower is better and `edges` are inclusive upper limits (duplication %, volume KLOC)
function rateLow(value, edges) {
  for (const rating of BAND_ORDER) if (value <= edges[rating]) return rating;
  return '--';
}
function rateHigh(value, edges) {
  for (const rating of BAND_ORDER) if (value >= edges[rating]) return rating;
  return '--';
}

// % of production lines inside a window of DUP_WINDOW_LINES identical normalised lines that has already been seen
function duplication(prodLines) {
  const seen = new Set(),
    redundant = new Set();
  let total = 0;
  for (const { file, lines } of prodLines) {
    total += lines.length;
    for (let index = 0; index + DUP_WINDOW_LINES <= lines.length; index++) {
      const window = lines.slice(index, index + DUP_WINDOW_LINES).join('\n');
      if (window.length < DUP_MIN_CHARS) continue;
      if (seen.has(window)) {
        for (let k = index; k < index + DUP_WINDOW_LINES; k++) redundant.add(file + ':' + k);
      } else seen.add(window);
    }
  }
  return { percent: total ? +((100 * redundant.size) / total).toFixed(1) : 0, redundantLines: redundant.size };
}

// normalised code lines of a script: comments gone, whitespace collapsed, empty lines dropped
function normalisedLines(scan) {
  return scan.code
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

// resolve a relative require() spec to a scoped file, or null
function resolveSpec(fromRel, spec, known) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  return ['', '.js', '.cjs', '.mjs', '/index.js'].map((item) => base + item).find((candidate) => known.has(candidate)) || null;
}

// fan-in per production file: distinct other files that require it or call one of its uniquely-defined functions
function fanIn(prod) {
  const known = new Set(prod.map((entry) => entry.rel));
  const owners = new Map();
  for (const entry of prod) for (const name of new Set(entry.fnNames)) owners.set(name, owners.has(name) ? null : entry.rel);
  const callers = new Map(prod.map((entry) => [entry.rel, new Set()]));
  for (const entry of prod) {
    for (const spec of entry.requires) {
      const target = resolveSpec(entry.rel, spec, known);
      if (target && target !== entry.rel) callers.get(target).add(entry.rel);
    }
    for (const name of entry.callNames) {
      const owner = owners.get(name);
      if (owner && owner !== entry.rel && name.length >= 5) callers.get(owner).add(entry.rel);
    }
  }
  return new Map([...callers].map(([rel, set]) => [rel, set.size]));
}

// SIG component balance: number of components (1–2 level folders) and how evenly production lines spread (Gini)
function componentBalance(prod) {
  const byTop = new Map();
  for (const entry of prod) {
    const top = entry.rel.split('/')[0];
    byTop.set(top, (byTop.get(top) || 0) + entry.lines);
  }
  const grand = [...byTop.values()].reduce((total, item) => total + item, 0) || 1;
  const [bigName, bigLines] = [...byTop].sort((first, second) => second[1] - first[1])[0] || ['', 0];
  const keyOf = (text) => {
    const parts = text.split('/');
    return bigLines / grand > 0.5 && parts[0] === bigName && parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0];
  };
  const sizes = new Map();
  for (const entry of prod) sizes.set(keyOf(entry.rel), (sizes.get(keyOf(entry.rel)) || 0) + entry.lines);
  const values = [...sizes.values()].sort((first, second) => first - second);
  const n = values.length,
    sum = values.reduce((total, item) => total + item, 0) || 1;
  const gini = n < 2 ? 1 : values.reduce((total, item, i) => total + (2 * (i + 1) - n - 1) * item, 0) / (n * sum);
  const countStars = n >= 6 && n <= 12 ? 5 : n >= 4 && n <= 16 ? 4 : n === 3 || (n >= 17 && n <= 24) ? 3 : n === 2 || n > 24 ? 2 : 1;
  const evenStars = gini <= 0.25 ? 5 : gini <= 0.35 ? 4 : gini <= 0.45 ? 3 : gini <= 0.6 ? 2 : 1;
  return {
    components: n,
    gini: +gini.toFixed(2),
    stars: Math.round((countStars + evenStars) / 2),
    biggest: [...sizes].sort((first, second) => second[1] - first[1]).slice(0, 3)
  };
}

/* ── one repo ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
// read every file once: units, lines, names for fan-in, normalised lines for duplication
function measureFiles(files) {
  const prod = [],
    tests = { lines: 0, files: 0 };
  for (const file of files) {
    const entry = { rel: file.rel, lines: 0, units: [], fnNames: [], callNames: [], requires: [], norm: [] };
    for (const script of file.scripts) {
      const scan = scanJs(script.src, { baseLine: script.baseLine });
      entry.lines += countCodeLines(script.src, scan.code);
      if (file.isTest) continue;
      entry.units.push(...unitsOf(scan, script.src, file.rel));
      entry.fnNames.push(...scan.functions.map((fn) => fn.name));
      entry.callNames.push(...scan.calls.filter((call) => !call.holder).map((call) => call.name));
      entry.requires.push(...scan.requires.map((req) => req.spec));
      entry.norm.push(...normalisedLines(scan));
    }
    if (file.isTest) {
      tests.lines += entry.lines;
      tests.files++;
    } else prod.push(entry);
  }
  return { prod, tests };
}

function measureRepo(name, root) {
  const { files, skipped } = readScope(root);
  const { prod, tests } = measureFiles(files);
  const units = prod.flatMap((entry) => entry.units);
  const prodLines = prod.reduce((sum, entry) => sum + entry.lines, 0);
  const inbound = fanIn(prod);
  const modules = prod.map((entry) => ({ rel: entry.rel, lines: entry.lines, fanIn: inbound.get(entry.rel) || 0 }));
  const dup = duplication(prod.map((entry) => ({ file: entry.rel, lines: entry.norm })));
  const props = {
    volume: { value: +(prodLines / 1000).toFixed(1), unit: 'KLOC', rating: rateLow(prodLines / 1000, VOLUME_KLOC) },
    duplication: { value: dup.percent, unit: '% lines', rating: rateLow(dup.percent, DUPLICATION_PCT) },
    unitSize: {
      ...profile(
        units,
        (u) => u.lines,
        UNIT_BANDS.size,
        SHARE_EDGES.size,
        (u) => u.lines
      ),
      unit: '% LOC ≥mod/≥high/vhigh'
    },
    unitComplexity: {
      ...profile(
        units,
        (u) => u.complexity,
        UNIT_BANDS.complexity,
        SHARE_EDGES.complexity,
        (u) => u.lines
      ),
      unit: '% LOC ≥mod/≥high/vhigh'
    },
    unitInterfacing: {
      ...profile(
        units,
        (u) => u.params,
        UNIT_BANDS.interfacing,
        SHARE_EDGES.interfacing,
        () => 1
      ),
      unit: '% units ≥mod/≥high/vhigh'
    },
    moduleCoupling: {
      ...profile(
        modules,
        (m) => m.fanIn,
        UNIT_BANDS.coupling,
        SHARE_EDGES.coupling,
        (m) => m.lines
      ),
      unit: '% LOC ≥mod/≥high/vhigh'
    }
  };
  const balance = componentBalance(prod);
  props.componentBalance = {
    value: balance.components + ' components, Gini ' + balance.gini,
    rating: Object.keys(STAR_FOR).find((item) => STAR_FOR[item] === balance.stars),
    detail: balance
  };
  const ratio = prodLines ? tests.lines / prodLines : 0;
  props.testRatio = { value: +ratio.toFixed(2), unit: 'test LOC ÷ prod LOC', rating: rateHigh(ratio, TEST_RATIO) };
  return {
    name,
    root,
    prodFiles: prod.length,
    prodLines,
    testLines: tests.lines,
    testFiles: tests.files,
    units: units.length,
    skipped,
    props,
    stars: rollUp(props),
    worst: worstUnits(units)
  };
}

// the ten largest-complexity units — where the next shrink pays most
function worstUnits(units) {
  return units
    .slice()
    .sort((first, second) => second.complexity - first.complexity)
    .slice(0, 10)
    .map((item) => ({ name: item.name, file: item.file, line: item.line, lines: item.lines, complexity: item.complexity, params: item.params }));
}

/* ── stars ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const star = (prop) => STAR_FOR[prop.rating];
const mean = (list) => list.reduce((total, item) => total + item, 0) / list.length;

// ISO 25010 sub-characteristics as SIG maps them, then the overall (mean of the five)
function rollUp(p) {
  const sub = {
    analysability: mean([star(p.volume), star(p.duplication), star(p.unitSize), star(p.testRatio)]),
    modifiability: mean([star(p.duplication), star(p.unitComplexity), star(p.moduleCoupling)]),
    testability: mean([star(p.unitComplexity), star(p.unitSize), star(p.testRatio)]),
    modularity: mean([star(p.moduleCoupling), star(p.componentBalance)]),
    reusability: mean([star(p.unitSize), star(p.unitInterfacing)])
  };
  const rounded = Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, +v.toFixed(1)]));
  return { ...rounded, overall: +mean(Object.values(sub)).toFixed(1) };
}

/* ── output ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const PROP_LABEL = {
  volume: 'Volume',
  duplication: 'Duplication',
  unitSize: 'Unit size',
  unitComplexity: 'Unit complexity',
  unitInterfacing: 'Unit interfacing',
  moduleCoupling: 'Module coupling',
  componentBalance: 'Component balance',
  testRatio: 'Test code ratio'
};
const cell = (prop) => '★'.repeat(star(prop)) + '☆'.repeat(5 - star(prop)) + ' ' + star(prop) + ' (' + prop.rating + ')';

function toMarkdown(results) {
  const head = '| property | ' + results.map((item) => item.name).join(' | ') + ' |\n|---|' + results.map(() => '---|').join('') + '\n';
  const rows = Object.keys(PROP_LABEL).map(
    (key) =>
      '| ' +
      PROP_LABEL[key] +
      ' | ' +
      results
        .map((item) => cell(item.props[key]) + ' · ' + (item.props[key].shares ? item.props[key].shares.join('/') + '%' : item.props[key].value))
        .join(' | ') +
      ' |'
  );
  const overall = '| **Overall** | ' + results.map((item) => '**' + item.stars.overall + '**').join(' | ') + ' |';
  const facts = results
    .map(
      (item) =>
        '- ' +
        item.name +
        ': ' +
        item.prodFiles +
        ' prod files · ' +
        item.prodLines +
        ' prod LOC · ' +
        item.testFiles +
        ' test files · ' +
        item.testLines +
        ' test LOC · ' +
        item.units +
        ' units · vendored/generated left out: ' +
        item.skipped.vendored.length +
        '/' +
        item.skipped.generated
    )
    .join('\n');
  return head + rows.join('\n') + '\n' + overall + '\n\n' + facts + '\n';
}

function main(argv) {
  const json = argv.includes('--json');
  const targets = argv.filter((arg) => arg.includes('=')).map((arg) => arg.split('='));
  if (!targets.length) {
    targets.push(['web', path.resolve(__dirname, '..')]);
  }
  const results = targets.filter(([, root]) => fs.existsSync(root)).map(([name, root]) => measureRepo(name, path.resolve(root)));
  if (json) process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  else process.stdout.write(toMarkdown(results));
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { measureRepo, bandOf, rateShares, rateLow, rateHigh, countParams, UNIT_BANDS, SHARE_EDGES };
