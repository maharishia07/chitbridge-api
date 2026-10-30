'use strict';
// @type: unit
/**
 * tests/rail-r11-connector-frozen.test.cjs — RULE-MATRIX p15 (R11 "a frozen chit is never rewritten", connector column), proven instead of read.
 *
 * OWNS      the proof that the connector side never rewrites a chit:
 *           (a) the two integration writes — POST /api/integrations/books (routes/integrations.js, the kit's write-back, books + books_log)
 *               and POST /api/integrations/books/skip (the owner's "not for the books", books_skip) — leave every chit field other than
 *               those riders byte-identical: the header columns, the seal, summary_json, business_json minus the riders, the lines,
 *               the status row, a sibling chit and the counterparty's copy of the same chit;
 *           (b) tools/tally-connector/core.js (and whatever it requires inside tools/tally-connector) never calls a chit writer —
 *               statically (every ChitBridge call it can make, every SQL text, every module it loads) and once for real, with fetch
 *               recorded, through catchUp (order + receipt), syncPurchases (purchase), a failed push and a cancelled order.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/integrations.js over the route-golden stand-ins
 *           (tests/support/route-golden.cjs); the db stand-in HOLDS the chit rows and applies each statement the route sends,
 *           failing closed on an expression it cannot read.
 * FLOW      chit rows → snapshot → real route → statements applied to the rows → snapshot → riders stripped → byte compare
 *           core.js source → call sites · SQL · requires → rules;  core.js run → every request recorded → only GETs to /api/chits
 * CARD      23-connectors-and-integrations/README
 *
 * Run: node tests/rail-r11-connector-frozen.test.cjs
 *      R11_CONNECTOR_CORE=tools/tally-connector/<copy>.js node tests/rail-r11-connector-frozen.test.cjs   (the mutation run on a copy)
 */
const assert = require('assert'),
  fs = require('fs'),
  os = require('os'),
  path = require('path');
const G = require('./support/route-golden.cjs');
const { blank } = require('./support/js-scan.cjs');
const API = G.API;

const SHOP = '11111111-1111-4111-8111-111111111111',
  BUYER = '22222222-2222-4222-8222-222222222222',
  ACTOR = '55555555-5555-4555-8555-555555555555';
const CHIT = '77777777-7777-4777-8777-777777777777',
  SIBLING = '77777777-7777-4777-8777-777777777778',
  MISSING = '99999999-9999-4999-8999-999999999999';
const RIDERS = ['books', 'books_log', 'books_skip'];
const clone = (value) => JSON.parse(JSON.stringify(value));

/* ── the chit as stored: a sealed, frozen order on the shop's copy, the buyer's copy of the same chit, and a sibling order ── */
function headerRow(chitId, entityId, direction) {
  return {
    chit_id: chitId, entity_id: entityId, direction, purpose: 'order', auto_subject: 'Order · Rice 2 bags', manual_subject: 'Diwali stock',
    created_at: '2026-10-20T09:00:00.000Z', all_recipients: [{ role: 'sender', display_name: 'Kumar Stores' }, { role: 'receiver', display_name: 'Mayur Traders' }],
    seal_hash: 'sha256:5f1c0a9e', sealed_at: '2026-10-20T09:00:01.000Z', frozen_at: '2026-10-21T11:30:00.000Z',
    summary_json: { total_value: 1050, money: { taxable: 1000, cgst: 25, sgst: 25, total: 1050 } },
    business_json: {
      customer: { name: 'Kumar Stores', gstin: '29ABCDE1234F1Z5' },
      invoice: { frozen_at: '2026-10-21T11:30:00.000Z', no: 'INV-0042', heads: { taxable: 1000, total: 1050 } },
      payment: { at: '2026-10-22T10:00:00.000Z', method: 'upi', ref: 'UPI-881', amount: 1050 },
      books_request: true
    }
  };
}
function freshWorld() {
  const line = (chitId, entityId, lineId) => ({ chit_id: chitId, entity_id: entityId, line_id: lineId, name: 'Rice 25 kg', quantity: 2, price: 500, total: 1000,
    item_data: { item_id: 'I-RICE', hsn: '1006', gst_rate: 5 } });
  return {
    chit_header: [headerRow(CHIT, SHOP, 'received'), headerRow(CHIT, BUYER, 'sent'), headerRow(SIBLING, SHOP, 'received')],
    chit_lines: [line(CHIT, SHOP, 'L1'), line(CHIT, BUYER, 'L1'), line(SIBLING, SHOP, 'L1')],
    chit_status: [{ chit_id: CHIT, entity_id: SHOP, direction: 'received', current_status: 'accepted', updated_at: '2026-10-21T11:00:00.000Z' }],
    chit_writes_elsewhere: []
  };
}

/* ── the stand-in that holds the rows: enough of Postgres's jsonb to apply the statements the route sends, and no more ── */
function unwrap(text) {
  const trimmed = text.trim();
  if (trimmed[0] !== '(' || trimmed[trimmed.length - 1] !== ')') return trimmed;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index++) {
    if (trimmed[index] === '(') depth++;
    if (trimmed[index] === ')') depth--;
    if (depth === 0 && index < trimmed.length - 1) return trimmed;
  }
  return trimmed.slice(1, -1).trim();
}
/** an expression split on a separator outside parentheses and quotes */
function splitTop(text, separator) {
  const parts = [];
  let depth = 0, quoted = false, start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "'") quoted = !quoted;
    else if (!quoted && char === '(') depth++;
    else if (!quoted && char === ')') depth--;
    else if (!quoted && depth === 0 && text.startsWith(separator, index)) {
      parts.push(text.slice(start, index).trim());
      start = index + separator.length;
      index += separator.length - 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}
function concatJson(left, right) {
  if (Array.isArray(left)) return left.concat(Array.isArray(right) ? right : [right]);
  return Object.assign({}, left, right);
}
function scalarOf(atom, params) {
  const param = /^\$(\d+)::text$/.exec(atom), literal = /^'([^']*)'$/.exec(atom);
  if (param) return String(params[Number(param[1]) - 1]);
  if (literal) return literal[1];
  throw new Error('the stand-in cannot read the key ' + atom);
}
function atomOf(atom, doc, params) {
  const whole = /^COALESCE\(business_json\s*,\s*'\{\}'::jsonb\)$/.exec(atom);
  const field = /^COALESCE\(business_json->'(\w+)'\s*,\s*'(\{\}|\[\])'::jsonb\)$/.exec(atom);
  const object = /^jsonb_build_object\(([\s\S]*)\)$/.exec(atom), array = /^jsonb_build_array\(([\s\S]*)\)$/.exec(atom);
  const param = /^\$(\d+)::jsonb$/.exec(atom);
  if (whole) return clone(doc);
  if (field) return clone(doc[field[1]] !== undefined ? doc[field[1]] : JSON.parse(field[2]));
  if (param) return JSON.parse(params[Number(param[1]) - 1]);
  if (array) return splitTop(array[1], ',').map((item) => jsonOf(item, doc, params));
  if (object) {
    const args = splitTop(object[1], ','), out = {};
    for (let index = 0; index < args.length; index += 2) out[scalarOf(args[index], params)] = jsonOf(args[index + 1], doc, params);
    return out;
  }
  throw new Error('the stand-in cannot read ' + atom);
}
/** a jsonb expression over the row's business_json: a || b || c, each term an atom minus quoted keys */
function jsonOf(expression, doc, params) {
  return splitTop(unwrap(expression), '||').map((term) => {
    const [first, ...removed] = splitTop(unwrap(term), ' - ');
    const value = atomOf(unwrap(first), doc, params);
    for (const key of removed) delete value[scalarOf(key, params)];
    return value;
  }).reduce(concatJson);
}
function applyUpdate(world, sql, params) {
  const parsed = /^UPDATE (\w+) SET (.+?) WHERE (.+?)(?: RETURNING (.+))?$/i.exec(sql);
  if (!parsed) throw new Error('the stand-in cannot read ' + sql);
  const [, table, setClause, where, returning] = parsed;
  if (table !== 'chit_header') return recordElsewhere(world, sql);
  const conditions = [...where.matchAll(/(\w+)\s*=\s*\$(\d+)/g)].map((m) => [m[1], params[Number(m[2]) - 1]]);
  const rows = world.chit_header.filter((row) => conditions.every(([column, value]) => row[column] === value));
  for (const row of rows) {
    for (const assignment of splitTop(setClause, ',')) {
      const at = assignment.indexOf('='), column = assignment.slice(0, at).trim(), expression = assignment.slice(at + 1);
      row[column] = column === 'business_json' ? jsonOf(expression, row.business_json || {}, params) : { set_by: expression.trim() };
    }
  }
  return returning ? rows.map((row) => ({ chit_id: row.chit_id })) : [];
}
function recordElsewhere(world, sql) {
  if (/\bchit_\w+/.test(sql)) world.chit_writes_elsewhere.push(sql);
  return [];
}
function applyStatement(world, sql, params) {
  if (/^UPDATE\b/i.test(sql)) return applyUpdate(world, sql, params);
  if (/^(INSERT|DELETE)\b/i.test(sql)) return recordElsewhere(world, sql);
  return [];
}

/* ── the real route over the stand-ins ── */
let world = freshWorld();
const harness = G.harness({ rows: (sql, params) => applyStatement(world, sql, params) });
const app = harness.app('/api/integrations', require(path.join(API, 'routes', 'integrations')));
const CONNECTOR_KEY = { identity_id: ACTOR, identity_type: 'actor', parent_entity_id: SHOP, connector_type: 'tally', display_name: 'Tally on the shop PC' };
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Traders' };

/** the chits as the rule sees them: every field except the riders the connector side is allowed to write */
function withoutRiders(rows) {
  const copy = clone(rows);
  for (const row of copy.chit_header) for (const rider of RIDERS) delete row.business_json[rider];
  return copy;
}
const shopCopy = () => world.chit_header.find((row) => row.chit_id === CHIT && row.entity_id === SHOP);
const writesOf = (recording) => recording.calls.filter((call) => /^(UPDATE|INSERT|DELETE)\b/i.test(call.sql || ''));

/** one request; the chit before and after, riders stripped, must be byte-identical */
async function frozenAcross(request) {
  const before = withoutRiders(world);
  const recording = await harness.run(app, request);
  const after = withoutRiders(world);
  assert.strictEqual(JSON.stringify(after), JSON.stringify(before), 'a field outside the riders changed');
  assert.deepStrictEqual(after, before);
  return recording;
}

let passed = 0, failed = 0;
async function it(label, body) {
  try {
    await body();
    passed++;
    console.log('  ok    ' + label);
  } catch (error) {
    failed++;
    console.log('  FAIL  ' + label + '\n        ' + String((error && error.message) || error).split('\n').slice(0, 6).join('\n        '));
  }
}

async function routeChecks() {
  console.log('\nR11 (a) · the integration writes leave the chit as it was, riders aside');
  await it('POST /books (order, ok): the books + books_log riders land, every other field is byte-identical', async () => {
    const recording = await frozenAcross({ url: '/api/integrations/books', identity: CONNECTOR_KEY, body: { chit_id: CHIT, kind: 'order', system: 'tally', ref: 'V-101', outcome: 'ok' } });
    assert.strictEqual(recording.status, 200, JSON.stringify(recording.body));
    assert.strictEqual(shopCopy().business_json.books.order.ref, 'V-101');
    assert.strictEqual(shopCopy().business_json.books_log.length, 1);
  });
  await it('POST /books (receipt, failed): a second kind merges into books and books_log grows; nothing else moves', async () => {
    await frozenAcross({ url: '/api/integrations/books', identity: CONNECTOR_KEY, body: { chit_id: CHIT, kind: 'receipt', system: 'tally', outcome: 'failed', why: 'Tally closed' } });
    const books = shopCopy().business_json.books;
    assert.deepStrictEqual([books.order.ref, books.receipt.outcome, shopCopy().business_json.books_log.length], ['V-101', 'failed', 2]);
  });
  await it('POST /books (purchase): the third kind, same rule', async () => {
    await frozenAcross({ url: '/api/integrations/books', identity: CONNECTOR_KEY, body: { chit_id: CHIT, kind: 'purchase', system: 'tally', ref: 'P-7', outcome: 'ok' } });
    assert.strictEqual(shopCopy().business_json.books.purchase.ref, 'P-7');
  });
  await it('POST /books/skip on: books_skip lands with who and why; every other field is byte-identical', async () => {
    const recording = await frozenAcross({ url: '/api/integrations/books/skip', identity: OWNER, body: { chit_id: CHIT, on: true, why: 'settled outside' } });
    assert.strictEqual(recording.status, 200, JSON.stringify(recording.body));
    assert.deepStrictEqual([shopCopy().business_json.books_skip.by, shopCopy().business_json.books_skip.why], [SHOP, 'settled outside']);
  });
  await it('POST /books/skip off: books_skip is lifted; every other field is byte-identical', async () => {
    await frozenAcross({ url: '/api/integrations/books/skip', identity: OWNER, body: { chit_id: CHIT, on: false } });
    assert.ok(!('books_skip' in shopCopy().business_json));
  });
  await it('an unknown chit is a 404 and changes nothing at all, riders included', async () => {
    const before = JSON.stringify(world);
    const recording = await harness.run(app, { url: '/api/integrations/books', identity: CONNECTOR_KEY, body: { chit_id: MISSING, kind: 'order', outcome: 'ok' } });
    assert.deepStrictEqual([recording.status, JSON.stringify(world) === before], [404, true]);
  });
  await it('the buyer\'s copy of the same chit and the sibling order carry no rider: only the shop\'s own copy was written', () => {
    const others = world.chit_header.filter((row) => row !== shopCopy());
    assert.deepStrictEqual(others.map((row) => RIDERS.filter((rider) => rider in row.business_json)), [[], []]);
  });
  await it('every write either route sent is an UPDATE of chit_header that sets business_json alone, and no other chit_* table was touched', async () => {
    const order = await harness.run(app, { url: '/api/integrations/books', identity: CONNECTOR_KEY, body: { chit_id: CHIT, kind: 'order', outcome: 'ok', ref: 'V-102' } });
    const skip = await harness.run(app, { url: '/api/integrations/books/skip', identity: OWNER, body: { chit_id: CHIT, on: true } });
    const writes = writesOf(order).concat(writesOf(skip));
    assert.strictEqual(writes.length, 3, 'books + books_log + books_skip');
    for (const call of writes) {
      const parsed = /^UPDATE (\w+) SET (.+?) WHERE /i.exec(call.sql);
      const columns = parsed ? splitTop(parsed[2], ',').map((assignment) => assignment.slice(0, assignment.indexOf('=')).trim()) : [];
      assert.deepStrictEqual([parsed && parsed[1], columns], ['chit_header', ['business_json']], call.sql);
    }
    assert.deepStrictEqual(world.chit_writes_elsewhere, []);
  });
}

/* ── (b) the connector core: what it can call, and what it does call ── */
const CONNECTOR_DIR = path.join(API, 'tools', 'tally-connector');
const CORE_FILE = path.resolve(API, process.env.R11_CONNECTOR_CORE || path.join('tools', 'tally-connector', 'core.js'));
/** the ChitBridge writes the connector may make — none of them is a chit; /api/integrations/books is the rider (a) proves */
const ALLOWED_WRITES = ['/api/integrations/books', '/api/integrations/heartbeat', '/api/integrations/profile', '/api/products/bulk', '/api/products/',
  '/api/products/availability/bulk', '/api/offers/explain', '/api/events/ticket'];
const ALLOWED_MODULES = ['fs', 'path', 'crypto', 'os', '../../lib/units'];
const CHIT_WRITER = /\/api\/chits[^'"`]*\/(send|status|deliver-lines|messages|amend|seal|lines)\b|\/api\/chits\/(send|draft)\b/;

/** core.js and every file it requires inside tools/tally-connector, read once */
function connectorSources() {
  const seen = new Map(), queue = [CORE_FILE];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    seen.set(file, source);
    for (const match of source.matchAll(/require\(\s*'(\.\/[^']+)'\s*\)/g)) queue.push(require.resolve(path.resolve(path.dirname(file), match[1])));
  }
  return seen;
}
/** every live call site (not a comment, not a string) of a pattern whose first character is code */
function liveMatches(source, pattern) {
  const code = blank(source);
  return [...source.matchAll(pattern)].filter((match) => code[match.index + match[0].search(/\w/)] !== ' ');
}

async function staticChecks() {
  const sources = connectorSources();
  console.log('\nR11 (b) · the connector core never calls a chit writer — ' + [...sources.keys()].map((file) => path.relative(API, file)).join(', '));
  await it('every file the core loads stays inside tools/tally-connector, and the core loads no db, route or chit module', () => {
    for (const file of sources.keys()) assert.ok(file.startsWith(CONNECTOR_DIR), file);
    for (const source of sources.values()) {
      const modules = liveMatches(source, /require\(\s*'([^']+)'\s*\)/g).map((match) => match[1]).filter((name) => !name.startsWith('./'));
      assert.deepStrictEqual(modules.filter((name) => !ALLOWED_MODULES.includes(name)), []);
    }
  });
  await it('every ChitBridge call names its method and path as literals, so the scan reads all of them', () => {
    for (const [file, source] of sources) {
      const all = liveMatches(source, /\.call\(/g).length, read = liveMatches(source, /\.call\(\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*'([^']*)'/g).length;
      assert.ok(read > 0 || file !== CORE_FILE, 'the scan read no call in the core');
      assert.strictEqual(read, all, 'a .call( whose method or path is not a literal');
    }
  });
  await it('every call to /api/chits is a GET, and every non-GET goes to an allowed non-chit endpoint', () => {
    for (const source of sources.values()) {
      for (const [, method, url] of liveMatches(source, /\.call\(\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*'([^']*)'/g)) {
        if (url.startsWith('/api/chits')) assert.strictEqual(method, 'GET', method + ' ' + url);
        if (method !== 'GET') assert.ok(ALLOWED_WRITES.includes(url), 'a write the rule has not seen: ' + method + ' ' + url);
      }
    }
  });
  await it('no chit writer path (send · status · deliver-lines · messages · amend · seal · lines) and no SQL write on a chit_* table appears anywhere', () => {
    for (const source of sources.values()) {
      assert.ok(!CHIT_WRITER.test(source), (CHIT_WRITER.exec(source) || [])[0]);
      assert.ok(!/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+chit_\w+/i.test(source), 'SQL on a chit table');
    }
  });
  await it('every raw fetch( is the one call() path or the push stream, and neither names a method other than GET', () => {
    const sites = [];
    for (const source of sources.values()) sites.push(...liveMatches(source, /\bfetch\((.*)$/gm).map((match) => match[1]));
    assert.ok(sites.length >= 2, 'the scan found ' + sites.length + ' fetch sites');
    for (const site of sites) {
      const named = /method\s*:\s*'(\w+)'/.exec(site);
      assert.ok(!named || named[1] === 'GET', site.slice(0, 120));
      assert.ok(/^this\.api \+ p, \{ method,|^cb\.api \+ '\/api\/events\/stream/.test(site), 'an unexpected fetch: ' + site.slice(0, 120));
    }
  });
}

/* ── (b) once for real: the core runs against a recorded fetch ── */
const ORDER = '33333333-3333-4333-8333-333333333331', PAID = '33333333-3333-4333-8333-333333333332',
  CANCELLED = '33333333-3333-4333-8333-333333333333', BROKEN = '33333333-3333-4333-8333-333333333334', PLACED = '33333333-3333-4333-8333-333333333335';
const INVOICE = {
  invoice: { BuyerDtls: { Gstin: '29ABCDE1234F1Z5', LglNm: 'Kumar Stores', State: '29' }, SellerDtls: { Gstin: '29PQRSX6789K1Z2', LglNm: 'Rice Mill', State: '29' },
    ItemList: [{ PrdDesc: 'Rice 25 kg', HsnCd: '1006', Qty: 2, Unit: 'BAG', UnitPrice: 500, AssAmt: 1000, GstRt: 5, CgstAmt: 25, SgstAmt: 25 }] },
  heads: { taxable: 1000, cgst: 25, sgst: 25, total: 1050 }
};
function chitAnswer(chitId) {
  const status = { [CANCELLED]: 'cancelled', [PLACED]: 'completed' }[chitId] || 'accepted';
  const business = chitId === PAID ? { payment: { at: '2026-10-22T10:00:00Z', method: 'upi', ref: 'UPI-881', amount: 1050 } } : {};
  return { header: { chit_id: chitId, purpose: 'order', current_status: status, business_json: business, summary_json: { total_value: 1050 } },
    detail: { line_items: [{ name: 'Rice 25 kg', quantity: 2, unit: 'bag', price: 500, total: 1000 }] } };
}
function answerFor(method, url) {
  const where = new URL(url).pathname;
  if (where === '/api/chits/inbox') return { chits: [ORDER, PAID, CANCELLED, BROKEN].map((id) => ({ chit_id: id, purpose: 'order' })) };
  if (where === '/api/chits/sent') return { chits: [{ chit_id: PLACED, purpose: 'order', current_status: 'completed' }] };
  if (where.startsWith('/api/chits/')) return chitAnswer(decodeURIComponent(where.slice('/api/chits/'.length)));
  if (where.startsWith('/api/invoice/')) return INVOICE;
  return { ok: true };
}
const ADAPTER = {
  name: 'fake-books',
  pushOrder: async (order) => { if (order.chit_id === BROKEN) throw new Error('stock item missing'); return { ref: 'V-' + order.chit_id.slice(-1) }; },
  pushReceipt: async () => ({ ref: 'R-1' }),
  pushPurchase: async () => ({ ref: 'P-1', input_tax: 50 }),
  ensureParty: async () => ({}), ensureSupplier: async () => ({}), ensureItems: async () => ({})
};

async function runCore(requests) {
  const core = require(CORE_FILE), realFetch = globalThis.fetch, folder = fs.mkdtempSync(path.join(os.tmpdir(), 'r11-connector-'));
  globalThis.fetch = async (url, options) => {
    const method = (options && options.method) || 'GET';
    requests.push({ method, path: new URL(url).pathname });
    const body = JSON.stringify(answerFor(method, url));
    return { ok: true, status: 200, text: async () => body };
  };
  try {
    const cb = new core.CB({ api: 'http://cb.test', key: 'k', log: () => {} });
    cb.policy = { books_at: 'accepted' };
    const run = { cb, adapter: ADAPTER, receipts: new core.Receipts(path.join(folder, 'receipts.jsonl')), log: () => {} };
    await core.catchUp(run);
    await core.syncPurchases(run);
    return fs.readFileSync(path.join(folder, 'receipts.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

async function liveChecks() {
  console.log('\nR11 (b) · the core, run once with every request recorded');
  const requests = [];
  const receipts = await runCore(requests);
  await it('the run did the work: an order booked, a receipt booked, a purchase booked, a failure and a cancellation recorded', () => {
    const outcomes = receipts.map((row) => row.kind + ':' + row.outcome).sort();
    assert.deepStrictEqual(outcomes, ['order:failed', 'order:ok', 'order:ok', 'order:skipped', 'purchase:ok', 'receipt:ok'].sort(), JSON.stringify(outcomes));
  });
  await it('it read the chits (GET /api/chits/…) and wrote the books rider back (POST /api/integrations/books)', () => {
    assert.ok(requests.some((request) => request.method === 'GET' && request.path.startsWith('/api/chits/')));
    assert.ok(requests.filter((request) => request.method === 'POST' && request.path === '/api/integrations/books').length >= 4);
  });
  await it('every request to /api/chits was a GET, and the only write that went out was the books rider', () => {
    assert.deepStrictEqual(requests.filter((request) => request.path.startsWith('/api/chits') && request.method !== 'GET'), []);
    assert.deepStrictEqual([...new Set(requests.filter((request) => request.method !== 'GET').map((request) => request.path))], ['/api/integrations/books']);
  });
}

(async () => {
  await routeChecks();
  await staticChecks();
  await liveChecks();
  console.log('\n  ' + (failed ? '✗' : '✓') + ' ' + passed + ' passed · ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})();
