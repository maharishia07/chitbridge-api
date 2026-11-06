// @type: contract
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
const filterShape = { status: 200, observed: 2, schema };
const fakeRes = (status) => { const sent = []; const res = { statusCode: status, json: (value) => (sent.push(value), res) }; return { res, sent }; };
const run = (status, value, shape) => { const { res, sent } = fakeRes(status); allow.outputFilter(shape || filterShape, 'GET /x')({ method: 'GET' }, res, () => undefined); res.json(value); return sent[0]; };
process.env.OUTPUT_ALLOWLIST = 'enforce';
allow.forgetDropped();
t('filter (enforce): a 2xx answer is pruned and the drop is counted with its route', same(run(200, body), cut.value) && allow.droppedKeys().length === 2 && allow.droppedKeys()[0].route === 'GET /x' && allow.droppedCount() === 2);
t('filter: a refusal (4xx) is never touched', (() => { const problem = { type: 't', extra: 1 }; return run(422, problem) === problem; })());
delete process.env.OUTPUT_ALLOWLIST;
allow.forgetDropped();
t('filter (report, the default): the key goes through unchanged and is counted', run(200, body) === body && allow.droppedCount() === 2);
process.env.OUTPUT_ALLOWLIST = 'enforce';
t('filter: the counter is bounded per route (paths) and in total (routes)', (() => { allow.forgetDropped(); for (let at = 0; at < 50; at++) run(200, { ok: true, ['k' + at]: 1 }); const out = allow.droppedKeys(); return allow.droppedCount() === 50 && out.length === 20; })());
t('filter: a shape with observed 0, no shape, or one that closes nothing gets no filter', allow.outputFilter({ status: 200, observed: 0, schema }) === null && allow.outputFilter(null) === null && allow.outputFilter({ status: 200, observed: 3, schema: { type: 'object', properties: {} } }) === null);
t('filter: a schema that closes only a nested node still gets one', allow.outputFilter({ status: 200, observed: 1, schema: { type: 'object', properties: { a: closed({ b: {} }) } } }) !== null);
t('shapeOf: a route whose shape has observed 0 reads as no shape', (() => { const file = allow.shapesFile(); file.routes['GET /nothing'] = { status: 200, observed: 0, schema }; const none = allow.shapeOf('GET /nothing'); delete file.routes['GET /nothing']; return none === null; })());
t('samplesOf: the same scenario in BASE and NEW counts once', (() => { const one = { route: 'GET /r', status: 200, body: { a: 1 } }; return tool.samplesOf([{ 'GET /r|s1': one, 'GET /r|s2': one }, { 'GET /r|s1': one }], 'GET /r')[200].length === 2; })());

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
t('derive: a spread leaves the node OPEN and says why', (() => { const out = derive([{ ok: true, a: 1 }], literal('{ ok: true, ...row }')); return out.schema.additionalProperties === undefined && out.open.length === 1 && /spread/.test(out.open[0].reason); })());
t('derive: a row passed through leaves its node open (listed), the parent stays closed', (() => { const out = derive([{ ok: true, data: [{ id: 1 }] }], literal('{ ok: true, data: rows }')); return out.schema.additionalProperties === false && out.schema.properties.data.items.additionalProperties === undefined && out.open[0].path === 'data[]'; })());
t('derive: a list made by a map literal is closed over the literal\'s keys', (() => { const out = derive([{ list: [] }], literal('{ list: rows.map((r) => ({ id: r.id, name: r.name })) }')); return !out.open.length && out.schema.properties.list.type === undefined; })());
t('derive: a map keyed by data (ids, dates) is open, not a record', (() => { const keys = {}; for (let at = 0; at < 6; at++) keys['2026-10-0' + (at + 1)] = at; return derive([{ by_day: keys }], literal('{ by_day: tally({ total: 1 }) }')).open.some((item) => /keyed by data/.test(item.reason)); })());

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
t('kit: a route with no derived shape keeps the row\'s own `out` and gets no filter', contract.operationFor('POST /resolve').responses[200].content['application/json'].schema.additionalProperties === undefined && !contract.checked('POST /resolve').some((fn) => fn && fn.outputAllowlist));

/* ── closed from recordings only (a route answered by a shared wrapper): reported, never enforced ── */
const wrapped = tool.deriveShape({ samples: [{ ok: true, entry_id: 'e1', lines: [{ code: '1', dr: 1 }] }, { ok: true, duplicate: true, entry_id: 'e1' }], source: null, recordings: true });
t('recordings: with no handler literal and recorded objects, the node closes over the recorded keys and says so', wrapped.schema.additionalProperties === false && wrapped.schema['x-closed-by'] === 'recordings' && same(Object.keys(wrapped.schema.properties), ['ok', 'entry_id', 'lines', 'duplicate']) && !wrapped.open.length);
t('recordings: the nested list items are closed from recordings too', wrapped.schema.properties.lines.items['x-closed-by'] === 'recordings');
t('recordings: the same samples without the flag stay OPEN and are listed (the literal rule is unchanged)', (() => { const out = tool.deriveShape({ samples: [{ ok: true }], source: null }); return out.schema.additionalProperties === undefined && out.open.length === 1; })());
t('recordings: a handler literal closes by the handler, never marked', (() => { const out = tool.deriveShape({ samples: [{ ok: true }], source: literal('{ ok: true }'), recordings: true }); return out.schema.additionalProperties === false && out.schema['x-closed-by'] === undefined; })());
const unproven = allow.prune(wrapped.schema, { ok: true, entry_id: 'e1', brand_new_key: 1, lines: [{ code: '1', dr: 1, other: 2 }] });
t('prune: a key outside a recordings-closed node is listed as dropped AND kept in the value (never enforced)', same(unproven.dropped.slice().sort(), ['brand_new_key', 'lines.[].other']) && same(unproven.kept.slice().sort(), ['brand_new_key', 'lines.[].other']) && unproven.value.brand_new_key === 1 && unproven.value.lines[0].other === 2);
t('prune: a key outside a node closed by the handler is still dropped and not in kept', (() => { const out = allow.prune(schema, body); return out.kept.length === 0 && out.value.canary === undefined; })());
allow.forgetDropped();
t('filter (enforce): a recordings-closed answer keeps its new key, and the drop is still counted and named', (() => { const out = run(200, { ok: true, brand_new_key: 1 }, { status: 200, observed: 2, schema: wrapped.schema }); return out.brand_new_key === 1 && allow.droppedCount() === 1 && allow.droppedKeys()[0].path === 'brand_new_key'; })());
allow.forgetDropped();
const wrapperText = ["router.get('/assets', auth, async (req, res) => { res.json({ a: 1 }); });", "route('post', '/assets', (req, e) => P().addAsset(e));", "route('post', '/assets/:id/dispose', (req, e) => P().disposeAsset(e));"];
t('wrapperLineOf: a route( registration is found by method and by the path the key ends with, exactly', tool.wrapperLineOf(wrapperText, { key: 'POST /api/books/assets' }) === 2 && tool.wrapperLineOf(wrapperText, { key: 'POST /api/books/assets/:id/dispose' }) === 3 && tool.wrapperLineOf(wrapperText, { key: 'GET /api/books/assets' }) === 0);
t('shapeEntry: a route( wrapper route closes from its recordings and says closed_by recordings; a router.get route with a literal does not', (() => {
  const samples = { 200: [{ ok: true, entry_id: 'e1' }] };
  const wrapped = tool.shapeEntry({ key: 'POST /api/books/assets', line: 0 }, { byStatus: samples, lines: wrapperText, captures: [] });
  const literal = tool.shapeEntry({ key: 'GET /api/books/assets', line: 1 }, { byStatus: samples, lines: wrapperText, captures: [] });
  return wrapped.closed_by === 'recordings' && wrapped.schema.additionalProperties === false && !wrapped.open.length && literal.closed_by === undefined;
})());
t('register: a passing output_allowlist whose evidence says basis recordings is marked on its row; nothing else is', (() => { const reg = require(path.join(API, 'tools', 'api-register.cjs')); return same(reg.basisOf({ output_allowlist: true }, { output_allowlist: true, output_allowlist_basis: 'recordings' }), { output_allowlist_basis: 'recordings' }) && same(reg.basisOf({ output_allowlist: true }, { output_allowlist: true }), {}) && same(reg.basisOf({ output_allowlist: false }, { output_allowlist_basis: 'recordings' }), {}); })());

t('deriveShape: identifiers a passed-through value happens to name (a shorthand key, a call argument) are NOT keys; only keys a recorded answer held are', (() => {
  const source = literal('Object.assign(view, pageOut(rows, { owner: isOwner(req), PAGE_DEFAULT }))');
  const shape = tool.deriveShape({ samples: [{ people: [{ id: 1 }], total: 1 }], source });
  const names = Object.keys(shape.schema.properties);
  return same(names, ['people', 'total']) && !names.includes('owner') && !names.includes('PAGE_DEFAULT') && shape.schema['x-closed-by'] === 'recordings';
})());
t('deriveShape: a passed-through value whose answers held no key stays open instead of taking its names as keys', (() => {
  const shape = tool.deriveShape({ samples: [{}], source: literal('rows.map((r) => ({ a: 1 }))') });
  return shape.open.length === 1 && shape.schema.additionalProperties === undefined;
})());
t('fromRecordings: a handler that hands its answer on (a library call, a spread) closes over the recorded keys, marked, only when asked', (() => {
  const text = ["router.get('/a', auth, async (req, res) => { res.json(await lib.listThings(req.query)); });", "router.get('/b', auth, async (req, res) => { res.json({ ...await lib.one(), extra: 1 }); });"];
  const samples = { 200: [{ rows: [{ id: 1 }], total: 1 }] };
  const asked = tool.shapeEntry({ key: 'GET /api/a', line: 1 }, { byStatus: samples, lines: text, captures: [], fromRecordings: true });
  const spread = tool.shapeEntry({ key: 'GET /api/b', line: 2 }, { byStatus: { 200: [{ a: 1 }] }, lines: text, captures: [], fromRecordings: true });
  const plain = tool.shapeEntry({ key: 'GET /api/a', line: 1 }, { byStatus: samples, lines: text, captures: [] });
  return asked.closed_by === 'recordings' && asked.schema.additionalProperties === false && asked.schema.properties.rows.items['x-closed-by'] === 'recordings' && !asked.open.length
    && same(Object.keys(spread.schema.properties).sort(), ['a', 'extra']) && spread.schema['x-closed-by'] === 'recordings' && plain.open.length === 1 && plain.closed_by === undefined;
})());
t('mergeShapeFile: a run keeps every other route in its place and puts a new route just before the first key that sorts after it (no whole-file re-sort, so parallel area runs do not collide)', (() => {
  const file = { _about: 'x', routes: { 'GET /b': { v: 1 }, 'GET /a': { v: 1 }, 'GET /z': { v: 1 } }, listed: {} };
  const out = tool.mergeShapeFile(file, { shapes: { 'GET /c': { v: 2 }, 'GET /a': { v: 3 } }, listed: {} });
  return same(Object.keys(out.routes), ['GET /b', 'GET /a', 'GET /c', 'GET /z']) && out.routes['GET /a'].v === 3;
})());
t('register: a route whose success schema holds an x-closed-by recordings node carries the basis whichever test proved it; a literal-closed one does not', (() => {
  const reg = require(path.join(API, 'tools', 'api-register.cjs'));
  const of = (schema) => ({ responses: { 200: { content: { 'application/json': { schema } } } } });
  const marked = of({ type: 'object', additionalProperties: false, properties: { rows: { type: 'array', items: { type: 'object', additionalProperties: false, 'x-closed-by': 'recordings' } } } });
  const literal = of({ type: 'object', additionalProperties: false, properties: {} });
  return same(reg.basisOf({ output_allowlist: true }, {}, marked), { output_allowlist_basis: 'recordings' }) && same(reg.basisOf({ output_allowlist: true }, {}, literal), {}) && same(reg.basisOf({ output_allowlist: false }, {}, marked), {});
})());

console.log('\n  ' + (pass + fail) + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
