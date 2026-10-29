'use strict';
/*
 * OWNS      the ENDPOINT CARD facts of one register row (API-12): does · owner_agent · errors · reads / writes · money · actions · callers.
 * CALLED BY tools/api-register.cjs (rowOf, renderMarkdown, --callers) · tests/api-tools.test.cjs
 * FLOW      route file text + handler source ──▶ @does / @actions comment above the route ──▶ tables from the SQL it (and the helpers it calls) holds ──▶ card
 *           web checkout ──▶ --callers ──▶ docs/contracts/api-callers.json ──▶ callers per route (the committed file is what --check reads, so CI needs no web checkout)
 * CARD      28-platform-and-operations/api-standard
 *
 * Written by hand: the `@does` and `@actions` lines in the comment block directly above the route. Everything else is DERIVED and marked so
 * (reads, writes, money, callers are best effort, never a promise). Reuse: callers come from tools/endpoint-usage-callers.cjs, the one scanner.
 *   // @does  Shopkeeper's words: what comes in -> what we do with it -> what goes back.
 *   // @actions  (SEC-117 seed; empty for now) the permission actions the route needs.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

/** route file (the register's owner_area) -> the cb-* agent that answers for it; one small table, the only one (no earlier map existed) */
const AGENT_OF = {
  actors: 'cb-people', adopt: 'cb-operations', assist: 'cb-ai', attachments: 'cb-rail', books: 'cb-accounting', capture: 'cb-connect',
  catalogue: 'cb-catalogue', 'catalogue-face': 'cb-catalogue', channels: 'cb-connect', chits: 'cb-rail', 'combo-templates': 'cb-catalogue',
  connections: 'cb-network', connectors: 'cb-connect', counters: 'cb-counter', 'csp-report': 'cb-security', crm: 'cb-crm', ctp: 'cb-rail',
  definitions: 'cb-catalogue', entities: 'cb-network', events: 'cb-rail', facts: 'cb-reports', folders: 'cb-rail', forms: 'cb-compliance',
  governance: 'cb-settings', 'identity-docs': 'cb-compliance', integrations: 'cb-connect', invoice: 'cb-accounting', keys: 'cb-security',
  kyb: 'cb-compliance', marketing: 'cb-marketing', network: 'cb-network', 'network-design': 'cb-network', 'network-offers': 'cb-network',
  notifications: 'cb-rail', offers: 'cb-catalogue', openapi: 'cb-api', people: 'cb-people', pricing: 'cb-catalogue', privacy: 'cb-compliance',
  products: 'cb-catalogue', 'quick-keys': 'cb-counter', relationships: 'cb-crm', 'repeat-supply': 'cb-orders', schemas: 'cb-capability',
  server: 'cb-platform', service: 'cb-rail', signin: 'cb-security', simulator: 'cb-demo', supplies: 'cb-operations', tax: 'cb-accounting',
  testing: 'cb-qa', till: 'cb-counter', work: 'cb-orders'
};
const agentOf = (area) => AGENT_OF[area] || 'unassigned';

/** the comment block directly above 1-based `line` of the file text (no blank line between), as plain text lines; [] when there is none */
function commentAbove(fileText, line) {
  if (!fileText || !line) return [];
  const lines = fileText.split('\n');
  const out = [];
  for (let at = line - 2; at >= 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[at]); at--) out.unshift(lines[at].replace(/^\s*(\/\/+|\/\*+|\*+\/?)\s?/, '').replace(/\*\/\s*$/, '').trim());
  return out;
}

/** one `@tag text` line of the comment above the route, or '' */
function tagAbove(fileText, line, tag) {
  const found = commentAbove(fileText, line).map((text) => new RegExp('^@' + tag + '\\b\\s*(.*)$').exec(text)).find(Boolean);
  return found ? found[1].trim() : '';
}

/** `@actions a, b` as a list (empty for now: the SEC-117 seed) */
const actionsAbove = (fileText, line) => tagAbove(fileText, line, 'actions').split(/[,\s]+/).filter(Boolean);

/** every table the migrations create (lowercase, schema prefix cut): the only names a SQL scan may report, so a word like "from the till" never reads as a table */
function knownTables(root) {
  const dir = path.join(root, 'migrations');
  const tables = new Set();
  if (!fs.existsSync(dir)) return tables;
  fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).forEach((name) => {
    for (const match of fs.readFileSync(path.join(dir, name), 'utf8').matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:\w+\.)?"?([a-z_][a-z0-9_]*)"?/gi)) tables.add(match[1].toLowerCase());
  });
  return tables;
}

/** the text of function `name` defined in `text` (function declaration or const/assignment), by balanced braces; '' when not found. Crude on purpose: best effort. */
function functionText(text, name) {
  const found = new RegExp('(?:function\\s+' + name + '\\s*\\(|(?:const|let|var)\\s+' + name + '\\s*=|\\b' + name + '\\s*:\\s*(?:async\\s*)?(?:function|\\())').exec(text);
  if (!found) return '';
  const open = text.indexOf('{', found.index);
  if (open < 0) return '';
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === '{') depth++;
    else if (text[at] === '}' && --depth === 0) return text.slice(found.index, at + 1);
  }
  return text.slice(found.index, found.index + 6000);
}

/** names the source calls: plain `name(` and `module.name(`; a module is returned as [module, name] */
function callsIn(source) {
  const plain = new Set();
  const member = [];
  for (const match of source.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) plain.add(match[1]);
  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)) member.push([match[1], match[2]]);
  return { plain, member };
}

/** local requires of a file: name -> absolute module path (const x = require('./y') and const { a, b } = require('./y')) */
function requiresOf(fileText, fileAbs) {
  const out = new Map();
  for (const match of fileText.matchAll(/(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    let target;
    try {
      target = require.resolve(path.resolve(path.dirname(fileAbs), match[2]));
    } catch (failure) {
      continue;
    }
    const names = match[1].startsWith('{') ? match[1].slice(1, -1).split(',').map((item) => item.split(':').pop().trim()) : [match[1]];
    names.filter(Boolean).forEach((name) => out.set(name, target));
  }
  return out;
}

/** the handler's source plus the text of the helpers it calls (same file, or a module it requires), `depth` levels down; best effort */
function reachableText(source, fileText, fileAbs, depth) {
  const parts = [source];
  const seen = new Set();
  const modules = requiresOf(fileText, fileAbs);
  const cache = new Map();
  const textOf = (file) => (cache.has(file) ? cache.get(file) : (cache.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''), cache.get(file)));
  let frontier = [source];
  for (let level = 0; level < depth; level++) {
    const next = [];
    frontier.forEach((piece) => {
      const { plain, member } = callsIn(piece);
      const wanted = [];
      plain.forEach((name) => wanted.push({ name, from: fileAbs, text: fileText }, ...(modules.has(name) ? [{ name, from: modules.get(name), text: textOf(modules.get(name)), whole: false }] : [])));
      member.filter(([owner]) => modules.has(owner)).forEach(([owner, name]) => wanted.push({ name, from: modules.get(owner), text: textOf(modules.get(owner)) }));
      wanted.forEach((want) => {
        const id = want.from + '#' + want.name;
        if (seen.has(id) || !want.text || ['if', 'for', 'while', 'switch', 'catch', 'function', 'require', 'query', 'json', 'status', 'send'].includes(want.name)) return;
        seen.add(id);
        const body = functionText(want.text, want.name);
        if (body) (parts.push(body), next.push(body));
      });
    });
    frontier = next;
  }
  return parts.join('\n');
}

/** string literals that hold SQL: a quote, apostrophe or template holding an upper-case SQL verb */
const sqlStrings = (text) => (text.match(/`[^`]*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g) || []).filter((literal) => /\b(SELECT|INSERT|UPDATE|DELETE|WITH)\b/.test(literal));

/** { reads, writes } table names from the SQL in `text`, only names the migrations create (marked "derived" wherever shown) */
function tablesOf(text, known) {
  const reads = new Set();
  const writes = new Set();
  const take = (set, name) => known.has(name.toLowerCase()) && set.add(name.toLowerCase());
  sqlStrings(text).forEach((sql) => {
    for (const match of sql.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?(?:\w+\.)?"?([a-z_][a-z0-9_]*)"?/gi)) take(writes, match[1]);
    for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+(?:\w+\.)?"?([a-z_][a-z0-9_]*)"?/gi)) take(reads, match[1]);
  });
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}

/** a money column named in the SQL, or the route is on the curated money-write list */
const MONEY_COLUMN = /\b(amount|price|cost|total|balance|fee|mrp|discount|paid|due|credit|debit)[a-z_]*\b|_minor\b/i;
const moneyOf = (text, curated) => !!curated || sqlStrings(text).some((sql) => MONEY_COLUMN.test(sql));

/** the codes and statuses a route can answer: declared statuses plus the codes its handler writes that the register knows */
function errorsOf(declaredStatuses, codes, registeredCodes) {
  const listed = [...new Set(codes)].filter((code) => !registeredCodes || registeredCodes.has(code)).sort();
  return { count: listed.length, statuses: declaredStatuses.slice().sort((left, right) => left - right), codes: listed };
}

/** the card facts of one route, given what api-register.cjs already knows (handler source, file text, declared statuses, codes) */
function cardOf({ root, area, source, fileText, fileAbs, line, declared, codes, registeredCodes, curatedMoney, known }) {
  const text = fileAbs ? reachableText(source, fileText, fileAbs, 2) : source;
  const tables = tablesOf(text, known);
  return {
    does: tagAbove(fileText, line, 'does'),
    owner_agent: agentOf(area),
    errors: errorsOf(declared, codes, registeredCodes),
    reads: tables.reads,
    writes: tables.writes,
    money: moneyOf(text, curatedMoney),
    actions: actionsAbove(fileText, line),
    derived: ['reads', 'writes', 'money']
  };
}

/* ── callers: the web screens that call a route (docs/contracts/api-callers.json, written by --callers, read by every other run) ── */
const CALLERS_FILE = 'docs/contracts/api-callers.json';
const readCallersFile = (root) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, CALLERS_FILE), 'utf8'));
  } catch (failure) {
    logger.warn("api-card: " + CALLERS_FILE + " not read, so callers and offline read empty: " + failure.message);
    return {};
  }
};
const readCallers = (root) => readCallersFile(root).routes || {};
/** route keys the web client's outbox queues and replays offline (core.js OUTBOX_KEYS, mapped through the api registry) */
const readQueueable = (root) => new Set(readCallersFile(root).queueable || []);

/** a path with every :param as ':' so a registry path and a route path compare */
const shapeOf = (route) => route.replace(/\{[^}]+\}|:[A-Za-z_]\w*/g, ':');

/** the client's api('key') registry: key -> { method, path } (the same pattern tools/endpoint-usage.cjs reads) */
function webRegistry(webRoot) {
  const registry = {};
  const dir = path.join(webRoot, 'public', 'app');
  if (!fs.existsSync(dir)) return registry;
  fs.readdirSync(dir).filter((name) => name.endsWith('.js')).forEach((name) => {
    for (const match of fs.readFileSync(path.join(dir, name), 'utf8').matchAll(/(\w+):\s*\{\s*m:\s*["'](\w+)["']\s*,\s*p:\s*["']([^"']+)["']/g)) registry[match[1]] = { method: match[2], path: match[3] };
  });
  return registry;
}

/** { 'METHOD /path': ['cap-books.js', ...] } for the screens (class A web files) that call a route, by api('key') and by literal path; the web checkout is a sibling of the api */
function scanCallers(root, rows, webRoot) {
  const callers = require('./endpoint-usage-callers.cjs');
  const registry = webRegistry(webRoot);
  const routes = rows.map((row) => ({ key: row.key, method: row.method, full: row.path }));
  const byShape = new Map(routes.map((route, id) => [route.method + ' ' + shapeOf(route.full), id]));
  const sources = callers.sources(root, webRoot, path.join(root, '..', 'chitbridge-engines-none')).filter((source) => source.repo === 'web' && source.cls === 'A');
  const { hits } = callers.scanAll(sources, routes, Object.keys(registry));
  const out = {};
  const addCaller = (id, source) => id !== undefined && ((out[routes[id].key] = out[routes[id].key] || new Set()).add(path.basename(source.relPath)));
  hits.forEach((found) => {
    if (found.route !== undefined) addCaller(found.route, found.src);
    else if (registry[found.key]) addCaller(byShape.get(registry[found.key].method + ' ' + shapeOf(registry[found.key].path)), found.src);
  });
  return Object.fromEntries(Object.keys(out).sort().map((key) => [key, [...out[key]].sort()]));
}

/** write docs/contracts/api-callers.json from the sibling web checkout (node tools/api-register.cjs --callers) */
function writeCallers(root, rows, webRoot) {
  const routes = scanCallers(root, rows, webRoot);
  const queueable = queueableRoutes(webRoot, rows);
  fs.writeFileSync(path.join(root, CALLERS_FILE), JSON.stringify({ about: 'Web screens that call each route, and the routes the web outbox queues offline, derived from the web checkout by node tools/api-register.cjs --callers (api(key) calls and literal paths, screens only). Read by the register; refresh by hand, never in CI.', routes, queueable }, null, 1) + '\n');
  return Object.keys(routes).length;
}

/** the route keys of the web outbox: the `OUTBOX_KEYS = new Set([...])` list of public/app/core.js, each api key mapped to its route through the registry */
function queueableRoutes(webRoot, rows) {
  const file = path.join(webRoot, 'public', 'app', 'core.js');
  const block = fs.existsSync(file) ? /OUTBOX_KEYS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(fs.readFileSync(file, 'utf8')) : null;
  if (!block) return [];
  const registry = webRegistry(webRoot);
  const byShape = new Map(rows.map((row) => [row.method + ' ' + shapeOf(row.path), row.key]));
  const keys = [...block[1].replace(/\/\/[^\n]*/g, '').matchAll(/['"](\w+)['"]/g)].map((match) => match[1]);
  return [...new Set(keys.filter((key) => registry[key]).map((key) => byShape.get(registry[key].method + ' ' + shapeOf(registry[key].path))).filter(Boolean))].sort();
}

/** offline: queueable (the outbox replays it) · idempotent (a money write that requires Idempotency-Key and passes) · online-only */
function offlineOf(key, queueable, idempotentPasses) {
  return queueable.has(key) ? 'queueable' : idempotentPasses ? 'idempotent' : 'online-only';
}

/** round trips: this route's budget (round-trips.budget.json) and, per calling screen, its share of the trips of every budgeted route that screen calls; trips null when no budget line */
function roundTripsOf(key, budget, callersByRoute) {
  const budgetLine = budget[key];
  if (!budgetLine) return { trips: null, wire: null, screens: [] };
  const screens = (callersByRoute[key] || []).map((screen) => {
    const total = Object.keys(callersByRoute).filter((other) => callersByRoute[other].includes(screen) && budget[other]).reduce((sum, other) => sum + budget[other].trips, 0);
    return screen + " " + budgetLine.trips + '/' + total;
  });
  return { trips: budgetLine.trips, wire: budgetLine.wire, screens };
}

/** the measured fields nobody has measured yet: left empty, never invented (cb-speed SPD-29 fills them) */
const unmeasured = () => ({ server_ms_p50: null, server_ms_p95: null, bytes_out: null, slow_3g: null });

/* ── the markdown card ── */
const list = (items) => (items.length ? items.join(', ') : '-');

/** one compact card per route: three lines under a heading */
function renderCard(row) {
  const errors = row.errors || { count: 0, statuses: [], codes: [] };
  return [
    '**' + row.method + ' ' + row.path + '** · ' + row.owner_area + ' · ' + row.owner_agent + ' · ' + row.status,
    '- does: ' + (row.does || '_not yet written_'),
    '- errors: ' + errors.count + ' code(s) [' + list(errors.codes) + '] · statuses ' + list(errors.statuses) + ' · money ' + (row.money ? 'y' : 'n') + ' (derived)',
    '- effect: offline ' + row.offline + ' · round trips ' + (row.round_trips && row.round_trips.trips !== null ? row.round_trips.trips + ' (wire ' + row.round_trips.wire + (row.round_trips.screens.length ? '; share ' + row.round_trips.screens.slice(0, 3).join(', ') : '') + ')' : '-') + ' · p50/p95 ms, bytes out, slow 3G: not measured (SPD-29)',
    '- reads (derived): ' + list(row.reads) + ' · writes (derived): ' + list(row.writes) + ' · callers: ' + list(row.callers) + ' · actions: ' + list(row.actions),
    ''
  ];
}

/** every card, grouped under one heading per area (system) */
function renderCards(rows) {
  const lines = ['', '## Endpoint cards', '', 'One card per route. `does` is written by hand above the route (`@does`); reads, writes, money and callers are derived best effort; `actions` is the SEC-117 seed (empty for now).', ''];
  const areas = [...new Set(rows.map((row) => row.owner_area))].sort();
  areas.forEach((area) => {
    const inArea = rows.filter((row) => row.owner_area === area);
    lines.push('### ' + area + ' (' + agentOf(area) + ', ' + inArea.filter((row) => row.does).length + ' of ' + inArea.length + ' with a description)', '');
    inArea.forEach((row) => lines.push(...renderCard(row)));
  });
  return lines;
}

/** routes with no @does (the ratchet's count; it may only go down) */
const withoutDoes = (rows) => rows.filter((row) => !row.does).length;

module.exports = { AGENT_OF, agentOf, commentAbove, tagAbove, actionsAbove, knownTables, functionText, tablesOf, moneyOf, errorsOf, cardOf, readCallers, readQueueable, offlineOf, roundTripsOf, unmeasured, queueableRoutes, scanCallers, writeCallers, renderCard, renderCards, withoutDoes, shapeOf, CALLERS_FILE };
