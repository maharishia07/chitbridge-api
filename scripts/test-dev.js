// scripts/test-dev.js — jq-free, bash-free dev test runner (Windows-friendly: just Node).
// Runs the key health + isolation (A4) + assist-dormant checks against a deployed dev API and prints PASS/FAIL.
// Usage:  node scripts/test-dev.js https://<dev-api>
// (The fuller bash smoke — OTP lockout, price-tamper — stays in scripts/smoke-review-fixes.sh for CI/Linux.)
const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = (process.argv[2] || process.env.API_BASE || '').replace(/\/+$/, '');
if (!BASE) { console.error('Usage: node scripts/test-dev.js https://<dev-api>'); process.exit(2); }
const DEV_OTP = process.env.DEV_OTP || '123456';
const TS = Date.now();
let PASS = 0, FAIL = 0, SKIP = 0;

function req(method, path, token, body) {
  return new Promise((resolve) => {
    let u; try { u = new URL(BASE + path); } catch (e) { return resolve({ status: 0, err: true, raw: e.message }); }
    const lib = u.protocol === 'https:' ? https : http;
    const data = body != null ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method, headers, timeout: 15000 }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, json: j, raw: b }); });
    });
    r.on('error', e => resolve({ status: 0, err: true, raw: String(e.message) }));
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, err: true, raw: 'timeout' }); });
    if (data) r.write(data); r.end();
  });
}
const pass = (m) => { console.log('PASS  ' + m); PASS++; };
const fail = (m, extra) => { console.log('FAIL  ' + m + (extra ? '  [' + extra + ']' : '')); FAIL++; };
const skip = (m) => { console.log('SKIP  ' + m); SKIP++; };
const deny = (m, r) => { (r.status >= 400) ? pass(m + ' (denied ' + r.status + ')') : fail(m, 'got ' + r.status + ' — expected >=400 [P0 if it leaked A data]'); };
const makeEntity = async (name, email) => {
  await req('POST', '/api/entities/register', null, { email, display_name: name });
  const v = await req('POST', '/api/entities/verify', null, { email, otp: DEV_OTP });
  return v.json && v.json.token;
};

(async () => {
  console.log('== Chit & Bridge — dev test runner (jq-free) ==');
  console.log('API_BASE=' + BASE + '\n');

  const h = await req('GET', '/health', null, null);
  if (h.status === 200) pass('health 200 — API reachable');
  else { fail('health', h.err ? h.raw : ('status ' + h.status)); console.log('\nCannot reach the API. Check the URL and that the deploy is live.'); process.exit(1); }

  const as = await req('POST', '/api/assist', null, { q: 'hi', context: 'welcome' });
  (as.status === 503) ? pass('assist dormant -> 503 (F0)') : fail('assist 503 (F0)', 'got ' + as.status);

  const A = await makeEntity('TA' + TS, 'ta-' + TS + '@example.com');
  const B = await makeEntity('TB' + TS, 'tb-' + TS + '@example.com');
  if (!A || !B) { fail('setup A/B (register/verify) — is DEV_OTP=123456 on dev?'); console.log('\n== summary: PASS=' + PASS + ' FAIL=' + FAIL + ' =='); process.exit(1); }
  pass('setup — A + B registered & verified');

  const me = await req('GET', '/api/entities/me', A, null);
  const A_ID = me.json && (me.json.identity_id || (me.json.entity && me.json.entity.identity_id));

  await req('POST', '/api/chits/send', A, { recipients: [{ role: 'to', self: true }], subject: 'iso' + TS, line_items: [] });
  const sent = await req('GET', '/api/chits/sent', A, null);
  const A_CHIT = sent.json && ((sent.json.chits && sent.json.chits[0] && sent.json.chits[0].chit_id) || (Array.isArray(sent.json) && sent.json[0] && sent.json[0].chit_id) || (sent.json.rows && sent.json.rows[0] && sent.json.rows[0].chit_id));

  if (!A_CHIT) { skip('isolation chit probes — could not create A\'s chit'); }
  else {
    const ctl = await req('GET', '/api/chits/' + A_CHIT, A, null);
    (ctl.status === 200) ? pass('control — A sees its own chit (200)') : fail('control — A cannot see own chit', 'status ' + ctl.status + '; setup broken');
    deny('I1 B read A chit detail',     await req('GET',    '/api/chits/' + A_CHIT,            B, null));
    deny('I2 B read A chit messages',   await req('GET',    '/api/chits/' + A_CHIT + '/messages', B, null));
    deny('I3 B change A chit status',   await req('PUT',    '/api/chits/' + A_CHIT + '/status', B, { status: 'in_progress' }));
    deny('I4 B raise dispute on A',     await req('POST',   '/api/chits/' + A_CHIT + '/disputes', B, { category: 'quality', reason: 'x' }));
    deny('I5 B archive A chit',         await req('POST',   '/api/chits/' + A_CHIT + '/archive', B, {}));
    deny('I6 B void A chit',            await req('PUT',    '/api/chits/' + A_CHIT + '/void',    B, { reason: 'x' }));
    deny('I7 B delete A chit',          await req('DELETE', '/api/chits/' + A_CHIT,             B, null));
    const nf = await req('GET', '/api/notifications', B, null);
    const leak = ((nf.json && nf.json.notifications) || []).filter(n => n.chit_id === A_CHIT).length;
    (leak === 0) ? pass('I9 A chit absent from B notifications') : fail('I9 A chit leaked into B notifications', 'count ' + leak + ' [P0]');
  }
  if (A_ID) {
    const sc = await req('GET', '/api/relationships/suppliers/' + A_ID + '/catalogue', B, null);
    const items = ((sc.json && sc.json.items) || []).length;
    (items === 0) ? pass('I10 B cannot read A supplier catalogue (empty)') : fail('I10 B read A catalogue', 'items ' + items + ' [P0]');
  } else skip('I10 supplier catalogue — no A id');

  console.log('\n== summary: PASS=' + PASS + ' FAIL=' + FAIL + ' SKIP=' + SKIP + ' ==');
  process.exit(FAIL === 0 ? 0 : 1);
})();
