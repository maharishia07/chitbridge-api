'use strict';
/*
 * OWNS      the REPORTED columns of the API register (CAP-17 slice 1: bfla_role_check · parameterised_query · rate_limited; column 14, 17 Nov 2026: role_matrix; column 16, 18 Nov 2026: resource_cap; column 17: junk_fuzz). Per route: does the column apply, does it hold.
 * CALLED BY tools/api-register.cjs (rowOf, countsOf, renderMarkdown) · tools/api-ratchet.cjs (reported_failing may only go down) · tests/api-reported.test.cjs
 * FLOW      the route's own source + its stack (leaf.chain, leaf.fns) + the evidence union ──▶ { columns, applies } ──▶ row.reported / row.reported_applies ──▶ counts.reported
 * CARD      28-platform-and-operations/api-standard
 *
 * REPORTED, NOT YET COUNTED (Athi's rule for CAP-17 slice 1): these columns are shown in the register and counted on their own line, but they are NOT in
 * MACHINE_COLUMNS, so they never move a route's status or the "meets" count. Once the failing counts are filled the plan is: add the three names to MACHINE_COLUMNS
 * (and HARDENING_COLUMNS) in one PR that states the new "meets" count, with Athi's sight. Until then the ratchet only stops the failing counts from rising.
 * OWASP API Security Top 10 2023: API5 broken function level authorisation (bfla_role_check) · API4 unrestricted resource consumption (rate_limited) · ASVS L2 V5.3.4 parameterised queries.
 *
 *   audit_logged         (column 18, Athi 18 Nov 2026; ISO/IEC 27001:2022 A.8.15 logging, SOC 2 CC7.2; API-STANDARD S40) applies to every WRITE route (POST, PUT, PATCH, DELETE). Holds when the handler call tree (same file, then
 *                        the lib functions it calls through required modules, up to HOP_LIMIT modules deep, each three levels deep) reaches an AUDIT WRITER: recordChanges / accessEvents.record, books-store logChange, auditWrite / writeAudit / recordAudit,
 *                        or an INSERT into an audit table (AUDIT_TABLES below). Or evidence `audit_logged: true`. A read route does not apply. THERE IS NO SINGLE AUDIT WRITER TODAY (state_log, books_change_log,
 *                        access_events, quick_key_audit ... each have their own): AUDIT_WRITERS lists them, and each is to be folded into the one S40 writer; the column counts routes, not writers.
 *   stale_write_refused  (column 19, RFC 9110 sec 13 conditional requests; API-STANDARD S22) applies to an UPDATE route of a mutable record: PUT, PATCH, or a POST whose path ends in a path parameter. N/A (reads yes, the reason
 *                        in reported_causes.stale_write_refused_na): read, create (POST on a collection), DELETE, a money-posting route (api-hardening-scope money_writes: append-only, corrected by reversal), an action POST (/:id/verb).
 *                        Holds when the call tree reads If-Match / expected_version / expected_updated_at / base_version or compares version / updated_at in a WHERE, AND answers 409 or 412. Or evidence `stale_write_refused: true`.
 *   documented_example   (column 20; rate_limited is already a reported column, so this replaces it; OpenAPI 3.1 Example Object) applies to every route. Holds when the route's OpenAPI operation carries an example of the 2xx
 *                        answer (content example / examples, or schema.example) AND, when the operation takes a request body, an example of that body. A route with no body needs the answer example only.
 *   junk_fuzz            (column 17, OWASP API4 and API8 input handling) applies to every route. Holds when the live junk run (lib/junk-fuzz.js cases, sent as owner, staff and anon through the real stack on a real Postgres
 *                        by tools/junk-fuzz.cjs) got, for every case: no 5xx, a Problem-shaped 4xx with a registered code, no stack or exception text, nothing written on a refused call, an answer in time.
 *                        Evidence `junk_fuzz: true`, written only by that tool.
 *   bfla_role_check      applies to a route whose stack holds a ROLE GATE (a function tagged `roleGate`: lib/owner.js ownerOnly = 'owner', lib/access.js writeGate = 'editor').
 *                        Holds when a test scene proved a lower role is refused (and the role it needs is not): evidence `bfla_role_check: true`, written by tests/lib/bfla-world.cjs.
 *   parameterised_query  applies to a route whose handler, or a function of the SAME file it calls (up to three levels), runs SQL through query/run/runQuery/queryAs. Holds when no such
 *                        call is string-built: a template literal whose ${..} is not an UPPER_CASE constant or a `$${n}` placeholder number, or a quoted string joined with `+`.
 *                        SLICE 1 stops at the file: SQL written in lib/*.js is the next slice (it needs the call tree across files); a fragment built from a whitelist reads as built, on purpose.
 *   role_matrix          (column 14, OWASP API5:2023) applies to every route. Holds when the route's operation declares `x-seats` (lib/role-matrix.js: owner, staff, adviser, auditor, anon) AND a live run through the real stack (tools/role-matrix-live.cjs)
 *                        proved every declared seat's answer: allowed seats answered, refused seats answered the one 401/403/404 Problem shape. Evidence `role_matrix: true`, written only by that tool.
 *   resource_cap         (column 16, OWASP API4:2023, lib/resource-cap.js) applies to every route. Holds when: a LIST read has a page-size cap through lib/bounds (B.limit) or lib/page-limit · a NAMED limiter (global or its own) stands in front of it ·
 *                        a write that sends mail, SMS, WhatsApp or an AI call has its own limiter tighter than the global. A route that fails names its causes in `reported_causes.resource_cap`. Static; tools/resource-cap-live.cjs writes the live evidence.
 *   paged_read           (column 21, 26 Nov 2026, PERF1 / DISCIPLINES §2; lib/paged-read.js) applies to a GET that answers a LIST (rows, not one record). Holds when the list has a SERVER MAXIMUM (limitOf / pageArgs / B.limit, not the client's word)
 *                        AND nothing asked answers one default page, not every row. The row carries the facts in `reported_facts.paged_read`: kind, mode (keyset|offset|none), default, max, unasked (bounded|everything). Causes: no_server_max · whole_when_unasked. A NEW list route must hold it (tools/api-ratchet.cjs).
 *   rate_limited         applies to every route. Holds when a limiter (express-rate-limit: a function with resetKey) OTHER than the global /api one sits in front of it, in the route's own
 *                        stack or mounted over its path. The global limiter is the floor for every route and proves nothing per endpoint.
 */
const REPORTED_COLUMNS = ['bfla_role_check', 'parameterised_query', 'rate_limited', 'role_matrix', 'junk_fuzz', 'resource_cap', 'audit_logged', 'stale_write_refused', 'documented_example', 'paged_read'];

/** junk_fuzz (column 17): the live junk run (tools/junk-fuzz.cjs) wrote `junk_fuzz: true` for the route: no 5xx, a registered Problem 4xx, no stack text, nothing written on a refusal, answered in time */
const junkFuzzColumn = (evidence) => !!(evidence && evidence.junk_fuzz === true);

const stackFunctions = (leaf) => leaf.chain.map((item) => (typeof item === 'function' ? item : item.fn)).concat(leaf.fns.slice(0, -1));

/** the role gates in the route's stack: the tags of the functions that carry `roleGate` */
const roleGatesOf = (leaf) => [...new Set(stackFunctions(leaf).filter((fn) => fn && fn.roleGate).map((fn) => fn.roleGate))];

/** an express-rate-limit middleware (it carries resetKey and getKey) */
const isLimiter = (fn) => typeof fn === 'function' && typeof fn.resetKey === 'function';

/** a mounted layer covers the route when express itself would run it for this path (its own regexp, so an array of mount paths and :params work); a layer at '' or '/api' is the global floor and never counts here */
function coversRoute(item, routePath) {
  const mount = ((item.prefix || '') + require('./load-app.cjs').mountOf(item.layer)).replace(/[/]$/, '');
  if (mount === '' || mount === '/api' || !item.layer || !item.layer.regexp || item.layer.regexp.fast_slash) return false;
  return item.layer.regexp.test(routePath.slice((item.prefix || '').length) || '/');
}

/** rate_limited: a per-endpoint limiter in the route's own stack, or mounted over its path */
function rateLimitedColumn(leaf) {
  if (leaf.fns.slice(0, -1).some(isLimiter)) return true;
  return leaf.chain.some((item) => typeof item !== 'function' && isLimiter(item.fn) && coversRoute(item, leaf.path));
}

/** the limiters standing in front of a route: the global floor (mounted at '' or /api, reaching every /api path) and every per-endpoint one (own stack, or mounted over its path), each as { name, max, own } */
function limitersOf(leaf) {
  const found = [];
  const addLimiter = (fn, isOwn) => found.push({ name: fn.limiterName || null, max: fn.limiterBudget ? fn.limiterBudget.max : NaN, own: isOwn });
  leaf.fns.slice(0, -1).filter(isLimiter).forEach((fn) => addLimiter(fn, true));
  leaf.chain.forEach((item) => {
    if (typeof item === 'function' || !isLimiter(item.fn)) return;
    const mount = ((item.prefix || '') + require('./load-app.cjs').mountOf(item.layer)).replace(/[/]$/, '');
    if (mount === '/api' && leaf.path.startsWith('/api/')) addLimiter(item.fn, false);
    else if (mount === '' ) addLimiter(item.fn, false);
    else if (coversRoute(item, leaf.path)) addLimiter(item.fn, true);
  });
  return found;
}

/** resource_cap (column 16): the causes it fails on (empty = holds) */
function resourceCapCauses({ leaf, source, fileText, operation }) {
  const limiters = limitersOf(leaf);
  const global = limiters.find((item) => !item.own && Number.isFinite(item.max));
  return require('../lib/resource-cap').causesOf({ key: leaf.method + ' ' + leaf.path, method: leaf.method, urlSchema: require('../middleware/validate').urlSchemaOf(operation), text: callTreeSource(source, fileText || ''), limiters, globalMax: global ? global.max : Infinity });
}

/** paged_read (column 21, PERF1): the paged-read facts of a GET and the causes it fails on (lib/paged-read.js) */
function pagedReadOf({ leaf, source, fileText, operation, root }) {
  const pagedRead = require('../lib/paged-read');
  const facts = pagedRead.factsOf({ method: leaf.method, file: leaf.file || '', path: leaf.path, text: source, treeText: callTreeSource(source, fileText || ''), fileText, urlSchema: require('../middleware/validate').urlSchemaOf(operation), root });
  return { facts, causes: pagedRead.causesOf(facts) };
}

/** bfla_role_check: only a route with a role gate in front of it applies; it holds on the test scene's evidence */
function bflaColumn(leaf, evidence) {
  const gates = roleGatesOf(leaf);
  return { applies: gates.length > 0, holds: gates.length === 0 || !!(evidence && evidence.bfla_role_check === true) };
}

/** role_matrix: the route declares well-formed seats AND the live run proved them (evidence role_matrix: true) */
const roleMatrixColumn = (operation, evidence) => !!operation && require('../lib/role-matrix').problemsOf(operation['x-seats']).length === 0 && !!(evidence && evidence.role_matrix === true);

/* ── parameterised_query ───────────────────────────────────────────────────────────────────────────────────── */
const SQL_CALL = /(?:^|[^\w$])(?:[\w$]+\.)*(?:query|run|runQuery|queryAs)\s*\(/g;
const SAFE_INTERPOLATION = /^(?:[A-Z][A-Z0-9_]*|frag\([\s\S]*\))$/; /* an UPPER_CASE constant, or frag(..): a fragment the code built and a human read (lib/sql-frag.js) */

/** the end index of a ${..} expression that starts at `from` (just after the "${"), balancing braces and nested template literals */
function endOfExpression(text, from) {
  let depth = 1;
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (char === '`') at = endOfTemplate(text, at + 1).end;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return at;
  }
  return text.length;
}

/** a template literal that starts after its opening backtick: { end: index of the closing backtick, expressions: the ${..} texts } */
function endOfTemplate(text, from) {
  const expressions = [];
  for (let at = from; at < text.length; at++) {
    if (text[at] === '\\') at++;
    else if (text[at] === '`') return { end: at, expressions };
    else if (text[at] === '$' && text[at + 1] === '{') {
      const close = endOfExpression(text, at + 2);
      expressions.push({ text: text.slice(at + 2, close).trim(), dollarBefore: text[at - 1] === '$' });
      at = close;
    }
  }
  return { end: text.length, expressions };
}

/** a quoted string at `from`, then + and more: built only when an operand after a + is not itself a quoted string (literals joined across lines are one fixed text) */
function literalChainBuilt(text, from) {
  let at = from;
  for (;;) {
    const quote = text[at];
    let close = at + 1;
    while (close < text.length && text[close] !== quote) close += text[close] === '\\' ? 2 : 1;
    const after = /^\s*\+\s*/.exec(text.slice(close + 1, close + 40));
    if (!after) return false;
    at = close + 1 + after[0].length;
    if (text[at] !== "'" && text[at] !== '"') return true;
  }
}

/** is the first argument of the call at `from` (just after the paren) string-built SQL? */
function firstArgumentBuilt(text, from) {
  let at = from;
  while (/\s/.test(text[at] || '')) at++;
  if (text[at] === '`') return endOfTemplate(text, at + 1).expressions.some((part) => !part.dollarBefore && !SAFE_INTERPOLATION.test(part.text));
  if (text[at] === "'" || text[at] === '"') return literalChainBuilt(text, at);
  return false;
}

/** { calls, built } — the SQL calls in a source text and how many of them build their SQL as a string */
function sqlCallsIn(source) {
  let calls = 0;
  let built = 0;
  for (const match of source.matchAll(SQL_CALL)) {
    calls++;
    if (firstArgumentBuilt(source, match.index + match[0].length)) built++;
  }
  return { calls, built };
}

/** the text of the function a name declares in a file (function declaration or const arrow), by brace matching; '' when the file declares none */
function bodyOf(fileText, name) {
  const head = new RegExp('(?:function\\s+' + name + '\\s*\\(|const\\s+' + name + '\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\()').exec(fileText);
  if (!head) return '';
  const open = fileText.indexOf('{', fileText.indexOf(')', head.index));
  if (open < 0) return '';
  let depth = 0;
  for (let at = open; at < fileText.length; at++) {
    if (fileText[at] === '`') at = endOfTemplate(fileText, at + 1).end;
    else if (fileText[at] === '{') depth++;
    else if (fileText[at] === '}' && --depth === 0) return fileText.slice(head.index, at + 1);
  }
  return '';
}

/** the handler's source plus the same-file functions it calls, up to three levels */
function callTreeSource(source, fileText, levels = 3) {
  const seen = new Set();
  const parts = [source];
  let frontier = [source];
  for (let level = 0; level < levels; level++) {
    const next = [];
    frontier.forEach((text) => {
      for (const match of text.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = match[1];
        if (seen.has(name) || /^(?:if|for|while|switch|catch|function|return|await|query|run|runQuery|queryAs)$/.test(name)) continue;
        seen.add(name);
        const body = bodyOf(fileText, name);
        if (body) {
          parts.push(body);
          next.push(body);
        }
      }
    });
    frontier = next;
  }
  return parts.join('\n');
}

/** parameterised_query: applies when the tree runs SQL; holds when none of its calls is string-built */
function parameterisedColumn(source, fileText) {
  const { calls, built } = sqlCallsIn(callTreeSource(source, fileText || ''));
  return { applies: calls > 0, holds: built === 0 };
}

/* ── audit_logged ──────────────────────────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const AUDIT_TABLES = ['state_log', 'books_change_log', 'access_events', 'quick_key_audit', 'bank_rec_log', 'books_access_log', 'signin_events', 'audit_log'];
const AUDIT_WRITERS = new RegExp('(?:\\brecordChanges\\s*\\(|\\baccessEvents\\.record\\s*\\(|\\blogChange\\s*\\(|\\bauditWrite\\s*\\(|\\bwriteAudit\\s*\\(|\\brecordAudit\\s*\\(|INSERT\\s+INTO\\s+(?:' + AUDIT_TABLES.join('|') + ')\\b)', 'i');
const ROOT = path.join(__dirname, '..');
const fileCache = new Map();
const readModule = (base) => {
  if (!fileCache.has(base)) fileCache.set(base, [base + '.js', base + '.cjs', base + '/index.js'].filter((file) => fs.existsSync(file)).map((file) => fs.readFileSync(file, 'utf8'))[0] || '');
  return fileCache.get(base);
};
const REQUIRE_LIB = /(?:const|let|var)\s+(?:([A-Za-z_$][\w$]*)|\{([^}]*)\})\s*=\s*require\(\s*['"](\.\.?\/[^'"]+?)(?:\.c?js)?['"]\s*\)/g;
const AUDIT_LEVELS = 5; /* same-file call levels the audit and stale trees follow inside one module (a bulk writer is a few helpers deep) */
const HOP_LIMIT = 4; /* how many required modules deep the audit and stale trees follow a call (routes -> lib -> lib -> ...) */
/** the lib/middleware modules a file requires (relative to its own folder): name (alias or destructured) -> { base path, fn } */
function libImportsOf(fileText, dir) {
  const map = {};
  for (const match of fileText.matchAll(REQUIRE_LIB)) {
    const base = path.resolve(dir || path.join(ROOT, 'routes'), match[3]);
    if (!['lib', 'middleware'].includes(path.basename(path.dirname(base))) || !base.startsWith(ROOT)) continue;
    if (match[1]) map[match[1]] = { base };
    else match[2].split(',').map((part) => part.split(':').map((x) => x.trim())).forEach((names) => { if (names[0]) map[names[names.length - 1]] = { base, fn: names[0] }; });
  }
  return map;
}
/** the lib function a call match reaches through a required module: { base, fn } or null */
function importedCall(match, imports) {
  const imported = match[1] ? imports[match[1]] : imports[match[3]];
  const fn = match[1] ? match[2] : imported && imported.fn;
  return imported && fn ? { base: imported.base, fn } : null;
}
/** the handler tree plus the lib functions it calls through required modules, followed hop by hop (HOP_LIMIT deep), each with its own same-file tree */
function auditTreeParts(source, fileText, hopLimit = HOP_LIMIT, levels = AUDIT_LEVELS) {
  const parts = [callTreeSource(source, fileText || '', levels)];
  const seen = new Set();
  /** one hop of the walk: the calls in this tree, each followed into its own module until hopsDone reaches the limit */
  const follow = (tree, imports, hopsDone) => {
    if (hopsDone >= hopLimit) return;
    for (const match of tree.matchAll(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(|(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const call = importedCall(match, imports);
      if (!call || seen.has(call.base + '#' + call.fn)) continue;
      seen.add(call.base + '#' + call.fn);
      const libText = readModule(call.base);
      const body = bodyOf(libText, call.fn);
      if (!body) continue;
      const libTree = callTreeSource(body, libText, levels);
      parts.push(libTree);
      follow(libTree, libImportsOf(libText, path.dirname(call.base)), hopsDone + 1);
    }
  };
  follow(parts[0], libImportsOf(fileText || ''), 0);
  return parts;
}
const auditTreeSource = (source, fileText, hopLimit, levels) => auditTreeParts(source, fileText, hopLimit, levels).join('\n');
/**
 * The per-route AUDIT EVIDENCE (docs/contracts/api-audit-evidence.json, read by a person, written by hand): { routes: { 'POST /api/x': { audit_logged: true|false, writer: 'lib/f.js fn (table)', why } } }.
 * A static walk only SHOWS that an audit writer is reachable; it cannot tell the write path from a branch that rarely runs (a ledger entry's first-use account is logged, the entry is not), so
 * the wide walk (HOP_LIMIT modules) never credits a route by itself: it credits only on a row here that says true, and a row that says false overrules even the near walk.
 * Without a row, the near walk (one module hop, three levels: what the column always held) decides. A true row names the writer and is checked by tests/api-reported.test.cjs.
 */
let auditEvidenceCache = null;
function auditEvidence() {
  if (!auditEvidenceCache) {
    const file = path.join(ROOT, 'docs', 'contracts', 'api-audit-evidence.json');
    auditEvidenceCache = (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).routes : null) || {};
  }
  return auditEvidenceCache;
}
/** audit_logged: { applies, holds } */
function auditColumn(leaf, source, fileText, evidence) {
  const applies = WRITE_METHODS.includes(leaf.method);
  if (!applies) return { applies, holds: true };
  const row = auditEvidence()[leaf.method + ' ' + leaf.path];
  if (row && typeof row.audit_logged === 'boolean') return { applies, holds: row.audit_logged };
  return { applies, holds: !!(evidence && evidence.audit_logged === true) || AUDIT_WRITERS.test(auditTreeSource(source, fileText, 1, 3)) };
}

/* ── stale_write_refused ───────────────────────────────────────────────────────────────────────────────────── */
const STALE_READS = /if-match|ifmatch|expected_?version|expected_?holder|expected_?updated_?at|base_?version|row_?version|\bWHERE\b[^;]*?\b(?:version|updated_at)\s*=\s*\$\d/i;
const STALE_ANSWER = /\b(?:409|412)\b|STALE|PRECONDITION_FAILED|VERSION_CONFLICT/;
/** a POST by path: an update when the path ends in a path parameter, an action on a record when one parameter is followed by a verb, else a create */
const postKind = (routePath) => (/\/:[A-Za-z_]+$/.test(routePath) ? null : /\/:[A-Za-z_]+\/[A-Za-z0-9_-]+$/.test(routePath) ? 'action' : 'create');
/** { applies, na } where na names why a write that is not an update of a mutable record does not apply */
function staleKind(leaf, moneyKeys) {
  const reason = staleNotApplicable(leaf, moneyKeys);
  return { applies: reason === null, na: reason };
}
/** why a route is outside the update rule, or null when it is an update */
function staleNotApplicable(leaf, moneyKeys) {
  if (!WRITE_METHODS.includes(leaf.method)) return 'read';
  if (leaf.method === 'DELETE') return 'delete';
  if (moneyKeys && moneyKeys.has(leaf.method + ' ' + leaf.path)) return 'money-posting';
  return leaf.method === 'POST' ? postKind(leaf.path) : null;
}
function staleColumn(leaf, source, fileText, evidence, moneyKeys) {
  const kind = staleKind(leaf, moneyKeys);
  if (!kind.applies) return { applies: false, holds: true, na: kind.na };
  const tree = auditTreeSource(source, fileText, 1, 3);
  return { applies: true, holds: !!(evidence && evidence.stale_write_refused === true) || (STALE_READS.test(tree) && STALE_ANSWER.test(tree)), na: null };
}

/* ── documented_example ────────────────────────────────────────────────────────────────────────────────────── */
const hasExampleKeys = (holder) => !!holder && (holder.example !== undefined || (Array.isArray(holder.examples) && holder.examples.length > 0));
const hasExample = (media) => !!media && (hasExampleKeys(media) || !!(media.examples && Object.keys(media.examples).length) || hasExampleKeys(media.schema));
const anyExample = (content) => !!content && Object.values(content).some(hasExample);
/** documented_example: the 2xx answer has an example and, when the operation takes a body, so does the body */
function exampleColumn(operation) {
  if (!operation) return false;
  const ok = Object.keys(operation.responses || {}).filter((code) => /^2/.test(code));
  return ok.some((code) => anyExample(operation.responses[code] && operation.responses[code].content)) && (!operation.requestBody || anyExample(operation.requestBody.content));
}

/** the reported columns of one route: { columns, applies } — a column that does not apply reads true, as the machine columns do */
function reportedOf({ leaf, source, fileText, evidence, operation, scope, root }) {
  const audit = auditColumn(leaf, source, fileText, evidence);
  const stale = staleColumn(leaf, source, fileText, evidence, scope && scope.money);
  const bfla = bflaColumn(leaf, evidence);
  const query = parameterisedColumn(source, fileText);
  const causes = resourceCapCauses({ leaf, source, fileText, operation });
  const paged = pagedReadOf({ leaf, source, fileText, operation, root });
  return {
    facts: { paged_read: paged.facts },
    causes: { resource_cap: causes, paged_read: paged.causes, stale_write_refused_na: stale.na ? [stale.na] : [] },
    columns: { bfla_role_check: bfla.holds, parameterised_query: query.holds, rate_limited: rateLimitedColumn(leaf), role_matrix: roleMatrixColumn(operation, evidence), junk_fuzz: junkFuzzColumn(evidence), resource_cap: causes.length === 0, audit_logged: audit.holds, stale_write_refused: stale.holds, documented_example: exampleColumn(operation), paged_read: paged.causes.length === 0 },
    applies: { bfla_role_check: bfla.applies, parameterised_query: query.applies, rate_limited: true, role_matrix: true, junk_fuzz: true, resource_cap: true, audit_logged: audit.applies, stale_write_refused: stale.applies, documented_example: true, paged_read: paged.facts.kind === 'list' }
  };
}

/** counts for the scorecard line: per reported column, routes it applies to and routes failing it */
function reportedCounts(rows) {
  return Object.fromEntries(
    REPORTED_COLUMNS.map((name) => [name, { applies: rows.filter((row) => row.reported_applies[name]).length, failing: rows.filter((row) => row.reported_applies[name] && !row.reported[name]).length }])
  );
}

/** resource_cap: how many routes fail on each cause (a route with two causes counts under both) */
function causeCounts(rows) {
  const out = {};
  rows.forEach((row) => ((row.reported_causes && row.reported_causes.resource_cap) || []).forEach((cause) => { out[cause] = (out[cause] || 0) + 1; }));
  return out;
}

module.exports = { pagedReadOf, AUDIT_WRITERS, auditColumn, staleColumn, staleKind, exampleColumn, auditTreeSource, auditEvidence, REPORTED_COLUMNS, roleMatrixColumn, junkFuzzColumn, causeCounts, limitersOf, resourceCapCauses, reportedOf, reportedCounts, roleGatesOf, rateLimitedColumn, bflaColumn, sqlCallsIn, parameterisedColumn, callTreeSource, isLimiter };
