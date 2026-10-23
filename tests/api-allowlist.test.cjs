/**
 * tests/api-allowlist.test.cjs — THE OUTPUT ALLOW-LIST (API-STANDARD S34), AS UNITS: the pruning rule, the filter on res.json, the shape derivation, and the property that makes it safe.
 *
 * OWNS      unit checks of lib/output-allowlist.js (prune · outputFilter · droppedKeys) · tools/api-allowlist.cjs (the literal reader, deriveShape, checkCaptures) · the way lib/contract-kit.js uses both.
 *           The property: a shape derived from some answers is the IDENTITY on every one of those answers (same keys, same order, same values), and a key it never saw is dropped AND reported (the negative control).
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      small answers ──▶ deriveShape ──▶ prune(schema, answer) equals answer ──▶ an extra key is dropped and counted; a fake res and next() for the middleware; the real assist contract for the kit
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
process.env.LOG_LEVEL = 'critical'; /* the filter warns when it drops a key; the checks read the count, not the log */
const allow = require(path.join(API, 'lib', 'output-allowlist.js'));
const tool = require(path.join(API, 'tools', 'api-allowlist.cjs'));

let pass = 0, fail = 0;
const t = (name, ok) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  XX  ' + name); } };
console.log('\napi allow-list · prune, filter, derive');

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const closed = (properties, required) => ({ type: 'object', required: required || [], properties, additionalProperties: false });
const literal = (text) => tool.nodeOf(text);
/** a handler literal that names every key the samples hold, nested ones too (a list as rows.map(r => ({...}))): the text a handler would have if it wrote what it answered */
const unionOf = (values) => {
  const objects = values.filter((one) => one && typeof one === 'object' && !Array.isArray(one));
  const lists = values.filter(Array.isArray).flat();
  if (objects.length) return Object.fromEntries([...new Set(objects.flatMap(Object.keys))].map((key) => [key, unionOf(objects.map((one) => one[key]))]));
  return lists.length ? [unionOf(lists)] : values.find((one) => one !== undefined && one !== null);
};
const textOf = (value) => (Array.isArray(value) ? 'rows.map((r) => (' + textOf(value[0]) + '))' : value && typeof value === 'object' ? '{ ' + Object.keys(value).map((key) => key + ': ' + textOf(value[key])).join(', ') + ' }' : '1');
const derive = (samples, source) => tool.deriveShape({ samples, source: source || literal(textOf(unionOf(samples))) });

/* ── prune ── */
const schema = closed({ ok: { type: 'boolean' }, rows: { type: 'array', items: closed({ id: { type: 'string' } }) }, meta: { type: 'object' } });
const body = { rows: [{ id: 'a', secret: 1 }], ok: true, meta: { anything: 1 }, canary: 'x' };
const cut = allow.prune(schema, body);
t('prune: a key the closed schema does not list is dropped, at the top and inside list items', same(cut.value, { rows: [{ id: 'a' }], ok: true, meta: { anything: 1 } }) && same(cut.dropped.sort(), ['canary', 'rows.[].secret']));
t('prune: the answer keeps ITS key order, not the schema\'s', same(Object.keys(cut.value), ['rows', 'ok', 'meta']));
t('prune: an open node (no additionalProperties false) is returned whole', same(allow.prune({ type: 'object', properties: { a: {} } }, { a: 1, b: 2 }).value, { a: 1, b: 2 }));
t('prune: an answer that loses nothing is the very same object', (() => { const fits = { ok: true }; return allow.prune(schema, fits).value === fits; })());
t('prune: a Date, a Buffer and a value with toJSON are not walked', (() => { const day = new Date(0); const out = allow.prune(closed({ at: {}, raw: {} }), { at: day, raw: Buffer.from('x') }).value; return out.at === day && Buffer.isBuffer(out.raw); })());
t('prune: a list at the top is pruned by its items', same(allow.prune({ type: 'array', items: closed({ a: {} }) }, [{ a: 1, z: 2 }]).value, [{ a: 1 }]));

/* ── the filter on res.json ── */
const operation = { responses: { 200: { content: { 'application/json': { schema } } }, 422: { content: { 'application/problem+json': { schema: { type: 'object' } } } } } };
const fakeRes = (status) => { const sent = []; const res = { statusCode: status, json: (value) => (sent.push(value), res) }; return { res, sent }; };
const run = (status, value) => { const { res, sent } = fakeRes(status); allow.outputFilter(operation, 'GET /x')({ method: 'GET' }, res, () => undefined); res.json(value); return sent[0]; };
allow.forgetDropped();
t('filter: a 2xx answer is pruned and the drop is counted with its route', same(run(200, body), cut.value) && allow.droppedKeys().length === 2 && allow.droppedKeys()[0].route === 'GET /x');
t('filter: a refusal (4xx) is never touched', (() => { const problem = { type: 't', extra: 1 }; return run(422, problem) === problem; })());
t('filter: an operation whose success schema closes nothing gets no filter', allow.outputFilter({ responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: {} } } } } } }) === null);
t('filter: a schema that closes only a nested node still gets one', allow.outputFilter({ responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { a: closed({ b: {} }) } } } } } } }) !== null);

/* ── the literal reader ── */
t('closingOf: braces inside strings, templates and comments do not close', tool.closingOf("{ a: '}', b: `${ {c:1}.c }}`, /* } */ d: 1 } tail", 0) === "{ a: '}', b: `${ {c:1}.c }}`, /* } */ d: 1 }".length - 1);
t('splitTop: commas inside brackets and strings stay', same(tool.splitTop("a: 1, b: [1, 2], c: f(x, y), d: 'p,q'"), ['a: 1', 'b: [1, 2]', 'c: f(x, y)', "d: 'p,q'"]));
const node = literal("{ ok: true, 'quoted-key': 1, shorthand, nested: { a: 1, ...more }, list: rows.map((r) => ({ id: r.id, name: r.name })) }");
t('nodeOf: a literal names its keys, shorthand included, with a nested literal and an opaque list', node.kind === 'object' && same([...node.keys.keys()], ['ok', 'quoted-key', 'shorthand', 'nested', 'list']) && node.keys.get('nested').spread === true && same([...node.keys.get('list').tokens].sort(), ['id', 'name']));
const text = "router.get('/a', (req, res) => {\n  if (!x) return res.status(404).json({ error: 'no' });\n  res.json({ ok: true, a: 1 });\n});\nrouter.post('/b', (req, res) => {\n  res.status(201).json({ made: true });\n  res.json(row);\n});\n";
const lines = text.split('\n');
t('handlerAnswers: only the success answers of the route, branches merged, a refusal ignored', same([...tool.handlerAnswers(tool.handlerText(lines, 1)).node.keys.keys()], ['ok', 'a']) && tool.handlerAnswers(tool.handlerText(lines, 1)).calls === 1);
t('handlerAnswers: a status of 201 counts; a second branch that passes a name through makes the node opaque', tool.handlerAnswers(tool.handlerText(lines, 5)).node.kind === 'opaque');

/* ── deriveShape ── */
const seen = [{ ok: true, n: 1, tags: ['a'], note: null, who: { name: 'x' } }, { ok: false, n: 2, tags: [], note: 'hi', who: { name: 'y', extra: 1 }, only_sometimes: 1 }];
const derived = derive(seen, null);
t('derive: a recorded object closes over the keys seen, required = seen every time', derived.schema.additionalProperties === false && same(derived.schema.required, ['ok', 'n', 'tags', 'note', 'who']) && !derived.open.length);
t('derive: types follow the values; null widens a type; a nested object is closed over every key any answer had', derived.schema.properties.n.type === 'number' && same(derived.schema.properties.note.type, ['string', 'null']) && same(Object.keys(derived.schema.properties.who.properties), ['name', 'extra']) && derived.schema.properties.who.additionalProperties === false);
t('derive: a list item is closed over its elements', derive([{ rows: [{ a: 1 }, { a: 2, b: 3 }] }]).schema.properties.rows.items.additionalProperties === false);
t('derive: a key only the handler\'s literal names (never seen) is in the schema, not required', (() => { const out = derive([{ ok: true }], literal('{ ok: true, maybe: x }')); return 'maybe' in out.schema.properties && !out.schema.required.includes('maybe'); })());
t('derive: a spread leaves the node OPEN and says why', (() => { const out = derive([{ ok: true, a: 1 }], literal('{ ok: true, ...row }')); return out.schema.additionalProperties === undefined && out.open.length === 1 && /spread/.test(out.open[0].why); })());
t('derive: a row passed through leaves its node open (listed), the parent stays closed', (() => { const out = derive([{ ok: true, data: [{ id: 1 }] }], literal('{ ok: true, data: rows }')); return out.schema.additionalProperties === false && out.schema.properties.data.items.additionalProperties === undefined && out.open[0].path === 'data[]'; })());
t('derive: a list made by a map literal is closed over the literal\'s keys', (() => { const out = derive([{ list: [] }], literal('{ list: rows.map((r) => ({ id: r.id, name: r.name })) }')); return !out.open.length && out.schema.properties.list.type === undefined; })());
t('derive: a map keyed by data (ids, dates) is open, not a record', (() => { const keys = {}; for (let at = 0; at < 6; at++) keys['2026-10-0' + (at + 1)] = at; return derive([{ by_day: keys }], literal('{ by_day: tally({ total: 1 }) }')).open.some((item) => /keyed by data/.test(item.why)); })());

/* ── the property that makes it safe ── */
const samples = [{ ok: true, d: { a: 1, list: [{ x: 1, y: [1, 2] }] } }, { ok: true, d: { a: 2, list: [] }, extra: 'e' }, { ok: false, d: { a: 3, list: [{ x: 2, z: null }] } }];
const everything = derive(samples, null).schema;
t('identity: the shape derived from answers keeps every one of them, key for key and in order', samples.every((one) => allow.prune(everything, one).dropped.length === 0 && JSON.stringify(allow.prune(everything, one).value) === JSON.stringify(one)));
t('negative control: a key no answer had is dropped and named', same(allow.prune(everything, { ok: true, d: { a: 1, list: [] }, leaked_column: 1 }).dropped, ['leaked_column']));

/* ── the capture check and the kit ── */
t('checkCaptures: a recorded answer that fits its committed shape loses nothing', tool.checkCaptures([{ 'GET /api/assist/whoami|x': { route: 'GET /api/assist/whoami', status: 200, body: { ok: true, is_helpdesk: false, actions: { publish: { ok: false } } } } }]).length === 0);
t('checkCaptures: a recorded answer with a key the shape lacks is named', tool.checkCaptures([{ 'GET /api/assist/whoami|x': { route: 'GET /api/assist/whoami', status: 200, body: { ok: true, is_helpdesk: false, actions: {}, canary: 1 } } }]).some((line) => /canary/.test(line)));
const contract = require(path.join(API, 'lib', 'assist-contract.js'));
const whoami = contract.operationFor('GET /whoami');
t('kit: a route with a derived shape answers under that closed schema, and its checked() chain holds the filter', whoami.responses[200].content['application/json'].schema.additionalProperties === false && contract.checked('GET /whoami').some((fn) => fn && fn.outputAllowlist));
t('kit: a route with no derived shape keeps the row\'s own `out` and gets no filter', contract.operationFor('POST /conform').responses[200].content['application/json'].schema.additionalProperties === undefined && !contract.checked('POST /conform').some((fn) => fn && fn.outputAllowlist));

console.log('\n  ' + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
