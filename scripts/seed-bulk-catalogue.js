#!/usr/bin/env node
/**
 * seed-bulk-catalogue.js — put a real number of products in a store, so search can be measured rather than guessed.
 *
 * Athi, 2026-08-08: *"we may have to add a catalogue from some store with 10000s of rows for testing and check how
 * it works and accordingly fine tune."*
 *
 * Everything measured so far has been measured on catalogues of ONE ITEM, where the entire cost is round-trip
 * latency and the query plan is irrelevant — Postgres will scan four rows faster than it can consider an index.
 * None of it says anything about the shape at volume, and b121's trigram indexes cannot be shown to help until
 * there is something for them to help with.
 *
 *   DEV_OTP=123456 node scripts/seed-bulk-catalogue.js --email=bulk@test-cb.com --count=20000
 *   DEV_OTP=123456 node scripts/seed-bulk-catalogue.js --email=bulk@test-cb.com --count=20000 --measure
 *
 * `--measure` skips seeding and just times searches against whatever is already there.
 *
 * ⚠️ It writes through the ORDINARY product API, one request per batch, so what lands is exactly what a real
 * import would produce — same validation, same stamping, same RLS. A direct SQL insert would seed rows the
 * application could never have created and prove nothing about the real path.
 */
'use strict';

const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = process.env.DEV_OTP || '123456';
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith('--' + k + '='));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const EMAIL = arg('email', 'bulk@test-cb.com');
const COUNT = parseInt(arg('count', '20000'), 10);
const MEASURE_ONLY = process.argv.includes('--measure');

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

/* A catalogue that looks like a real one: repeated families, sizes and materials, so a search for "impeller"
   matches thousands and a search for a code matches one. A file of "Product 1..N" would make every query either
   match everything or nothing, and neither is the case that hurts. */
const FAMILY = ['Impeller', 'Shaft seal', 'Bearing housing', 'Coupling', 'Mechanical seal', 'Wear ring',
                'Diffuser', 'Casing', 'Motor stator', 'Thrust washer', 'Gasket set', 'Sleeve'];
const MATERIAL = ['cast iron', 'bronze', '316 stainless', 'duplex', 'PTFE-lined', 'ceramic'];
const SIZE = ['32', '40', '50', '65', '80', '100', '125', '150', '200', '250'];

function itemAt(i) {
  const f = FAMILY[i % FAMILY.length];
  const m = MATERIAL[Math.floor(i / FAMILY.length) % MATERIAL.length];
  const s = SIZE[Math.floor(i / (FAMILY.length * MATERIAL.length)) % SIZE.length];
  return {
    name: `${f} ${s}mm ${m}`,
    code: 'P' + String(100000 + i),
    unit: 'each',
    price: 50 + ((i * 37) % 4000),
  };
}

(async () => {
  console.log('\n' + '═'.repeat(74));
  console.log('  BULK CATALOGUE — measuring search at volume, not at one row');
  console.log('═'.repeat(74));
  console.log('  ' + API + '\n');

  await api('/api/entities/register', { method: 'POST', body: { email: EMAIL, display_name: 'Bulk Test Store' } });
  const v = await api('/api/entities/verify', { method: 'POST', body: { email: EMAIL, otp: OTP } });
  const token = (v.json || {}).token;
  if (!token) { console.log('  could not sign in as ' + EMAIL + ' — is DEV_OTP set on the server?\n'); process.exit(1); }
  await api('/api/schemas/create-default', { method: 'POST', token });

  const before = await api('/api/products', { token });
  const have = (((before.json || {}).items) || []).length;
  console.log('  store: ' + EMAIL + '   already holds ~' + have + ' item(s) (first page)');

  if (!MEASURE_ONLY) {
    /**
     * ⚠️ THE CSV IMPORT, NOT ONE REQUEST PER ITEM.
     *
     * The first version posted each product individually and managed 3 per second — 20,000 rows would have taken
     * nearly two hours, which is not a test anybody runs. The import endpoint takes 2,000 rows in ONE request and
     * is the path a real merchant uses for a catalogue this size, so it is both faster and more honest: it
     * exercises preflight, validation and stamping exactly as an upload would.
     */
    const BATCH = 2000;   // routes/products.js IMPORT_MAX_ROWS — split above this or the upload is refused whole
    console.log('  seeding ' + COUNT.toLocaleString() + ' items via the CSV import path, ' + BATCH + ' per upload…');
    const t0 = Date.now();
    let ok = 0, failed = 0;
    for (let start = 0; start < COUNT; start += BATCH) {
      const n = Math.min(BATCH, COUNT - start);
      const lines = ['name,code,unit,price'];
      for (let i = 0; i < n; i++) {
        const it = itemAt(start + i);
        lines.push([it.name, it.code, it.unit, it.price].join(','));
      }
      const csvText = lines.join('\n');
      // The decisions are built from preflight's OWN mapping — `incoming` (the file's header) and `canonical`
      // (the catalogue column it matched). Guessing this shape cost a wasted run: the first attempt sent
      // `{header, field}`, nothing mapped, and the import correctly refused with "no row had a product name".
      const pre = await api('/api/products/import/preflight', { method: 'POST', token, body: { csv: csvText } });
      const mapping = (((pre.json || {}).report) || {}).mapping || [];
      const decisions = mapping
        .filter((m) => m.canonical && m.how !== 'blocked' && m.how !== 'not-accepted')
        .map((m) => ({ incoming: m.incoming, action: 'map', field: m.canonical }));
      const r = await api('/api/products/import', { method: 'POST', token,
        body: { csv: csvText, decisions, confirm: true } });
      if (r.status === 200) { ok += n; } else {
        failed += n;
        if (failed === n) console.log('\n    import refused: ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 300));
      }
      const el = Math.max(1, (Date.now() - t0) / 1000);
      process.stdout.write('\r    ' + (ok + failed) + '/' + COUNT + '  ' + Math.round((ok + failed) / el) + '/s   ');
    }
    console.log('\n    seeded ' + ok + ', failed ' + failed + ', in ' + Math.round((Date.now() - t0) / 1000) + 's');
  }

  // ── MEASURE ────────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n  SEARCH TIMINGS — the network locator, against this catalogue\n');
  const probes = [
    ['impeller', 'a word matching thousands'],
    ['P100777',  'an exact code matching one'],
    ['duplex',   'a material matching many'],
    ['zzzzz',    'matching nothing'],
  ];
  for (const [q, why] of probes) {
    const runs = [];
    for (let k = 0; k < 3; k++) {
      const t = Date.now();
      const r = await api('/api/network-design/availability?q=' + encodeURIComponent(q), { token });
      runs.push(Date.now() - t);
      if (k === 0 && r.status !== 200) console.log('    (' + q + ' → ' + r.status + ')');
    }
    const best = Math.min(...runs);
    console.log('    ' + q.padEnd(11) + best + ' ms  (best of 3)   ' + why);
  }

  console.log('\n  WHAT TO LOOK FOR');
  console.log('    · a word matching thousands should NOT be much slower than one matching nothing —');
  console.log('      if it is, the LIMIT is being applied after a scan rather than during an index walk');
  console.log('    · run this before and after applying migrations/b121 (pg_trgm). If the numbers do not move,');
  console.log('      the index is not being used, and an index that is not used is worse than none.');
  console.log('    · EXPLAIN ANALYZE the real query in Supabase to confirm — timings alone can be misread\n');
})().catch((e) => { console.error('\n  harness error: ' + e.message + '\n'); process.exit(1); });
