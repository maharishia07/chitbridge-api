// db/index.js — PostgreSQL connection pool
const { Pool } = require('pg');

const POOLER_REGIONS = [
  'aws-1-ap-south-1',
  'aws-0-ap-south-1',
  'aws-0-ap-southeast-1',
  'aws-0-us-east-1',
  'aws-0-eu-west-1',
];

async function tryConnect(config) {
  return new Promise((resolve, reject) => {
    const p = new Pool({ ...config, max: 1, connectionTimeoutMillis: 5000 });
    p.connect((err, client, release) => {
      if (err) { p.end(); return reject(err); }
      release();
      p.end();
      resolve(true);
    });
  });
}

// SSL: off for local/CI Postgres, relaxed-verify for managed hosts (Supabase).
function sslForHost(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname) ? false : { rejectUnauthorized: false };
}

async function createPool() {
  const rawUrl = process.env.DATABASE_URL || '';
  let parsed;
  try { parsed = new URL(rawUrl); } catch (e) { throw new Error('Invalid DATABASE_URL'); }

  // 1) Try the DATABASE_URL exactly as given — a standard DSN. This honours a plain Postgres (CI / local / any
  //    direct connection) instead of forcing the Supabase pooler. On failure it falls through to the pooler
  //    discovery below, so the managed dev/prod path is preserved unchanged.
  const directSsl = sslForHost(parsed.hostname);
  try {
    await tryConnect({ connectionString: rawUrl, ssl: directSsl });
    console.log(`DB connected via DATABASE_URL: ${parsed.hostname}:${parsed.port || '5432'}`);
    return new Pool({ connectionString: rawUrl, ssl: directSsl, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  } catch (e) {
    console.log(`Direct DATABASE_URL connect failed (${e.message}); trying Supabase pooler fallback…`);
  }

  // 2) Supabase pooler fallback (managed dev/prod). Project ref is env-overridable; default kept for back-compat.
  const password = decodeURIComponent(parsed.password);
  const ref = process.env.SUPABASE_REF || 'bzacyrdrnzdbficjplcn';
  const sslConfig = { rejectUnauthorized: false };
  for (const region of POOLER_REGIONS) {
    const host = `${region}.pooler.supabase.com`;
    for (const user of [`postgres.${ref}`, 'postgres']) {
      const config = { host, port: 6543, user, password, database: 'postgres', ssl: sslConfig };
      try {
        await tryConnect(config);
        console.log(`DB connected via pooler: ${host} as ${user}`);
        return new Pool({ ...config, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
      } catch (e) {
        console.log(`Pooler ${region} user=${user} failed: ${e.message}`);
      }
    }
  }
  throw new Error('All connection attempts failed (direct DATABASE_URL + Supabase pooler regions)');
}

let pool;

createPool().then(p => {
  pool = p;
  p.on('error', err => console.error('Database error:', err.message));
}).catch(err => {
  console.error('DB init failed — server stays up, queries will retry:', err.message);
});

const query = async (text, params) => {
  if (!pool) throw new Error('Database not connected — check DATABASE_URL in Railway environment variables');
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    if (process.env.NODE_ENV === 'development') {
      console.log(`Query: ${text.substring(0, 50)} | ${Date.now() - start}ms | ${result.rowCount} rows`);
    }
    return result;
  } catch (err) {
    console.error('Query error:', err.message, '\nQuery:', text);
    throw err;
  }
};

// ── Run a set of writes atomically: BEGIN → fn(client) → COMMIT, else ROLLBACK ──
// Pass a function that does ALL its queries on the supplied `client` (NOT the pool
// `query`, or they won't be in the transaction). Returns whatever fn returns.
const withTransaction = async (fn) => {
  if (!pool) throw new Error('Database not connected — check DATABASE_URL in Railway environment variables');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rbErr) { console.error('Rollback failed:', rbErr.message); }
    throw err;
  } finally {
    client.release();   // always return the connection to the pool
  }
};

// ── B1 (RLS Stage-0) — entity-context primitive ──────────────────────────────────────────────────────────
// Run fn() inside a transaction with the caller's entity bound to the session, so RLS policies (once enabled)
// scope to it. Pass a function that does ALL its queries on the supplied `client` (the transaction) — exactly
// like withTransaction. ADDITIVE: changes nothing about existing query()/withTransaction; routes opt in
// incrementally (`withEntity(callerEntity, db => db.query(...))`). `set_config(name, value, is_local=true)` is
// `SET LOCAL`, so the binding is transaction-scoped — correct for Supabase's transaction pooler (a bare SET
// would not persist there anyway) and it auto-resets on COMMIT/ROLLBACK so it can never leak to the next request.
const withEntity = async (entityId, fn) => {
  return withTransaction(async (client) => {
    await client.query(`SELECT set_config('app.current_entity', $1, true)`, [entityId == null ? '' : String(entityId)]);
    return fn(client);
  });
};

module.exports = { query, withTransaction, withEntity, sslForHost, get pool() { return pool; } };
