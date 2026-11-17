#!/usr/bin/env node
/**
 * tools/graph/graph.cjs — the call graph, the joined knowledge graph, and the reasoning over it (KG1, 2026-10-12).
 *
 * Athi, 2026-10-12: *"knowledge graph, call graph, reasoning engine, digital twin — do we have all this?"* — in steps; this is
 * steps 1 + 2. One static, deterministic read of the three repos side by side (web = this one · ../chitbridge-api ·
 * ../chitbridge-engines), joined with what already names the system:
 *   · docs/process/flows.json (PM1)            the flow steps, and which screen fn · engine fn · route · test each one names
 *   · public/app/screens.js (CBSCREENS)        the screen codes; app.html's `UI.nav==="x"` dispatch says which fn paints each
 *   · api tools/endpoint-usage.cjs --json      the client's endpoint registry and the server's mounts — SPAWNED, the way
 *                                              api tests/round-trips-all.test.cjs does ("one scan, not a second copy of it")
 *   · api migrations/*.sql + db/schema.sql     the tables that exist (CREATE TABLE / VIEW)
 *   · engines src/reg-*.js                     the regulation packs
 *   · a decisions file                         NONE exists in any of the three repos (searched by name and heading) — the
 *                                              `decision` node kind and `decided-by` edges are skipped, and meta says so
 *
 * Nodes  step · screen · function · route · table · test · pack · file · errcode · lesson · check   (the last three: FEEDGRAPH, tools/graph/apifeed.cjs)
 * Edges  implements (step → code) · calls (fn/screen/route → fn; fn → route via http) · reads / writes (code → table)
 *        tested-by (code → test) · requires (file → file) · vendors (adopted copy → engines source) · uses (file → pack)
 *        opens (screen → screen: a sheet raised from a page — SCREEN-ID, read from tools/screen-list.cjs)
 *        returns (route → errcode) · enforced-by / mentions (lesson → check) · tested-by also from the api's error-tests / contract / evidence files
 *
 *   node tools/graph/graph.cjs build                      → tools/graph/out/calls.json + graph.json (gitignored)
 *   node tools/graph/graph.cjs impact <file|function>     flow steps, screens, routes and TESTS touched by a change there
 *   node tools/graph/graph.cjs changed <git-range>        git diff → impacted tests (the list a PR should run)  [--repo api|engines]
 *   node tools/graph/graph.cjs gaps                       steps with no test · functions on no flow · routes no screen calls · tables no route touches · routes no test proves · lessons nothing enforces
 *   flags: --roots web=DIR,api=DIR,engines=DIR  --out DIR  --json  --depth N  --top N
 *
 * ⚠️ WHAT IT CANNOT SEE, SAID PLAINLY: static names only. Dynamic dispatch (`window[name]()`), a holder chain longer than one
 * (`a.b.c()`), SQL built from variables, and a route reached only by a storefront script it does not scan are all invisible.
 * It over-links on purpose where it is unsure (a callback reference counts as a call): impact must err towards MORE tests.
 *
 * OWNS      the knowledge graph: its nodes, edges and the three questions over it; tools/graph/out/{calls,graph}.json (gitignored)
 * CALLED BY e2e/knowledge-graph.cjs (web CI), tools/graph/trace.cjs (READ-GUARD: trace.json per repo), by hand
 * CARD      qa/knowledge-graph
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const S = require('./scan.cjs');
const APIFEED = require('./apifeed.cjs');
/** the most the api's own route scanner may take inside a build (MNT-49): it ran about 7 s here, so 90 s is a hang, not work */
const EU_TIMEOUT_MS = 90000;

/* ── args ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] == null || /^--/.test(argv[i + 1]) ? true : argv[i + 1]) : dflt;
};
const positional = argv.filter((item, index) => !/^--/.test(item) && !(index > 0 && /^--(roots|out|depth|top|repo|endpoint-usage|home)$/.test(argv[index - 1])));
const CMD = positional[0];
const ARG = positional[1];
const HERE = __dirname;
const WEB_DEFAULT = path.resolve(HERE, '..', '..');
const ROOTS = { web: WEB_DEFAULT, api: path.resolve(WEB_DEFAULT, '..', 'chitbridge-api'), engines: path.resolve(WEB_DEFAULT, '..', 'chitbridge-engines') };
if (process.env.CB_GRAPH_ROOTS) parseRoots(process.env.CB_GRAPH_ROOTS);
if (flag('roots')) parseRoots(flag('roots'));
function parseRoots(s) {
  String(s)
    .split(',')
    .forEach((item) => {
      const m = /^(web|api|engines)=(.+)$/.exec(item.trim());
      if (m) ROOTS[m[1]] = path.resolve(m[2]);
    });
}
const OUT = path.resolve(flag('out', path.join(HERE, 'out')));
const JSON_OUT = !!flag('json', false);
/* depth of the reverse walk: 4 by default — app.html is one window, so an unlimited walk from any shared helper reaches every
   screen and every step, which is true and useless. `--depth 0` lifts the limit. */
const DEPTH = flag('depth', null) == null ? 4 : Number(flag('depth')) || 0;
const TOP = Number(flag('top', 10)) || 10;
/* the folder that holds docs/29-…/tests/TEST-LIBRARY.json and PM/API-LESSONS-AUDIT-*.md (the dev root, beside the repos) */
const HOME = path.resolve(String(flag('home', path.resolve(ROOTS.web, '..'))));

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch (_) {
    return false;
  }
};
const read = (p) => fs.readFileSync(p, 'utf8');
const rel = (repo, abs) => path.relative(ROOTS[repo], abs).split(path.sep).join('/');
const walk = (dir, keep, out = []) => {
  if (!exists(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/^(node_modules|\.git|vendor|dist|_design)$/.test(e.name)) walk(p, keep, out);
    } else if (keep(p)) out.push(p);
  }
  return out;
};
const norm = (p) =>
  String(p)
    .split('?')[0]
    .replace(/\/$/, '')
    .replace(/:[A-Za-z_][\w]*/g, ':p') || '/';

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   BUILD
   ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
const NOT_WEB_CODE = /(^|\/)(vendor|_design|fixture|node_modules)\//; /* over the path INSIDE the web root (the fixture root itself is one) */
/** the web's own code: pages, public scripts (engine copies told apart), and — READ-GUARD — tools/ + scripts/ (not their tests) */
function addWebCode(webRoot, addFile) {
  const publicDir = path.join(webRoot, 'public');
  const isOwnCode = (filePath) => !NOT_WEB_CODE.test(path.relative(webRoot, filePath).split(path.sep).join('/'));
  walk(publicDir, (filePath) => /\.html$/.test(filePath) && isOwnCode(filePath) && (path.dirname(filePath) === publicDir || /[\\/](cmdb|illustrations)[\\/]/.test(filePath)))
    .sort()
    .forEach((filePath) => addFile('web', filePath, 'page'));
  walk(publicDir, (filePath) => /\.js$/.test(filePath) && !/\.min\.js$/.test(filePath) && isOwnCode(filePath))
    .sort()
    .forEach((filePath) => addFile('web', filePath, /[\\/]engine[\\/]/.test(filePath) ? 'web-engine' : 'web-script'));
  for (const dir of ['tools', 'scripts'])
    walk(path.join(webRoot, dir), (filePath) => /\.(cjs|js|mjs)$/.test(filePath) && !/\.test\.(cjs|js|mjs)$/.test(filePath) && isOwnCode(filePath))
      .sort()
      .forEach((filePath) => addFile('web', filePath, 'web-tool'));
}

/** a test naming a module by path string → that module's file node (web: app/ engine/ tools/ scripts/; api: lib/ routes/ … tools/ scripts/) */
const FILE_NAMED = {
  web: [/(?:^|[\/'"\s])(?:public\/)?((?:app|engine)\/[\w.-]+\.js|cb-sw\.js)$/, /(?:^|[\/'"\s])((?:tools|scripts)\/[\w.\/-]+\.(?:cjs|js|mjs))$/],
  api: [
    /(?:^|[\/'"\s])((?:lib|routes|middleware|src|governance|tools|scripts)\/[\w.\/-]+?)(?:\.c?js)?$/,
    /(?:^|[\/'"\s])(tools\/tally-connector\/[\w.-]+\.html)$/
  ],
  engines: [/(?:^|[\/'"\s])((?:src|tools)\/[\w.\/-]+\.c?js)$/]
};
/** the node id a test's string names, or null — the name may come without its extension (path.join(API, 'lib', 'rail')), a web
 *  file may sit under public/, and a counter page is a screen node (INT7b) */
function fileNamedBy(repo, text, byId) {
  for (const pattern of FILE_NAMED[repo] || []) {
    const match = pattern.exec(text);
    if (!match) continue;
    const relPaths = [match[1], match[1] + '.js', match[1] + '.cjs'];
    const candidates = ['file:' + repo + ':public/', 'file:' + repo + ':', 'screen:' + repo + ':'].flatMap((prefix) =>
      relPaths.map((relPath) => prefix + relPath)
    );
    const found = candidates.find((id) => byId.has(id));
    if (found) return found;
  }
  return null;
}
/** a test that OPENS a page drives the scripts that page loads with <script src> (not the workshop app.html, whose caps load lazily) — INT7b */
function linkPageScripts(page, testFile, resolveWebSrc, edge) {
  if (!page || page.rel === 'public/app.html') return;
  for (const script of page.scripts || []) {
    const file = resolveWebSrc(page, script.src);
    if (file) edge(file.id, testFile.id, 'tested-by', 'page');
  }
}
/** every module a test names by path string gets a tested-by edge (READ-GUARD: the trace row of a tool or a lib) */
function linkNamedFiles(testFile, byId, edge) {
  const named = testFile.scan.strings.concat(testFile.scan.joinedPaths || []); /* a path.join(...) of string segments names a file too (INT7b) */
  for (const text of named) {
    const file = fileNamedBy(testFile.repo, text.text, byId);
    if (file) edge(file, testFile.id, 'tested-by', 'reads');
  }
}

/** { kind: how many } for a list of nodes or edges, in first-seen order */
function countKinds(items) {
  const counts = {};
  items.forEach((item) => {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
  });
  return counts;
}

/** the tested-by `via` of a test that calls a path: an open path (variable tail) that is not itself a route matched by PREFIX, which is a guess */
const httpProofVia = (isOpenPath, isExactRoute) => (isOpenPath && !isExactRoute ? 'http-prefix' : 'http');

/** W2 (30 Oct): every prefix a route file is mounted at (a router mounted twice, ctp.js at '/' and /api/ctp, is two sets of endpoints; the first is the module's route, the rest are route nodes of their own) */
function mountsOf(relFile, mounts, mountsAll) {
  const name = path.basename(relFile);
  const every = mountsAll && mountsAll[name] && mountsAll[name].length ? mountsAll[name] : [(mounts && mounts[name]) || '/api/' + path.basename(relFile, '.js')];
  return every.map((prefix) => (prefix === '/' ? '' : prefix));
}
const routePath = (base, tail) => (base + tail).replace(/\/$/, '') || base || '/';

/** W2 (30 Oct): the app's own routes (server.js: GET /health, OPTIONS *): the register lists them, so a module must serve them */
function appRoutesOf(serverFile) {
  const appRoutes = [];
  if (!serverFile || !serverFile.scan) return appRoutes;
  for (const call of serverFile.scan.code.matchAll(/\bapp\.(get|post|put|patch|delete|options)\s*\(\s*(['"])/g)) {
    const text = serverFile.scan.strings.find((item) => item.start === call.index + call[0].length);
    if (!text) continue;
    const method = call[1].toUpperCase();
    appRoutes.push({ id: 'route:api:server.js ' + method + ' ' + text.text, key: method + ' ' + text.text, node: { kind: 'route', repo: 'api', file: 'server.js', method, tail: text.text, path: text.text, line: serverFile.scan.toLine(call.index) } });
  }
  return appRoutes;
}

/** run the api's own route scanner as a child; a stuck one is stopped after EU_TIMEOUT_MS and throws, so build() notes it, never a silent freeze (MNT-49) */
function runEndpointScanner(scannerFile, apiDir, webDir) {
  const result = spawnSync(process.execPath, [scannerFile, '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    timeout: EU_TIMEOUT_MS,
    env: Object.assign({}, process.env, { CB_API_DIR: apiDir, CB_WEB_DIR: webDir })
  });
  if (result.error) throw new Error('stopped: ' + result.error.code + ' after ' + EU_TIMEOUT_MS / 1000 + 's'); /* build() records it in meta.notes, so graph.json says why */
  return result;
}

function build() {
  const t0 = Date.now();
  const meta = { generated: new Date().toISOString().slice(0, 10), roots: {}, present: {}, notes: [], counts: {} };
  for (const r of Object.keys(ROOTS)) {
    meta.roots[r] = ROOTS[r];
    meta.present[r] = exists(ROOTS[r]);
  }
  if (!meta.present.api)
    meta.notes.push('../chitbridge-api is not beside this checkout: no routes, tables, api functions or api tests — the api half of the graph is absent');
  if (!meta.present.engines) meta.notes.push('../chitbridge-engines is not beside this checkout: no packs or engine functions');

  const nodes = new Map(); // id -> node
  const edges = new Map(); // key -> edge
  const node = (id, props) => {
    const n = nodes.get(id);
    if (n) {
      Object.assign(n, props || {});
      return n;
    }
    const o = Object.assign({ id }, props || {});
    nodes.set(id, o);
    return o;
  };
  const edge = (from, to, kind, via) => {
    if (!from || !to || from === to) return;
    const k = from + '\u0001' + to + '\u0001' + kind + '\u0001' + (via || '');
    if (!edges.has(k)) edges.set(k, via ? { from, to, kind, via } : { from, to, kind });
  };

  /* ── 1 · the files ───────────────────────────────────────────────────────────────────────────────────────────── */
  const files = []; // { repo, rel, abs, kind }
  const addFile = (repo, abs, kind) => {
    if (exists(abs)) files.push({ repo, abs, rel: rel(repo, abs), kind });
  };
  const W = ROOTS.web,
    A = ROOTS.api,
    E = ROOTS.engines;
  addWebCode(W, addFile); /* pages · public scripts · tools/ + scripts/ (READ-GUARD: a tool is a module with a trace row too) */
  const webTests = []
    .concat(
      walk(path.join(W, 'e2e'), (p) => /\.(cjs|js|mjs)$/.test(p) && path.dirname(p) === path.join(W, 'e2e')),
      walk(path.join(W, 'tests'), (p) => /\.(cjs|js|mjs)$/.test(p)),
      walk(path.join(W, 'scripts'), (p) => /\.test\.(cjs|js|mjs)$/.test(p))
    )
    .sort();
  webTests.forEach((item) => addFile('web', item, 'test'));
  /* api */
  if (meta.present.api) {
    ['lib', 'routes', 'src', 'middleware', 'governance', 'tools', 'scripts'].forEach((item) =>
      walk(path.join(A, item), (p) => /\.[cm]?js$/.test(p) && !/\.test\.[cm]?js$/.test(p))
        .sort()
        .forEach((entry) => addFile('api', entry, /[\\/]routes[\\/]/.test(entry) ? 'route-file' : 'api-lib'))
    );
    addFile('api', path.join(A, 'server.js'), 'api-lib');
    walk(path.join(A, 'tests'), (p) => /\.(test\.)?(cjs|js)$/.test(p) && !/[\\/](fixtures|support|helpers?)[\\/]/.test(p))
      .sort()
      .forEach((item) => addFile('api', item, 'test'));
    /* the counter's pages (the till master and promo) are own code with a trace row: screens of the api repo (INT7b) */
    walk(
      path.join(A, 'tools', 'tally-connector'),
      (filePath) => /\.html$/.test(filePath) && path.dirname(filePath) === path.join(A, 'tools', 'tally-connector')
    )
      .sort()
      .forEach((filePath) => addFile('api', filePath, 'page'));
  }
  /* engines */
  if (meta.present.engines) {
    walk(path.join(E, 'src'), (p) => /\.js$/.test(p))
      .sort()
      .forEach((item) => addFile('engines', item, /[\\/]reg-[a-z]+\.js$/.test(item) ? 'pack' : 'engine'));
    addFile('engines', path.join(E, 'index.js'), 'engine');
    walk(path.join(E, 'tests'), (p) => /\.(cjs|js)$/.test(p) && !/[\\/]fixtures[\\/]/.test(p))
      .sort()
      .forEach((item) => addFile('engines', item, 'test'));
  }

  /* ── 2 · scan every file ─────────────────────────────────────────────────────────────────────────────────────── */
  const byId = new Map(); // fileId -> record
  for (const f of files) {
    f.id = (f.kind === 'test' ? 'test:' : f.kind === 'page' ? 'screen:' : 'file:') + f.repo + ':' + f.rel;
    const text = read(f.abs);
    f.src = text;
    if (f.kind === 'page') {
      const h = S.scanHtml(text);
      f.scripts = h.scripts;
      f.markupHandlers = h.handlers;
      f.scan = {
        code: '',
        strings: [],
        joinedPaths: [],
        functions: [],
        calls: [],
        requires: [],
        exports: [],
        globals: [],
        apiKeys: [],
        apiPaths: [],
        handlers: []
      };
      /* a page's code view is the inline blocks laid at their offsets, so positions are page positions */
      let code = text.replace(/[^\n]/g, ' ');
      for (const b of h.inline) {
        const j = S.scanJs(b.code, { baseLine: b.baseLine });
        code = code.slice(0, b.offset) + j.code + code.slice(b.offset + j.code.length);
        const shift = (arr) =>
          arr.forEach((x) => {
            if (x.pos != null) x.pos += b.offset;
            if (x.start != null) x.start += b.offset;
            if (x.end != null) x.end += b.offset;
            if (x.paramsAt != null) x.paramsAt += b.offset;
            if (x.declAt != null) x.declAt += b.offset;
          });
        ['strings', 'joinedPaths', 'functions', 'calls', 'requires', 'apiKeys', 'apiPaths', 'handlers'].forEach((item) => {
          shift(j[item]);
          f.scan[item] = f.scan[item].concat(j[item]);
        });
        f.scan.exports = f.scan.exports.concat(j.exports);
        f.scan.globals = f.scan.globals.concat(j.globals);
      }
      f.scan.code = code;
      f.scan.toLine = S.lineIndex(text);
      f.scan.functions.sort((first, second) => first.start - second.start || second.end - first.end);
    } else {
      f.scan = S.scanJs(text);
      f.scan.toLine = f.scan.toLine || S.lineIndex(text);
    }
    /* the vendored-engine header: "ADOPTED from chitbridge-engines vX · name" */
    const ad = /ADOPTED from chitbridge-engines v[\d.]+ · ([a-z0-9-]+)/.exec(text.slice(0, 400));
    if (ad) f.adopted = ad[1];
    /* a single `module.exports = EXPORTS` where EXPORTS is an object literal */
    if (f.scan.exports.length === 1 && new RegExp('(?:const|var|let)\\s+' + f.scan.exports[0].replace(/\$/g, '\\$') + '\\s*=\\s*\\{').test(f.scan.code)) {
      const m = new RegExp('(?:const|var|let)\\s+' + f.scan.exports[0].replace(/\$/g, '\\$') + '\\s*=\\s*\\{').exec(f.scan.code);
      const open = m.index + m[0].length - 1,
        close = S.matchBracket(f.scan.code, open);
      if (close > 0)
        f.scan.exports = f.scan.code
          .slice(open + 1, close)
          .split(',')
          .map((item) => (/^\s*([A-Za-z_$][\w$]*)/.exec(item) || [])[1])
          .filter((x) => x && !S.KEYWORDS.has(x));
    }
    byId.set(f.id, f);
  }
  meta.counts.files = files.length;

  /* ── 3 · function nodes, enclosure, attribution ─────────────────────────────────────────────────────────────── */
  for (const f of files) {
    const rows = f.scan.functions;
    const seenName = new Map();
    /* parent = innermost enclosing function (a stack sweep over start-sorted ranges) */
    const stack = [];
    for (const fn of rows) {
      while (stack.length && stack[stack.length - 1].end < fn.start) stack.pop();
      fn.parent = stack.length ? stack[stack.length - 1] : null;
      stack.push(fn);
      fn.top = !fn.parent;
      const n = (seenName.get(fn.name) || 0) + 1;
      seenName.set(fn.name, n);
      fn.id = 'fn:' + f.repo + ':' + f.rel + '#' + fn.name + (n > 1 ? ':' + fn.line : '');
      if (f.kind !== 'test')
        node(fn.id, { kind: 'function', name: fn.name, repo: f.repo, file: f.rel, line: fn.line, endLine: fn.endLine, top: fn.top, form: fn.kind });
    }
    /* attribute every positioned thing to its innermost function (or null = file level) */
    const owner = (pos) => {
      let best = null;
      for (const fn of rows) {
        if (fn.start > pos) break;
        if (fn.end >= pos && (!best || fn.start >= best.start)) best = fn;
      }
      return best;
    };
    /* the sweep above is O(n) per lookup; make it O(log n) with a sorted array of starts + a parent chain */
    const starts = rows.map((x) => x.start);
    const ownerFast = (pos) => {
      let count = 0,
        hi = starts.length - 1,
        idx = -1;
      while (count <= hi) {
        const mid = (count + hi) >> 1;
        if (starts[mid] <= pos) {
          idx = mid;
          count = mid + 1;
        } else hi = mid - 1;
      }
      let fn = idx >= 0 ? rows[idx] : null;
      while (fn && fn.end < pos) fn = fn.parent;
      return fn;
    };
    f.owner = rows.length > 400 ? ownerFast : owner;
    f.scan.calls.forEach((item) => {
      item.owner = f.owner(item.pos);
    });
    f.scan.handlers.forEach((item) => {
      item.owner = f.owner(item.pos);
    });
    f.scan.apiKeys.forEach((item) => {
      item.owner = f.owner(item.pos);
    });
    f.scan.apiPaths.forEach((item) => {
      item.owner = f.owner(item.pos);
    });
    f.scan.strings.forEach((item) => {
      item.owner = f.owner(item.start);
    });
    /* nodes for files (not pages — a page IS its screen node — and not tests, which are test nodes) */
    if (f.kind === 'page')
      node(f.id, {
        kind: 'screen',
        screen: 'page',
        repo: f.repo,
        file: f.rel,
        lab: /-(lab|design|next)\.html$|design-mock|screen-gallery|lifecycle-test|shell-lab/.test(f.rel)
      });
    else if (f.kind === 'test') node(f.id, { kind: 'test', repo: f.repo, file: f.rel });
    else node(f.id, { kind: 'file', repo: f.repo, file: f.rel, fileKind: f.kind, adopted: f.adopted || undefined });
  }

  /* ── 4 · routes (api), their mounts and the client's registry — via the api's own scanner ───────────────────── */
  const routes = []; // { id, file, method, tail, path, start, end, fileRec }
  let registry = null,
    [mounts, mountsAll] = [null, null],
    euRows = null;
  /* --endpoint-usage PATH: the fixture test points at the REAL api scanner while --roots points api= at the fixture */
  const EU = flag('endpoint-usage', null) ? path.resolve(flag('endpoint-usage')) : path.join(A, 'tools', 'endpoint-usage.cjs');
  if (meta.present.api && exists(EU)) {
    try {
      const r = runEndpointScanner(EU, A, W);
      const parsed = JSON.parse(r.stdout);
      [mounts, mountsAll] = [parsed.mounts || null, parsed.mountsAll || null];
      euRows = parsed.routes || null;
      registry = parsed.registry || null;
      if (!registry)
        meta.notes.push(
          "api tools/endpoint-usage.cjs --json hands back no `registry` (it predates KG1): api('key') calls cannot be joined to routes — update the api"
        );
      if (!mounts) meta.notes.push('api tools/endpoint-usage.cjs --json hands back no `mounts`');
    } catch (e) {
      meta.notes.push(
        'api tools/endpoint-usage.cjs --json did not answer (' + String(e.message).slice(0, 80) + '): screen→route joins fall back to route-file names'
      );
    }
  } else if (meta.present.api) {
    meta.notes.push(
      "api tools/endpoint-usage.cjs is not in the api checkout: mounts and the client registry are unknown — route paths are guessed from the route file name (/api/<file>) and api('key') calls are not joined"
    );
  }
  meta.endpointUsage = registry ? 'registry+mounts' : mounts ? 'mounts' : 'absent';
  if (euRows) meta.endpointUsageCounts = { routes: euRows.length, calledByRegistry: euRows.filter((item) => item.calls > 0).length };
  const pathIndex = new Map(); // norm(METHOD path) -> route id
  for (const f of files) {
    if (f.kind !== 'route-file') continue;
    const code = f.scan.code;
    /* router.post('/x', …)  — and routes/books.js's own helper  route('post', '/x', …) */
    const re = /\b(?:router\.(get|post|put|patch|delete|options|all)\s*\(\s*(['"`])|route\s*\(\s*(['"])(?=\s*['"]\s*,\s*['"]))/g;
    const found = [];
    let m;
    while ((m = re.exec(code))) {
      let method, s;
      if (m[1]) {
        method = m[1].toUpperCase();
        s = f.scan.strings.find((x) => x.start === m.index + m[0].length);
      } else {
        const ms = f.scan.strings.find((x) => x.start === m.index + m[0].length);
        if (!ms || !/^(get|post|put|patch|delete|all)$/i.test(ms.text)) continue;
        method = ms.text.toUpperCase();
        const q = code.indexOf(',', ms.end);
        const q2 = q < 0 ? -1 : code.slice(q).search(/['"]/);
        s = q2 < 0 ? null : f.scan.strings.find((x) => x.start === q + q2 + 1);
      }
      if (!s) continue;
      found.push({ method, tail: s.text, start: m.index, line: f.scan.toLine(m.index) });
    }
    found.forEach((item, index) => {
      item.end = index + 1 < found.length ? found[index + 1].start : code.length;
    });
    mountsOf(f.rel, mounts, mountsAll).forEach((base, which) => {
      for (const r of found) {
        const full = routePath(base, r.tail);
        const id = 'route:api:' + f.rel + ' ' + r.method + ' ' + r.tail + (which ? ' @' + base : '');
        node(id, { kind: 'route', repo: 'api', file: f.rel, method: r.method, tail: r.tail, path: full, pathGuessed: !(mounts && mounts[path.basename(f.rel)]) || undefined, line: r.line });
        pathIndex.has(r.method + ' ' + norm(full)) || pathIndex.set(r.method + ' ' + norm(full), id);
        if (!which) routes.push(Object.assign(r, { id, file: f.rel, path: full, fileRec: f }));
      }
    });
    f.routes = found;
  }
  appRoutesOf(files.find((file) => file.rel === 'server.js')).forEach((app) => (node(app.id, app.node), pathIndex.has(app.key) || pathIndex.set(app.key, app.id)));
  meta.counts.routes = routes.length;
  /* which route owns a position in a route file (outside any named function) */
  const routeAt = (f, pos) => {
    if (!f.routes) return null;
    for (const r of f.routes) if (pos >= r.start && pos < r.end) return r;
    return null;
  };
  const resolvePath = (method, p, open) => {
    const exact = pathIndex.get(method + ' ' + norm(p));
    if (exact) return [exact];
    const n = norm(p);
    const out = [];
    for (const [k, id] of pathIndex) {
      const [mth, text] = [k.slice(0, k.indexOf(' ')), k.slice(k.indexOf(' ') + 1)];
      if (mth !== method) continue;
      if (open ? text === n + '/:p' || text.startsWith(n + '/:p/') || text.startsWith(n + '/') : text === n) out.push(id);
    }
    return out.slice(0, 6);
  };

  /* ── 5 · tables (api migrations + schema) ───────────────────────────────────────────────────────────────────── */
  if (meta.present.api) {
    const sqlFiles = []
      .concat(
        walk(path.join(A, 'migrations'), (p) => /\.sql$/.test(p)),
        walk(path.join(A, 'db'), (p) => /\.sql$/.test(p)),
        walk(A, (p) => /^migration_.*\.sql$/.test(path.basename(p)) && path.dirname(p) === A)
      )
      .sort();
    for (const p of sqlFiles) {
      const src = read(p).replace(/--[^\n]*/g, '');
      for (const m of src.matchAll(
        /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+)?(TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([A-Za-z_][\w]*)"?/gi
      )) {
        const name = m[2].toLowerCase();
        const n = node('table:' + name, { kind: 'table', name, declared: true });
        n.kind_sql = /view/i.test(m[1]) ? 'view' : 'table';
        (n.declaredIn = n.declaredIn || []).includes(rel('api', p)) || n.declaredIn.push(rel('api', p));
      }
    }
    meta.counts.tablesDeclared = [...nodes.values()].filter((item) => item.kind === 'table').length;
  }

  /* ── 6 · scopes and indexes for resolution ──────────────────────────────────────────────────────────────────── */
  const webFiles = files.filter((item) => item.repo === 'web' && item.kind !== 'test');
  const webByRel = new Map(webFiles.map((item) => [item.rel, item]));
  const resolveWebSrc = (page, text) => {
    if (/^https?:|^\/\//.test(text)) return null;
    const clean = text.split('?')[0];
    const relp = clean.startsWith('/') ? 'public' + clean : path.posix.normalize(path.posix.join(path.posix.dirname(page.rel), clean));
    return webByRel.get(relp) || null;
  };
  const pageScope = new Map(); // page -> Set(fileRec)
  const appScripts = webFiles.filter((item) => /^public\/app\/.+\.js$/.test(item.rel));
  for (const page of webFiles.filter((item) => item.kind === 'page')) {
    const set = new Set([page]);
    (page.scripts || []).forEach((item) => {
      const f = resolveWebSrc(page, item.src);
      if (f) set.add(f);
    });
    if (page.rel === 'public/app.html') appScripts.forEach((item) => set.add(item));
    /* files a page (or its scripts) names by path — lazily added scripts */
    for (const f of [...set])
      for (const s of f.scan.strings) {
        const m = /^\/?((?:app|engine)\/[\w.-]+\.js)$/.exec(s.text);
        if (m) {
          const g = webByRel.get('public/' + m[1]);
          if (g) set.add(g);
        }
      }
    pageScope.set(page, set);
  }
  const fileScope = new Map(); // fileRec -> Set(fileRec)
  for (const f of webFiles) {
    const set = new Set([f]);
    for (const [page, scope] of pageScope) if (scope.has(f)) scope.forEach((item) => set.add(item));
    if (set.size === 1 && /^public\/app\//.test(f.rel)) (pageScope.get(webByRel.get('public/app.html')) || new Set()).forEach((item) => set.add(item));
    fileScope.set(f, set);
  }
  /* per file: name -> [fn], and top-level name -> [fn] */
  for (const f of files) {
    f.declAll = new Map();
    f.declTop = new Map();
    for (const fn of f.scan.functions) {
      (f.declAll.get(fn.name) || f.declAll.set(fn.name, []).get(fn.name)).push(fn);
      if (fn.top) (f.declTop.get(fn.name) || f.declTop.set(fn.name, []).get(fn.name)).push(fn);
    }
    f.globalSet = new Set(f.scan.globals.concat(f.scan.exports));
  }
  /* api / engines: require resolution */
  const resolveSpec = (f, spec) => {
    if (spec === 'chitbridge-engines' || /^chitbridge-engines\//.test(spec)) {
      const text = spec.replace(/^chitbridge-engines\/?/, '') || 'index.js';
      return byId.get('file:engines:' + (text.endsWith('.js') ? text : text + '.js')) || byId.get('file:engines:index.js') || null;
    }
    if (!/^\.\.?\//.test(spec)) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(f.rel), spec));
    for (const cand of [base, base + '.js', base + '.cjs', base + '.mjs', base + '/index.js', base + '/index.cjs']) { /* the way Node resolves: exact, extensions, directory index */
      const hit = byId.get('file:' + f.repo + ':' + cand) || byId.get('test:' + f.repo + ':' + cand);
      if (hit) return hit;
    }
    return null;
  };
  for (const f of files) {
    f.aliasFile = new Map(); // alias -> fileRec
    f.nameFile = new Map(); // local name -> { file, exported }
    for (const r of f.scan.requires) {
      const target = resolveSpec(f, r.spec);
      if (!target) continue;
      if (f.kind !== 'test') edge(f.id, target.id, 'requires');
      else edge(target.id, f.id, 'tested-by', 'requires');
      if (r.alias) f.aliasFile.set(r.alias, target);
      for (const n of r.names) f.nameFile.set(n.local, { file: target, exported: n.exported });
    }
  }
  /* globals: web per scope (holder name -> file), api/engines per repo */
  const repoGlobals = { api: new Map(), engines: new Map() };
  for (const f of files)
    if (repoGlobals[f.repo] && f.kind !== 'test') for (const g of f.scan.globals) if (!repoGlobals[f.repo].has(g)) repoGlobals[f.repo].set(g, f);

  const fnsNamed = (f, name, topOnly) => (topOnly ? f.declTop : f.declAll).get(name) || [];
  /** bare name → [fn] from file f */
  const resolveBare = (f, name) => {
    const same = fnsNamed(f, name, false);
    if (same.length) return same;
    const imp = f.nameFile.get(name);
    if (imp) {
      const t = fnsNamed(imp.file, imp.exported, false);
      return t.length ? t : [{ id: imp.file.id }];
    }
    if (f.repo === 'web' || (f.kind === 'test' && f.repo === 'web')) {
      const out = [];
      for (const g of fileScope.get(f) || []) if (g !== f) out.push(...fnsNamed(g, name, true));
      return out;
    }
    return [];
  };
  /** holder.name → [fn | file] from file f */
  const resolveMember = (f, holder, name) => {
    if (/^(window|root|globalThis|self)$/.test(holder)) return resolveBare(f, name);
    let target = f.aliasFile.get(holder) || (f.nameFile.get(holder) || {}).file || null;
    if (!target && f.repo !== 'web') target = repoGlobals[f.repo].get(holder) || null;
    if (!target && f.repo === 'web') {
      for (const g of fileScope.get(f) || [])
        if (g.globalSet.has(holder)) {
          target = g;
          break;
        }
    }
    if (!target) return [];
    const t = fnsNamed(target, name, false);
    return t.length ? t : [{ id: target.id, fileOnly: true }];
  };

  /* ── 7 · calls, refs, handlers, http, sql ───────────────────────────────────────────────────────────────────── */
  const fromNode = (f, owner, pos) => {
    if (owner) return owner.id;
    if (f.kind === 'route-file') {
      const r = routeAt(f, pos);
      if (r) return r.id;
    }
    return f.id; /* page screen · file · test */
  };
  const callEdges = [];
  /* the screen codes (CBSCREENS.byNav) — read here so a web test's `#/app/<nav>` string can be checked against them */
  const screensJs = path.join(W, 'public', 'app', 'screens.js');
  let byNav = {};
  if (exists(screensJs)) {
    try {
      const w = {};
      new Function('window', read(screensJs))(w);
      byNav = (w.CBSCREENS || {}).byNav || {};
    } catch (e) {
      meta.notes.push('public/app/screens.js could not be read: ' + e.message);
    }
  }
  const webTopNames = new Map(); // name -> [fn] across web (top-level only, shaped names) — what a web test can name
  for (const g of webFiles)
    for (const [n, fns] of g.declTop) if (n.length >= 8 && /[A-Z_]/.test(n.slice(1))) (webTopNames.get(n) || webTopNames.set(n, []).get(n)).push(...fns);
  for (const f of files) {
    const isTest = f.kind === 'test';
    const kindFor = isTest ? 'tested-by' : 'calls';
    const link = (from, targets, via) => {
      for (const t of targets) {
        if (isTest) edge(t.id, f.id, 'tested-by', via);
        else {
          edge(from, t.id, 'calls', via);
          callEdges.push([from, t.id, via]);
        }
      }
    };
    for (const c of f.scan.calls) {
      const from = fromNode(f, c.owner, c.pos);
      const targets = c.holder ? resolveMember(f, c.holder, c.name) : resolveBare(f, c.name);
      if (targets.length) link(from, targets, c.holder ? 'member' : undefined);
    }
    for (const h of f.scan.handlers) link(fromNode(f, h.owner, h.pos), resolveBare(f, h.name), 'handler');
    (f.markupHandlers || []).forEach((item) => link(f.id, resolveBare(f, item.name), 'markup'));
    /* callbacks passed by name — only names shaped like this codebase's functions (camelCase or snake_case, ≥ 6 chars):
       `list`, `read`, `open`, `money` are variable names a thousand times over and would wire everything to everything */
    const names = new Set();
    const refShaped = (n) => n.length >= 6 && /[A-Z_]/.test(n.slice(1));
    for (const g of f.repo === 'web' ? fileScope.get(f) || [f] : [f]) for (const n of (g === f ? g.declAll : g.declTop).keys()) if (refShaped(n)) names.add(n);
    for (const [n] of f.nameFile) if (refShaped(n)) names.add(n);
    if (!isTest)
      for (const r of S.refsTo(f.scan.code, names)) {
        const owner = f.owner(r.pos);
        if (owner && owner.name === r.name) continue;
        link(fromNode(f, owner, r.pos), resolveBare(f, r.name), 'ref');
      }
    /* http: api('key') and '/api/…' literals */
    for (const k of f.scan.apiKeys) {
      const from = fromNode(f, k.owner, k.pos);
      const reg = registry && registry[k.key];
      if (!reg) continue;
      const ids = resolvePath(reg.method, reg.path, false);
      for (const id of ids) {
        if (isTest) edge(id, f.id, 'tested-by', 'http');
        else {
          edge(from, id, 'calls', 'http');
          callEdges.push([from, id, 'http:' + k.key]);
        }
      }
    }
    for (const p of f.scan.apiPaths.filter((item) => !(item.entry && registry))) { /* a registry entry's path is a call only where api('key') cannot be joined */
      const from = fromNode(f, p.owner, p.pos);
      let method = p.method;
      /* `call('POST', '/api/…')` — the method sits just BEFORE the path in the api's tests */
      const before = f.scan.strings.filter((item) => item.start < p.pos && item.start > p.pos - 40 && /^(GET|POST|PUT|PATCH|DELETE)$/.test(item.text));
      if (before.length) method = before[before.length - 1].text;
      const ids = resolvePath(method, p.path, p.open);
      /* an open path (a template literal with a variable tail) that is not itself a route is matched by prefix: a guess, weak proof */
      const testVia = httpProofVia(p.open, pathIndex.has(method + ' ' + norm(p.path)));
      for (const id of ids) {
        if (isTest) edge(id, f.id, 'tested-by', testVia);
        else {
          edge(from, id, 'calls', 'http');
          callEdges.push([from, id, 'http']);
        }
      }
    }
    /* sql: the strings of each owner joined, tables read and written */
    if (f.repo === 'api' && !isTest) {
      const groups = new Map();
      for (const s of f.scan.strings) {
        if (!/\b(FROM|JOIN|INTO|UPDATE|DELETE|TRUNCATE)\b/.test(s.text)) continue;
        const from = fromNode(f, s.owner, s.start);
        (groups.get(from) || groups.set(from, []).get(from)).push(s.text);
      }
      for (const [from, texts] of groups) {
        const text = texts.join('\n');
        const ctes = new Set([...text.matchAll(/\b([a-z_][\w]*)\s+AS\s*\(/g)].map((item) => item[1]));
        const { reads, writes } = S.sqlTables(text);
        for (const t of reads)
          if (!ctes.has(t)) {
            node('table:' + t, { kind: 'table', name: t });
            edge(from, 'table:' + t, 'reads');
          }
        for (const t of writes)
          if (!ctes.has(t)) {
            node('table:' + t, { kind: 'table', name: t });
            edge(from, 'table:' + t, 'writes');
          }
      }
    }
    /* a WEB test names what it tests by string: a page, a #/app/<nav> deep link, an app/ or engine/ file, a function name;
       and by identifier when it evaluates a function in the page (page.evaluate(() => sendChit())) */
    if (isTest) linkNamedFiles(f, byId, edge);
    if (isTest && f.repo === 'web') {
      for (const s of f.scan.strings) {
        let m;
        if ((m = /(?:^|[\/'"\s])([a-z0-9-]+\.html)(?:[#?]|$)/.exec(s.text)) && byId.get('screen:web:public/' + m[1])) {
          edge('screen:web:public/' + m[1], f.id, 'tested-by', 'opens');
          linkPageScripts(webByRel.get('public/' + m[1]), f, resolveWebSrc, edge);
        }
        if ((m = /(?:^|\/)cmdb\/record\.html/.exec(s.text)) && byId.get('screen:web:public/cmdb/record.html'))
          edge('screen:web:public/cmdb/record.html', f.id, 'tested-by', 'opens');
        if ((m = /#\/app\/([a-z][a-z0-9-]*)/.exec(s.text)) && byNav[m[1]]) edge('screen:web:public/app.html#' + m[1], f.id, 'tested-by', 'opens');
        if (/^[A-Za-z_$][\w$]*$/.test(s.text) && webTopNames.has(s.text)) for (const fn of webTopNames.get(s.text)) edge(fn.id, f.id, 'tested-by', 'names');
      }
      for (const r of S.refsTo(f.scan.code, new Set(webTopNames.keys()))) for (const fn of webTopNames.get(r.name)) edge(fn.id, f.id, 'tested-by', 'mentions');
      for (const c of f.scan.calls)
        if (!c.holder && webTopNames.has(c.name) && !f.declAll.has(c.name))
          for (const fn of webTopNames.get(c.name)) edge(fn.id, f.id, 'tested-by', 'evaluates');
    }
    /* vendored copies */
    if (f.adopted && meta.present.engines) {
      const t = byId.get('file:engines:src/' + f.adopted + '.js');
      if (t) edge(f.id, t.id, 'vendors');
    }
    /* route → the functions declared inside its handler */
    if (f.routes)
      for (const fn of f.scan.functions) {
        const r = routeAt(f, fn.start);
        if (r && !fn.parent) edge(r.id, fn.id, 'calls', 'inner');
      }
  }
  for (const n of nodes.values()) if (n.kind === 'table' && !n.declared) n.declared = false;

  /* ── 8 · packs ──────────────────────────────────────────────────────────────────────────────────────────────── */
  const packs = files.filter((item) => item.kind === 'pack');
  for (const p of packs) {
    const code = /reg-([a-z]+)\.js$/.exec(p.rel)[1].toUpperCase();
    node('pack:engines:' + p.rel, { kind: 'pack', code, file: p.rel, repo: 'engines' });
    edge('pack:engines:' + p.rel, p.id, 'requires');
    for (const f of files) {
      if (f === p) continue;
      const mentions =
        f.scan.strings.some((item) => item.text.includes('reg-' + code.toLowerCase())) ||
        new RegExp('PACKS\\s*(?:\\.' + code + '\\b|\\[\\s*$)').test(f.scan.code) ||
        f.scan.strings.some((item) => item.text === code && f.scan.code.includes('PACKS['));
      if (mentions) edge(f.kind === 'test' ? f.id : f.id, 'pack:engines:' + p.rel, f.kind === 'test' ? 'tested-by' : 'uses');
    }
  }
  /* a test that mentions a pack: pack → test */
  for (const e of [...edges.values()])
    if (e.kind === 'tested-by' && e.from.startsWith('test:')) {
      edges.delete(e.from + '\u0001' + e.to + '\u0001' + e.kind + '\u0001' + (e.via || ''));
      edge(e.to, e.from, 'tested-by', 'mentions');
    }
  meta.counts.packs = packs.length;

  /* ── 9 · screens: CBSCREENS codes + app.html's nav dispatch ─────────────────────────────────────────────────── */
  const app = webByRel.get('public/app.html');
  if (app) {
    const code = app.scan.code;
    const strAt = new Map(app.scan.strings.map((item) => [item.start, item]));
    const navCalls = new Map(); // nav -> Set(fn id)
    const setFor = (nav) => navCalls.get(nav) || navCalls.set(nav, new Set()).get(nav);
    const screenShaped = (n) => /Screen$|HTML$|Load$|^(load|render|paint|open)[A-Z]/.test(n);
    const topOnly = (name) =>
      (app.declTop.get(name) || []).concat(...[...(fileScope.get(app) || [])].filter((item) => item !== app).map((item) => item.declTop.get(name) || []));
    /* (a) `if(UI.nav==="x") return xScreen()` — the calls on that line, and a capScreen("name") string */
    const re = /\bUI\.nav\s*===?\s*(['"])/g;
    let m;
    while ((m = re.exec(code))) {
      const s = strAt.get(m.index + m[0].length);
      if (!s) continue;
      const nav = s.text;
      const ls = code.lastIndexOf('\n', m.index) + 1,
        le = code.indexOf('\n', m.index);
      const lineEnd = le < 0 ? code.length : le;
      const set = setFor(nav);
      for (const c of app.scan.calls) {
        if (c.pos < ls || c.pos > lineEnd) continue;
        if (/^(capScreen|ensureCap|typeof|emptyState|tx|localStorage|setItem|getItem|test|exec|then|catch|indexOf|uk)$/.test(c.name)) continue;
        if (!screenShaped(c.name) && !c.name.endsWith('Screen')) continue;
        for (const t of c.holder ? resolveMember(app, c.holder, c.name) : resolveBare(app, c.name)) set.add(t.id);
      }
      for (const st of app.scan.strings) {
        if (st.start < ls || st.start > lineEnd || st === s) continue;
        if (!screenShaped(st.text)) continue;
        for (const t of topOnly(st.text)) set.add(t.id);
      }
    }
    /* (a2) `if(["task","order","drafts","trash","archive"].includes(UI.nav)) return taskPanel();` — the folders are one screen */
    const reArr = /\[((?:\s*['"]\s*['"]\s*,?)+)\]\s*\.\s*(?:includes|indexOf)\s*\(\s*UI\.nav\s*\)/g;
    while ((m = reArr.exec(code))) {
      const navs = [];
      let k = m.index;
      while ((k = code.indexOf('"', k + 1)) >= 0 && k < m.index + m[1].length + 1) {
        const s = strAt.get(k + 1);
        if (s) navs.push(s.text);
      }
      let k2 = m.index;
      while ((k2 = code.indexOf("'", k2 + 1)) >= 0 && k2 < m.index + m[1].length + 1) {
        const s = strAt.get(k2 + 1);
        if (s) navs.push(s.text);
      }
      const ls = code.lastIndexOf('\n', m.index) + 1,
        le = code.indexOf('\n', m.index),
        lineEnd = le < 0 ? code.length : le;
      for (const c of app.scan.calls) {
        if (c.pos < ls || c.pos > lineEnd || c.holder) continue;
        if (/^(includes|indexOf|capScreen|ensureCap|typeof|tx)$/.test(c.name)) continue;
        for (const t of topOnly(c.name)) for (const nav of navs) setFor(nav).add(t.id);
      }
    }
    /* (b) the sidebar's own click map: key==="compose"?`compose()`:key==="counter"?`counterOpen()`… */
    const reKey = /===\s*(['"])(?=[^'"]*\1\s*\?\s*`)/g;
    while ((m = reKey.exec(code))) {
      const s = strAt.get(m.index + m[0].length);
      if (!s || !byNav[s.text]) continue;
      const q = code.indexOf('?', s.end),
        tick = code.indexOf('`', q);
      const t = app.scan.strings.find((x) => x.start === tick + 1);
      const call = t && /^([A-Za-z_$][\w$]*)\s*\(/.exec(t.text);
      if (call) for (const fn of resolveBare(app, call[1])) setFor(s.text).add(fn.id);
    }
    /* (c) the folders are one screen: a nav that app.html assigns to UI.folder paints what `task` paints */
    const folderNavs = new Set();
    for (const fm of code.matchAll(/UI\.folder\s*=\s*(['"])/g)) {
      const s = strAt.get(fm.index + fm[0].length);
      if (s && byNav[s.text]) folderNavs.add(s.text);
    }
    for (const fm of code.matchAll(/\[((?:\s*(['"])\s*\2\s*,?)+)\]\.indexOf\(\s*_deep\[1\]\s*\)/g)) {
      let k = fm.index;
      while ((k = code.indexOf('"', k + 1)) >= 0 && k < fm.index + fm[0].length) {
        const s = strAt.get(k + 1);
        if (s && byNav[s.text]) folderNavs.add(s.text);
      }
    }
    for (const text of new Set([...Object.keys(byNav), ...navCalls.keys()])) {
      const id = 'screen:web:public/app.html#' + text;
      const meta2 = byNav[text] || {};
      node(id, { kind: 'screen', screen: 'nav', repo: 'web', file: 'public/app.html', nav: text, code: meta2.code, label: meta2.label, path: meta2.path });
      edge(app.id, id, 'calls', 'nav');
      let set = navCalls.get(text) || new Set();
      if (!set.size) {
        const cap = text.replace(/-(\w)/g, (x, label) => label.toUpperCase());
        for (const cand of [cap + 'Screen', 'load' + cap[0].toUpperCase() + cap.slice(1), 'render' + cap[0].toUpperCase() + cap.slice(1)])
          for (const t of topOnly(cand)) set.add(t.id);
      }
      if (!set.size && folderNavs.has(text) && navCalls.get('task')) {
        set = navCalls.get('task');
        for (const t of set) edge(id, t, 'calls', 'dispatch:folder');
        continue;
      }
      for (const t of set) edge(id, t, 'calls', 'dispatch');
    }
  }

  /* ── 9b · the small apps' screens and the sheets (SCREEN-ID): the declared rows of the one register, and screen → opens → screen ──── */
  if (exists(path.join(W, 'public', 'app', 'screen-id.js'))) {
    try {
      const SL = require('../screen-list.cjs').load(W);
      const idOf = {};
      for (const r of SL.rows) {
        const file = r.kind === 'sheet' ? 'public/' + r.file : r.page === '/' ? 'index.html' : 'public' + r.page;
        const id = 'screen:web:' + file + (r.key ? '#' + r.key : '');
        idOf[r.code] = id;
        node(id, { kind: 'screen', screen: r.kind, repo: 'web', file, code: r.code, label: r.screen, path: r.path });
        if (r.key && nodes.has('screen:web:' + file)) edge('screen:web:' + file, id, 'calls', 'section');
      }
      idOf.APP001 = 'screen:web:public/app.html';
      for (const o of SL.opens) if (idOf[o.from] && idOf[o.to] && nodes.has(idOf[o.from])) edge(idOf[o.from], idOf[o.to], 'opens', 'loads ' + o.page);
      meta.counts.screenOpens = SL.opens.length;
      /* a web test names a declared screen by its CODE (e2e/walk-screen-id.cjs asserts each one) */
      for (const f of files) {
        if (f.kind !== 'test' || f.repo !== 'web') continue;
        for (const st of f.scan.strings) {
          const m = /^[A-Z]{3}\d{3}$/.exec(st.text);
          if (m && idOf[st.text] && nodes.has(idOf[st.text])) edge(idOf[st.text], f.id, 'tested-by', 'code');
        }
      }
    } catch (e) {
      meta.notes.push('public/app/screen-id.js could not be read (SCREEN-ID rows and opens edges left out): ' + e.message);
    }
  }

  /* ── 10 · flow steps (PM1) ──────────────────────────────────────────────────────────────────────────────────── */
  const flowsPath = path.join(W, 'docs', 'process', 'flows.json');
  let unresolvedStepRefs = 0,
    stepCount = 0;
  if (exists(flowsPath)) {
    const MAP = JSON.parse(read(flowsPath));
    const modulePage = {};
    (MAP.modules || []).forEach((item) => {
      modulePage[item.id] = item.page;
    });
    const refFn = (ref, fn) => {
      const m = /^(web|api|engines):(.+)$/.exec(ref || '');
      if (!m) return null;
      const f = byId.get('file:' + m[1] + ':' + m[2]) || byId.get('screen:' + m[1] + ':' + m[2]);
      if (!f) return meta.present[m[1]] ? null : 'absent';
      if (!fn) return f.id;
      const d = fnsNamed(f, fn, false);
      return d.length ? d[0].id : null;
    };
    for (const flow of MAP.flows || [])
      for (const s of flow.steps || []) {
        stepCount++;
        const id = 'step:' + flow.id + '/' + s.n;
        node(id, {
          kind: 'step',
          flow: flow.id,
          flowName: flow.name,
          n: s.n,
          step: s.step,
          module: s.module,
          status: s.status,
          who: s.who,
          note: s.note || undefined
        });
        const page = modulePage[s.module];
        if (page) {
          const m = /^web:(.+)$/.exec(page);
          if (m && byId.get('screen:web:' + m[1])) edge(id, 'screen:web:' + m[1], 'implements', 'module');
        }
        for (const r of (s.screen || []).concat(s.engine || [])) {
          const t = refFn(r.file, r.fn);
          if (t === 'absent') continue;
          if (t) edge(id, t, 'implements');
          else unresolvedStepRefs++;
        }
        for (const r of s.route || []) {
          const m = /^(api):(.+)$/.exec(r.file || '');
          if (!m) continue;
          const hit = routes.find(
            (x) => x.file === m[2] && x.method === String(r.m).toUpperCase() && norm(x.tail) === norm(r.p.replace(/^\/api\/[^/]+/, '') || '/')
          );
          if (hit) edge(id, hit.id, 'implements');
          else if (meta.present.api) unresolvedStepRefs++;
        }
        for (const t of s.test || []) {
          const m = /^(web|api|engines):(.+)$/.exec(t);
          if (!m) continue;
          const tn = byId.get('test:' + m[1] + ':' + m[2]);
          if (tn) edge(id, tn.id, 'tested-by', 'flows.json');
          else if (meta.present[m[1]]) unresolvedStepRefs++;
        }
      }
  } else meta.notes.push('docs/process/flows.json is missing: no flow steps');
  meta.counts.steps = stepCount;
  if (unresolvedStepRefs)
    meta.notes.push(unresolvedStepRefs + ' flows.json refs name a file/function/route this scan did not find (e2e/process-map.cjs is the guard for those)');
  meta.notes.push(
    'no decisions file exists in web, api or engines (searched for *decision* files and "# Decisions" headings): the decision node kind and decided-by edges are skipped'
  );

  /* ── 10b · FEEDGRAPH: the api's generated registers, tests, evidence, error codes and the lessons audit ─────────────── */
  APIFEED.feed({ A, HOME, node, edge, byId, routes, files, norm, meta, present: meta.present });

  /* ── 11 · write ─────────────────────────────────────────────────────────────────────────────────────────────── */
  const list = [...nodes.values()].sort((first, second) => (first.id < second.id ? -1 : 1));
  const Ed = [...edges.values()].sort((first, second) =>
    first.from + first.to + first.kind + (first.via || '') < second.from + second.to + second.kind + (second.via || '') ? -1 : 1
  );
  const kinds = countKinds(list);
  const ekinds = countKinds(Ed);
  meta.counts.nodes = kinds;
  meta.counts.edges = ekinds;
  meta.ms = Date.now() - t0;
  fs.mkdirSync(OUT, { recursive: true });
  const calls = {
    generated: meta.generated,
    meta: { present: meta.present, endpointUsage: meta.endpointUsage },
    functions: list
      .filter((item) => item.kind === 'function')
      .map((item) => ({
        id: item.id,
        name: item.name,
        repo: item.repo,
        file: item.file,
        line: item.line,
        endLine: item.endLine,
        top: item.top
      })),
    calls: Ed.filter((e) => e.kind === 'calls' && !e.via).map((e) => [e.from, e.to]),
    refs: Ed.filter((e) => e.kind === 'calls' && /^(ref|handler|markup|member)$/.test(e.via || '')).map((e) => [e.from, e.to, e.via]),
    screenToRoute: screenRoutes(list, Ed),
    http: Ed.filter((e) => e.kind === 'calls' && e.via === 'http').map((e) => [e.from, e.to]),
    routeToTable: Ed.filter((e) => /^(reads|writes)$/.test(e.kind) && e.from.startsWith('route:')).map((e) => [e.from, e.to, e.kind]),
    fnToTable: Ed.filter((e) => /^(reads|writes)$/.test(e.kind) && e.from.startsWith('fn:')).map((e) => [e.from, e.to, e.kind])
  };
  fs.writeFileSync(path.join(OUT, 'calls.json'), JSON.stringify(calls));
  fs.writeFileSync(path.join(OUT, 'graph.json'), JSON.stringify({ generated: meta.generated, meta, nodes: list, edges: Ed }));
  if (!JSON_OUT) {
    console.log('\n  graph built in ' + meta.ms + ' ms → ' + path.relative(process.cwd(), OUT) + '/{calls,graph}.json');
    console.log(
      '  nodes ' +
        Object.entries(kinds)
          .map(([k, v]) => k + ' ' + v)
          .join(' · ')
    );
    console.log(
      '  edges ' +
        Object.entries(ekinds)
          .map(([k, v]) => k + ' ' + v)
          .join(' · ')
    );
    meta.notes.forEach((item) => console.log('  ⚠ ' + item));
    console.log('');
  } else console.log(JSON.stringify({ meta }));
  return { nodes: list, edges: Ed, meta };
}

/** screen → route, through the web functions each screen reaches (transitive within web calls) */
function screenRoutes(N, Ed) {
  const g = loadGraph({ nodes: N, edges: Ed });
  const out = [];
  for (const s of N) {
    if (s.kind !== 'screen') continue;
    const seen = new Set(),
      stack = [s.id],
      routes = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of g.out.get(id) || []) {
        if (e.kind !== 'calls') continue;
        if (e.to.startsWith('route:')) routes.add(e.to);
        else if (e.to.startsWith('fn:web:') || (e.to.startsWith('screen:') && e.via === 'nav' && false)) stack.push(e.to);
      }
    }
    if (routes.size) out.push([s.id, [...routes].sort()]);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
   READ THE GRAPH
   ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════ */
function loadGraph(g) {
  if (!g) {
    const p = path.join(OUT, 'graph.json');
    if (!exists(p)) {
      console.error('  no graph yet — run: node tools/graph/graph.cjs build');
      process.exit(2);
    }
    g = JSON.parse(read(p));
  }
  const nodes = new Map(g.nodes.map((item) => [item.id, item]));
  const out = new Map(),
    lookup = new Map();
  for (const e of g.edges) {
    (out.get(e.from) || out.set(e.from, []).get(e.from)).push(e);
    (lookup.get(e.to) || lookup.set(e.to, []).get(e.to)).push(e);
  }
  const byFile = new Map();
  for (const n of nodes.values())
    if (n.kind === 'function') (byFile.get(n.repo + ':' + n.file) || byFile.set(n.repo + ':' + n.file, []).get(n.repo + ':' + n.file)).push(n);
  return { nodes, out, inn: lookup, byFile, meta: g.meta };
}

/** the nodes an argument names: a function name, repo:path or path suffix, a route path, a table, a step id, a nav key */
function seedsFor(g, arg) {
  const hits = new Set();
  const a = String(arg || '').trim();
  if (!a) return hits;
  if (/^(fn|file|screen|route|table|test|step|pack):/.test(a) && g.nodes.has(a)) {
    hits.add(a);
    return hits;
  }
  const m = /^(?:(web|api|engines):)?(.+?)(?:#([A-Za-z_$][\w$]*))?$/.exec(a);
  const repo = m[1],
    p = m[2],
    fn = m[3];
  for (const n of g.nodes.values()) {
    if (repo && n.repo && n.repo !== repo) continue;
    if (/^[A-Za-z_$][\w$]*$/.test(a)) {
      /* a bare word: function name · table · nav key · step name */
      if (n.kind === 'function' && n.name === a) hits.add(n.id);
      if (n.kind === 'table' && n.name === a) hits.add(n.id);
      if (n.kind === 'screen' && n.nav === a) hits.add(n.id);
      continue;
    }
    if (/^\/api\//.test(a) && n.kind === 'route' && norm(n.path) === norm(a)) {
      hits.add(n.id);
      continue;
    }
    if (/^[A-Z0-9]+\/\d+$/.test(a) && n.kind === 'step' && n.flow + '/' + n.n === a) {
      hits.add(n.id);
      continue;
    }
    const file = n.kind === 'function' ? null : n.file;
    if (file && (file === p || file.endsWith('/' + p) || 'public/' + p === file)) {
      if (fn) {
        for (const f of g.byFile.get(n.repo + ':' + file) || []) if (f.name === fn) hits.add(f.id);
      } else hits.add(n.id);
    }
  }
  /* a file seed (a file node, or a PAGE screen — not a nav screen, which is one view inside app.html) carries its functions */
  for (const id of [...hits]) {
    const n = g.nodes.get(id);
    if (n && (n.kind === 'file' || (n.kind === 'screen' && n.screen === 'page')) && n.file)
      for (const f of g.byFile.get(n.repo + ':' + n.file) || []) hits.add(f.id);
  }
  return hits;
}

const DEP_KINDS = new Set(['calls', 'reads', 'writes', 'requires', 'vendors', 'uses', 'implements']);

/** everything that depends on the seeds (reverse walk), the tests that cover any of it, grouped */
function impactOf(g, seeds, maxDepth) {
  const reached = new Map(); // id -> depth
  const list = [...seeds].map((id) => [id, 0]);
  while (list.length) {
    const [id, d] = list.shift();
    if (reached.has(id)) continue;
    reached.set(id, d);
    if (maxDepth && d >= maxDepth) continue;
    /* a step's `implements via module` edge (step → its module's PAGE) is for display: followed in reverse it would make every
       function in app.html touch every Tasks & Orders step */
    for (const e of g.inn.get(id) || []) if (DEP_KINDS.has(e.kind) && e.via !== 'module' && !reached.has(e.from)) list.push([e.from, d + 1]);
    /* a function reached → its file's dependents too (a test that requires the file) */
    const n = g.nodes.get(id);
    if (n && n.kind === 'function') {
      const fid = 'file:' + n.repo + ':' + n.file;
      if (g.nodes.has(fid) && !reached.has(fid)) list.push([fid, d + 1]);
    }
  }
  const tests = new Map();
  for (const id of reached.keys())
    for (const e of g.out.get(id) || [])
      if (e.kind === 'tested-by') {
        if (!tests.has(e.to)) tests.set(e.to, id);
      }
  const group = (kind) =>
    [...reached.keys()]
      .map((id) => g.nodes.get(id))
      .filter((item) => item && item.kind === kind)
      .sort((first, second) => reached.get(first.id) - reached.get(second.id) || (first.id < second.id ? -1 : 1));
  return {
    reached,
    tests,
    steps: group('step'),
    screens: group('screen'),
    routes: group('route'),
    functions: group('function'),
    tables: group('table'),
    files: group('file'),
    packs: group('pack')
  };
}

function printImpact(g, seeds, r) {
  const seedNodes = [...seeds].map((id) => g.nodes.get(id)).filter(Boolean);
  console.log(
    '\n  seeds (' +
      seedNodes.length +
      '): ' +
      seedNodes
        .slice(0, 8)
        .map((item) => item.id)
        .join(' · ') +
      (seedNodes.length > 8 ? ' · …' : '')
  );
  console.log(
    '  reached ' +
      r.reached.size +
      ' nodes' +
      (DEPTH ? ' (depth ≤ ' + DEPTH + ')' : '') +
      ': ' +
      r.functions.length +
      ' functions · ' +
      r.files.length +
      ' files · ' +
      r.tables.length +
      ' tables\n'
  );
  const show = (title, list, fmt) => {
    console.log('  ' + title + ' (' + list.length + ')');
    list.slice(0, 40).forEach((item) => console.log('    ' + fmt(item) + '   ← depth ' + r.reached.get(item.id)));
    if (list.length > 40) console.log('    … and ' + (list.length - 40) + ' more');
    console.log('');
  };
  show('FLOW STEPS', r.steps, (n) => n.flow + ' step ' + n.n + ' · ' + n.step + ' [' + n.status + ']');
  show('SCREENS', r.screens, (n) => (n.code ? n.code + ' ' : '') + n.id.replace(/^screen:web:/, '') + (n.label ? ' · ' + n.label : ''));
  show('ROUTES', r.routes, (n) => n.method + ' ' + n.path + (n.pathGuessed ? ' (path guessed)' : '') + '  ' + n.file);
  const tests = [...r.tests.entries()].sort();
  console.log('  TESTS to run (' + tests.length + ')');
  tests.forEach(([text, via]) =>
    console.log('    ' + text.replace(/^test:/, '') + '   ← ' + via.replace(/^(fn|route|screen|file|step):(web|api|engines)?:?/, ''))
  );
  console.log('');
}

/* ── impact ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
function impact() {
  const g = loadGraph();
  const seeds = seedsFor(g, ARG);
  if (!seeds.size) {
    console.log('\n  nothing in the graph is called "' + ARG + '" — try a function name, repo:path, path#fn, /api/path, a table, O2C/3 or a nav key\n');
    process.exit(1);
  }
  const r = impactOf(g, seeds, DEPTH);
  if (JSON_OUT) return console.log(JSON.stringify(serialise(r, seeds)));
  printImpact(g, seeds, r);
}
const serialise = (r, seeds) => ({
  seeds: [...seeds],
  reached: r.reached.size,
  steps: r.steps.map((item) => item.id),
  screens: r.screens.map((item) => item.id),
  routes: r.routes.map((item) => item.id),
  tests: [...r.tests.keys()].sort(),
  functions: r.functions.length,
  tables: r.tables.map((item) => item.id)
});

/* ── changed <git-range> ────────────────────────────────────────────────────────────────────────────────────────── */
function changed() {
  const g = loadGraph();
  const repo = flag('repo', 'web');
  const root = ROOTS[repo];
  if (!root || !exists(root)) {
    console.error('  no checkout for --repo ' + repo);
    process.exit(2);
  }
  const range = ARG || 'HEAD';
  const r = spawnSync('git', ['-C', root, 'diff', '--unified=0', '--no-color', '--no-ext-diff', range, '--'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) {
    console.error('  git diff failed: ' + (r.stderr || '').trim());
    process.exit(2);
  }
  const seeds = new Set();
  const touched = [];
  let file = null;
  let pendingOld = null;
  for (const line of r.stdout.split('\n')) {
    let m;
    if (/^diff --git /.test(line)) {
      file = null;
      pendingOld = null;
      continue;
    }
    if ((m = /^--- a\/(.+)$/.exec(line))) {
      pendingOld = m[1];
      continue;
    }
    if ((m = /^\+\+\+ b\/(.+)$/.exec(line))) {
      file = m[1];
      touched.push({ file, lines: [] });
      pendingOld = null;
      continue;
    }
    if (/^\+\+\+ \/dev\/null/.test(line)) {
      if (pendingOld) touched.push({ file: pendingOld, lines: [], deleted: true });
      file = null;
      pendingOld = null;
      continue;
    }
    if (file && (m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line))) {
      const a = Number(m[1]),
        n = m[2] == null ? 1 : Number(m[2]);
      touched[touched.length - 1].lines.push([a, a + Math.max(n, 1) - 1]);
    }
  }
  const changedTests = [];
  for (const t of touched) {
    const fileId = ['file', 'screen', 'test'].map((item) => item + ':' + repo + ':' + t.file).find((id) => g.nodes.has(id));
    if (fileId) seeds.add(fileId);
    if (fileId && fileId.startsWith('test:')) {
      t.isTest = true;
      changedTests.push(fileId);
    }
    const fns = g.byFile.get(repo + ':' + t.file) || [];
    let count = 0;
    for (const f of fns)
      for (const [a, b] of t.lines)
        if (f.line <= b && f.endLine >= a) {
          seeds.add(f.id);
          count++;
          break;
        }
    t.functions = count;
    if (!fns.length && !fileId) t.unknown = true;
  }
  const res = impactOf(g, seeds, DEPTH);
  changedTests.forEach((id) => {
    if (!res.tests.has(id)) res.tests.set(id, 'changed itself');
  }); /* a changed test runs */
  if (JSON_OUT)
    return console.log(
      JSON.stringify(
        Object.assign(
          {
            repo,
            range,
            touched: touched.map((item) => ({ file: item.file, functions: item.functions, test: item.isTest || undefined, unknown: item.unknown || undefined }))
          },
          serialise(res, seeds)
        )
      )
    );
  console.log('\n  ' + repo + ' ' + range + ': ' + touched.length + ' file(s) changed');
  touched.forEach((item) =>
    console.log(
      '    ' +
        item.file +
        (item.unknown
          ? '   (not in the graph — a doc, a data file, or not scanned)'
          : item.isTest
            ? '   (a test — runs)'
            : '   ' + item.functions + ' function(s) touched')
    )
  );
  printImpact(g, seeds, res);
  if (!res.tests.size) console.log('  no test in any repo reaches what changed — that is a gap, not a pass\n');
}

/* ── gaps ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
/** the tested-by `via` values that are a GUESS or a gate-only proof: a path-prefix match, and an error-tests row holding only 401/403/500 */
const WEAK_PROOF_VIAS = new Set(['http-prefix', 'error-tests-refusal']);

/** how well tests prove one route: 'none' (no tested-by edge) · 'weak' (only guesses / refusals) · 'strong' ; plus which weak kinds it has */
function proofOf(graph, route) {
  const vias = (graph.out.get(route.id) || []).filter((link) => link.kind === 'tested-by').map((link) => link.via || '');
  if (!vias.length) return { strength: 'none', vias };
  return { strength: vias.every((kind) => WEAK_PROOF_VIAS.has(kind)) ? 'weak' : 'strong', vias };
}

/** the top files by route count, with each file's own route total */
function topRouteFiles(list, routes) {
  const perFile = {};
  list.forEach((route) => {
    perFile[route.file] = (perFile[route.file] || 0) + 1;
  });
  return Object.entries(perFile)
    .sort((first, second) => second[1] - first[1])
    .slice(0, TOP)
    .map(([file, count]) => ({ file, routes: count, of: routes.filter((item) => item.file === file).length }));
}

/** gap 6 (FEEDGRAPH): routes by proof strength — none · weak only (a path-prefix guess, a refusal-only row) · strong (a test that calls the exact path, a contract, evidence, a handler status) */
function routesNoProof(graph, routes) {
  const graded = routes.map((route) => Object.assign({ route }, proofOf(graph, route)));
  const unproven = graded.filter((item) => item.strength === 'none').map((item) => item.route);
  const weak = graded.filter((item) => item.strength === 'weak');
  const byStatus = {};
  unproven.forEach((route) => {
    const status = route.reg ? route.reg.status : 'not in register';
    byStatus[status] = (byStatus[status] || 0) + 1;
  });
  const label = (route) => route.method + ' ' + route.path + (route.reg ? ' [' + route.reg.status + (route.reg.signed ? ', signed' : '') + ']' : '');
  return {
    total: routes.length,
    strong: graded.length - unproven.length - weak.length,
    unproven: unproven.length,
    weakOnly: weak.length,
    weakOnlyPrefixGuess: weak.filter((item) => item.vias.includes('http-prefix')).length,
    weakOnlyRefusal: weak.filter((item) => !item.vias.includes('http-prefix')).length,
    byRegisterStatus: byStatus,
    signedButUnproven: unproven.filter((route) => route.reg && route.reg.signed).length,
    topFiles: topRouteFiles(unproven, routes),
    examples: unproven.slice(0, TOP).map(label),
    weakList: weak.map((item) => label(item.route) + ' (' + (item.vias.includes('http-prefix') ? 'path-prefix guess' : 'refusal only') + ')')
  };
}

/** gap 7 (FEEDGRAPH): lessons whose verdict is RULE ONLY or NOT ADDRESSED, those ADDRESSED only partly, and ADDRESSED rows whose named check was not found */
function lessonsNoCheck(nodes) {
  const lessons = nodes.filter((item) => item.kind === 'lesson');
  const unenforced = lessons.filter((lesson) => lesson.gap);
  const partly = lessons.filter((lesson) => lesson.partly);
  const claimedNoCheck = lessons.filter((lesson) => !lesson.gap && !lesson.partly && !lesson.checksFound);
  return {
    total: lessons.length,
    unenforced: unenforced.length,
    ruleOnly: unenforced.filter((lesson) => lesson.verdict === 'rule-only').length,
    notAddressed: unenforced.filter((lesson) => lesson.verdict === 'not-addressed').length,
    partly: partly.length,
    addressedButCheckNotFound: claimedNoCheck.map((lesson) => lesson.n),
    list: unenforced.map((lesson) => lesson.n + ' [' + lesson.verdict + '] ' + lesson.text),
    partlyList: partly.map((lesson) => lesson.n + ' [partly] ' + lesson.text)
  };
}

/** the tests that cover a flow step: the ones its flows.json row names, and the ones its code reaches within 2 hops (never through a screen) */
function stepTestsOf(graph, step) {
  const explicit = (graph.out.get(step.id) || []).filter((link) => link.kind === 'tested-by').map((link) => link.to);
  const implied = new Set();
  const seen = new Set();
  const list = [[step.id, 0]];
  while (list.length) {
    const [nodeId, depth] = list.shift();
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    for (const link of graph.out.get(nodeId) || []) {
      if (link.kind === 'tested-by' && nodeId !== step.id) implied.add(link.to);
      if ((link.kind === 'implements' || link.kind === 'calls') && depth < 2 && !link.to.startsWith('screen:')) list.push([link.to, depth + 1]);
    }
  }
  return { explicit, implied: [...implied] };
}

/** the console block for gaps 6 and 7 (FEEDGRAPH) */
function printFeedGaps(out) {
  const proof = out.routesNoProof;
  console.log(
    '\n  6 · ROUTES NO TEST PROVES  — of ' + proof.total + ' routes: ' + proof.strong + ' strongly proven · ' + proof.weakOnly + ' weak proof only (' + proof.weakOnlyPrefixGuess +
      ' path-prefix guess · ' + proof.weakOnlyRefusal + ' refusal-only 401/403/500) · ' + proof.unproven + ' unproven (no test edge of any kind); unproven by register status ' +
      JSON.stringify(proof.byRegisterStatus) + '; ' + proof.signedButUnproven + ' of them are signed off'
  );
  proof.topFiles.forEach((item) => console.log('      ' + String(item.routes).padStart(4) + ' of ' + String(item.of).padEnd(4) + ' ' + item.file));
  proof.examples.forEach((item) => console.log('        ' + item));
  proof.weakList.slice(0, TOP).forEach((item) => console.log('        weak: ' + item));
  const lessons = out.lessonsNoCheck;
  console.log(
    '\n  7 · LESSONS NOTHING ENFORCES  — ' + lessons.unenforced + ' of ' + lessons.total + ' API lessons (' + lessons.ruleOnly + ' rule only · ' + lessons.notAddressed +
      ' not addressed) + ' + lessons.partly + ' only partly enforced' +
      (lessons.addressedButCheckNotFound.length ? '; ADDRESSED but no CI check found (the audit only names a file): ' + lessons.addressedButCheckNotFound.join(' ') : '')
  );
  lessons.list.concat(lessons.partlyList).slice(0, TOP * 6).forEach((item) => console.log('      ' + item.slice(0, 150)));
}

function gaps() {
  const g = loadGraph();
  const N = [...g.nodes.values()];
  const present = g.meta.present || {};
  const out = { notes: [] };
  if (!present.api) out.notes.push('api not beside this checkout: routes and tables are unknown, so those two gap kinds are empty by construction');

  /* 1 · flow steps with no test: none named in flows.json AND none reaches the step's code (depth 2 forward) */
  const steps = N.filter((item) => item.kind === 'step' && item.status !== 'missing');
  const noTest = [],
    noExplicit = [];
  for (const s of steps) {
    const t = stepTestsOf(g, s);
    if (!t.explicit.length) noExplicit.push(s);
    if (!t.explicit.length && !t.implied.length) noTest.push(s);
  }
  out.stepsNoTest = {
    total: steps.length,
    noExplicitTest: noExplicit.length,
    noTestAtAll: noTest.length,
    list: noTest.map((item) => item.flow + ' step ' + item.n + ' · ' + item.step + ' [' + item.status + ']')
  };
  out.stepsMissing = N.filter((item) => item.kind === 'step' && item.status === 'missing').map((item) => item.flow + ' step ' + item.n + ' · ' + item.step);

  /* 2 · functions on no flow: not reachable forward from any step over implements/calls */
  const onFlow = new Set();
  {
    const list = steps.map((item) => item.id);
    while (list.length) {
      const id = list.pop();
      if (onFlow.has(id)) continue;
      onFlow.add(id);
      for (const e of g.out.get(id) || []) if (e.kind === 'implements' || e.kind === 'calls' || e.kind === 'requires') list.push(e.to);
    }
  }
  const labFiles = new Set(N.filter((item) => item.kind === 'screen' && item.lab).map((item) => 'web:' + item.file));
  const fns = N.filter((item) => item.kind === 'function' && item.top && !labFiles.has(item.repo + ':' + item.file));
  const off = fns.filter((item) => !onFlow.has(item.id));
  const perRepo = {},
    perFile = {};
  fns.forEach((item) => {
    perRepo[item.repo] = perRepo[item.repo] || { total: 0, off: 0 };
    perRepo[item.repo].total++;
  });
  off.forEach((item) => {
    perRepo[item.repo].off++;
    const k = item.repo + ':' + item.file;
    perFile[k] = (perFile[k] || 0) + 1;
  });
  out.functionsOnNoFlow = {
    total: fns.length,
    off: off.length,
    perRepo,
    topFiles: Object.entries(perFile)
      .sort((first, second) => second[1] - first[1])
      .slice(0, TOP)
      .map(([f, c]) => ({ file: f, functions: c, of: fns.filter((item) => item.repo + ':' + item.file === f).length }))
  };

  /* 3 · routes no screen calls: no incoming http edge from a web function or screen */
  const routes = N.filter((item) => item.kind === 'route');
  const webCalled = new Set();
  for (const r of routes)
    for (const e of g.inn.get(r.id) || []) if (e.kind === 'calls' && e.via === 'http' && /^(fn|screen):web:/.test(e.from)) webCalled.add(r.id);
  const uncalled = routes.filter((item) => !webCalled.has(item.id));
  const testedRoutes = new Set();
  for (const r of routes) if ((g.out.get(r.id) || []).some((e) => e.kind === 'tested-by')) testedRoutes.add(r.id);
  const perRouteFile = {};
  uncalled.forEach((item) => {
    perRouteFile[item.file] = (perRouteFile[item.file] || 0) + 1;
  });
  out.routesNoScreen = {
    total: routes.length,
    uncalledByWeb: uncalled.length,
    uncalledAndUntested: uncalled.filter((item) => !testedRoutes.has(item.id)).length,
    topFiles: Object.entries(perRouteFile)
      .sort((first, second) => second[1] - first[1])
      .slice(0, TOP)
      .map(([f, c]) => ({ file: f, routes: c, of: routes.filter((item) => item.file === f).length })),
    examples: uncalled
      .filter((item) => !testedRoutes.has(item.id))
      .slice(0, TOP)
      .map((item) => item.method + ' ' + item.path)
  };

  /* 4 · tables no route touches: declared tables with no reads/writes from a route or from api code a route reaches */
  const tables = N.filter((item) => item.kind === 'table' && item.declared);
  const fromRoutes = new Set();
  {
    const list = routes.map((item) => item.id);
    while (list.length) {
      const id = list.pop();
      if (fromRoutes.has(id)) continue;
      fromRoutes.add(id);
      for (const e of g.out.get(id) || []) if (e.kind === 'calls' || e.kind === 'requires') list.push(e.to);
    }
  }
  const touchedByRoute = new Set(),
    touchedAtAll = new Set();
  for (const t of tables)
    for (const e of g.inn.get(t.id) || [])
      if (e.kind === 'reads' || e.kind === 'writes') {
        touchedAtAll.add(t.id);
        if (fromRoutes.has(e.from)) touchedByRoute.add(t.id);
      }
  const untouched = tables.filter((item) => !touchedByRoute.has(item.id));
  out.tablesNoRoute = {
    declared: tables.length,
    noRouteTouches: untouched.length,
    noCodeTouchesAtAll: tables.filter((item) => !touchedAtAll.has(item.id)).length,
    list: untouched.map((item) => item.name + (touchedAtAll.has(item.id) ? ' (api code touches it, no route reaches that code)' : '')).slice(0, 40),
    undeclaredInCode: N.filter((item) => item.kind === 'table' && !item.declared).length
  };

  /* 5 · screens nothing tests · nav screens with no dispatch found */
  const screens = N.filter((item) => item.kind === 'screen' && !item.lab);
  const untestedScreens = screens.filter((item) => !(g.out.get(item.id) || []).some((e) => e.kind === 'tested-by'));
  out.screensNoTest = {
    total: screens.length,
    untested: untestedScreens.length,
    list: untestedScreens.map((item) => (item.code ? item.code + ' ' : '') + item.id.replace(/^screen:web:/, '')).slice(0, 40)
  };
  out.navNoDispatch = N.filter((item) => item.kind === 'screen' && item.screen === 'nav' && !(g.out.get(item.id) || []).some((e) => e.via === 'dispatch')).map(
    (item) => item.nav
  );

  out.routesNoProof = routesNoProof(g, routes);
  out.lessonsNoCheck = lessonsNoCheck(N);

  if (JSON_OUT) return console.log(JSON.stringify(out));
  console.log('');
  out.notes.forEach((item) => console.log('  ⚠ ' + item));
  console.log(
    '  1 · FLOW STEPS WITH NO TEST  — ' +
      out.stepsNoTest.noTestAtAll +
      ' of ' +
      out.stepsNoTest.total +
      ' built steps have no test named in flows.json AND none reaching their code (' +
      out.stepsNoTest.noExplicitTest +
      ' name none)'
  );
  out.stepsNoTest.list.slice(0, TOP).forEach((item) => console.log('      ' + item));
  if (out.stepsMissing.length) console.log('      (+ ' + out.stepsMissing.length + ' steps are MISSING in the code: ' + out.stepsMissing.join(' · ') + ')');
  console.log(
    '\n  2 · FUNCTIONS ON NO FLOW  — ' +
      out.functionsOnNoFlow.off +
      ' of ' +
      out.functionsOnNoFlow.total +
      ' top-level functions are not reached from any flow step  ' +
      Object.entries(perRepo)
        .map(([r, v]) => r + ' ' + v.off + '/' + v.total)
        .join(' · ')
  );
  out.functionsOnNoFlow.topFiles.forEach((item) =>
    console.log('      ' + String(item.functions).padStart(4) + ' of ' + String(item.of).padEnd(4) + ' ' + item.file)
  );
  const eu = g.meta.endpointUsageCounts;
  console.log(
    '\n  3 · ROUTES NO SCREEN CALLS  — ' +
      out.routesNoScreen.uncalledByWeb +
      ' of ' +
      out.routesNoScreen.total +
      ' routes have no api()/fetch call from a web screen (' +
      out.routesNoScreen.uncalledAndUntested +
      ' of those also have no test)' +
      (eu
        ? '\n      (api tools/endpoint-usage.cjs, registry keys only: ' +
          (eu.routes - eu.calledByRegistry) +
          ' of ' +
          eu.routes +
          " not called — this graph also follows fetch('/api/…') literals in till/shop/accounts)"
        : '')
  );
  out.routesNoScreen.topFiles.forEach((item) => console.log('      ' + String(item.routes).padStart(4) + ' of ' + String(item.of).padEnd(4) + ' ' + item.file));
  console.log(
    '\n  4 · TABLES NO ROUTE TOUCHES  — ' +
      out.tablesNoRoute.noRouteTouches +
      ' of ' +
      out.tablesNoRoute.declared +
      ' declared tables are read or written by no route nor by code a route reaches (' +
      out.tablesNoRoute.noCodeTouchesAtAll +
      ' by no api code at all; ' +
      out.tablesNoRoute.undeclaredInCode +
      ' names in SQL are not in any migration)'
  );
  out.tablesNoRoute.list.slice(0, TOP).forEach((item) => console.log('      ' + item));
  console.log(
    '\n  5 · SCREENS NO TEST  — ' + out.screensNoTest.untested + ' of ' + out.screensNoTest.total + ' screens (labs excluded) are reached by no web test'
  );
  out.screensNoTest.list.slice(0, TOP).forEach((item) => console.log('      ' + item));
  printFeedGaps(out);
  if (out.navNoDispatch.length) console.log('\n  nav keys in CBSCREENS with no dispatch line found in app.html: ' + out.navNoDispatch.join(' · '));
  console.log('');
}

/* ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────── */
if (require.main === module) {
  if (CMD === 'build') build();
  else if (CMD === 'impact') impact();
  else if (CMD === 'changed') changed();
  else if (CMD === 'gaps') gaps();
  else {
    console.log(
      '\n  node tools/graph/graph.cjs build | impact <file|function> | changed <git-range> [--repo api|engines] | gaps   [--json --roots web=,api=,engines= --out DIR --depth N --top N]\n'
    );
    process.exit(CMD ? 1 : 0);
  }
}
module.exports = { build, loadGraph, seedsFor, impactOf, ROOTS, OUT };
