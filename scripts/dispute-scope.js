/** @covers FR-D2 — a chit participant outside the dispute must not see its messages */
// Prove dispute-message scoping: a chit participant who is NOT in the dispute must NOT see dispute messages.
const BASE = 'https://chitbridge-api-production.up.railway.app';
const ALPHA = 'Alpha Timbers', BETA = 'Beta Traders', ALPHA_ID = '71373522-147e-4a75-966a-73de3d8bf045', BETA_ID = '75c378a6-ad7f-4b58-87d2-e1509cbb0482';
let PASS = 0, FAIL = 0;
function check(n, ok, d) { if (ok) { PASS++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { FAIL++; console.log('  ✗ ' + n + (d ? '  — ' + d : '')); } }
async function api(m, p, { token, body } = {}) { const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token; const r = await fetch(BASE + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, json: j }; }
async function login(n) { const r = await api('POST', '/api/entities/register', { body: { email: n } }); const o = r.json && r.json.dev_otp; if (!o) return {}; const v = await api('POST', '/api/entities/verify', { body: { email: r.json.email, otp: o } }); return { token: v.json && v.json.token }; }
const eid = t => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).identity_id; } catch (_) { return null; } };
const has = (o, s) => JSON.stringify(o || '').includes(s);
(async () => {
  console.log('== DISPUTE MESSAGE SCOPING ==\n');
  const A = await login(ALPHA), B = await login(BETA), G = await login('gamma-reg@test.com');
  check('Alpha/Beta/Gamma logged in', A.token && B.token && G.token);
  if (!(A.token && B.token && G.token)) return done();
  const gid = eid(G.token);
  const ts = Date.now().toString().slice(-5);
  // Alpha -> Beta(to) + Gamma(cc): all three are CHIT participants
  const snd = await api('POST', '/api/chits/send', { token: A.token, body: { recipients: [{ entity_id: BETA_ID, role: 'to' }, { entity_id: gid, role: 'cc' }], purpose: 'general', manual_subject: 'DSCOPE ' + ts, business_json: {} } });
  const chit = snd.json && (snd.json.chit_id || (snd.json.chit && snd.json.chit.chit_id));
  check('3-party chit created (Beta TO, Gamma CC)', !!chit, chit);
  if (!chit) return done();
  check('Gamma is a chit participant', has((await api('GET', '/api/chits/inbox', { token: G.token })).json, chit));
  // Beta raises a TARGETED dispute against Alpha only (Gamma is NOT a dispute party)
  const disp = await api('POST', '/api/chits/' + chit + '/disputes', { token: B.token, body: { category: 'quality', reason: 'Targeted dispute against Alpha only for scope test.', target_entity_id: ALPHA_ID, chit_wide: false } });
  const did = disp.json && (disp.json.dispute_id || (disp.json.dispute && disp.json.dispute.dispute_id));
  check('Beta raised a targeted dispute vs Alpha', !!did, did || JSON.stringify(disp.json).slice(0, 160));
  if (!did) return done();
  // Beta posts a dispute message
  const dm = await api('POST', '/api/chits/' + chit + '/messages', { token: B.token, body: { message_text: 'DISPUTE-SECRET-' + ts, thread_type: 'external', is_dispute: true, dispute_id: did } });
  check('Beta posted a dispute message', dm.status === 200 || dm.status === 201, 'status ' + dm.status);
  // Alpha (dispute party) SEES it
  const aMsgs = await api('GET', '/api/chits/' + chit + '/messages', { token: A.token });
  check('Alpha (dispute party) SEES the dispute message', has(aMsgs.json, 'DISPUTE-SECRET-' + ts));
  // Gamma (chit participant, NOT dispute party) must NOT see it
  const gMsgs = await api('GET', '/api/chits/' + chit + '/messages', { token: G.token });
  check('Gamma (chit party, NOT dispute party) does NOT see it', !has(gMsgs.json, 'DISPUTE-SECRET-' + ts), 'Gamma msg payload len ' + JSON.stringify(gMsgs.json || '').length);
  done();
})().catch(e => { console.error('ERR', e); done(); });
function done() { console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL); process.exit(FAIL ? 1 : 0); }
