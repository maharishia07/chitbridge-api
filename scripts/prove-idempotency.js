// prove-idempotency.js — LIVE proof of the offline-outbox idempotency layer (Phase 2). node scripts/prove-idempotency.js
// Proves a replayed mutation executes AT MOST ONCE: same Idempotency-Key ⇒ same chit (no double), replay header set;
// new key ⇒ new chit; same key + different body ⇒ 422. Needs the API up + b109 run.
const B = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
let P = 0, F = 0;
const chk = (n, ok, d) => { ok ? (P++, console.log('  ✓ ' + n + (d ? '  ' + d : ''))) : (F++, console.log('  ✗ ' + n + (d ? '  — ' + d : ''))); };
async function api(m, p, o) { o = o || {}; const h = { 'Content-Type': 'application/json' }; if (o.token) h.Authorization = 'Bearer ' + o.token; if (o.idem) h['Idempotency-Key'] = o.idem; const r = await fetch(B + p, { method: m, headers: h, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch (_) {} return { status: r.status, j, replay: r.headers.get('X-Idempotent-Replay') }; }
async function login(email) { const reg = await api('POST', '/api/entities/register', { body: { email } }); const v = await api('POST', '/api/entities/verify', { body: { email, otp: reg.j && reg.j.dev_otp } }); return { token: v.j && v.j.token }; }
const chitId = (r) => r.j && (r.j.chit_id || (r.j.chit && r.j.chit.chit_id));
const uuid = () => 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });

(async () => {
  console.log('== PROVE IDEMPOTENCY (offline-outbox Phase 2) ==  ' + B + '\n');
  const ts = Date.now().toString().slice(-6);
  const me = await login('idem-' + ts + '@t.com');
  chk('login', !!me.token);

  const key = uuid();
  const body = { recipients: [{ name: 'self', role: 'to' }], purpose: 'general', manual_subject: 'idem-' + ts, line_items: [] };
  // 1 · first send with the key
  const r1 = await api('POST', '/api/chits/send', { token: me.token, idem: key, body });
  chk('first send succeeds', r1.status === 200 || r1.status === 201, 'chit=' + String(chitId(r1) || '').slice(0, 8));
  // 2 · REPLAY the same key + same body → must NOT create a second chit
  const r2 = await api('POST', '/api/chits/send', { token: me.token, idem: key, body });
  chk('replay returns the SAME chit (executed at most once)', !!chitId(r1) && chitId(r2) === chitId(r1), 'c1=' + String(chitId(r1) || '').slice(0, 8) + ' c2=' + String(chitId(r2) || '').slice(0, 8));
  chk('replay is marked X-Idempotent-Replay', r2.replay === 'true', 'header=' + r2.replay);
  // 3 · a DIFFERENT key → a genuinely new chit
  const r3 = await api('POST', '/api/chits/send', { token: me.token, idem: uuid(), body });
  chk('a new key creates a NEW chit', !!chitId(r3) && chitId(r3) !== chitId(r1));
  // 4 · same key reused with a DIFFERENT body → 422 (guards against key collision masking a different request)
  const r4 = await api('POST', '/api/chits/send', { token: me.token, idem: key, body: { ...body, manual_subject: 'DIFFERENT-' + ts } });
  chk('same key + different body → 422', r4.status === 422, 'status=' + r4.status);
  // 5 · no key still works normally (opt-in)
  const r5 = await api('POST', '/api/chits/send', { token: me.token, body });
  chk('no Idempotency-Key → normal behaviour (new chit)', (r5.status === 200 || r5.status === 201) && !!chitId(r5));

  console.log('\n== RESULT ==  PASS ' + P + '  ·  FAIL ' + F);
  process.exit(0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(0); });
