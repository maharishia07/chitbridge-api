// self-copy-pref.js — policy-flag #1: the self-chit copy policy + the co-held invariant + the governance stamp.
//   both      → self-chit lands in Order (sent) AND Task (received)
//   sent      → ORDER-only: the self Task copy is suppressed
//   received  → TASK-only: the sender's Order copy is suppressed
// INVARIANT: suppression is SELF-CHIT-ONLY — an inter-entity chit ALWAYS keeps both copies (cb-core-principle).
// Every suppression is DECLARED on the chit via summary_json.copy_policy (governed, auditable — never a silent gap).
// Backend: routes/chits.js (manual self-chits). IoT task-only lives in routes/connectors.js (emitSignalChit) —
// verify that path via lifecycle-iot.js or a live device signal; this harness covers the manual flag + the invariant.
// Run: node scripts/self-copy-pref.js
const BASE = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
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
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}
async function login(email) {
  const reg = await api('POST', '/api/entities/register', { body: { email } });
  const otp = reg.json && reg.json.dev_otp; if (!otp) return { err: JSON.stringify(reg.json) };
  const ver = await api('POST', '/api/entities/verify', { body: { email: reg.json.email, otp } });
  return { token: ver.json && ver.json.token };
}
const has = (obj, id) => JSON.stringify(obj || '').includes(id);
const eid = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).identity_id; } catch (_) { return null; } };
const setPref = (token, pref) => api('PATCH', '/api/entities/profile', { token, body: { self_copy_pref: pref } });
async function sendSelf(token, subj) {
  const r = await api('POST', '/api/chits/send', { token, body: {
    recipients: [{ self: true, role: 'to' }], purpose: 'general', manual_subject: subj, business_json: { note: 'scp test' } } });
  return r.json && (r.json.chit_id || (r.json.chit && r.json.chit.chit_id));
}
const inOrder = async (token, id) => has((await api('GET', '/api/chits/sent',  { token })).json, id);
const inTask  = async (token, id) => has((await api('GET', '/api/chits/inbox', { token })).json, id);
const detail  = (token, id) => api('GET', '/api/chits/' + id, { token });

(async () => {
  console.log('== SELF-COPY-PREF (policy-flag #1) ==  ' + BASE + '\n');
  const ts = Date.now().toString().slice(-6);
  const S = await login('scp-self-' + ts + '@test.com');
  const R = await login('scp-recv-' + ts + '@test.com');
  check('self entity login', !!S.token, S.err);
  check('recipient entity login', !!R.token, R.err);
  if (!S.token || !R.token) return done();
  const R_ID = eid(R.token);

  // 1 · both (default) — Order + Task, nothing suppressed, no stamp
  console.log('\n1 · both — Order + Task present, no suppression');
  await setPref(S.token, 'both');
  const c1 = await sendSelf(S.token, 'SCP both ' + ts);
  check('send self-chit (both)', !!c1, c1 || 'no chit_id');
  if (c1) {
    check('both → Order copy present', await inOrder(S.token, c1));
    check('both → Task copy present', await inTask(S.token, c1));
    const d1 = (await detail(S.token, c1)).json;
    check('both → self-chit identity KEPT (scope:self, nothing suppressed)', has(d1, '"scope":"self"') && has(d1, '"suppressed":[]'));
  }

  // 2 · order-only ('sent') — Task copy suppressed + declared
  console.log("\n2 · order-only ('sent') — Task copy suppressed");
  await setPref(S.token, 'sent');
  const c2 = await sendSelf(S.token, 'SCP order ' + ts);
  check('send self-chit (order-only)', !!c2, c2 || 'no chit_id');
  if (c2) {
    check('order-only → Order copy present', await inOrder(S.token, c2));
    check('order-only → Task copy ABSENT', !(await inTask(S.token, c2)));
    const d = (await detail(S.token, c2)).json;
    check('order-only → copy_policy declares Task suppressed', has(d, 'copy_policy') && has(d, 'Task copy suppressed'));
  }

  // 3 · task-only ('received') — Order copy suppressed + declared
  console.log("\n3 · task-only ('received') — Order copy suppressed");
  await setPref(S.token, 'received');
  const c3 = await sendSelf(S.token, 'SCP task ' + ts);
  check('send self-chit (task-only)', !!c3, c3 || 'no chit_id');
  if (c3) {
    check('task-only → Task copy present', await inTask(S.token, c3));
    check('task-only → Order copy ABSENT', !(await inOrder(S.token, c3)));
    const d = (await detail(S.token, c3)).json;
    check('task-only → copy_policy declares Order suppressed', has(d, 'copy_policy') && has(d, 'Order copy suppressed'));
  }

  // 4 · INVARIANT — flag STILL 'received', but an inter-entity chit keeps BOTH copies (suppression is self-only)
  console.log('\n4 · co-held invariant — inter-entity chit ignores the flag');
  const r4 = await api('POST', '/api/chits/send', { token: S.token, body: {
    recipients: [{ entity_id: R_ID, role: 'to' }], purpose: 'general', manual_subject: 'SCP xent ' + ts, business_json: { note: 'invariant' } } });
  const c4 = r4.json && (r4.json.chit_id || (r4.json.chit && r4.json.chit.chit_id));
  check('send inter-entity chit', !!c4, c4 || 'no chit_id');
  if (c4) {
    check('inter-entity → sender KEEPS Order copy (not suppressed)', await inOrder(S.token, c4));
    check('inter-entity → recipient gets Task copy', await inTask(R.token, c4));
    check('inter-entity → NO copy_policy (suppression is self-only)', !has((await detail(S.token, c4)).json, 'copy_policy'));
  }

  await setPref(S.token, 'both');   // leave the throwaway entity at default
  console.log('\n(IoT task-only is enforced in emitSignalChit — verify via lifecycle-iot.js or a live device signal.)');
  done();
})().catch(e => { console.error('HARNESS ERROR', e); done(); });

function done() {
  console.log('\n== RESULT ==  PASS ' + PASS + '  ·  FAIL ' + FAIL);
  if (ISSUES.length) { console.log('\n-- ISSUES --'); ISSUES.forEach((i, n) => console.log((n + 1) + '. ' + i)); }
  process.exit(0);
}
