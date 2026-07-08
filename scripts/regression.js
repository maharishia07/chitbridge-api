// Cross-entity REGRESSION harness — drives the core mailing flows on the LIVE API and asserts logic + criss-cross
// isolation. Finds issues the way the IoT harness did. Run: node regression.js
const BASE = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const ALPHA = 'Alpha Timbers', BETA = 'Beta Traders';
const BETA_ID = '75c378a6-ad7f-4b58-87d2-e1509cbb0482';
const ALPHA_ID = '71373522-147e-4a75-966a-73de3d8bf045';
let PASS = 0, FAIL = 0; const ISSUES = [];
function check(name, ok, detail) {
  if (ok) { PASS++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { FAIL++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')); ISSUES.push(name + (detail ? ' — ' + detail : '')); }
  return ok;
}
async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null, text = null; try { json = await res.json(); } catch (_) { try { text = await res.text(); } catch (__) {} }
  return { status: res.status, json, text };
}
async function login(name) {
  const reg = await api('POST', '/api/entities/register', { body: { email: name } });
  const otp = reg.json && reg.json.dev_otp; if (!otp) return { err: JSON.stringify(reg.json) };
  const ver = await api('POST', '/api/entities/verify', { body: { email: reg.json.email, otp } });
  return { token: ver.json && ver.json.token, email: reg.json.email };
}
const has = (obj, id) => JSON.stringify(obj || '').includes(id);

(async () => {
  console.log('== CROSS-ENTITY REGRESSION ==  ' + BASE + '\n');
  const A = await login(ALPHA), B = await login(BETA);
  check('Alpha login', !!A.token, A.err); check('Beta login', !!B.token, B.err);
  if (!A.token || !B.token) return done();
  // throwaway third entity for true non-participant isolation
  const G = await login('gamma-reg@test.com');
  const gammaOk = !!G.token; console.log('  (third entity for isolation: ' + (gammaOk ? 'ready' : 'unavailable — ' + G.err) + ')');

  // ===== 1 · SEND A->B + delivery (mailing model) =====
  console.log('\n1 · Send A→B + delivery');
  const subj = 'REG ' + Date.now().toString().slice(-6);
  const snd = await api('POST', '/api/chits/send', { token: A.token, body: {
    recipients: [{ entity_id: BETA_ID, role: 'to' }], purpose: 'general', manual_subject: subj,
    line_items: [{ description: 'Widget', qty: 2, rate: 100 }], business_json: { note: 'reg test' } } });
  const chit_id = snd.json && (snd.json.chit_id || (snd.json.chit && snd.json.chit.chit_id));
  check('send returned a chit_id', !!chit_id, chit_id || JSON.stringify(snd.json).slice(0, 200));
  if (!chit_id) return done();
  const aSent = await api('GET', '/api/chits/sent', { token: A.token });
  check('Alpha has the SENT copy (Order)', has(aSent.json, chit_id));
  const bInbox = await api('GET', '/api/chits/inbox', { token: B.token });
  check('Beta has the RECEIVED copy (Task)', has(bInbox.json, chit_id));
  const aDet = await api('GET', '/api/chits/' + chit_id, { token: A.token });
  check('Alpha can open the chit detail', aDet.status === 200, 'status ' + aDet.status);
  const bDet = await api('GET', '/api/chits/' + chit_id, { token: B.token });
  check('Beta can open the chit detail', bDet.status === 200, 'status ' + bDet.status);

  // ===== 2 · CRISS-CROSS isolation (a non-participant sees nothing) =====
  console.log('\n2 · Criss-cross isolation (third entity)');
  if (gammaOk) {
    const gDet = await api('GET', '/api/chits/' + chit_id, { token: G.token });
    check('Gamma CANNOT open the chit (403/404)', gDet.status === 403 || gDet.status === 404, 'status ' + gDet.status);
    const gInbox = await api('GET', '/api/chits/inbox', { token: G.token });
    check('Gamma inbox does NOT contain it', !has(gInbox.json, chit_id));
    const gSent = await api('GET', '/api/chits/sent', { token: G.token });
    check('Gamma sent does NOT contain it', !has(gSent.json, chit_id));
  } else check('isolation (skipped — no third entity)', false);

  // ===== 3 · STATUS logic (receiver-driven; sender read-only) =====
  console.log('\n3 · Status transitions');
  const bAcc = await api('PUT', '/api/chits/' + chit_id + '/status', { token: B.token, body: { status: 'accepted', note: 'ok' } });
  check('Beta (receiver) CAN set status', bAcc.status === 200, 'status ' + bAcc.status + ' ' + JSON.stringify(bAcc.json).slice(0, 120));
  const aTry = await api('PUT', '/api/chits/' + chit_id + '/status', { token: A.token, body: { status: 'completed' } });
  check('Alpha (sender) is read-only on status (blocked)', aTry.status !== 200, 'status ' + aTry.status + ' (expect NOT 200)');
  if (gammaOk) { const gTry = await api('PUT', '/api/chits/' + chit_id + '/status', { token: G.token, body: { status: 'rejected' } });
    check('Gamma (non-party) CANNOT set status', gTry.status === 403 || gTry.status === 404, 'status ' + gTry.status); }
  const aDet2 = await api('GET', '/api/chits/' + chit_id, { token: A.token });
  check('Alpha sees Beta’s accepted status reflected', has(aDet2.json, 'accepted'), 'sender-side status visibility');

  // ===== 4 · MESSAGES =====
  console.log('\n4 · Messages (external thread)');
  const aMsg = await api('POST', '/api/chits/' + chit_id + '/messages', { token: A.token, body: { message_text: 'hello from alpha', thread_type: 'external' } });
  check('Alpha can post a message', aMsg.status === 200 || aMsg.status === 201, 'status ' + aMsg.status);
  const bMsgs = await api('GET', '/api/chits/' + chit_id + '/messages', { token: B.token });
  check('Beta sees Alpha’s message', has(bMsgs.json, 'hello from alpha'));
  if (gammaOk) { const gMsgs = await api('GET', '/api/chits/' + chit_id + '/messages', { token: G.token });
    check('Gamma CANNOT read the thread', !has(gMsgs.json, 'hello from alpha') && (gMsgs.status === 403 || gMsgs.status === 200), 'status ' + gMsgs.status);
    const gPost = await api('POST', '/api/chits/' + chit_id + '/messages', { token: G.token, body: { message_text: 'intruder', thread_type: 'external' } });
    check('Gamma CANNOT post to the thread', gPost.status === 403 || gPost.status === 404, 'status ' + gPost.status); }
  // internal note stays private to author
  const aInt = await api('POST', '/api/chits/' + chit_id + '/messages', { token: A.token, body: { message_text: 'alpha private note', thread_type: 'internal' } });
  check('Alpha can post an internal note', aInt.status === 200 || aInt.status === 201, 'status ' + aInt.status);
  const bMsgs2 = await api('GET', '/api/chits/' + chit_id + '/messages', { token: B.token });
  check('Beta does NOT see Alpha’s internal note', !has(bMsgs2.json, 'alpha private note'), 'internal-visibility scoping');

  // ===== 5 · DISPUTES =====
  console.log('\n5 · Disputes');
  const bDisp = await api('POST', '/api/chits/' + chit_id + '/disputes', { token: B.token, body: { category: 'quality', reason: 'The widgets arrived damaged on arrival.', target_entity_id: ALPHA_ID } });
  const dispute_id = bDisp.json && (bDisp.json.dispute_id || (bDisp.json.dispute && bDisp.json.dispute.dispute_id));
  check('Beta can raise a dispute', !!dispute_id, dispute_id || (bDisp.status + ' ' + JSON.stringify(bDisp.json).slice(0, 160)));
  const aDisp = await api('GET', '/api/chits/' + chit_id + '/disputes', { token: A.token });
  check('Alpha (target) sees the dispute', has(aDisp.json, dispute_id || 'quality'));
  if (gammaOk) { const gDisp = await api('GET', '/api/chits/' + chit_id + '/disputes', { token: G.token });
    check('Gamma CANNOT see the dispute', !has(gDisp.json, dispute_id || '') && (gDisp.status === 403 || gDisp.status === 200), 'status ' + gDisp.status); }
  if (dispute_id) { const res9 = await api('PUT', '/api/chits/' + chit_id + '/disputes/' + dispute_id + '/resolve', { token: B.token, body: { resolution_note: 'Replaced the damaged units on 2026-07-08.' } });
    check('Raiser (Beta) can resolve its dispute', res9.status === 200, 'status ' + res9.status + ' ' + JSON.stringify(res9.json).slice(0, 120));
    const aDisp2 = await api('GET', '/api/chits/' + chit_id + '/disputes', { token: A.token });
    check('dispute no longer shows as open after resolve', !has(aDisp2.json, '"status":"open"'), 'post-resolve state'); }

  // ===== 6 · ATTACHMENTS — PER-ENTITY copies (b66) =====
  console.log('\n6 · Attachments — per-entity copies');
  const up = await api('POST', '/api/attachments', { token: A.token, body: { chit_id, name: 'doc.txt', mime: 'text/plain', data_base64: Buffer.from('regression-doc').toString('base64') } });
  const attId = up.json && up.json.id;
  check('Alpha can attach a document', !!attId, attId || (up.status + ' ' + JSON.stringify(up.json).slice(0, 120)));
  if (attId) {
    const aGet = await api('GET', '/api/attachments/' + attId, { token: A.token });
    check('Alpha fetches ITS OWN copy', aGet.status === 200, 'status ' + aGet.status);
    // Beta gets its OWN copy via the chit detail — distinct id, not Alpha's
    const bDet = await api('GET', '/api/chits/' + chit_id, { token: B.token });
    const bAtt = ((bDet.json && bDet.json.attachments) || []).find(a => a.name === 'doc.txt');
    const betaAttId = bAtt && bAtt.id;
    check('Beta has its OWN replicated copy (distinct id)', !!betaAttId && betaAttId !== attId, 'beta ' + betaAttId + ' vs alpha ' + attId);
    if (betaAttId) { const bOwn = await api('GET', '/api/attachments/' + betaAttId, { token: B.token });
      check('Beta fetches ITS OWN copy', bOwn.status === 200, 'status ' + bOwn.status); }
    const bCross = await api('GET', '/api/attachments/' + attId, { token: B.token });
    check('Beta CANNOT fetch Alpha\'s copy id (per-entity)', bCross.status !== 200, 'status ' + bCross.status);
    if (gammaOk) { const gGet = await api('GET', '/api/attachments/' + attId, { token: G.token });
      check('Gamma (non-party) CANNOT fetch it', gGet.status === 403 || gGet.status === 404, 'status ' + gGet.status); }
  }

  // ===== 7 · DELETE INDEPENDENCE (per-copy) =====
  console.log('\n7 · Delete independence (per-copy)');
  const aDel = await api('DELETE', '/api/chits/' + chit_id, { token: A.token });
  check('Alpha can delete ITS copy', aDel.status === 200, 'status ' + aDel.status);
  const bStill = await api('GET', '/api/chits/' + chit_id, { token: B.token });
  check('Beta’s copy SURVIVES Alpha’s delete', bStill.status === 200, 'status ' + bStill.status);
  const bInbox2 = await api('GET', '/api/chits/inbox', { token: B.token });
  check('Beta’s inbox still shows it', has(bInbox2.json, chit_id));

  // ===== 8 · CC-role delivery (fan-out) =====
  console.log('\n8 · CC-role delivery');
  const eid = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).identity_id; } catch (_) { return null; } };
  const gammaId = gammaOk ? eid(G.token) : null;
  if (gammaId) {
    const subj2 = 'REGCC ' + Date.now().toString().slice(-6);
    const snd2 = await api('POST', '/api/chits/send', { token: A.token, body: {
      recipients: [{ entity_id: BETA_ID, role: 'to' }, { entity_id: gammaId, role: 'cc' }],
      purpose: 'general', manual_subject: subj2, business_json: { note: 'cc test' } } });
    const chit2 = snd2.json && (snd2.json.chit_id || (snd2.json.chit && snd2.json.chit.chit_id));
    check('send with TO + CC succeeds', !!chit2, chit2 || JSON.stringify(snd2.json).slice(0, 160));
    if (chit2) {
      const gInbox2 = await api('GET', '/api/chits/inbox', { token: G.token });
      check('CC recipient (Gamma) RECEIVED a copy', has(gInbox2.json, chit2));
      const gDet2 = await api('GET', '/api/chits/' + chit2, { token: G.token });
      check('CC recipient can open it (now a participant)', gDet2.status === 200, 'status ' + gDet2.status);
      const bInbox3 = await api('GET', '/api/chits/inbox', { token: B.token });
      check('TO recipient (Beta) also received it', has(bInbox3.json, chit2));
    }
  } else check('CC delivery (skipped — no third entity id)', false);

  done();
})().catch(e => { console.error('HARNESS ERROR', e); done(); });

function done() {
  console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL);
  if (ISSUES.length) { console.log('\n-- ISSUES / THINGS TO REVIEW --'); ISSUES.forEach((i, n) => console.log((n + 1) + '. ' + i)); }
  process.exit(0);
}
