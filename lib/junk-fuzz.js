'use strict';
/*
 * OWNS      the pure half of register column 17 (junk_fuzz, OWASP API4/API8 input handling): the fixed, seeded junk set built from a route's own input schema, and the verdict on one answer.
 * CALLED BY tools/junk-fuzz.cjs (the live run on a SIT box) · tests/junk-fuzz.test.cjs
 * FLOW      route { key, method, path, params, body{properties,required}, query, writes } + seed ──▶ casesOf() → [{ id, kind, path, query, body|raw }] ──▶ (sent as each seat) ──▶ verdictOf(answer) → null | { kind, detail }
 * CARD      28-platform-and-operations/api-standard
 *
 * No clock and no Math.random: the same route and the same seed give the same cases, byte for byte, so a failing case can be sent again.
 * A route PASSES when no case of any seat gets: a 5xx · a timeout · stack or exception text in the body · a refusal (4xx) that is not the Problem shape with a registered code · (the driver adds) a row written by a refused call.
 * A 429 is VOID, not a pass and not a fail: the limiter answered, the route was not reached.
 */
const STACK_TEXT = [
  /\n\s+at\s+\S+.*:\d+:\d+/,
  /\bat\s+(?:async\s+)?[\w.$<>]+\s+\((?:\/|[A-Za-z]:\\|node:|file:)/,
  /node_modules/,
  /(?:^|[\s("'])\/(?:app|usr|home|srv|opt)\/[\w./-]+\.(?:c?js|mjs)/,
  /\b[\w-]+\.(?:c?js|mjs):\d+(?::\d+)?\b/,
  /\b(?:TypeError|ReferenceError|RangeError|SyntaxError|EvalError|URIError|AggregateError):\s/,
  /\bSQLSTATE\b|\bpg_[a-z_]+\b|relation "[^"]+" does not exist|syntax error at or near|invalid input syntax for|violates (?:not-null|foreign key|unique|check) constraint|duplicate key value|column "[^"]+" (?:of relation|does not exist)|null value in column|invalid byte sequence|unterminated quoted string/i,
  /\bECONN(?:REFUSED|RESET)\b|\bENOTFOUND\b|\bETIMEDOUT\b|\bEAI_AGAIN\b/,
  /Unexpected token\b.*\bJSON\b|Unexpected end of JSON|JSON at position/i,
  /Cannot read propert(?:y|ies) of|is not a function|is not defined|is not iterable|Cannot destructure|\[object Object\]/,
  /<!DOCTYPE|<html|<pre>/i
];
/** the first piece of stack or exception text in an answer body, or null */
const rawTextIn = (text) => {
  for (const pattern of STACK_TEXT) {
    const found = pattern.exec(text || '');
    if (found) return found[0].trim().slice(0, 80);
  }
  return null;
};

/** mulberry32: a small seeded generator (a 32-bit state), never the clock */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
/** a 32-bit hash of a text (FNV-1a) */
const hashOf = (text) => {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
  return hash;
};

const SQL = "'; DROP TABLE identities; -- ' OR '1'='1";
const SCRIPT = '<script>alert(1)</script>${7*7}{{constructor.constructor("return 1")()}}$(id)`id`';
const RTL = '‮evil‭ ‏العربية 💩🏳️‍🌈 \u0000 ￿';
const HUGE = 'A'.repeat(120000);
const NOT_AN_ID = ['not-an-id', '..%2F..%2Fetc%2Fpasswd', '%00', encodeURIComponent("' OR 1=1--"), 'x'.repeat(3000), '-1', 'NaN', encodeURIComponent('‮ال💩'), '0', '9'.repeat(40), '%', '.'];
const TEXT_JUNK = [SQL, SCRIPT, RTL, '', ' ', '\n\r\t', 'null', 'undefined', '0', '-1', '1e999', 'NaN', '__proto__'];
const WRONG_KIND = [123456, -1, 0, true, false, null, [], {}, [1, 2], { a: { b: 1 } }, 'x', 1.5];
const NUMBER_JUNK_RAW = ['-1', '-0', '1e999', '-1e999', '9007199254740993', '0.0000001', '1e-400'];
const FALLBACK_FIELDS = ['id', 'name', 'amount', 'qty', 'items', 'party_id', 'note', 'date', 'type', 'status'];
const BODY_METHODS = ['POST', 'PUT', 'PATCH'];

/** the deep value: n levels of nesting, alternating object and array */
const nested = (levels) => {
  let value = 'x';
  for (let at = 0; at < levels; at++) value = at % 2 ? [value] : { a: value };
  return value;
};
const rawNested = (levels) => '['.repeat(levels) + ']'.repeat(levels);

/** an object with every name set to a value */
const filledWith = (names, value) => Object.fromEntries(names.map((name) => [name, value]));

/** the fields to attack for a route: the schema's own property names (up to 6), else a generic set */
const fieldsOf = (route) => {
  const named = Object.keys((route.body && route.body.properties) || {});
  return (named.length ? named : FALLBACK_FIELDS).slice(0, 6);
};

/** the declared kind of a field, '' when the schema says nothing */
const kindOf = (route, name) => [].concat((((route.body && route.body.properties) || {})[name] || {}).type || '')[0] || '';

/** a value from the list that is NOT of the declared kind, picked by the seeded generator */
const wrongFor = (kind, random) => {
  const fits = (value) => (kind === 'string' ? typeof value === 'string' : kind === 'integer' || kind === 'number' ? typeof value === 'number' : kind === 'boolean' ? typeof value === 'boolean' : kind === 'array' ? Array.isArray(value) : kind === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : false);
  const options = WRONG_KIND.filter((value) => !fits(value));
  return options[Math.floor(random() * options.length)];
};

/** the path with every :param replaced by a value (an id-looking default; a junk value when given) */
const pathOf = (route, junk) => route.path.replace(/:(\w+)/g, (all, name) => (junk !== undefined ? junk : DEFAULT_PARAMS[name] || ZERO));
const ZERO = '00000000-0000-4000-8000-000000000001';
const DEFAULT_PARAMS = { account: '1000', fy: '2026', p: '1', act: 'lock', ref: 'x1', year: '2026', month: '1', page: '1', code: 'x1', name: 'x1' };

/**
 * the cases for one route, in a fixed order. A case is { id, kind, path, query?, body? , raw? }: `body` is sent as JSON, `raw` as the exact text (malformed JSON, a 2 MB depth bomb).
 * kinds: type · string · huge · unicode · number · depth · unknown_key · missing · shape · array · path · query
 */
function casesOf(route, seed) {
  const random = seeded((seed || 0) ^ hashOf(route.key));
  const hasBody = BODY_METHODS.includes(route.method);
  const fields = fieldsOf(route);
  const cases = [];
  const add = (id, kind, extra) => cases.push(Object.assign({ id, kind, path: pathOf(route) }, extra));

  if ((route.params || []).length) NOT_AN_ID.forEach((junk, at) => cases.push({ id: 'path:' + at, kind: 'path', path: pathOf(route, junk), body: hasBody ? {} : undefined }));

  const queryNames = (route.query || []).slice(0, 6);
  queryNames.forEach((name) => {
    ['-1', 'NaN', '1e999', '99999999999999999999', 'abc', encodeURIComponent(SQL), encodeURIComponent(RTL), 'x'.repeat(5000), '', '[]', '{}', '%00'].forEach((value, at) => add('query:' + name + ':' + at, 'query', { query: name + '=' + value, body: hasBody ? {} : undefined }));
    add('query:' + name + ':array', 'query', { query: name + '[]=1&' + name + '[]=2&' + name + '[a]=b', body: hasBody ? {} : undefined });
    add('query:' + name + ':repeat', 'query', { query: name + '=1&' + name + '=2&' + name + '=3', body: hasBody ? {} : undefined });
  });
  if (!queryNames.length) ['limit', 'page', 'q', 'sort'].forEach((name) => add('query:any:' + name, 'query', { query: name + '=-1&' + name + '=NaN&' + name + '=' + encodeURIComponent(SQL), body: hasBody ? {} : undefined }));

  if (!hasBody) return cases;

  fields.forEach((name) => {
    add('type:' + name, 'type', { body: { [name]: wrongFor(kindOf(route, name), random) } });
    add('string:' + name, 'string', { body: { [name]: TEXT_JUNK[Math.floor(random() * TEXT_JUNK.length)] } });
  });
  add('missing:all', 'missing', { body: {} });
  ((route.body && route.body.required) || []).slice(0, 3).forEach((name) => add('missing:' + name, 'missing', { body: Object.assign(filledWith(fields, 'x'), { [name]: undefined }) }));
  add('shape:array', 'shape', { body: [] });
  add('shape:string', 'shape', { raw: '"just a string"' });
  add('shape:null', 'shape', { raw: 'null' });
  add('shape:number', 'shape', { raw: '12345' });
  add('shape:truncated', 'shape', { raw: '{"a": [1, 2, {"b":' });
  add('shape:empty', 'shape', { raw: '' });
  add('huge:first', 'huge', { body: { [fields[0]]: HUGE } });
  add('huge:all', 'huge', { body: filledWith(fields, 'B'.repeat(20000)) });
  add('unicode:all', 'unicode', { body: filledWith(fields, RTL) });
  add('sql:all', 'string', { body: filledWith(fields, SQL) });
  add('script:all', 'string', { body: filledWith(fields, SCRIPT) });
  NUMBER_JUNK_RAW.forEach((number, at) => add('number:' + at, 'number', { raw: '{' + fields.map((name) => JSON.stringify(name) + ':' + number).join(',') + '}' }));
  add('number:nan-text', 'number', { body: filledWith(fields, 'NaN') });
  add('depth:200', 'depth', { body: { [fields[0]]: nested(200) } });
  add('depth:5000', 'depth', { raw: rawNested(5000) });
  add('unknown:proto', 'unknown_key', { raw: '{"__proto__":{"admin":true},"constructor":{"prototype":{"x":1}},"' + fields[0] + '":"x"}' });
  add('unknown:many', 'unknown_key', { body: Object.fromEntries(Array.from({ length: 150 }, (value, at) => ['k' + hashOf(route.key + at).toString(36), at])) });
  add('array:field', 'array', { body: { [fields[0]]: new Array(10000).fill(1) } });
  add('array:whole', 'array', { body: new Array(10000).fill({ a: 1 }) });
  add('array:items', 'array', { body: { items: new Array(5000).fill({ id: ZERO, qty: 1 }), lines: new Array(5000).fill({}) } });
  return cases;
}

/**
 * the verdict on one answer: null (good) or { kind, detail }.
 * answer = { status, text, body (parsed JSON or null), contentType, timedOut }; codes = Set of the registered error codes.
 * kinds: timeout · 5xx · raw_text · shape (a refusal that is not the Problem shape) · code (a code the register does not know) · void (429)
 */
function verdictOf(answer, codes) {
  if (answer.timedOut) return { kind: 'timeout', detail: 'no answer in time' };
  if (answer.status === 429) return { kind: 'void', detail: 'the limiter answered' };
  if (answer.status >= 500) return { kind: '5xx', detail: String(answer.status) + (answer.body && answer.body.code ? ' ' + answer.body.code : '') };
  const raw = rawTextIn(answer.text);
  if (raw) return { kind: 'raw_text', detail: raw };
  if (answer.status >= 400) {
    const body = answer.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { kind: 'shape', detail: answer.status + ' with a body that is not a JSON object' };
    if (body.status !== answer.status || typeof body.title !== 'string' || typeof body.type !== 'string') return { kind: 'shape', detail: answer.status + ' without type/title/status of the Problem shape' };
    if (typeof body.code !== 'string') return { kind: 'shape', detail: answer.status + ' with no code' };
    if (codes && !codes.has(body.code)) return { kind: 'code', detail: answer.status + ' code ' + body.code + ' is not in docs/error-codes.json' };
  }
  return null;
}

const isRefusal = (status) => status >= 400 && status < 500;

module.exports = { casesOf, verdictOf, rawTextIn, seeded, hashOf, isRefusal, NOT_AN_ID, ZERO, DEFAULT_PARAMS, BODY_METHODS };
