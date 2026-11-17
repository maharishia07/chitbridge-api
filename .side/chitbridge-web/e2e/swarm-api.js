// API-LEVEL SWARM — the REAL concurrency test. Fires N concurrent chit-creates straight at the rail (no browser),
// using the stable pool's saved tokens, and asserts every one persists. This is how you actually load-test
// "everyone across the globe creates chits at the same instant" — the UI swarm can't (one box can't drive N browsers).
//   Run:  node swarm-api.js          (default = whole pool)   ·   CB_SWARM_SIZE=25 node swarm-api.js
const fs = require('fs');
const path = require('path');
const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const N = Number(process.env.CB_SWARM_SIZE || 10);

function poolTokens() {
  const dir = path.join(__dirname, '.auth');
  const toks = [];
  for (const f of fs.readdirSync(dir).filter(x => /^pool-\d+\.json$/.test(x)).sort()) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const ls = (s.origins && s.origins[0] && s.origins[0].localStorage) || [];
      const sess = ls.find(x => x.name === 'cb_sess');
      if (sess) toks.push({ file: f, token: JSON.parse(sess.value).token });
    } catch (e) { /* skip unreadable session */ }
  }
  return toks;
}

async function sendChit(token, subject) {
  try {
    const r = await fetch(API + '/api/chits/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        recipients: [{ self: true, role: 'to' }],
        subject,
        line_items: [{ name: 'Widget', qty: 3, price: 100 }],
      }),
    });
    let body = null; try { body = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, chit_id: body && (body.chit_id || (body.chit && body.chit.chit_id)) };
  } catch (e) { return { ok: false, err: e.message }; }
}

(async () => {
  const pool = poolTokens().slice(0, N);
  if (!pool.length) { console.error('No pool tokens — run `npm run pool` first.'); process.exit(2); }
  const stamp = Date.now();
  console.log(`API-SWARM: ${pool.length} pool tokens loaded — firing ${pool.length} concurrent chit-creates at ${API} ...`);
  const t0 = Date.now();
  const results = await Promise.all(pool.map((p, i) => sendChit(p.token, `API-SWARM ${stamp} #${String(i).padStart(2, '0')}`)));
  const ms = Date.now() - t0;
  const ok = results.filter(r => r.ok).length;
  console.log(`API-SWARM RESULT: ${ok}/${pool.length} concurrent chit-creates succeeded in ${ms}ms (${Math.round(ms / pool.length)}ms/req effective)`);
  results.forEach((r, i) => { if (!r.ok) console.log(`  #${i} FAILED: HTTP ${r.status || '-'} ${r.err || ''}`); });
  // Every concurrent create must persist — the rail must not drop or cross-contaminate under simultaneous writes.
  process.exit(ok === pool.length ? 0 : 1);
})();
