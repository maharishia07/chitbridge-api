// tests/run-tests.js — Chit and Bridge MVP Test Harness
// Run: node tests/run-tests.js
// Requires server running at BASE_URL
require('dotenv').config();

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

// ── Test state ────────────────────────────────────────────────
const state = {
  entities: {},   // A, B, C
  tokens: {},
  connections: {},
  chit_id: null,
  results: [],
  /* ⭐ which section is running — a condition without the scenario it belongs to is a sentence with no subject */
  section: null
};

// ── Colours ───────────────────────────────────────────────────
const C = {
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  reset:  '\x1b[0m',
  bold:   '\x1b[1m'
};

// ── Helpers ───────────────────────────────────────────────────
async function api(method, path, body, token) {
  /**
   * ⚠ THIS SUITE COULD NOT RUN AT ALL (found 2026-09-12): node-fetch is not installed and is not in
   * package.json, so the harness aborted at the health check with 0 assertions — it has been unrunnable for
   * however long that has been true. ⭐ The fix is not to install it: Node has shipped a global fetch since
   * 18, and this runtime is 24. Adding a dependency to get what the runtime already provides is how a suite
   * acquires a reason to break again. node-fetch stays as the fallback for an older Node.
   */
  const fetch = globalThis.fetch || (await import('node-fetch')).default;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    },
    ...(body && { body: JSON.stringify(body) })
  };
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

function pass(test, detail = '') {
  const msg = `${C.green}✅ PASS${C.reset} ${test}${detail ? ` — ${detail}` : ''}`;
  console.log(msg);
  state.results.push({ test, passed: true, detail, section: state.section });
}

function fail(test, detail = '') {
  const msg = `${C.red}❌ FAIL${C.reset} ${test}${detail ? ` — ${detail}` : ''}`;
  console.log(msg);
  state.results.push({ test, passed: false, detail, section: state.section });
}

function section(title) {
  state.section = title;
  console.log(`\n${C.bold}${C.blue}── ${title} ──${C.reset}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Health check ──────────────────────────────────────────────
async function testHealth() {
  section('Health Check');
  const { status, data } = await api('GET', '/health');
  if (status === 200 && data.status === 'OK') {
    pass('Server is running', `v${data.version}`);
  } else {
    fail('Server health check', `Status: ${status}`);
    throw new Error('Server not running — stopping tests');
  }
}

// ── Registration ──────────────────────────────────────────────
async function registerAndVerify(name, email) {
  // Register
  const reg = await api('POST', '/api/entities/register', {
    display_name: name,
    email,
    user_id: 'e' + Date.now() + Math.floor(Math.random()*1e6)
  });

  if (reg.status !== 200) {
    fail(`Register ${name}`, reg.data.message);
    return null;
  }

  // Get OTP from dev_otp (development mode)
  const otp = reg.data.dev_otp;
  if (!otp) {
    fail(`Get OTP for ${name}`, 'dev_otp not returned — check NODE_ENV=development');
    return null;
  }

  // Verify
  const ver = await api('POST', '/api/entities/verify', { email, otp });
  if (ver.status !== 200) {
    fail(`Verify ${name}`, ver.data.message);
    return null;
  }

  pass(`Register and verify ${name}`, `bridge_id: ${ver.data.entity.bridge_id}`);
  return { token: ver.data.token, entity: ver.data.entity };
}

async function testRegistration() {
  section('Scenario 1 — Entity Registration');

  const timestamp = Date.now();
  const entities = [
    { key: 'A', name: `Test Entity A ${timestamp}`, email: `entity-a-${timestamp}@test-cb.com` },
    { key: 'B', name: `Test Entity B ${timestamp}`, email: `entity-b-${timestamp}@test-cb.com` },
    { key: 'C', name: `Test Entity C ${timestamp}`, email: `entity-c-${timestamp}@test-cb.com` },
  ];

  for (const e of entities) {
    const result = await registerAndVerify(e.name, e.email);
    if (!result) throw new Error(`Registration failed for ${e.key}`);
    state.entities[e.key] = result.entity;
    state.tokens[e.key] = result.token;
    await sleep(200);
  }

  // Verify bridge_ids are unique
  const ids = Object.values(state.entities).map(e => e.bridge_id);
  const unique = new Set(ids).size === ids.length;
  if (unique) {
    pass('Bridge IDs are unique', ids.join(', '));
  } else {
    fail('Bridge IDs uniqueness check');
  }
}

// ── Connections ───────────────────────────────────────────────
async function testConnections() {
  section('Scenario 2 — Connection Handshake');

  // A requests connection to B
  const reqAB = await api('POST', '/api/connections/request', {
    to_entity_id: state.entities.B.identity_id,
    note: 'Test connection from A to B'
  }, state.tokens.A);

  if (reqAB.status === 200) {
    pass('A sends connection request to B');
    state.connections.AB = reqAB.data.connection_id;
  } else {
    fail('A → B connection request', reqAB.data.message);
  }

  // A requests connection to C
  const reqAC = await api('POST', '/api/connections/request', {
    to_entity_id: state.entities.C.identity_id,
    note: 'Test connection from A to C'
  }, state.tokens.A);

  if (reqAC.status === 200) {
    pass('A sends connection request to C');
    state.connections.AC = reqAC.data.connection_id;
  } else {
    fail('A → C connection request', reqAC.data.message);
  }

  // B checks pending requests
  const pending = await api('GET', '/api/connections/pending', null, state.tokens.B);
  if (pending.status === 200 && pending.data.count >= 1) {
    pass('B sees pending request from A', `${pending.data.count} pending`);
  } else {
    fail('B pending requests check');
  }

  // B accepts A
  const acceptAB = await api('PUT', `/api/connections/${state.connections.AB}/respond`,
    { action: 'accept' }, state.tokens.B);
  if (acceptAB.status === 200) {
    pass('B accepts connection from A');
  } else {
    fail('B accepts A', acceptAB.data.message);
  }

  // C accepts A
  const pendingC = await api('GET', '/api/connections/pending', null, state.tokens.C);
  if (pendingC.data.requests && pendingC.data.requests.length > 0) {
    const connId = pendingC.data.requests[0].connection_id;
    const acceptAC = await api('PUT', `/api/connections/${connId}/respond`,
      { action: 'accept' }, state.tokens.C);
    if (acceptAC.status === 200) {
      pass('C accepts connection from A');
    } else {
      fail('C accepts A', acceptAC.data.message);
    }
  }

  // Verify A has 2 connections
  const connList = await api('GET', '/api/connections/list', null, state.tokens.A);
  if (connList.status === 200 && connList.data.count === 2) {
    pass('A has 2 accepted connections');
  } else {
    fail('A connections count', `Expected 2, got ${connList.data.count}`);
  }
}

// ── Send chit ─────────────────────────────────────────────────
async function testSendChit() {
  section('Scenario 3 — Send Chit from A to B and C');

  const chitPayload = {
    receivers: [
      { entity_id: state.entities.B.identity_id },
      { entity_id: state.entities.C.identity_id }
    ],
    purpose: 'order',
    manual_subject: 'Test order — June batch',
    line_items: [
      { name: 'Paracetamol 500mg', quantity: 100, unit: 'strips', price: 45.00, total: 4500.00 },
      { name: 'Ibuprofen 400mg', quantity: 50, unit: 'strips', price: 32.00, total: 1600.00 }
    ]
  };

  const send = await api('POST', '/api/chits/send', chitPayload, state.tokens.A);

  if (send.status === 200) {
    state.chit_id = send.data.chit_id;
    pass('A sends chit to B and C', `chit_id: ${state.chit_id}`);
    pass('Auto subject generated', send.data.auto_subject);
    pass('Summary calculated', `${send.data.summary.line_item_count} items, ${send.data.summary.currency_code} ${send.data.summary.total_value}`);
  } else {
    fail('Send chit A→B,C', send.data.message);
    throw new Error('Cannot continue without chit_id');
  }

  // Check B inbox
  const inboxB = await api('GET', '/api/chits/inbox', null, state.tokens.B);
  const chitInB = inboxB.data.chits && inboxB.data.chits.find(c => c.chit_id === state.chit_id);
  if (chitInB) {
    pass('B sees chit in inbox', `status: ${chitInB.current_status}`);
  } else {
    fail('B inbox check');
  }

  // Check C inbox
  const inboxC = await api('GET', '/api/chits/inbox', null, state.tokens.C);
  const chitInC = inboxC.data.chits && inboxC.data.chits.find(c => c.chit_id === state.chit_id);
  if (chitInC) {
    pass('C sees chit in inbox', `status: ${chitInC.current_status}`);
  } else {
    fail('C inbox check');
  }

  // Check A sent items — the SENDER's copy lives on /sent (two-copy model); /inbox is the received side.
  const sentA = await api('GET', '/api/chits/sent', null, state.tokens.A);
  const chitInA = sentA.data.chits && sentA.data.chits.find(c => c.chit_id === state.chit_id);
  if (chitInA) {
    pass('A sees chit in sent items');
  } else {
    fail('A sent items check', `sent: ${JSON.stringify(sentA.data).slice(0, 120)}`);
  }
}

// ── Chit detail and state ─────────────────────────────────────
async function testChitDetail() {
  section('Scenario 4 — Chit Detail and State Updates');

  // B opens chit — should see full detail
  const detailB = await api('GET', `/api/chits/${state.chit_id}`, null, state.tokens.B);
  if (detailB.status === 200) {
    pass('B opens chit — sees full detail');

    // Check participants
    const participants = detailB.data.participants;
    if (participants && participants.length === 3) {
      pass('All 3 participants visible', participants.map(p => p.display_name).join(', '));
    } else {
      fail('Participants count', `Expected 3, got ${participants ? participants.length : 0}`);
    }

    // Check state log — B's received copy has at least its delivery entry at this point (it hasn't acted yet).
    const log = detailB.data.state_log;
    if (log && log.length >= 1) {
      pass('State log has entries', `${log.length} entries`);
    } else {
      fail('State log check');
    }

    // Check line items present
    const detail = detailB.data.detail;
    if (detail && detail.line_items) {
      pass('Line items visible to B', `${detail.line_item_count} items`);
    }
  } else {
    fail('B open chit', detailB.data.message);
  }

  // B accepts chit
  const accept = await api('PUT', `/api/chits/${state.chit_id}/status`,
    { status: 'accepted' }, state.tokens.B);
  if (accept.status === 200) {
    pass('B accepts chit', `${accept.data.previous_status} → ${accept.data.new_status}`);
  } else {
    fail('B accept chit', accept.data.message);
  }

  // C rejects chit
  const reject = await api('PUT', `/api/chits/${state.chit_id}/status`,
    { status: 'rejected', note: 'Out of stock' }, state.tokens.C);
  if (reject.status === 200) {
    pass('C rejects chit', `${reject.data.previous_status} → ${reject.data.new_status}`);
  } else {
    fail('C reject chit', reject.data.message);
  }

  // A checks both statuses
  const detailA = await api('GET', `/api/chits/${state.chit_id}`, null, state.tokens.A);
  if (detailA.status === 200) {
    const bStatus = detailA.data.participants.find(
      p => p.entity_id === state.entities.B.identity_id);
    const cStatus = detailA.data.participants.find(
      p => p.entity_id === state.entities.C.identity_id);

    if (bStatus && bStatus.current_status === 'accepted') {
      pass('A sees B status: accepted');
    } else {
      fail('A sees B status', `Got: ${bStatus ? bStatus.current_status : 'not found'}`);
    }

    if (cStatus && cStatus.current_status === 'rejected') {
      pass('A sees C status: rejected');
    } else {
      fail('A sees C status', `Got: ${cStatus ? cStatus.current_status : 'not found'}`);
    }
  }
}

// ── Invalid transition test ───────────────────────────────────
async function testInvalidTransition() {
  section('Scenario 5 — Invalid State Transition Rejected');

  // B is 'accepted'. The bidirectional 3-state model allows accepted→{in_progress,completed,pending,rejected,cancelled}
  // but NOT 'partial' — so 'partial' is a genuinely invalid target from accepted and must be rejected.
  const invalid = await api('PUT', `/api/chits/${state.chit_id}/status`,
    { status: 'partial' }, state.tokens.B);

  if (invalid.status === 400) {
    pass('Platform rejects invalid transition', invalid.data.message);
  } else {
    fail('Invalid transition should be rejected', `Got status: ${invalid.status}`);
  }
}

// ── Connection rejected test ──────────────────────────────────
async function testConnectionRejected() {
  section('Scenario 6 — Cannot Send Chit Without Connection');

  const timestamp = Date.now();
  // Register a new entity D with no connections
  const resultD = await registerAndVerify(
    `Test Entity D ${timestamp}`,
    `entity-d-${timestamp}@test-cb.com`
  );

  if (!resultD) return;

  // A sends a chit to D (unconnected). Mailing model: connection NOT required — send like email — so this SUCCEEDS.
  const send = await api('POST', '/api/chits/send', {
    receivers: [{ entity_id: resultD.entity.identity_id }],
    purpose: 'order'
  }, state.tokens.A);

  if (send.status === 200 || send.status === 201) {
    pass('Platform allows chit to any entity (mailing model — no connection required)');
  } else {
    fail('Send to any entity should succeed (mailing model)', `Got: ${send.status} ${JSON.stringify(send.data).slice(0, 120)}`);
  }
}

// ── Final results ─────────────────────────────────────────────
/**
 * ⚠️⚠️ THIS PRINTED "ALL TESTS PASSED" AFTER RUNNING ZERO TESTS, AND THE PROCESS EXITED 0.
 *
 * With no server on :3000 the very first `fetch` THROWS (ECONNREFUSED) before testHealth() can even
 * call fail(), so nothing is ever pushed to state.results. main() caught the error, printed one line,
 * and fell through to here — where `failed === 0` was the only condition on success. Total 0,
 * Passed 0, and a green "✅ ALL TESTS PASSED — MVP CONCEPT PROVEN".
 *
 * ⚠️ THE EXIT CODE WAS THE WORSE HALF. main() never set one, so `npm test` returned 0 no matter what.
 * A CI job wired to this would go green on a total outage of the API. Found 2026-08-29 while sweeping
 * the suite; the harness had been reporting success on nothing for as long as it has existed.
 *
 * ⭐ A suite that ran nothing has PROVEN nothing. Three things now fail: any failed assertion, an
 * abort, and an empty result set.
 *
 * @param {string|null} aborted  the message that stopped the run, if it stopped
 * @returns {boolean} whether this run may be called a pass
 */
function printResults(aborted) {
  const passed = state.results.filter(r => r.passed).length;
  const failed = state.results.filter(r => !r.passed).length;
  const total = state.results.length;
  const ok = failed === 0 && total > 0 && !aborted;

  console.log(`\n${C.bold}${'═'.repeat(50)}${C.reset}`);
  console.log(`${C.bold}  TEST RESULTS${C.reset}`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  Total tests:  ${total}`);
  console.log(`  ${C.green}Passed: ${passed}${C.reset}`);
  if (failed > 0) {
    console.log(`  ${C.red}Failed: ${failed}${C.reset}`);
    console.log(`\n  Failed tests:`);
    state.results.filter(r => !r.passed).forEach(r => {
      console.log(`  ${C.red}→ ${r.test}${C.reset}${r.detail ? ': ' + r.detail : ''}`);
    });
  }
  console.log(`${'═'.repeat(50)}`);

  /**
   * ⚠️ THE CELEBRATION USED TO LIST SEVEN OUTCOMES — "Three entities registered", "A sent chit to
   * B and C" — as literal strings, printed whether or not any of them had been checked. On the empty
   * run it asserted all seven against zero evidence. A summary may only report what it counted.
   */
  if (aborted) {
    console.log(`\n${C.red}${C.bold}  ❌ RUN ABORTED — ${aborted}${C.reset}`);
    console.log(`  ${C.yellow}${total} assertion(s) had run when it stopped. Nothing after that point was checked.${C.reset}\n`);
  } else if (total === 0) {
    console.log(`\n${C.red}${C.bold}  ❌ NO TESTS RAN${C.reset}`);
    console.log(`  ${C.yellow}A suite that ran nothing has proven nothing. Is the server up at ${BASE_URL}?${C.reset}\n`);
  } else if (failed === 0) {
    console.log(`\n${C.green}${C.bold}  ✅ ${passed} ASSERTION(S) PASSED${C.reset}`);
    console.log(`  ${C.cyan}Server: ${BASE_URL}${C.reset}\n`);
  } else {
    console.log(`\n${C.red}${C.bold}  ❌ ${failed} OF ${total} FAILED — see above${C.reset}\n`);
  }
  return ok;
}

// ── Entity + KEY (actor provisioning) ─────────────────────────
async function testActorKey() {
  section('ENTITY + KEY — actor (co-assist) provisioning');
  const ts = Date.now();
  const ent = await registerAndVerify('KeyTest Co', `keytest-${ts}@example.com`);
  if (!ent) return;
  const actorKey = 'ops' + (ts % 100000);
  const r = await api('POST', '/api/actors',
    { display_name: 'Ops Co-assist', actor_key: actorKey, actor_role: 'operator' }, ent.token);
  if (r.status !== 200 && r.status !== 201) { fail('Create actor (key)', JSON.stringify(r.data)); return; }
  const a = r.data.actor || {};
  if (a.actor_key === actorKey && a.login_format) pass('Create actor (key)', `login ${a.login_format}`);
  else fail('Create actor (key)', 'unexpected response: ' + JSON.stringify(r.data));
}

// ── Network design persistence (b111, per-entity, RLS) ─────────
async function testNetworkDesign() {
  section('NETWORK DESIGN persistence (b111 — cross-device, RLS)');
  const ts = Date.now();
  const A = await registerAndVerify('NetDesign A', `netdesign-a-${ts}@example.com`);
  const B = await registerAndVerify('NetDesign B', `netdesign-b-${ts}@example.com`);
  if (!A || !B) return;
  const design = { id: 'net-test', purpose: 'Smoke design', built: false,
    nodes: [{ key: 'k1', name: 'HQ', root: true, owned: true, holds: [] }] };
  const put = await api('PUT', '/api/network-design', { draft: design }, A.token);
  if (put.status !== 200) { fail('Save design (A)', JSON.stringify(put.data)); return; }
  pass('Save design (A)', 'updated_at ' + (put.data.updated_at || '?'));
  const getA = await api('GET', '/api/network-design', null, A.token);
  if (getA.status === 200 && getA.data.draft && getA.data.draft.nodes &&
      getA.data.draft.nodes[0] && getA.data.draft.nodes[0].name === 'HQ')
    pass('Load design (A) round-trip', 'nodes: ' + getA.data.draft.nodes.length);
  else fail('Load design (A) round-trip', JSON.stringify(getA.data));
  const getB = await api('GET', '/api/network-design', null, B.token);
  if (getB.status === 200 && (getB.data.draft === null || getB.data.draft === undefined))
    pass('RLS isolation — B cannot see A design', 'B draft is null');
  else fail('RLS isolation — B cannot see A design', 'B saw: ' + JSON.stringify(getB.data.draft));
  // reject a non-object draft (input guard)
  const bad = await api('PUT', '/api/network-design', { draft: 'not-an-object' }, A.token);
  if (bad.status === 400) pass('Reject bad draft (400)', 'guard holds');
  else fail('Reject bad draft (400)', 'status ' + bad.status);
}

// ── Catalogue face persistence (b112, per-entity, RLS) ─────────
async function testCatalogueFace() {
  section('CATALOGUE FACE persistence (b112 — cross-device, RLS)');
  const ts = Date.now();
  const A = await registerAndVerify('CatFace A', `catface-a-${ts}@example.com`);
  const B = await registerAndVerify('CatFace B', `catface-b-${ts}@example.com`);
  if (!A || !B) return;
  const face = { method: 'cart', units: ['kg', 'litre'], tax: { label: 'GST', rate: '18' },
    catalogue: { product: 'Paint', baseUnit: 'litre' }, facets: { variants: true } };
  const put = await api('PUT', '/api/catalogue-face', { face }, A.token);
  if (put.status !== 200) { fail('Save face (A)', JSON.stringify(put.data)); return; }
  pass('Save face (A)', 'updated_at ' + (put.data.updated_at || '?'));
  const getA = await api('GET', '/api/catalogue-face', null, A.token);
  if (getA.status === 200 && getA.data.face && Array.isArray(getA.data.face.units) &&
      getA.data.face.units.join(',') === 'kg,litre' && getA.data.face.method === 'cart')
    pass('Load face (A) round-trip', 'units: ' + getA.data.face.units.join('·'));
  else fail('Load face (A) round-trip', JSON.stringify(getA.data));
  const getB = await api('GET', '/api/catalogue-face', null, B.token);
  if (getB.status === 200 && (getB.data.face === null || getB.data.face === undefined))
    pass('RLS isolation — B cannot see A face', 'B face is null');
  else fail('RLS isolation — B cannot see A face', 'B saw: ' + JSON.stringify(getB.data.face));
  // reject a non-object face (input guard)
  const bad = await api('PUT', '/api/catalogue-face', { face: 'not-an-object' }, A.token);
  if (bad.status === 400) pass('Reject bad face (400)', 'guard holds');
  else fail('Reject bad face (400)', 'status ' + bad.status);
}

// ── ⭐⭐ THE RUN GOES ON THE BOARD ─────────────────────────────
/**
 * Athi, 2026-09-12: *"my only concern is test case, condition and the result is not getting reflected in the
 * test lab."*
 *
 * ⚠️⚠️ HE WAS RIGHT, AND THE HOLE WAS WIDER THAN NOT POSTING. This file reached the board only as a classified
 * FILE — "test.harness · support · 551 lines" — carrying no steps and no result. Forty-two assertions against
 * the live API, and the page that reports what is tested could not see one of them.
 *
 * ⭐ SO ONE RUN NOW WRITES BOTH HALVES, AND THEY CANNOT DRIFT APART: the CONDITIONS (what this suite checks)
 * into TEST-CONDITIONS.json, which build-test-cases.cjs hangs on this file's case; and the RESULT into a JUnit
 * report post-suite.cjs puts on that same case. The definitions and the evidence come out of one pass, so a
 * condition cannot be on the board without the run that proved it, or the other way round.
 *
 * ⚠️ ONE RESULT PER CASE, NOT PER ASSERTION, because that is the ledger's shape: uq_test_result_once is one row
 * per (run, case, layer). Posting 42 rows keyed to one case would keep the first and drop 41 without a word —
 * so the case passes only when every condition in it passed, and the note carries the count and the failures.
 *
 * ⚠️⚠️ AND NOTHING IS WRITTEN ON AN ABORTED RUN. A suite that stopped at scenario 2 knows about six conditions,
 * not forty-two; writing that list would DELETE thirty-six conditions from the board and read as a tidy-up.
 * [[feedback-improvise-update-cases]] — a case is moved, never quietly dropped.
 */
const fs = require('fs');
const path = require('path');

/**
 * ⚠️ THIS KEY MUST BE THE ONE classify-tests.cjs EMITS FOR THIS FILE. Two spellings of one identity is how a
 * history splits in half with nothing to say it did — the same warning suite.cjs carries about its own keys.
 * chitbridge-api/tests/test-board.test.js fails if TEST-CONDITIONS.json ever names a case the board lacks.
 */
const CASE_KEY = 'chitbridge-api/tests/run-tests.js';
const DEV = path.join(__dirname, '..', '..');
const CONDITIONS_FILE = path.join(DEV, 'TEST-CONDITIONS.json');
const JUNIT_FILE = path.join(__dirname, '..', 'test-results', 'harness.xml');

/**
 * ⭐ WHAT VARIES BETWEEN RUNS IS NOT A CONDITION. Every entity here is created fresh, so an assertion detail
 * reads "bridge_id: CBWZR6JLF4" today and something else tomorrow. Left alone, the board's conditions would
 * change on every single run and `board.cjs --check` would go red daily until nobody read it any more.
 * ⚠️ The shape is kept and only the value is replaced, so a reader still sees WHAT was checked.
 */
function steady(s) {
  const flat = String(s == null ? '' : s)
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '«at»')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '«id»')
    .replace(/\bCB[A-Z0-9]{8}\b/g, '«bridge id»')
    /**
     * ⚠️ NO WORD BOUNDARY. \\b\\d{9,}\\b missed `ops45635@e1789206464341320473` — the digits are welded to a
     * letter, so there is no boundary to find, and the condition moved on every run while looking normalised.
     * ⭐ Found by running the suite twice and diffing, which is the only way this kind of thing is ever found.
     */
    .replace(/\d{5,}/g, '«run»');
  /**
   * ⚠️⚠️ AN UNORDERED LIST IS NOT A CHANGING CONDITION. "All 3 participants visible" came back as B·A·C on one
   * run and C·B·A on the next — the API promises the SET, not the order, and the assertion only ever checked
   * that all three were there. Left alone the board would have rewritten itself every run over nothing.
   * ⭐ Sorted, so the condition says the same thing twice; the check itself is unchanged.
   */
  return flat.indexOf(', ') > 0 ? flat.split(', ').sort().join(', ') : flat;
}

/** The conditions, in the order the suite runs them, grouped under the section that ran them. */
function conditionsOfRun() {
  const seen = [], bySection = {};
  for (const r of state.results) {
    const sec = r.section || 'Unsectioned';
    if (!bySection[sec]) { bySection[sec] = []; seen.push(sec); }
    bySection[sec].push(r);
  }
  const steps = [];
  for (const sec of seen) {
    for (const r of bySection[sec]) {
      /**
       * ⭐ A STEP IS [what is done, what must be true]. For an automated case the assertion label IS the check
       * and the detail is what the suite accepted as proof — which is why these are written by the run and not
       * by me: a hand-written expectation for code that asserts for itself is a sentence nobody verified.
       */
      steps.push([sec + ' — ' + steady(r.test),
        steady(r.detail) || 'The suite accepts this as proven when it holds.']);
    }
  }
  return steps;
}

/**
 * ⚠️ MERGED, NEVER OVERWRITTEN. Any other suite that learns to describe its own conditions writes into the same
 * file under its own case key; a whole-file rewrite here would erase theirs on the next run of this one.
 */
function writeConditions(steps) {
  let doc = {};
  try { doc = JSON.parse(fs.readFileSync(CONDITIONS_FILE, 'utf8')); } catch (_) { doc = {}; }
  if (!doc._what) {
    doc._what = 'CONDITIONS WRITTEN BY THE RUN ITSELF. Keyed by case key. build-test-cases.cjs hangs these on '
      + 'the matching case so the board shows WHAT an automated suite checks, not only that it exists. '
      + '⚠ Never hand-edited: the suite is the source, and a typed condition here would claim a check nobody wrote.';
  }
  doc[CASE_KEY] = {
    at: new Date().toISOString(),
    against: String(BASE_URL).replace(/^https?:\/\//, ''),
    /* ⚠️ the timestamp above is provenance and deliberately does NOT reach the board — a date in the case text
       would move the committed board on every run and turn `--check` into noise. */
    count: steps.length,
    steps: steps,
  };
  fs.writeFileSync(CONDITIONS_FILE, JSON.stringify(doc, null, 1) + '\n');
  return CONDITIONS_FILE;
}

/** The result, in the format the board already ingests — the same JUnit suite.cjs writes for the guards. */
function writeJunit(passed, total, failures) {
  const esc = (x) => String(x == null ? '' : x)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const red = failures.length > 0;
  const why = red
    ? failures.length + ' of ' + total + ' conditions failed: '
      + failures.slice(0, 6).map((f) => steady(f.test)).join(' · ')
    : '';
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<testsuites name="chitbridge-harness" tests="1" failures="' + (red ? 1 : 0) + '">\n'
    + '  <testsuite name="api-integration" tests="1" failures="' + (red ? 1 : 0) + '">\n'
    + '    <testcase classname="test.harness" name="' + esc(CASE_KEY) + '" time="0">'
    + (red ? '<failure message="' + esc(why) + '"/>' : '')
    + '<system-out>' + esc(passed + ' of ' + total + ' conditions passed against ' + BASE_URL) + '</system-out>'
    + '</testcase>\n  </testsuite>\n</testsuites>\n';
  fs.mkdirSync(path.dirname(JUNIT_FILE), { recursive: true });
  fs.writeFileSync(JUNIT_FILE, xml);
  return JUNIT_FILE;
}

function writeBoardArtefacts(aborted) {
  const total = state.results.length;
  const failures = state.results.filter((r) => !r.passed);
  const passed = total - failures.length;
  console.log(`\n${C.bold}── the board ──${C.reset}`);
  if (aborted) {
    /* ⚠️ SAID OUT LOUD, because a runner that skips a step in silence is the thing board-day.cjs exists to end. */
    console.log(`  ${C.yellow}conditions NOT written — this run stopped early and knows only ${total} of them.`
      + `${C.reset}\n  A short list would delete the rest from the board and look deliberate.`);
  } else {
    const f = writeConditions(conditionsOfRun());
    console.log(`  conditions: ${total} written to ${f}`);
  }
  const j = writeJunit(passed, total, failures);
  console.log(`  result:     ${j}`);
  console.log(`  ⭐ to put it on the live board:  node C:\\dev\\post-suite.cjs <token> --file `
    + `chitbridge-api/test-results/harness.xml --keys name --kind t2 --layer transport --label "api harness"`);
  console.log(`     Rebuild first if the conditions moved:  node C:\\dev\\board.cjs\n`);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  let aborted = null;
  console.log(`\n${C.bold}${C.cyan}
╔══════════════════════════════════════════════════╗
║    CHIT AND BRIDGE MVP — TEST HARNESS v1.0       ║
║    Three AI agents — Five scenarios              ║
╠══════════════════════════════════════════════════╣
║    Server: ${BASE_URL.padEnd(38)}║
╚══════════════════════════════════════════════════╝
  ${C.reset}`);

  try {
    await testHealth();
    await testRegistration();
    await testActorKey();
    await testNetworkDesign();
    await testCatalogueFace();
    await testConnections();
    await testSendChit();
    await testChitDetail();
    await testInvalidTransition();
    await testConnectionRejected();
  } catch (err) {
    aborted = (err && err.message) || String(err);
    console.log(`\n${C.red}Test suite stopped: ${aborted}${C.reset}`);
  }

  /**
   * ⚠️⚠️ THE EXIT CODE. main() used to set none at all, so `npm test` returned 0 whatever
   * happened — a CI job wired to this would have gone green through a total outage of the API. That
   * is worse than the wrong words on screen, because nobody reads a passing build.
   *
   * ⚠️ process.exitCode, NOT process.exit(). process.exit() can truncate stdout that has not
   * flushed, which on a failing run throws away the very output someone needs. Setting the code lets
   * the process end on its own with everything printed.
   */
  const green = printResults(aborted);
  /* ⚠ written even on a red run — a failure is today's answer and belongs on the board more than a pass does */
  try { writeBoardArtefacts(aborted); } catch (e) { console.log('  could not write the board artefacts: ' + e.message); }
  process.exitCode = green ? 0 : 1;
}

/* Requiring this file must not run the suite — tests/run-tests-exit.test.cjs asks printResults()
   directly for its verdict in each of the four states. */
if (require.main === module) main();

module.exports = { printResults, state, steady, CASE_KEY };
