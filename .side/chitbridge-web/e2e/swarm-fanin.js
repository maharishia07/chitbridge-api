// FAN-IN BULK LOAD — 99 senders push ~1MB chits at 1 recipient, concurrently. Stresses fan-in load + large-payload
// handling + per-copy replication (the recipient's inbox ends up with ~99 copies × 1MB). Pure API (no browser), fixed
// emails so re-runs REUSE the same entities (no churn). Batched so we don't OOM Railway-Hobby or trip the rate limiter.
//   node swarm-fanin.js            (99 senders, 1MB each, batches of 12)
//   CB_SENDERS=200 CB_PAYLOAD_MB=2 CB_BATCH=20 node swarm-fanin.js
const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const N = Number(process.env.CB_SENDERS || 99);
const MB = Number(process.env.CB_PAYLOAD_MB || 1);
const BATCH = Number(process.env.CB_BATCH || 12);
const OTP = require('./lib/signin-code.cjs').codeOrSkip(API);   // SEC1: E2E_TESTER_CODE on a deployed api (unset → skipped with a warning)

async function authFixed(email, name) {                       // create-or-reuse (register re-issues OTP for an existing email)
  await fetch(API + '/api/entities/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, display_name: name }) });
  const r = await fetch(API + '/api/entities/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, otp: OTP }) });
  const j = await r.json().catch(() => ({}));
  return j.token;
}
const idFromToken = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).identity_id; } catch (e) { return null; } };
async function inBatches(items, size, fn) {                    // run `fn` over items, `size` at a time
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

(async () => {
  console.log(`FAN-IN: provisioning 1 recipient + ${N} senders (fixed emails, create-or-reuse)...`);
  const recipTok = await authFixed('e2e.fanin.recipient@test.example', 'FanIn Recipient');
  const recipId = idFromToken(recipTok);
  if (!recipId) { console.error('could not resolve recipient id (dev-OTP off?)'); process.exit(2); }

  const senderEmails = Array.from({ length: N }, (_, i) => `e2e.fanin.s${String(i + 1).padStart(3, '0')}@test.example`);
  const senderToks = (await inBatches(senderEmails, BATCH, (e, ) => authFixed(e, 'FanIn Sender'))).filter(Boolean);
  console.log(`FAN-IN: ${senderToks.length}/${N} senders ready. Recipient = ${recipId.slice(0, 8)}…`);

  const pad = 'x'.repeat(MB * 1024 * 1024);                    // ~MB of bulk payload
  const stamp = Date.now();
  const send = async (tok, i) => {
    const t0 = Date.now();
    try {
      const r = await fetch(API + '/api/chits/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ recipients: [{ entity_id: recipId, role: 'to' }], subject: `FANIN ${stamp} #${i}`, business_json: { bulk: pad } }),
      });
      return { ok: r.ok, status: r.status, ms: Date.now() - t0 };
    } catch (e) { return { ok: false, err: e.message, ms: Date.now() - t0 }; }
  };

  console.log(`FAN-IN: firing ${senderToks.length} × ${MB}MB sends → 1 recipient (batches of ${BATCH}) ...`);
  const t0 = Date.now();
  const res = await inBatches(senderToks.map((t, i) => ({ t, i })), BATCH, ({ t, i }) => send(t, i));
  const wall = Date.now() - t0;
  const ok = res.filter(r => r.ok).length;
  const avg = Math.round(res.reduce((a, r) => a + r.ms, 0) / res.length);
  const statuses = {}; res.forEach(r => { const k = r.ok ? '200' : (r.status || r.err || 'err'); statuses[k] = (statuses[k] || 0) + 1; });
  console.log(`\nFAN-IN RESULT: ${ok}/${senderToks.length} bulk sends landed · ${(ok * MB)}MB delivered to 1 recipient · ${wall}ms wall · ${avg}ms/req avg`);
  console.log('  status breakdown:', JSON.stringify(statuses));

  // verify the recipient's inbox received them
  const inbox = await fetch(API + '/api/chits/inbox?limit=500', { headers: { Authorization: 'Bearer ' + recipTok } }).then(r => r.json()).catch(() => ({}));
  const arr = Array.isArray(inbox) ? inbox : (inbox.items || inbox.chits || []);
  const got = arr.filter(c => String(c.manual_subject || c.subject || '').includes(`FANIN ${stamp}`)).length;
  console.log(`  recipient inbox now shows ${got} of this run's ${ok} sent (per-copy fan-in)`);
  process.exit(ok >= Math.ceil(senderToks.length * 0.9) ? 0 : 1);
})().catch(e => { console.error('FAN-IN ERR', e.message); process.exit(1); });
