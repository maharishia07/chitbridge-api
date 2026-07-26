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
  results: []
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
  const fetch = (await import('node-fetch')).default;
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
  state.results.push({ test, passed: true });
}

function fail(test, detail = '') {
  const msg = `${C.red}❌ FAIL${C.reset} ${test}${detail ? ` — ${detail}` : ''}`;
  console.log(msg);
  state.results.push({ test, passed: false, detail });
}

function section(title) {
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
    email
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

  // Check A sent items
  const inboxA = await api('GET', '/api/chits/inbox', null, state.tokens.A);
  const chitInA = inboxA.data.chits && inboxA.data.chits.find(c => c.chit_id === state.chit_id);
  if (chitInA) {
    pass('A sees chit in sent items');
  } else {
    fail('A sent items check');
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

    // Check state log
    const log = detailB.data.state_log;
    if (log && log.length >= 2) {
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

  // B tries to complete without being in_progress
  const invalid = await api('PUT', `/api/chits/${state.chit_id}/status`,
    { status: 'completed' }, state.tokens.B);

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

  // A tries to send chit to D — should fail (no connection)
  const send = await api('POST', '/api/chits/send', {
    receivers: [{ entity_id: resultD.entity.identity_id }],
    purpose: 'order'
  }, state.tokens.A);

  if (send.status === 400 && send.data.error === 'Not connected') {
    pass('Platform blocks chit to unconnected entity');
  } else {
    fail('Unconnected chit should be blocked', `Got: ${send.status} ${send.data.error}`);
  }
}

// ── Final results ─────────────────────────────────────────────
function printResults() {
  const passed = state.results.filter(r => r.passed).length;
  const failed = state.results.filter(r => !r.passed).length;
  const total = state.results.length;

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

  if (failed === 0) {
    console.log(`\n${C.green}${C.bold}  ✅ ALL TESTS PASSED — MVP CONCEPT PROVEN${C.reset}`);
    console.log(`\n  Three entities registered`);
    console.log(`  Entity A connected to B and C`);
    console.log(`  A sent chit to B and C`);
    console.log(`  B accepted — C rejected`);
    console.log(`  A sees both statuses`);
    console.log(`  Full state log recorded`);
    console.log(`  Platform enforces state rules`);
    console.log(`\n  ${C.cyan}Share the Railway URL with your father${C.reset}`);
    console.log(`  ${C.cyan}He will run the test dashboard from Claude.ai${C.reset}\n`);
  } else {
    console.log(`\n${C.red}${C.bold}  ❌ SOME TESTS FAILED — See above${C.reset}\n`);
  }
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

// ── Main ──────────────────────────────────────────────────────
async function main() {
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
    console.log(`\n${C.red}Test suite stopped: ${err.message}${C.reset}`);
  }

  printResults();
}

main();
