'use strict';
/*
 * OWNS      the three REPORTED columns of the API register (CAP-17 slice 1): bfla_role_check · parameterised_query · rate_limited. Per route: does the column apply, does it hold.
 * CALLED BY tools/api-register.cjs (rowOf, countsOf, renderMarkdown) · tools/api-ratchet.cjs (reported_failing may only go down) · tests/api-reported.test.cjs
 * FLOW      the route's own source + its stack (leaf.chain, leaf.fns) + the evidence union ──▶ { columns, applies } ──▶ row.reported / row.reported_applies ──▶ counts.reported
 * CARD      28-platform-and-operations/api-standard
 *
 * REPORTED, NOT YET COUNTED (Athi's rule for CAP-17 slice 1): these columns are shown in the register and counted on their own line, but they are NOT in
 * MACHINE_COLUMNS, so they never move a route's status or the "meets" count. Once the failing counts are filled the plan is: add the three names to MACHINE_COLUMNS
 * (and HARDENING_COLUMNS) in one PR that states the new "meets" count, with Athi's sight. Until then the ratchet only stops the failing counts from rising.
 * OWASP API Security Top 10 2023: API5 broken function level authorisation (bfla_role_check) · API4 unrestricted resource consumption (rate_limited) · ASVS L2 V5.3.4 parameterised queries.
 *
 *   bfla_role_check      applies to a route whose stack holds a ROLE GATE (a function tagged `roleGate`: lib/owner.js ownerOnly = 'owner', lib/access.js writeGate = 'editor').
 *                        Holds when a test scene proved a lower role is refused (and the role it needs is not): evidence `bfla_role_check: true`, written by tests/lib/bfla-world.cjs.
 *   parameterised_query  applies to a route whose handler, or a function of the SAME file it calls (up to three levels), runs SQL through query/run/runQuery/queryAs. Holds when no such
 *                        call is string-built: a template literal whose ${..} is not an UPPER_CASE constant or a `$${n}` placeholder number, or a quoted string joined with `+`.
 *                        SLICE 1 stops at the file: SQL written in lib/*.js is the next slice (it needs the call tree across files); a fragment built from a whitelist reads as built, on purpose.
 *   rate_limited         applies to every route. Holds when a limiter (express-rate-limit: a function with resetKey) OTHER than the global /api one sits in front of it, in the route's own
 *                        stack or mounted over its path. The global limiter is the floor for every route and proves nothing per endpoint.
 */
const REPORTED_COLUMNS = ['bfla_role_check', 'parameterised_query', 'rate_limited'];

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

/** bfla_role_check: only a route with a role gate in front of it applies; it holds on the test scene's evidence */
function bflaColumn(leaf, evidence) {
  const gates = roleGatesOf(leaf);
  return { applies: gates.length > 0, holds: gates.length === 0 || !!(evidence && evidence.bfla_role_check === true) };
}

/* ── parameterised_query ───────────────────────────────────────────────────────────────────────────────────── */
const SQL_CALL = /(?:^|[^\w$])(?:[\w$]+\.)*(?:query|run|runQuery|queryAs)\s*\(/g;
const SAFE_INTERPOLATION = /^[A-Z][A-Z0-9_]*$/;

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

/** is the first argument of the call at `from` (just after the paren) string-built SQL? */
function firstArgumentBuilt(text, from) {
  let at = from;
  while (/\s/.test(text[at] || '')) at++;
  if (text[at] === '`') return endOfTemplate(text, at + 1).expressions.some((part) => !part.dollarBefore && !SAFE_INTERPOLATION.test(part.text));
  if (text[at] === "'" || text[at] === '"') {
    const close = text.indexOf(text[at], at + 1);
    return close > 0 && /^\s*\+/.test(text.slice(close + 1, close + 40));
  }
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
function callTreeSource(source, fileText) {
  const seen = new Set();
  const parts = [source];
  let frontier = [source];
  for (let level = 0; level < 3; level++) {
    const next = [];
    frontier.forEach((text) => {
      for (const match of text.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
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

/** the reported columns of one route: { columns, applies } — a column that does not apply reads true, as the machine columns do */
function reportedOf({ leaf, source, fileText, evidence }) {
  const bfla = bflaColumn(leaf, evidence);
  const query = parameterisedColumn(source, fileText);
  return {
    columns: { bfla_role_check: bfla.holds, parameterised_query: query.holds, rate_limited: rateLimitedColumn(leaf) },
    applies: { bfla_role_check: bfla.applies, parameterised_query: query.applies, rate_limited: true }
  };
}

/** counts for the scorecard line: per reported column, routes it applies to and routes failing it */
function reportedCounts(rows) {
  return Object.fromEntries(
    REPORTED_COLUMNS.map((name) => [name, { applies: rows.filter((row) => row.reported_applies[name]).length, failing: rows.filter((row) => row.reported_applies[name] && !row.reported[name]).length }])
  );
}

module.exports = { REPORTED_COLUMNS, reportedOf, reportedCounts, roleGatesOf, rateLimitedColumn, bflaColumn, sqlCallsIn, parameterisedColumn, callTreeSource, isLimiter };
