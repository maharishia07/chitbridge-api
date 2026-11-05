/**
 * tests/api-problem-ctp.test.cjs — API-1 SLICE 1d: EVERY ANSWER OF routes/ctp.js IS A PROBLEM THAT KEEPS ITS OLD KEYS, ON BOTH MOUNTS.
 *
 * OWNS      the scenarios behind the error_tests column of routes/ctp.js, and its rows of docs/contracts/api-error-tests.json.
 *           CTP's doors are answered to OTHER INSTALLATIONS: lib/ctptransport reads `accepted` and `why` from a peer's body (any content
 *           type), so every refusal keeps those keys word for word (frozen in docs/contracts/api-legacy.json) beside the Problem fields.
 *           Also lib/ctp-contract.js as a unit: 3 operations, the envelope and question refusals in their old words, a 5xx fail-closed.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: the real routes/ctp.js and lib/ctpaddress.js over a stand-in db, key
 *           directory, envelope and question openers, deliverer and catalogue. Mounted twice, as server.js mounts it (/ and /api/ctp).
 * FLOW      scenario → real route on each mount → body → Problem fields present · frozen legacy keys equal · no cause on a 5xx · statuses → manifest
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/api-problem-ctp.test.cjs               check
 *   node tests/api-problem-ctp.test.cjs --write       rewrite this file's rows of docs/contracts/api-error-tests.json
 *   node tests/api-problem-ctp.test.cjs --capture F   record every answer to F (run on the code BEFORE the change, to freeze its keys)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const HERE = path.join(__dirname, '..');
const API = process.env.API_ROOT ? path.resolve(process.env.API_ROOT) : HERE;
process.env.NODE_ENV = 'test';
const LEGACY_FILE = path.join(HERE, 'docs', 'contracts', 'api-legacy.json');
const TESTED_FILE = path.join(HERE, 'docs', 'contracts', 'api-error-tests.json');
/* this file's rows: the three doors on both mounts */
const MINE = (route) => / (\/api\/ctp)?\/(deliver|query|\.well-known\/ctp\.json)$/.test(route);
const argv = process.argv.slice(2);
const PROBLEM_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id', 'field', 'params', 'errors'];
const REQUIRED_FIELDS = ['type', 'title', 'status', 'code', 'detail', 'hint', 'request_id'];

let passed = 0;
let failed = 0;
const check = (label, condition, info) => {
  if (condition) passed++;
  else failed++;
  console.log('  ' + (condition ? 'ok  ' : 'FAIL') + '  ' + label + (condition || info === undefined ? '' : '\n        ' + JSON.stringify(info).slice(0, 500)));
};
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/* ── stand-ins ───────────────────────────────────────────────────────────────────────────────────────────────────── */
const mock = (relative, exported) => {
  const file = require.resolve(path.join(API, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};
const SECRET_SQL = 'relation "chit_copy" does not exist -- INSERT INTO vault';
const PEER = { installation_key: 'mx-1', domain: 'mx.example.com', hosted_locally: false, active: true };
const LIVE_TO = { identity_id: 'e-to', population: 'live' };
const SHOP = { identity_id: 'e-to', bridge_id: 'CBRECV0001', display_name: 'Recv', user_id: 'recv' };
const FRESH = { peer: PEER, to: LIVE_TO, mayCross: true, peerThrows: false, crossThrows: false, noKey: false, openWhy: null, noSender: false, storeFails: false, keysFail: false, catalogueFails: false };
const world = Object.assign({}, FRESH);

/** the rows a statement gets: the peer, the recipient, the crossing rule, the live world */
function rowsFor(sql) {
  if (/FROM installation WHERE installation_key = \$1/.test(sql)) {
    if (world.peerThrows) throw new Error(SECRET_SQL);
    return { rows: world.peer ? [world.peer] : [] };
  }
  /* RAIL-138 (b): the sender's id and bridge id are looked up here too; this world's sender is a party of the peer with no row here */
  if (/SELECT identity_id FROM identities WHERE (identity_id|bridge_id) = \$1$/.test(sql)) return { rows: [] };
  if (/f_installation_of/.test(sql) && /FROM identities/.test(sql)) return { rows: [] }; /* RAIL-107: the sender has no row here yet: a stub is made */
  if (/^INSERT INTO identities/.test(sql)) return { rows: [{ identity_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', display_name: 'MX' }] };
  if (/f_place_entity/.test(sql)) return { rows: [] };
  if (/FROM identities WHERE bridge_id = ANY/.test(sql)) return { rows: [] };
  if (/FROM identities/.test(sql)) return { rows: world.to ? [world.to] : [] };
  if (/f_ctp_may_deliver/.test(sql)) {
    if (world.crossThrows) throw new Error(SECRET_SQL);
    return { rows: [{ ok: !!world.mayCross }] };
  }
  if (/ops\.population/.test(sql)) return { rows: [{ code: 'live' }] };
  if (/SELECT trade_mode FROM entity_profile/.test(sql)) return { rows: [{ trade_mode: 'export' }] }; /* NET-39: the shop asked about sells outside, so its catalogue is answered */
  return { rows: [] };
}

function installStubs() {
  const db = { query: async (sql) => rowsFor(sql) };
  db.withEntity = async (_id, fn) => fn(db); /* RAIL-138 (c): the recipient's own copy is read as the recipient */
  mock('db', db);
  mock('db/index', db);
  mock('lib/ctpdirectory', { publicKeyFor: async (domain, ik) => (world.noKey ? { ok: false, why: 'no manifest at ' + domain } : { ok: true, public_key: 'PK-' + ik }) });
  mock('lib/ctpkeys', {
    status: () => {
      if (world.keysFail) throw new Error('EACCES: ' + SECRET_SQL);
      return { can_sign: true, public_key: 'PK-here', why: '' };
    },
    verifyWith: () => true
  });
  mock('lib/ctpenvelope', {
    digest: () => 'H-1',
    open: () =>
      world.openWhy
        ? { ok: false, why: world.openWhy }
        : { ok: true, chit_id: 'chit-1', copy: Object.assign({ entity_id: 'THEIRS', business_json: {} }, world.noSender ? {} : { sender_entity_id: '22222222-2222-4222-8222-222222222222', sender_entity_bridge_id: 'CBSEND0001' }), header: {} }
  });
  /* RAIL-96/97: the route reads which questions are the network's (NETWORK_WANTS) from the real module; the stand-in keeps those lists and replaces only the opener */
  const realQuery = require(path.join(API, 'lib', 'ctpquery'));
  mock('lib/ctpquery', { WANTS: realQuery.WANTS, NETWORK_WANTS: realQuery.NETWORK_WANTS, open: (q) => (world.openWhy ? { ok: false, why: world.openWhy } : { ok: true, ask: (q && q.ask) || {} }) });
  mock('lib/mint', {
    deliver: async () => {
      if (world.storeFails) throw Object.assign(new Error(SECRET_SQL), { code: '53100' });
      return { ok: true };
    }
  });
  mock('lib/govresolve', { resolveInstallationGovernance: async () => null });
  mock('routes/catalogue', {
    resolveEntity: async () => {
      if (world.catalogueFails) throw new Error(SECRET_SQL);
      return SHOP;
    },
    publicViewFor: async () => ({ available: true }),
    publicResponseFor: () => ({ items: [] })
  });
}

/* ── the scenarios: every answer of routes/ctp.js. Each runs on both mounts (server.js: '/' and '/api/ctp'). ───────────────── */
/* RAIL-139 (b): the door checks the seal before the recipient, so the envelope carries one the stubbed digest matches */
const ENV = { ctp: '1', from: { installation_key: 'mx-1', bridge_id: 'CBSEND0001' }, to: { bridge_id: 'CBRECV0001' }, sealed: { hash: 'H-1', sig: 'S-1' } };
const env = (patch) => Object.assign({}, ENV, patch || {});
const ASK = (ask) => ({ ctp: '1', kind: 'query', from: { installation_key: 'mx-1' }, ask });
const DOORS = { manifest: 'GET /.well-known/ctp.json', deliver: 'POST /deliver', query: 'POST /query' };
const SCENARIOS = [
  { id: 'manifest-ok', door: 'manifest', status: 200 },
  { id: 'manifest-keys-fail', door: 'manifest', status: 500, setup: { keysFail: true } },
  { id: 'deliver-not-envelope', door: 'deliver', status: 400, body: { ctp: '2' } },
  { id: 'deliver-no-body', door: 'deliver', status: 400 },
  { id: 'deliver-no-recipient', door: 'deliver', status: 400, body: env({ to: {} }) },
  { id: 'deliver-no-installation', door: 'deliver', status: 400, body: env({ from: {} }) },
  { id: 'deliver-stranger', door: 'deliver', status: 403, body: env(), setup: { peer: null } },
  { id: 'deliver-table-unreadable', door: 'deliver', status: 403, body: env(), setup: { peerThrows: true } },
  { id: 'deliver-hosted-here', door: 'deliver', status: 409, body: env(), setup: { peer: Object.assign({}, PEER, { hosted_locally: true }) } },
  { id: 'deliver-key-unreadable', door: 'deliver', status: 403, body: env(), setup: { noKey: true } },
  { id: 'deliver-no-business', door: 'deliver', status: 404, body: env(), setup: { to: null } },
  { id: 'deliver-crossing-unreadable', door: 'deliver', status: 503, body: env(), setup: { crossThrows: true } },
  { id: 'deliver-not-paired', door: 'deliver', status: 409, body: env(), setup: { mayCross: false } },
  { id: 'deliver-envelope-refused', door: 'deliver', status: 409, body: env(), setup: { openWhy: 'signature does not verify' } },
  { id: 'deliver-no-sender', door: 'deliver', status: 400, body: env(), setup: { noSender: true } },
  { id: 'deliver-store-fails', door: 'deliver', status: 500, body: env(), setup: { storeFails: true } },
  { id: 'deliver-accepted', door: 'deliver', status: 200, body: env() },
  { id: 'query-not-query', door: 'query', status: 400, body: { ctp: '1', kind: 'deliver' } },
  { id: 'query-no-installation', door: 'query', status: 400, body: { ctp: '1', kind: 'query', from: {} } },
  { id: 'query-stranger', door: 'query', status: 403, body: ASK({ want: 'resolve', handle: 'recv' }), setup: { peer: null } },
  { id: 'query-hosted-here', door: 'query', status: 409, body: ASK({ want: 'resolve', handle: 'recv' }), setup: { peer: Object.assign({}, PEER, { hosted_locally: true }) } },
  { id: 'query-key-unreadable', door: 'query', status: 403, body: ASK({ want: 'resolve', handle: 'recv' }), setup: { noKey: true } },
  { id: 'query-not-open', door: 'query', status: 403, body: ASK({ want: 'resolve', handle: 'recv' }), setup: { openWhy: 'unsigned' } },
  { id: 'query-unknown-question', door: 'query', status: 400, body: ASK({ want: 'everything' }) },
  { id: 'query-catalogue', door: 'query', status: 200, body: ASK({ want: 'catalogue', bridge_id: 'CBRECV0001' }) },
  { id: 'query-fails', door: 'query', status: 500, body: ASK({ want: 'catalogue', bridge_id: 'CBRECV0001' }), setup: { catalogueFails: true } }
];
const MOUNTS = ['', '/api/ctp'];

function send(port, method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const options = { port, path: urlPath, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} };
    const request = http.request(options, (response) => {
      let text = '';
      response.on('data', (part) => (text += part));
      response.on('end', () => resolve({ status: response.statusCode, type: String(response.headers['content-type'] || ''), text, json: safeParse(text) }));
    });
    request.setTimeout(3000, () => {
      request.destroy();
      resolve({ status: 0, type: '', text: '', json: null });
    });
    request.on('error', () => {});
    if (data) request.write(data);
    request.end();
  });
}
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (failure) {
    return null;
  }
}

const legacyOf = (key, scenario) => (JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).routes[key] || { answers: [] }).answers.find((answer) => answer.scenario === scenario);

function checkProblemBody(label, answer) {
  check(label + ': content-type is application/problem+json', /application\/problem\+json/.test(answer.type), answer.type);
  check(label + ': has every Problem field', answer.json && REQUIRED_FIELDS.every((name) => answer.json[name] !== undefined), answer.json);
  check(label + ': request_id is the id the server minted', answer.json && answer.json.request_id === 'req-test', answer.json && answer.json.request_id);
  check(label + ': status in the body equals the HTTP status', answer.json && answer.json.status === answer.status);
}

function checkLegacy(label, answer, frozen) {
  if (!frozen) return check(label + ': a frozen legacy entry exists in docs/contracts/api-legacy.json', false);
  check(label + ': status equals the frozen status', answer.status === frozen.status, [answer.status, frozen.status]);
  const missing = Object.keys(frozen.fixture).filter((name) => !sameValue(answer.json[name], frozen.fixture[name]));
  check(label + ': every frozen legacy key is still there, byte for byte', missing.length === 0, missing.map((name) => name + ' -> ' + JSON.stringify(answer.json[name])));
  const extra = Object.keys(answer.json).filter((name) => !PROBLEM_FIELDS.includes(name) && !(name in frozen.fixture));
  check(label + ': no key beyond the frozen ones and the Problem fields', extra.length === 0, extra);
}

/** a success: the old body, and what a peer reads from it */
function checkSuccess(label, scenario, answer) {
  check(label + ': answers JSON, as before', /application\/json/.test(answer.type), answer.type);
  if (scenario.door === 'deliver') check(label + ': accepted, so lib/ctptransport counts it delivered', answer.json && answer.json.accepted === true && answer.json.chit_id === 'chit-1');
  if (scenario.door === 'query') check(label + ': ok and found', answer.json && answer.json.ok === true && answer.json.found === true);
  if (scenario.door === 'manifest') check(label + ': says CTP/1 and the key', answer.json && answer.json.ctp === '1' && answer.json.public_key === 'PK-here');
}

async function checkRoutes(port, recording) {
  console.log('\n-- routes/ctp.js: every refusal is a Problem and keeps its old keys, on both mounts --');
  const tested = {};
  for (const mount of MOUNTS) {
    for (const scenario of SCENARIOS) {
      Object.assign(world, FRESH, scenario.setup);
      const [method, template] = DOORS[scenario.door].split(' ');
      const route = method + ' ' + mount + template;
      const answer = await send(port, method, mount + template, scenario.body);
      (recording[route] = recording[route] || {})[scenario.id] = { status: answer.status, body: answer.json };
      (tested[route] = tested[route] || new Set()).add(answer.status);
      if (argv.includes('--capture')) continue;
      const label = route + ' ' + scenario.id;
      check(label + ': answers ' + scenario.status, answer.status === scenario.status, answer.status);
      if (scenario.status < 300) {
        checkSuccess(label, scenario, answer);
        continue;
      }
      checkProblemBody(label, answer);
      checkLegacy(label, answer, legacyOf(route, scenario.id));
      if (scenario.status >= 500) check(label + ': a 5xx says nothing of its cause', !/chit_copy|INSERT|vault|relation|EACCES|53100/.test(answer.text), answer.text);
    }
  }
  return tested;
}

/* ── lib/ctp-contract.js as a unit: the operations, the refusals in the old words, the 5xx body ── */
function checkContract() {
  console.log('\n-- lib/ctp-contract.js: the operations and the old words --');
  const contract = require(path.join(HERE, 'lib', 'ctp-contract.js'));
  const operations = Object.keys(contract).filter((name) => name.endsWith('_OPERATION'));
  check('3 operations, one per door', operations.length === 3, operations.length);
  operations.forEach((name) => {
    const responses = contract[name].responses || {};
    check(name + ': declares the 500 every door can answer', !!responses[500]);
    check(name + ': its success declares a JSON schema', !!(responses[200] && responses[200].content['application/json'].schema));
  });
  check("an envelope the schema refuses stays a 400 in the old words (a peer is never sent a 422)", sameValue(contract.ENVELOPE_REFUSAL.legacy([{ detail: 'x' }]), { accepted: false, why: 'not a CTP/1 envelope' }) && contract.ENVELOPE_REFUSAL.status === 400);
  check('a question the schema refuses stays a 400 in the old words', sameValue(contract.QUERY_REFUSAL.legacy([{ detail: 'x' }]), { ok: false, why: 'not a CTP/1 query' }) && contract.QUERY_REFUSAL.status === 400);
  check('fail closed: a 5xx keeps its old keys and never says its cause', !/\+|message/.test(JSON.stringify(contract.QUERY_FAILED)) && contract.QUERY_FAILED.why === 'this installation could not answer');
}

process.on('unhandledRejection', (failure) => console.log('  (unhandled rejection: ' + String(failure && failure.message).slice(0, 80) + ')'));
(async () => {
  installStubs();
  const app = express();
  app.use((req, res, next) => {
    req.id = 'req-test';
    next();
  });
  app.use(express.json());
  const ctp = require(path.join(API, 'routes', 'ctp.js'));
  MOUNTS.forEach((mount) => app.use(mount || '/', ctp));
  const server = app.listen(0);
  const recording = {};
  const tested = await checkRoutes(server.address().port, recording);
  server.close();
  if (argv.includes('--capture')) {
    fs.writeFileSync(argv[argv.indexOf('--capture') + 1], JSON.stringify(recording, null, 1));
    console.log('captured ' + Object.keys(recording).length + ' routes');
    process.exit(0);
  }
  checkContract();
  const coverage = Object.fromEntries(Object.keys(tested).sort().map((route) => [route, [...tested[route]].sort((a, b) => a - b)]));
  const onDisk = JSON.parse(fs.readFileSync(TESTED_FILE, 'utf8'));
  const mine = Object.fromEntries(Object.keys(onDisk).filter(MINE).sort().map((route) => [route, onDisk[route]]));
  if (argv.includes('--write')) {
    const others = Object.fromEntries(Object.keys(onDisk).filter((route) => !MINE(route)).map((route) => [route, onDisk[route]]));
    const merged = Object.assign(others, coverage);
    fs.writeFileSync(TESTED_FILE, JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map((route) => [route, merged[route]])), null, 1) + '\n');
  } else check('docs/contracts/api-error-tests.json lists exactly the statuses these scenarios cover for routes/ctp.js', sameValue(mine, coverage), { onDisk: mine, covered: coverage });
  console.log('\n  ' + passed + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
