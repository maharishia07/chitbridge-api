// ACTOR-perspective harness. Invariants: (1) NOTHING shared between entities; (2) NOTHING private to an actor
// except drafts. Creates two actors under Alpha (Ana, Bob), logs in as each, and checks sharing/isolation.
const BASE = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const ALPHA = 'Alpha Timbers', BETA = 'Beta Traders', ALPHA_ID = '71373522-147e-4a75-966a-73de3d8bf045', BETA_ID = '75c378a6-ad7f-4b58-87d2-e1509cbb0482';
let PASS = 0, FAIL = 0; const ISSUES = [];
function check(name, ok, detail) { if (ok) { PASS++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); } else { FAIL++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')); ISSUES.push(name + (detail ? ' — ' + detail : '')); } return ok; }
async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }; if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (_) {} return { status: res.status, json };
}
async function entLogin(name) { const r = await api('POST', '/api/entities/register', { body: { email: name } }); const o = r.json && r.json.dev_otp; if (!o) return {}; const v = await api('POST', '/api/entities/verify', { body: { email: r.json.email, otp: o } }); return { token: v.json && v.json.token }; }
const has = (o, id) => JSON.stringify(o || '').includes(id);

(async () => {
  console.log('== ACTOR-PERSPECTIVE HARNESS ==  ' + BASE + '\n');
  const A = await entLogin(ALPHA), B = await entLogin(BETA);
  check('Alpha entity login', !!A.token); check('Beta entity login', !!B.token);
  if (!A.token || !B.token) return done();

  // create two actors under Alpha
  const ts = Date.now().toString().slice(-6);
  async function mkActor(key, nm) {
    const c = await api('POST', '/api/actors', { token: A.token, body: { display_name: nm, actor_key: key, hat: 'act' } });
    const otp = c.json && (c.json.otp || c.json.dev_otp || (c.json.actor && c.json.actor.otp));
    if (!otp) return { err: 'no otp: ' + JSON.stringify(c.json).slice(0, 160) };
    const l = await api('POST', '/api/actors/login', { body: { username: key + '@' + ALPHA.toLowerCase(), otp } });
    return { token: l.json && l.json.token, err: l.json && l.json.message };
  }
  const ana = await mkActor('ana' + ts, 'Ana Reg'), bob = await mkActor('bob' + ts, 'Bob Reg');
  check('Actor Ana created + logged in', !!ana.token, ana.err); check('Actor Bob created + logged in', !!bob.token, bob.err);
  if (!ana.token || !bob.token) return done();

  // ===== 1 · Actors SHARE the entity's inbox (not actor-private) =====
  console.log('\n1 · Actors share the entity mailbox');
  const snd = await api('POST', '/api/chits/send', { token: B.token, body: { recipients: [{ entity_id: ALPHA_ID, role: 'to' }], purpose: 'general', manual_subject: 'ACTORTEST ' + ts, business_json: {} } });
  const chit_id = snd.json && (snd.json.chit_id || (snd.json.chit && snd.json.chit.chit_id));
  check('Beta sent a chit to Alpha', !!chit_id, chit_id);
  if (chit_id) {
    const anaIn = await api('GET', '/api/chits/inbox', { token: ana.token });
    check('Ana (actor) SEES the entity inbox chit', has(anaIn.json, chit_id));
    const bobIn = await api('GET', '/api/chits/inbox', { token: bob.token });
    check('Bob (other actor) ALSO sees it (shared, not actor-private)', has(bobIn.json, chit_id));
    const anaDet = await api('GET', '/api/chits/' + chit_id, { token: ana.token });
    check('Ana can open it', anaDet.status === 200, 'status ' + anaDet.status);
    const bobDet = await api('GET', '/api/chits/' + chit_id, { token: bob.token });
    check('Bob can open it too', bobDet.status === 200, 'status ' + bobDet.status);
  }

  // ===== 2 · Cross-entity isolation FROM AN ACTOR =====
  console.log('\n2 · Actor cannot see another entity\'s data');
  const bSelf = await api('POST', '/api/chits/send', { token: B.token, body: { recipients: [{ entity_id: BETA_ID, role: 'to' }], purpose: 'general', manual_subject: 'BETAONLY ' + ts, business_json: {} } });
  const betaChit = bSelf.json && (bSelf.json.chit_id || (bSelf.json.chit && bSelf.json.chit.chit_id));
  check('Beta made a Beta-only chit', !!betaChit, betaChit);
  if (betaChit) {
    const anaTry = await api('GET', '/api/chits/' + betaChit, { token: ana.token });
    check('Ana (Alpha actor) CANNOT open Beta\'s chit', anaTry.status === 403 || anaTry.status === 404, 'status ' + anaTry.status);
    const anaIn2 = await api('GET', '/api/chits/inbox', { token: ana.token });
    check('Beta\'s chit is NOT in Ana\'s inbox', !has(anaIn2.json, betaChit));
  }

  // ===== 3 · DRAFTS are actor-private (the ONLY allowed private) =====
  console.log('\n3 · Draft privacy (author-only)');
  const dr = await api('POST', '/api/chits/send', { token: ana.token, body: { is_draft: true, purpose: 'general', manual_subject: 'ANADRAFT ' + ts, business_json: {} } });
  const draftId = dr.json && (dr.json.chit_id || (dr.json.chit && dr.json.chit.chit_id));
  check('Ana can create a draft', !!draftId, draftId || JSON.stringify(dr.json).slice(0, 140));
  if (draftId) {
    const anaDrafts = await api('GET', '/api/chits/folder?view=drafts', { token: ana.token });
    check('Ana sees HER draft in drafts', has(anaDrafts.json, draftId));
    const bobDrafts = await api('GET', '/api/chits/folder?view=drafts', { token: bob.token });
    check('Bob does NOT see Ana\'s draft in drafts', !has(bobDrafts.json, draftId));
    // the sharper test: can Bob reach it directly? (draft is an entity-owned row → RLS lets Bob read the ROW)
    const bobReach = await api('GET', '/api/chits/' + draftId, { token: bob.token });
    check('Bob CANNOT open Ana\'s draft directly (author-scoped)', bobReach.status === 403 || bobReach.status === 404, 'status ' + bobReach.status + (bobReach.status === 200 ? '  ⚠ LEAK: draft readable by another actor' : ''));
    const anaReach = await api('GET', '/api/chits/' + draftId, { token: ana.token });
    check('Ana can open her own draft', anaReach.status === 200, 'status ' + anaReach.status);
  }

  // ===== 4 · Everything else is SHARED among actors (a message Ana posts, Bob sees) =====
  console.log('\n4 · Non-draft data shared among actors');
  if (chit_id) {
    const anaMsg = await api('POST', '/api/chits/' + chit_id + '/messages', { token: ana.token, body: { message_text: 'note from ana ' + ts, thread_type: 'external' } });
    check('Ana can post a message on the entity chit', anaMsg.status === 200 || anaMsg.status === 201, 'status ' + anaMsg.status);
    const bobMsgs = await api('GET', '/api/chits/' + chit_id + '/messages', { token: bob.token });
    check('Bob (other actor) SEES Ana\'s message (shared)', has(bobMsgs.json, 'note from ana ' + ts));
  }

  done();
})().catch(e => { console.error('HARNESS ERROR', e); done(); });

function done() {
  console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL);
  if (ISSUES.length) { console.log('\n-- ISSUES / REVIEW --'); ISSUES.forEach((i, n) => console.log((n + 1) + '. ' + i)); }
  process.exit(0);
}
