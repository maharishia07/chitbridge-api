/**
 * tools/graph/apifeed.cjs — FEEDGRAPH: the api's own generated registers become graph facts (KG-FEED, 2026-10-23).
 *
 * Athi, 2026-10-23: "create feedgraph and the other one and will see which one should be useful". This is candidate A: the KG1 graph
 * (graph.cjs) widened, never a second graph. graph.cjs calls feed() once, after the route nodes exist and before the graph is written.
 * The api registers and test results are READ from generated files. The one hand-written source is the lessons audit (cb-api writes it
 * by hand): its verdicts are the audit's word, so a file it merely names is a `mentions` edge (via 'audit'), and only a test / tool / CI file is `enforced-by`.
 *
 *   api docs/api-register.json                    route nodes gain `reg`: status · 13 columns · human sign-off · owner_area · declared statuses
 *   api docs/contracts/api-error-tests.json       route → test (the api-problem sweep that names the route's file)  via `error-tests`
 *   api docs/contracts/api-contract-results.json  route → tests/api-contract.test.cjs                                 via `contract`
 *   api docs/contracts/api-hardening-evidence*.json  route → the evidence writer's test                              via `evidence`
 *                                                 (the -areas file arrives with api #337: absent = said in meta.notes, not an error)
 *   api docs/error-codes.json                     `errcode` nodes · route → errcode `returns` when the route's own text names the code
 *   HOME docs/29-…/tests/TEST-LIBRARY.json        test nodes gain level · type · runner · owner
 *   HOME PM/API-LESSONS-AUDIT-*.md                `lesson` nodes (status ADDRESSED / RULE ONLY / NOT ADDRESSED) → `enforced-by` the check it
 *                                                 names when that file runs in CI (tests/ · tools/ · e2e/ · .github/ · a scanned test), else `mentions`
 *                                                 (via 'audit'); `gap` when nothing fails if the lesson is forgotten; a partly lesson is counted apart
 * Proof strength travels on the tested-by edge's `via`: error-tests-refusal (only 401/403/500) and http-prefix (a path-prefix guess) are WEAK.
 *
 * Static and offline. A route listed in a register that the scan cannot find (or the reverse) is counted in meta.apiFeed, never dropped.
 * Each source is one small function below; feed() runs them in the order the notes are read.
 *
 * OWNS      the join between the api registers / lessons audit and the graph nodes
 * CALLED BY tools/graph/graph.cjs build (step 10b) · e2e/knowledge-graph.cjs · tests/graph-apifeed.test.cjs
 * CARD      qa/knowledge-graph
 */
'use strict';
const fs = require('fs');
const path = require('path');

/** true when the error only says "the file or folder is not there" — the caller already says that in its own note */
const isAbsence = (error) => error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');

/** read a JSON file; null when it is missing (the caller says so) or unreadable (said here, with the reason, in the graph's notes) */
function readJson(file, note) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (note && !isAbsence(error)) note('api feed could not read ' + file + ' (' + error.message + '): the reader gets no rows from it');
    return null;
  }
}

/** true when the path is a file; false when it is not or cannot be told (an unexpected failure is said in the notes: the lesson then shows no check) */
function isFile(file, note) {
  try {
    return fs.statSync(file).isFile();
  } catch (error) {
    if (note && !isAbsence(error)) note('api feed could not stat ' + file + ' (' + error.message + '): a lesson naming it shows no check');
    return false;
  }
}

/** the audit's verdict cell → 'not-addressed' | 'rule-only' | 'addressed' | 'unknown' (bold markers are ignored) */
function verdictClass(status) {
  const plain = status.replace(/\*/g, '').trim();
  if (/^NOT ADDRESSED/.test(plain)) return 'not-addressed';
  if (/^RULE ONLY/.test(plain)) return 'rule-only';
  if (/^ADDRESSED/.test(plain)) return 'addressed';
  return 'unknown';
}

/** the cells of one markdown table line */
const cellsOf = (line) => line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());

/** the table header line → { status, by } column positions, or null when no header names both a Status and a "By what" column */
function columnsOf(markdown) {
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\|/.test(line)) continue;
    const names = cellsOf(line).map((cell) => cell.replace(/\*/g, '').trim().toLowerCase());
    const status = names.indexOf('status');
    const by = names.findIndex((name) => /^by what/.test(name));
    if (status >= 0 && by >= 0) return { status, by, count: names.length };
  }
  return null;
}

/** true when an ADDRESSED verdict says it covers only part of the lesson: "(partly)" or "… / RULE ONLY" */
const isPartly = (verdict, status) => verdict === 'addressed' && /\(partly\)|\/ RULE ONLY|RULE ONLY \(/.test(status);

/** the "By what" cell ; when it is the last column, a `|` inside a backticked cell has split it, so the rest is joined back */
const byCell = (cells, columns) => (columns.by === columns.count - 1 ? cells.slice(columns.by).join('|') : cells[columns.by]);

/** one audit table line → { id, ledger, text, status, verdict, partial, by } ; null when the line is not a lesson row */
function parseLessonLine(line, columns) {
  const idCell = /^\|\s*(\d+[a-z]?|defect)\s*\|/.exec(line);
  if (!idCell) return null;
  const cells = cellsOf(line);
  if (cells.length <= columns.by) return null;
  const status = cells[columns.status];
  const verdict = verdictClass(status);
  return { id: cells[0], ledger: cells[1], text: cells[2], status, verdict, partial: isPartly(verdict, status), by: byCell(cells, columns) };
}

/** a repeated lesson id gets "#2", "#3" … so each repeat stays its own node ; returns the ids that repeated */
function renameRepeats(lessons) {
  const seen = new Map();
  const repeated = [];
  lessons.forEach((lesson) => {
    const count = (seen.get(lesson.id) || 0) + 1;
    seen.set(lesson.id, count);
    if (count === 1) return;
    repeated.push(lesson.id);
    lesson.id = lesson.id + '#' + count;
  });
  return repeated;
}

/** the audit's markdown table → { lessons, problems } ; the Status and "By what" columns are found by HEADER text, and a table without them is refused */
function parseLessonsChecked(markdown) {
  const columns = columnsOf(markdown);
  if (!columns) return { lessons: [], problems: ['the lessons audit has no table header with "Status" and "By what" columns: no lesson was read (columns are found by name, never by position)'] };
  const lessons = markdown.split(/\r?\n/).map((line) => parseLessonLine(line, columns)).filter(Boolean);
  const repeated = renameRepeats(lessons);
  const problems = repeated.length ? ['the lessons audit repeats lesson id(s) ' + [...new Set(repeated)].join(', ') + ': each repeat is kept as its own node (id#2), not merged'] : [];
  return { lessons, problems };
}

/** the lessons only (parseLessonsChecked also returns the problems found) */
const parseLessons = (markdown) => parseLessonsChecked(markdown).lessons;

/** the test node for a repo-relative api test file, or null when the scan has no such test */
const testNodeFor = (ctx, relPath) => (ctx.byId.has('test:api:' + relPath) ? 'test:api:' + relPath : null);

/** a `check` node for a generated file or tool that proves something but is not a scanned test; returns its id */
function checkNodeFor(ctx, relPath) {
  const id = 'check:api:' + relPath;
  ctx.node(id, { kind: 'check', repo: 'api', file: relPath });
  return id;
}

/** METHOD + normalised path → [route] for every scanned route */
function indexRoutes(ctx) {
  const routesByKey = new Map();
  for (const route of ctx.routes) {
    const routeKey = route.method + ' ' + ctx.norm(route.path);
    (routesByKey.get(routeKey) || routesByKey.set(routeKey, []).get(routeKey)).push(route);
  }
  return routesByKey;
}

/** ids of the scanned routes some register row owns; the tail fallback never steals one */
function ownedRouteIds(ctx, register, routesByKey) {
  const owned = new Set();
  if (!register || !Array.isArray(register.routes)) return owned;
  for (const row of register.routes)
    for (const candidate of routesByKey.get(row.method + ' ' + ctx.norm(row.path)) || []) if (candidate.file === row.file) owned.add(candidate.id);
  return owned;
}

/** the scanned route a register row stands for: same file first, else any same-path one, else the mounted-twice fallback (file + method + tail) */
function matchRegisterRow(ctx, row, routesByKey, owned) {
  const candidates = routesByKey.get(row.method + ' ' + ctx.norm(row.path)) || [];
  const exact = candidates.find((candidate) => candidate.file === row.file) || candidates[0];
  if (exact) return exact;
  /* a router file mounted twice (catalogue.js at /api/catalogue and /api/network) keeps one mount in the scan: fall back to file + method + the tail */
  return ctx.routes.find(
    (candidate) =>
      candidate.file === row.file && candidate.method === row.method && !owned.has(candidate.id) && ctx.norm(row.path).endsWith(ctx.norm(candidate.tail)) && ctx.norm(candidate.tail) !== '/'
  );
}

/** a register row → the `reg` block a route node carries */
function registerBlock(row) {
  const columns = {};
  Object.keys(row.columns || {}).forEach((column) => {
    columns[column] = !!row.columns[column];
  });
  const human = row.human || {};
  return {
    key: row.key,
    status: row.status,
    owner_area: row.owner_area,
    signed: !!human.signed_off_by_date,
    signedBy: human.signed_off_by_date || undefined,
    columns,
    columnsPassing: Object.values(columns).filter(Boolean).length,
    columnsTotal: Object.keys(columns).length,
    human,
    declared: row.declared || [],
    notes: row.notes || [],
    stale: row.stale_since || undefined
  };
}

/** a register row → its route node ; a SECOND row for the same node is kept in \ and counted, never written over the first */
function recordRegisterRow(ctx, stats, regOwner, scanned, row) {
  const owner = regOwner.get(scanned.id);
  if (!owner) {
    regOwner.set(scanned.id, { key: row.key, also: [] });
    return ctx.node(scanned.id, { reg: registerBlock(row) });
  }
  stats.registerCollisions.push(owner.key + ' = ' + row.key);
  owner.also.push(registerBlock(row));
  ctx.node(scanned.id, { regAlso: owner.also });
}

/** source 1: api docs/api-register.json → `reg` on each route node ; returns Map(register key → route) for the sources after it */
function feedRegister(ctx, stats) {
  const { routes, meta } = ctx;
  const joined = new Map();
  const regOwner = new Map();
  const register = readJson(path.join(ctx.apiRoot, 'docs', 'api-register.json'), (text) => meta.notes.push(text));
  const routesByKey = indexRoutes(ctx);
  const owned = ownedRouteIds(ctx, register, routesByKey);
  if (!register || !Array.isArray(register.routes)) {
    meta.notes.push('api docs/api-register.json is missing or unreadable: route nodes carry no register columns, status or sign-off');
    return joined;
  }
  stats.register = { stage: register.stage, routes: register.routes.length, machine: register.machine_columns, human: register.human_columns };
  for (const row of register.routes) {
    const scanned = matchRegisterRow(ctx, row, routesByKey, owned);
    if (!scanned) {
      stats.registerNotInScan++;
      continue;
    }
    joined.set(row.key, scanned);
    stats.routesJoined++;
    recordRegisterRow(ctx, stats, regOwner, scanned, row);
  }
  const joinedIds = new Set([...joined.values()].map((route) => route.id));
  if (stats.registerCollisions.length)
    meta.notes.push('api register: ' + stats.registerCollisions.length + ' rows map to a route another row already owns (kept in regAlso): ' + stats.registerCollisions.join('; '));
  stats.scanNotInRegister = routes.filter((route) => !joinedIds.has(route.id)).length;
  if (stats.registerNotInScan || stats.scanNotInRegister)
    meta.notes.push(
      'api register ↔ scanned routes: ' + stats.registerNotInScan + ' register rows not found in the scan, ' + stats.scanNotInRegister +
        ' scanned routes not in the register (mount-prefix guesses, dynamic paths — counted, not dropped)'
    );
  return joined;
}

/** REFUSAL statuses: the request is turned away before the route's handler runs, so a row holding only these proves the gate, not the handler */
const REFUSAL_STATUSES = new Set([401, 403, 500]);

/** true when at least one status in an error-tests row comes from the handler itself (a 2xx or a 4xx with a body) */
const hasHandlerStatus = (statuses) => Array.isArray(statuses) && statuses.some((status) => !REFUSAL_STATUSES.has(Number(status)));

/** source 2: api docs/contracts/api-error-tests.json → route tested-by the api-problem sweep that names the route's file (else the sweep kit) */
function feedErrorTests(ctx, stats, joined) {
  const { edge, node, files, meta } = ctx;
  const sweepTests = files.filter((file) => file.repo === 'api' && file.kind === 'test' && /(^|\/)api-problem-[a-z-]+\.test\.cjs$/.test(file.rel));
  const sweepText = new Map(sweepTests.map((file) => [file.rel, fs.readFileSync(file.abs, 'utf8')]));
  const sweepsNaming = (routeFile) => sweepTests.filter((file) => sweepText.get(file.rel).includes(routeFile)).map((file) => file.id);
  const sweepKit = testNodeFor(ctx, 'tests/lib/problem-sweep-kit.cjs');
  const errorTests = readJson(path.join(ctx.apiRoot, 'docs', 'contracts', 'api-error-tests.json'), (text) => meta.notes.push(text));
  if (!errorTests) return meta.notes.push('api docs/contracts/api-error-tests.json is missing: no error-tests proofs');
  for (const [routeKey, statuses] of Object.entries(errorTests)) {
    const route = joined.get(routeKey);
    if (!route) continue;
    const sweeps = sweepsNaming(route.file);
    const targets = sweeps.length ? sweeps : [sweepKit || checkNodeFor(ctx, 'docs/contracts/api-error-tests.json')];
    const proofKind = hasHandlerStatus(statuses) ? 'error-tests' : 'error-tests-refusal';
    targets.forEach((target) => edge(route.id, target, 'tested-by', proofKind));
    node(route.id, { errorTestStatuses: statuses });
    stats.testedByFeed++;
  }
}

/** source 3: api docs/contracts/api-contract-results.json → route tested-by tests/api-contract.test.cjs, with its case counts */
function feedContractResults(ctx, stats, joined) {
  const { edge, node, meta } = ctx;
  const results = readJson(path.join(ctx.apiRoot, 'docs', 'contracts', 'api-contract-results.json'), (text) => meta.notes.push(text));
  if (!results) return meta.notes.push('api docs/contracts/api-contract-results.json is missing: no schema-contract proofs');
  const contractTest = testNodeFor(ctx, 'tests/api-contract.test.cjs') || checkNodeFor(ctx, 'tools/api-contract-tests.cjs');
  for (const [routeKey, result] of Object.entries(results.routes || {})) {
    const route = joined.get(routeKey);
    if (!route) continue;
    node(route.id, { contractCases: result.cases, contractFailed: result.failed });
    if (result.failed > 0) {
      stats.contractFailed++;
      continue;
    }
    edge(route.id, contractTest, 'tested-by', 'contract');
    stats.testedByFeed++;
  }
}

/** the names of the flags that are true in an evidence row ; none when the row is missing or every flag is false (that proves nothing) */
const trueFlags = (flags) => Object.keys(flags || {}).filter((flag) => flags[flag]);

/** source 4: evidence, the two columns a static read cannot prove. api-hardening-evidence-areas.json arrives with api #337 — handle its absence */
function feedEvidenceFiles(ctx, stats, joined) {
  const { edge, node, meta } = ctx;
  const evidenceFiles = ['api-hardening-evidence.json', 'api-hardening-evidence-areas.json'];
  const writer = testNodeFor(ctx, 'tests/lib/foreign-id-world.cjs') || checkNodeFor(ctx, 'docs/contracts/api-hardening-evidence.json');
  let evidenceRows = 0;
  for (const name of evidenceFiles) {
    const evidence = readJson(path.join(ctx.apiRoot, 'docs', 'contracts', name), (text) => meta.notes.push(text));
    if (!evidence) {
      if (name !== evidenceFiles[0]) meta.notes.push('api docs/contracts/' + name + ' is absent (it arrives with api #337): areas evidence not joined');
      continue;
    }
    for (const [routeKey, flags] of Object.entries(evidence.routes || {})) {
      const route = joined.get(routeKey);
      const proven = trueFlags(flags);
      if (!route || !proven.length) continue;
      evidenceRows++;
      node(route.id, { evidence: proven });
      edge(route.id, writer, 'tested-by', 'evidence');
      stats.testedByFeed++;
    }
  }
  stats.evidenceRows = evidenceRows;
}

/** a route "returns" a code when a string literal inside the route's own text is that code (lib helpers that raise it are not seen) */
function linkRoutesToCodes(ctx, joined, codes) {
  for (const route of ctx.routes) {
    if (!joined.size || !route.fileRec || !route.fileRec.scan) continue;
    for (const literal of route.fileRec.scan.strings)
      if (literal.start >= route.start && literal.start < route.end && codes.has(literal.text)) ctx.edge(route.id, 'errcode:' + literal.text, 'returns', 'literal');
  }
}

/** source 5: api docs/error-codes.json → `errcode` nodes, and route → errcode `returns` edges */
function feedErrorCodes(ctx, stats, joined) {
  const { node, meta } = ctx;
  const errorCodes = readJson(path.join(ctx.apiRoot, 'docs', 'error-codes.json'), (text) => meta.notes.push(text));
  if (!errorCodes || !Array.isArray(errorCodes.codes)) return meta.notes.push('api docs/error-codes.json is missing: no errcode nodes');
  const codes = new Set();
  for (const entry of errorCodes.codes) {
    codes.add(entry.code);
    node('errcode:' + entry.code, { kind: 'errcode', code: entry.code, status: entry.status, title: entry.title, owner_area: entry.owner_area, since: entry.since });
    stats.errcodes++;
  }
  linkRoutesToCodes(ctx, joined, codes);
}

/** source 6: HOME TEST-LIBRARY.json → level · type · runner · owner on the test nodes the scan knows */
function feedTestLibrary(ctx, stats) {
  const { node, byId, meta } = ctx;
  const library = readJson(path.join(ctx.HOME, 'docs', '29-qa-test-tooling-ux-locale-and-design-system', 'tests', 'TEST-LIBRARY.json'), (text) => meta.notes.push(text));
  if (!library || !Array.isArray(library.rows)) return meta.notes.push('TEST-LIBRARY.json not found under ' + ctx.HOME + ': test nodes carry no level/type/owner');
  stats.libraryRows = library.rows.length;
  for (const row of library.rows) {
    const id = 'test:' + row.repo + ':' + row.file;
    if (!byId.has(id)) continue;
    stats.libraryMatched++;
    node(id, { level: row.level, testType: row.type, runner: row.runner, testOwner: row.owner });
  }
}

/** api file base name → [file node ids], so a lesson naming a bare file name finds it when only one api file has that name */
function apiFilesByBaseName(ctx) {
  const byBase = new Map();
  for (const file of ctx.files) {
    if (file.repo !== 'api') continue;
    const base = path.basename(file.rel);
    (byBase.get(base) || byBase.set(base, []).get(base)).push(file.id);
  }
  return byBase;
}

/** the newest PM/API-LESSONS-AUDIT-*.md file name, or undefined when there is none (an unreadable folder is said in the notes) */
function newestAuditName(ctx, pmDir) {
  try {
    return fs.readdirSync(pmDir).filter((name) => /^API-LESSONS-AUDIT-.*\.md$/.test(name)).sort().pop();
  } catch (error) {
    if (!isAbsence(error)) ctx.meta.notes.push('api feed could not list ' + pmDir + ' (' + error.message + '): the reader gets no lesson nodes');
    return undefined;
  }
}

/** a backticked path in a lesson's "by" cell → repo-relative file name ; '' when it does not look like a file */
function checkPathOf(backticked) {
  const relPath = backticked.replace(/:\d+(?:-\d+)?(?=\s|$|\W)/g, '').split(/[\s,]/)[0].replace(/^\.\//, '');
  return /[./]/.test(relPath) && !/\s/.test(relPath) ? relPath : '';
}

/** the node a named check path stands for (a test, an api file, a check on disk in the api or the home repo), or null when nothing is there */
function checkTargetFor(ctx, relPath, byBase) {
  const { byId, node, meta } = ctx;
  const note = (text) => meta.notes.push(text);
  let target = null;
  if (byId.has('test:api:' + relPath)) target = 'test:api:' + relPath;
  else if (byId.has('file:api:' + relPath)) target = 'file:api:' + relPath;
  else if (isFile(path.join(ctx.apiRoot, relPath), note)) target = checkNodeFor(ctx, relPath);
  else if (isFile(path.join(ctx.HOME, relPath), note)) {
    target = 'check:home:' + relPath;
    node(target, { kind: 'check', repo: 'home', file: relPath });
  }
  if (!target && !relPath.includes('/') && byBase.has(relPath) && byBase.get(relPath).length === 1) target = byBase.get(relPath)[0];
  return target;
}

/** true when the file runs in CI as a check: a scanned test, or a file under tests/ · tools/ · e2e/ · .github/ · scripts/guard* (an implementation, data or doc file is only named) */
const runsInCi = (relPath, target) => target.startsWith('test:') || /^(tests|tools|e2e|\.github)\//.test(relPath) || /^scripts\/guard/.test(relPath);

/** the fields of a `lesson` node: ADDRESSED enforces (partly when the audit says so), anything else is a `gap` */
function lessonFields(lesson) {
  const enforces = lesson.verdict === 'addressed';
  const fields = { kind: 'lesson', repo: 'api', n: lesson.id, ledger: lesson.ledger, text: lesson.text.slice(0, 200), verdict: lesson.verdict };
  if (lesson.partial) fields.partial = true;
  if (!enforces) fields.gap = true;
  if (enforces && lesson.partial) fields.partly = true;
  return fields;
}

/** one lesson → its `lesson` node and the enforced-by / mentions edges to the checks its "by" cell names ; adds the count found */
function feedOneLesson(ctx, lesson, byBase) {
  const id = 'lesson:api:' + lesson.id;
  const enforces = lesson.verdict === 'addressed';
  ctx.node(id, lessonFields(lesson));
  let found = 0;
  const backticks = /`([^`]+)`/g;
  let named;
  while ((named = backticks.exec(lesson.by))) {
    const relPath = checkPathOf(named[1]);
    const target = relPath && checkTargetFor(ctx, relPath, byBase);
    if (!target) continue;
    const enforcing = enforces && runsInCi(relPath, target);
    if (enforcing) found++;
    ctx.edge(id, target, enforcing ? 'enforced-by' : 'mentions', 'audit');
  }
  ctx.node(id, { checksFound: found });
}

/** source 7: HOME PM/API-LESSONS-AUDIT-*.md → `lesson` nodes, each enforced-by the check it names or marked `gap` */
function feedLessonsAudit(ctx, stats) {
  const byBase = apiFilesByBaseName(ctx);
  const pmDir = path.join(ctx.HOME, 'PM');
  const audit = newestAuditName(ctx, pmDir);
  if (!audit) return ctx.meta.notes.push('PM/API-LESSONS-AUDIT-*.md not found under ' + ctx.HOME + ': no lesson nodes');
  const parsed = parseLessonsChecked(fs.readFileSync(path.join(pmDir, audit), 'utf8'));
  const lessons = parsed.lessons;
  stats.lessonProblems = parsed.problems;
  parsed.problems.forEach((problem) => ctx.meta.notes.push(problem));
  const unknown = lessons.filter((lesson) => lesson.verdict === 'unknown').map((lesson) => lesson.id);
  if (unknown.length) ctx.meta.notes.push('lessons audit: verdict not read for lesson(s) ' + unknown.join(', ') + ' (counted as a gap)');
  stats.lessons = lessons.length;
  stats.lessonSource = audit;
  for (const lesson of lessons) feedOneLesson(ctx, lesson, byBase);
}

/** the whole feed: the seven sources in order, counted in meta.apiFeed ; does nothing but zero the counts when the api repo is absent */
function feed(ctx) {
  const stats = (ctx.meta.apiFeed = { register: null, routesJoined: 0, registerNotInScan: 0, registerCollisions: [], contractFailed: 0, lessonProblems: [], scanNotInRegister: 0, testedByFeed: 0, errcodes: 0, lessons: 0, libraryRows: 0, libraryMatched: 0 });
  if (!ctx.present.api) return;
  const feedCtx = Object.assign({}, ctx, { apiRoot: ctx.A });
  const joined = feedRegister(feedCtx, stats);
  feedErrorTests(feedCtx, stats, joined);
  feedContractResults(feedCtx, stats, joined);
  feedEvidenceFiles(feedCtx, stats, joined);
  feedErrorCodes(feedCtx, stats, joined);
  feedTestLibrary(feedCtx, stats);
  feedLessonsAudit(feedCtx, stats);
}

module.exports = { feed, parseLessons, parseLessonsChecked };
