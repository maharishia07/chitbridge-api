// FX rate read-vs-correction race loop (FULLPROOF C8). Needs a throwaway postgres with table fx_rate(rate_id bigserial pk, entity_id uuid, rate_date date, from_ccy, to_ccy, rate numeric, source, source_ref, entered_by, created_at). usage: FXDB_URL=... node tests/fx-rate-race.loop.cjs lib/books-store.js 200 -> wrong_rate must be 0 (before the lock: 53/200)
const fs = require('fs'), { Pool } = require('pg');
const src = fs.readFileSync(process.argv[2], 'utf8');
const grab = (re) => { const m = re.exec(src); if (!m) throw new Error('missing ' + re); return m[0]; };
const FX_COLS = "rate_id, rate_date, from_ccy, to_ccy, rate::text AS rate, source, source_ref, entered_by, created_at";
let lockSrc = /const fxLock = [^\n]*\n/.exec(src); lockSrc = lockSrc ? lockSrc[0] : 'const fxLock = async () => {};\n';
const insSrc = grab(/async function insertFxRates[\s\S]*?\n}\n/), onSrc = grab(/async function fxRateOn[\s\S]*?\n}\n/);
const lib = new Function('FX_COLS', lockSrc + insSrc + onSrc + 'return { insertFxRates, fxRateOn };')(FX_COLS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const pool = new Pool({ connectionString: process.env.FXDB_URL, max: 6 });
  const N = Number(process.argv[3]); let wrong = 0, p60 = 0, p70 = 0;
  for (let i = 0; i < N; i++) {
    const ent = require('crypto').randomUUID(), day = '2026-10-15';
    await pool.query("INSERT INTO fx_rate (entity_id,rate_date,from_ccy,to_ccy,rate,source) VALUES ($1,$2,'AUD','INR',54.60,'manual')", [ent, day]);
    const poster = (async () => { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await lib.fxRateOn(c, ent, 'AUD', 'INR', day); await sleep(Math.random() * 25); const sent = process.hrtime.bigint(); await c.query('COMMIT'); return { rate: Number(r.rate), sent }; } finally { c.release(); } })();
    const corr = (async () => { await sleep(Math.random() * 25); const c = await pool.connect(); try { await c.query('BEGIN'); await lib.insertFxRates(c, ent, [{ rate_date: day, from_ccy: 'AUD', to_ccy: 'INR', rate: '54.70', source: 'manual', source_ref: null }], null); await sleep(Math.random() * 10); await c.query('COMMIT'); return process.hrtime.bigint(); } finally { c.release(); } })();
    const [p, done] = await Promise.all([poster, corr]);
    if (p.rate === 54.6) p60++; else p70++;
    if (p.rate === 54.6 && done < p.sent) wrong++;   // correction committed before the posting began to commit, yet it posted the old rate
  }
  console.log(JSON.stringify({ iterations: N, posted_at_54_60: p60, posted_at_54_70: p70, wrong_rate: wrong }));
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
