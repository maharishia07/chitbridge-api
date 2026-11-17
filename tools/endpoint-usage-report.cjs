/*
 * OWNS      turning caller hits into buckets (A live · B internal · C external · D no caller found), and the test evidence per endpoint.
 * CALLED BY tools/endpoint-usage.cjs (--buckets · --md)
 * FLOW      serverRows -> bucketsOf(rows, hits) -> testEvidence(rows, ...) -> markdown
 * CARD      janitor/endpoint-usage
 *
 * 2026-10-23 (Athi): "in the build phase a count of no-path endpoints is a watch figure; where there is a path it has to be tested
 * and verified". So D is only COUNTED here, and every A, B and C endpoint carries four answers: unit/contract · walk · board case ·
 * in the next reviewer cycle. Read-only: it ranks and counts, nothing is removed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

const STRONG = { exact: 1, 'path-only': 1, 'key-call': 1 };
const ORDER = { A: 0, C: 1, B: 2 };
const SHARED_FILE_SCREENS = 12; /* a file reached from more screens than this is shared plumbing: no screen is blamed for it */
const FILE_DECLARED = {
  'ctp.js': 'cross-installation chit delivery and the well-known file (another installation calls it)',
  'csp-report.js': 'the browser posts CSP reports here (outside caller)',
  'openapi.js': 'the published contract, read by other systems',
  'privacy.js': 'public privacy facts, read without a sign-in'
};

/** The route declarations of one file: router.get('/x') and the books-style helper route('post', '/x'). Returns { method, path, index }. */
function declarationsOf(source) {
  const out = [];
  for (const decl of source.matchAll(/(?:router|ctpRouter)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2/g))
    out.push({ method: decl[1], path: decl[3], index: decl.index });
  for (const decl of source.matchAll(/^route\(\s*(['"])(get|post|put|patch|delete)\1\s*,\s*(['"`])([^'"`]*)\3/gm))
    out.push({ method: decl[2], path: decl[4], index: decl.index, helper: true });
  return out.sort((x, y) => x.index - y.index);
}

/** Every route of routes/, src/routes/ and server.js with its line and what its own code declares about outside callers.
    ⚠️ routes/books.js registers eleven POSTs through its own helper route('post', '/closing-stock', fn) (routes/books.js:2286): a scan for router.post( never sees them. */
function serverRows(API, mounts) {
  const rows = [];
  for (const dir of ['routes', 'src/routes']) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(API, dir)).filter((name) => name.endsWith('.js'));
    } catch (_) {
      continue; /* a checkout without src/routes: the register still lists what the app really mounts */
    }
    for (const file of files) {
      if (dir === 'src/routes' && file === 'catalogue.js') continue; /* its mount is commented out in server.js: not served */
      rows.push(...rowsOfFile(API, dir, file, mounts[file]));
    }
  }
  rows.push({ file: 'server.js', area: 'server', method: 'GET', full: '/health', line: 486, declared: 'the host and the uptime workflow read it' });
  return rows;
}

/** The rows of one route file, once per mount prefix (a router mounted twice is two sets of endpoints, as the register counts it). */
function rowsOfFile(API, dir, file, mount) {
  const source = fs.readFileSync(path.join(API, dir, file), 'utf8');
  const decls = declarationsOf(source);
  const bases = [].concat(mount === undefined ? '' : mount);
  const rows = [];
  decls.forEach((decl, at) => {
    const rest = source.slice(decl.index, decl.index + 700).split(/\n(?:router|ctpRouter)\./)[0];
    const line = source.slice(0, decl.index).split('\n').length;
    const next = decls[at + 1] ? decls[at + 1].index : source.length;
    for (const base of bases) {
      const full = (base + decl.path).replace(/\/+/g, '/').replace(/\/$/, '') || base || '/';
      rows.push({
        file: dir + '/' + file,
        area: file.replace(/\.js$/, ''),
        method: decl.method.toUpperCase(),
        full,
        line,
        span: [decl.index, next],
        helper: !!decl.helper,
        declared: declaredOf(file, full, rest)
      });
    }
  });
  return rows;
}

/** Why a route is called from outside by its own declaration, or null. */
function declaredOf(file, full, chain) {
  const scope = /requireScope\(\s*['"](\w+)['"]/.exec(chain);
  if (scope) return 'API key scope "' + scope[1] + '" (auth.requireScope)';
  if (/\/webhook\//.test(full)) return 'webhook (Meta / mail provider calls it)';
  return FILE_DECLARED[file] || null;
}

/** Same shape for comparing a route with a registry path or a test key: params collapse to :p, query and trailing slash go. */
function norm(text) {
  return text
    .split('?')[0]
    .replace(/\/$/, '')
    .replace(/:[A-Za-z_]+/g, ':p');
}

/** Bucket every row from its hits. Returns rows with bucket, weak, callers. */
function bucketsOf(rows, hits) {
  const keyRows = {};
  rows.forEach((row, id) => (row.keys || []).forEach((key) => (keyRows[key] = keyRows[key] || []).push(id)));
  rows.forEach((row) => (row.callers = []));
  for (const found of hits) {
    const ids = found.route !== undefined ? [found.route] : keyRows[found.key] || [];
    for (const id of ids)
      rows[id].callers.push({ cls: found.src.cls, kind: found.src.kind, label: found.src.label, line: found.line, strength: found.strength });
  }
  rows.forEach(decide);
  return rows;
}

/** One row's bucket: best class among strong evidence; weak evidence still keeps it out of D (and says so). */
function decide(row) {
  const strong = row.callers.filter((caller) => STRONG[caller.strength]);
  const pool = strong.length ? strong : row.callers;
  const classes = pool.map((caller) => caller.cls).sort((first, second) => ORDER[first] - ORDER[second]);
  row.weak = !strong.length && row.callers.length > 0;
  if (!classes.length && row.declared) {
    row.bucket = 'C';
    row.why = 'declared: ' + row.declared;
  } else if (!classes.length) {
    row.bucket = 'D';
    row.why = 'no caller found in web, api, engines, tests, scripts, workflows';
  } else {
    row.bucket = classes[0];
    row.why = evidenceOf(
      pool.filter((caller) => caller.cls === classes[0]),
      row
    );
  }
  row.callers.sort((first, second) => (STRONG[second.strength] ? 1 : 0) - (STRONG[first.strength] ? 1 : 0) || ORDER[first.cls] - ORDER[second.cls]);
}

/** The first caller of the winning class as file:line, plus how many others. */
function evidenceOf(list, row) {
  const first = list[0];
  const more = list.length > 1 ? ' +' + (list.length - 1) : '';
  const decl = row.declared && first.cls !== 'A' ? '; declared: ' + row.declared : '';
  return first.label + ':' + first.line + (first.strength === 'exact' || first.strength === 'key-call' ? '' : ' (' + first.strength + ')') + more + decl;
}

/** Test board cases per screen code, and the screen codes the reviewer cycle names. */
function loadBoard(API, cyclePath) {
  const perCode = {};
  let cases = [];
  try {
    cases = JSON.parse(fs.readFileSync(path.join(API, 'data', 'test-cases.json'), 'utf8')).cases || [];
  } catch (err) {
    logger.warn('endpoint-usage: data/test-cases.json not read, so every board answer reads no: ' + err.message);
    return { perCode, cases, cycle: new Set(), cycleText: '' }; /* no board file: every board answer is "no", and the report says it was not read */
  }
  for (const item of cases) if (item.screen_code) perCode[item.screen_code] = (perCode[item.screen_code] || 0) + 1;
  let cycleText = '';
  try {
    cycleText = fs.readFileSync(cyclePath, 'utf8');
  } catch (err) {
    logger.warn('endpoint-usage: the reviewer-cycle page was not read, so the cycle column reads no: ' + err.message);
  }
  return { perCode, cases, cycle: new Set(cycleText.match(/\b[A-Z]{3}\d{3}\b/g) || []), cycleText };
}

/** Which screens a web file belongs to: from the knowledge graph (web tools/graph build), or none when no graph is given. */
function screensByFile(graphPath) {
  const map = {};
  if (!graphPath) return map;
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const out = {};
  for (const edge of graph.edges) if (edge.kind === 'calls') (out[edge.from] = out[edge.from] || []).push(edge.to);
  const fileOf = (id) => (/^(?:fn|file|screen):web:([^#]+)/.exec(id) || [])[1];
  for (const screen of graph.nodes.filter((count) => count.kind === 'screen' && count.repo === 'web')) {
    let frontier = [screen.id];
    const seen = new Set(frontier);
    for (let depth = 0; depth < 2; depth++) {
      frontier = frontier.flatMap((id) => (out[id] || []).filter((to) => !seen.has(to) && seen.add(to)));
    }
    for (const id of seen) if (fileOf(id)) (map[fileOf(id)] = map[fileOf(id)] || new Map()).set(screen.id, screen);
  }
  return map;
}

/** The screens one row is reached through (web A and C callers only). */
function screensOf(row, byFile) {
  const found = new Map();
  let shared = false;
  for (const caller of row.callers.filter((x) => x.label.startsWith('web:') && x.cls !== 'B')) {
    const set = byFile[caller.label.slice(4)];
    if (!set) continue;
    if (set.size > SHARED_FILE_SCREENS) shared = true;
    else for (const [id, node] of set) found.set(id, node);
  }
  return { screens: [...found.values()], shared };
}

/** Walk files that exercise a screen: the page file name, or the screen's nav key as a quoted word (indicative, over-links on purpose). */
function walkReaches(screen, walkTexts) {
  const names = [];
  if (screen.screen === 'page' || screen.screen === 'tab') names.push(path.basename(screen.file));
  if (screen.nav && screen.nav.length >= 4) names.push("'" + screen.nav + "'", '"' + screen.nav + '"');
  return Object.keys(walkTexts).filter((label) => names.some((count) => walkTexts[label].indexOf(count) >= 0));
}

/** "METHOD /path" keys of a register file, with params collapsed, as a Set. */
function routeKeys(register) {
  return new Set(Object.keys(register).map((name) => name.split(' ')[0] + ' ' + norm(name.slice(name.indexOf(' ') + 1))));
}

/** The strong hits of one row from the given kinds of caller. */
function directHits(row, kinds) {
  return row.callers.filter((caller) => kinds.indexOf(caller.kind) >= 0 && STRONG[caller.strength]);
}

/** unit/contract evidence: the register's error tests, its contract cases, an api test that calls the route, a real-stack truth test. */
function unitEvidence(row, sets) {
  const key = row.method + ' ' + norm(row.full);
  const unitTests = directHits(row, ['unit']);
  const realTests = directHits(row, ['real-stack']);
  const reasons = [
    sets.errorTests.has(key) ? 'error-tests' : '',
    sets.contract.has(key) ? 'contract' : '',
    unitTests.length ? 'test:' + unitTests[0].label.replace('api:tests/', '') : '',
    realTests.length ? 'real-stack:' + realTests[0].label.replace('api:tests/', '') : ''
  ].filter(Boolean);
  return { unit: reasons.length > 0, unitWhy: reasons.join(' ') };
}

/** walk, board case and reviewer-cycle evidence: direct hits, and the screens the route is reached through. */
function screenEvidence(row, ctx) {
  const walks = directHits(row, ['walk']);
  const reach = screensOf(row, ctx.byFile);
  const codes = reach.screens.map((screen) => screen.code).filter(Boolean);
  const viaWalk = reach.screens.flatMap((screen) => walkReaches(screen, ctx.walkTexts).map((walkLabel) => walkLabel.replace(/^web:e2e\//, '')));
  const cases = codes.reduce((sum, code) => sum + (ctx.board.perCode[code] || 0), 0);
  const mention = ctx.board.cases.filter((item) => item.title && item.title.indexOf(row.full) >= 0).length;
  return {
    walk: walks.length > 0 || viaWalk.length > 0,
    walkWhy: walks.length ? 'direct:' + walks[0].label.replace('web:e2e/', '') : viaWalk.length ? 'screen:' + viaWalk[0] : '',
    board: cases + mention > 0,
    boardWhy: cases ? cases + ' case(s) on ' + [...new Set(codes)].slice(0, 3).join(',') : mention ? mention + ' case(s) name the path' : '',
    cycle: codes.some((code) => ctx.board.cycle.has(code)) || ctx.board.cycleText.indexOf(row.full) >= 0,
    screens: reach.screens.map((screen) => screen.label || screen.nav || path.basename(screen.file)),
    shared: reach.shared && !reach.screens.length
  };
}

/** Attach row.tests = { unit, walk, board, cycle, gap, ... } to every row that has a path (bucket A, B or C). */
function testEvidence(rows, ctx) {
  const sets = { errorTests: routeKeys(ctx.errorTests), contract: routeKeys(ctx.contractResults) };
  for (const row of rows) {
    if (row.bucket === 'D') continue;
    row.tests = Object.assign(unitEvidence(row, sets), screenEvidence(row, ctx));
    row.tests.gap = !row.tests.walk && !row.tests.board;
  }
}

module.exports = { serverRows, bucketsOf, loadBoard, screensByFile, testEvidence, norm };
