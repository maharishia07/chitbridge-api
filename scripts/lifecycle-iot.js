// IoT connector lifecycle harness — drives the LIVE API end-to-end and asserts the desired result at each step.
// Auth: dev-mode entity login (register -> dev_otp -> verify -> JWT). Run: node lifecycle-iot.js
const BASE  = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const ENTITY = process.env.CB_ENTITY || 'Alpha Timbers';
const BETA   = process.env.CB_BETA || '75c378a6-ad7f-4b58-87d2-e1509cbb0482'; // counterparty for CC
// a valid 1x1 JPEG, for the proof-attachment path
const TINY_JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';

let PASS = 0, FAIL = 0;
function check(name, ok, detail) {
  if (ok) { PASS++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else    { FAIL++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
  return ok;
}
async function api(method, path, { token, key, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (key)   headers['X-Bridge-Key'] = key;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

(async () => {
  console.log('== IoT lifecycle harness ==  ' + BASE + '\n');

  // ---- AUTH ----
  console.log('AUTH');
  const reg = await api('POST', '/api/entities/register', { body: { email: ENTITY } });
  const otp = reg.json && reg.json.dev_otp;
  check('dev login issued an OTP', !!otp, otp ? 'email ' + reg.json.email : JSON.stringify(reg.json));
  if (!otp) return done();
  const ver = await api('POST', '/api/entities/verify', { body: { email: reg.json.email, otp } });
  const token = ver.json && ver.json.token;
  check('verify returned a JWT', !!token);
  if (!token) return done();

  // ---- 1 · CREATE CONNECTOR (push) ----
  console.log('\n1 · Create IoT connector (push)');
  const name = 'LC gateway ' + Date.now().toString().slice(-6);
  const c1 = await api('POST', '/api/connectors', { token, body: { display_name: name, type: 'iot', site: 'Harness', config: { mode: 'push' } } });
  const actorId = c1.json && c1.json.connector && c1.json.connector.identity_id;
  const key1 = c1.json && c1.json.provision_key;
  check('connector created', !!actorId, actorId);
  check('ActorKey returned once', !!key1);
  check('initial health = offline', c1.json && c1.json.connector && c1.json.connector.health === 'offline');
  if (!actorId) return done();

  // ---- 2 · ADD DEVICE (folder + classes + CC) ----
  console.log('\n2 · Add device (folder=Gate log, classes=[tanker], CC=Beta)');
  const d1 = await api('POST', '/api/connectors/' + actorId + '/connections', { token, body: {
    ref: 'cam-01', counterparty_entity_id: BETA, config: { folder: 'Gate log', classes: ['tanker'] } } });
  const bridge_id = d1.json && d1.json.connection && d1.json.connection.bridge_id;
  check('device connection created', !!(d1.json && d1.json.connection));
  check('device got its own bridge_id', !!bridge_id, bridge_id);

  // ---- 3 · REGENERATE KEY (old must die) ----
  console.log('\n3 · Regenerate key');
  const rg = await api('POST', '/api/connectors/' + actorId + '/regenerate-key', { token, body: {} });
  const key2 = rg.json && rg.json.provision_key;
  check('fresh key issued', !!key2);
  check('fresh key differs from original', key2 && key2 !== key1);
  const oldPing = await api('POST', '/api/connectors/ingest', { key: key1, body: { heartbeat_only: true } });
  check('OLD key now rejected (401)', oldPing.status === 401, 'got ' + oldPing.status);

  // ---- 4 · HEARTBEAT ONLY (health live, no chit) ----
  console.log('\n4 · Ingest heartbeat_only');
  const hb = await api('POST', '/api/connectors/ingest', { key: key2, body: { bridge_id, heartbeat_only: true } });
  check('heartbeat accepted', hb.status === 200, 'status ' + hb.status);
  check('health reported live', hb.json && hb.json.health === 'live');
  check('NO chit raised on heartbeat', hb.json && hb.json.chit_id == null, 'note: ' + (hb.json && hb.json.note));

  // ---- 5 · INGEST EXCEPTION + PROOF ----
  console.log('\n5 · Ingest exception (vehicle) with proof image');
  const ex = await api('POST', '/api/connectors/ingest', { key: key2, body: {
    bridge_id, signal: 'vehicle', value: '1', proof: TINY_JPEG, proof_name: 'frame.jpg', proof_mime: 'image/jpeg' } });
  const chit_id = ex.json && ex.json.chit_id;
  const proofId = ex.json && ex.json.proof_id;
  check('exception raised a chit', !!chit_id, chit_id);
  check('proof image attached (proof_id)', !!proofId, proofId);

  // ---- 6 · AUTO-FILE INTO FOLDER (the payoff) ----
  console.log('\n6 · Auto-file into "Gate log" + raiser shown');
  const fl = await api('GET', '/api/folders', { token });
  const gate = (fl.json && fl.json.folders || []).find(f => (f.name || '').toLowerCase() === 'gate log');
  check('folder "Gate log" auto-created', !!gate, gate && gate.folder_id);
  if (gate) {
    const fc = await api('GET', '/api/folders/' + gate.folder_id + '/chits', { token });
    const rows = (fc.json && fc.json.chits) || [];
    const mine = rows.find(r => r.chit_id === chit_id);
    check('the exception is filed in the folder', !!mine);
    if (mine) {
      check('raiser = the device', mine.raiser_name === name, 'raiser_name=' + mine.raiser_name);
      const bj = mine.business_json || {};
      check('classified as tanker (from classes)', bj.sub_type === 'tanker', 'sub_type=' + bj.sub_type);
      check('carries kind=device_signal', bj.kind === 'device_signal');
    }
  }

  // ---- 6b · RLS ISOLATION: Beta must NOT see Alpha's folder or its chits ----
  console.log('\n6b · RLS isolation (Beta cannot see Alpha\'s folder)');
  let betaToken = null;
  const bReg = await api('POST', '/api/entities/register', { body: { email: 'Beta Traders' } });
  const bOtp = bReg.json && bReg.json.dev_otp;
  if (!bOtp) { check('Beta dev login (skipped — no dev_otp)', false, JSON.stringify(bReg.json)); }
  else {
    const bVer = await api('POST', '/api/entities/verify', { body: { email: bReg.json.email, otp: bOtp } });
    betaToken = bVer.json && bVer.json.token;
    check('Beta logged in', !!betaToken);
    if (betaToken && gate) {
      const bf = await api('GET', '/api/folders', { token: betaToken });
      const betaSeesGate = ((bf.json && bf.json.folders) || []).some(f => f.folder_id === gate.folder_id || (f.name || '').toLowerCase() === 'gate log');
      check('Beta does NOT see Alpha\'s "Gate log" folder', !betaSeesGate);
      const bc = await api('GET', '/api/folders/' + gate.folder_id + '/chits', { token: betaToken });
      const betaRows = (bc.json && bc.json.chits) || [];
      const leaked = betaRows.find(r => r.chit_id === chit_id);
      check('Beta CANNOT read chits filed in Alpha\'s folder (RLS)', !leaked, 'rows visible to Beta: ' + betaRows.length);
    }
  }

  // ---- 7 · SITE + HEALTH READBACK ----
  console.log('\n7 · Cockpit readback (health + cascade shape)');
  const conns = await api('GET', '/api/connectors/' + actorId + '/connections', { token });
  check('actor health readable', conns.json && !!conns.json.actor_health, 'actor_health=' + (conns.json && conns.json.actor_health));
  check('connection carries a signal field', conns.json && conns.json.connections && conns.json.connections[0] && 'signal' in conns.json.connections[0], 'signal=' + (conns.json && conns.json.connections && conns.json.connections[0] && conns.json.connections[0].signal));

  // ---- 8 · DUPLICATE-CREATE (the Back bug, at the API level) ----
  console.log('\n8 · Duplicate create (same name twice)');
  const dupName = 'LC dup ' + Date.now().toString().slice(-5);
  const dupA = await api('POST', '/api/connectors', { token, body: { display_name: dupName, type: 'iot', config: { mode: 'push' } } });
  const dupB = await api('POST', '/api/connectors', { token, body: { display_name: dupName, type: 'iot', config: { mode: 'push' } } });
  const idA = dupA.json && dupA.json.connector && dupA.json.connector.identity_id;
  const idB = dupB.json && dupB.json.connector && dupB.json.connector.identity_id;
  check('API permits a second identical connector (so the UI MUST guard)', idA && idB && idA !== idB, idA + ' / ' + idB);

  // ---- 9 · DELETE (rule: only if no devices) ----
  console.log('\n9 · Delete');
  const delDup = await api('DELETE', '/api/connectors/' + idA, { token });
  check('DELETE bare connector -> handled', delDup.status === 200, 'status ' + delDup.status + (delDup.status === 404 ? ' (NO DELETE ROUTE YET — the gap)' : ''));
  const delWithDev = await api('DELETE', '/api/connectors/' + actorId, { token });
  check('DELETE connector WITH device -> refused', delWithDev.status === 409, 'status ' + delWithDev.status + (delWithDev.status === 404 ? ' (NO DELETE ROUTE YET)' : ''));

  // ---- 10 · FOLDER CRUD under FORCE-RLS (the routes I just refactored to withEntity) ----
  console.log('\n10 · Folder CRUD under RLS (create/sub/rename/move/delete)');
  const fCreate = await api('POST', '/api/folders', { token, body: { name: 'Harness CRUD' } });
  const crudId = fCreate.json && fCreate.json.folder && fCreate.json.folder.folder_id;
  check('create folder', !!crudId, crudId || JSON.stringify(fCreate.json));
  if (crudId) {
    const fSub = await api('POST', '/api/folders', { token, body: { name: 'Sub', parent_id: crudId } });
    check('create NESTED sub-folder', !!(fSub.json && fSub.json.folder && fSub.json.folder.folder_id) && fSub.json.folder.parent_id === crudId);
    const fRen = await api('PATCH', '/api/folders/' + crudId, { token, body: { name: 'Harness CRUD 2' } });
    check('rename folder', fRen.json && fRen.json.folder && fRen.json.folder.name === 'Harness CRUD 2', 'name=' + (fRen.json && fRen.json.folder && fRen.json.folder.name));
    const fMove = await api('POST', '/api/folders/move', { token, body: { chit_id, folder_id: crudId } });
    check('MOVE a chit into it (manual file)', fMove.json && fMove.json.moved >= 1, 'moved ' + (fMove.json && fMove.json.moved));
    const fVer = await api('GET', '/api/folders/' + crudId + '/chits', { token });
    check('chit now appears in the folder', ((fVer.json && fVer.json.chits) || []).some(r => r.chit_id === chit_id));
    const fDel = await api('DELETE', '/api/folders/' + crudId, { token });
    check('delete folder + child cascades', fDel.status === 200, 'status ' + fDel.status + ' deleted ' + (fDel.json && fDel.json.deleted));
    const fGone = await api('GET', '/api/folders', { token });
    check('deleted folder no longer listed', !((fGone.json && fGone.json.folders) || []).some(f => f.folder_id === crudId));
    const inbAfter = await api('GET', '/api/chits/inbox', { token });
    check('unfiled chit SURVIVES (not deleted with folder)', JSON.stringify(inbAfter.json || '').includes(chit_id));
  }

  // ---- 11 · CC RECEIPT — the partner actually receives the co-held Info copy ----
  console.log('\n11 · CC receipt (Beta receives the co-held copy)');
  if (betaToken) {
    const bInbox = await api('GET', '/api/chits/inbox', { token: betaToken });
    check('Beta RECEIVED the CC copy of the exception', JSON.stringify(bInbox.json || '').includes(chit_id), 'searched Beta inbox');
  } else check('CC receipt (skipped — no Beta token)', false);

  // ---- 12 · PROOF RETRIEVAL — PER-ENTITY copies (b66) ----
  console.log('\n12 · Proof retrieval — per-entity copies');
  if (proofId) {
    const pa = await api('GET', '/api/attachments/' + proofId, { token });
    check('Alpha (owner) fetches ITS OWN proof copy', pa.status === 200, 'status ' + pa.status);
    if (betaToken) {
      // Beta must fetch ITS OWN copy — a DISTINCT id discovered via the chit detail, never Alpha's id.
      const bDetail = await api('GET', '/api/chits/' + chit_id, { token: betaToken });
      const bAtts = (bDetail.json && bDetail.json.attachments) || [];
      const betaProof = bAtts[0] && bAtts[0].id;
      check('Beta has its OWN replicated proof copy (distinct id)', !!betaProof && betaProof !== proofId, 'beta ' + betaProof + ' vs alpha ' + proofId);
      if (betaProof) { const pb = await api('GET', '/api/attachments/' + betaProof, { token: betaToken });
        check('Beta fetches ITS OWN copy', pb.status === 200, 'status ' + pb.status); }
      const pcross = await api('GET', '/api/attachments/' + proofId, { token: betaToken });
      check('Beta CANNOT fetch Alpha\'s copy id (per-entity isolation)', pcross.status !== 200, 'status ' + pcross.status);
    }
  } else check('proof retrieval (skipped — no proof_id)', false);
  // Non-party has NO copy at all: a NO-CC exception; Beta is not a party.
  const exNoCC = await api('POST', '/api/connectors/ingest', { key: key2, body: { folder: 'NoCC', signal: 'vehicle', value: '1', proof: TINY_JPEG, proof_name: 'p.jpg', proof_mime: 'image/jpeg' } });
  const proofNoCC = exNoCC.json && exNoCC.json.proof_id;
  check('raised a NO-CC exception with proof', !!proofNoCC, proofNoCC || JSON.stringify(exNoCC.json));
  if (proofNoCC && betaToken) {
    const pn = await api('GET', '/api/attachments/' + proofNoCC, { token: betaToken });
    check('Beta has NO copy of a chit it is not party to (403/404)', pn.status === 403 || pn.status === 404, 'status ' + pn.status);
  }

  // ---- 13 · INGEST ERROR PATHS ----
  console.log('\n13 · Ingest error paths');
  const noKey = await api('POST', '/api/connectors/ingest', { body: { signal: 'x' } });
  check('ingest with NO key -> 401', noKey.status === 401, 'status ' + noKey.status);
  const badBridge = await api('POST', '/api/connectors/ingest', { key: key2, body: { bridge_id: 'CBZZZZZZZZ', signal: 'x' } });
  check('ingest UNKNOWN bridge_id -> 404', badBridge.status === 404, 'status ' + badBridge.status);

  return done();
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });

function done() {
  console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL);
  process.exit(FAIL ? 1 : 0);
}
