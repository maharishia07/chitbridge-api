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

// ── COLD-START RACE (fixed 2026-07-29) ────────────────────────────────────────────────────────────────────
// createPool() is async, but the HTTP server starts listening immediately. On Railway the container SLEEPS when
// idle, so every wake-up replayed the same failure: the app's first burst (/entities/me, /notifications,
// /network-design) arrived BEFORE the pool resolved and every one threw "Database not connected" — the user saw
// errors purely for opening the app after a break. Seen in the deploy log: three such failures at 23:20:36,
// followed by "DB connected" in the SAME second.
//
// Fix: a request that arrives before the pool is up now WAITS for it (bounded) instead of failing. Nothing is
// weakened — after the wait it either has a real pool or throws the identical error as before.
//
// Also makes the old comment true: it claimed "queries will retry" but `pool` simply stayed undefined forever, so
// a failed init was permanent until redeploy. A failed init now clears itself and the next query retries.
const BOOT_WAIT_MS = Number(process.env.DB_BOOT_WAIT_MS || 15000);
const NOT_CONNECTED = 'Database not connected — check DATABASE_URL in Railway environment variables';
let pool;
let initPromise = null;

function startInit() {
  const p = createPool()
    .then((created) => {
      pool = created;
      created.on('error', (err) => console.error('Database error:', err.message));
      return created;
    })
    .catch((err) => {
      console.error('DB init failed — the next query will retry:', err.message);
      initPromise = null;                 // clear, so a later request genuinely retries
      throw err;
    });
  initPromise = p;
  p.catch(() => {});                      // module-load safety: never an unhandled rejection
  return p;
}
startInit();

// Wait for the pool, bounded — a request must never hang forever on a dead database.
async function ensurePool() {
  if (pool) return pool;
  const p = initPromise || startInit();
  let timer;
  try {
    return await Promise.race([
      p,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(NOT_CONNECTED)), BOOT_WAIT_MS); }),
    ]);
  } catch (_) {
    throw new Error(NOT_CONNECTED);       // one canonical message, unchanged from before
  } finally { clearTimeout(timer); }
}

// ── B1 (RLS Stage-0) — the NO-CONTEXT GUARD ──────────────────────────────────────────────────────────────
// A tripwire: the module-level `query()` is the CONTEXT-FREE path (no entity bound), so any tenant-table access
// through it means a route FORGOT withEntity() — under FORCE RLS that query fails closed and the feature quietly
// returns empty. The guard makes that mistake LOUD in dev/CI, long before it reaches prod. Legitimate tenant
// access goes through withEntity()'s `client.query(...)` (the transaction), which never passes through here.
//
// The table list MUST equal the RLS-policy set in migration_b49 exactly — no more, no less. `identities` is the
// deliberate carve-out (cross-tenant discovery) and is intentionally ABSENT.
//
// PLATFORM-CONFIGURABILITY (Athi): mode is env-driven, never hardcoded — RLS_GUARD = off | warn | throw.
//   • prod default = off  (a guard must NEVER hard-block production traffic)
//   • dev/CI default = warn (visible during the incremental route migration without breaking un-migrated routes)
//   • set RLS_GUARD=throw in CI (and locally once all Direct-group routes are on withEntity) to ENFORCE it.
// G1 (reviewer 2026-07-13) — complete the tenant-table list: the guard previously OMITTED chit_messages and the newest
// (most sensitive) tables entity_compliance / entity_profile (vault) / entity_wallet (money) / usage_ledger.
const RLS_TENANT_TABLES = ['chit_header', 'chit_status', 'chit_detail', 'chit_messages', 'state_log', 'catalogue_items',
  'customer_list', 'folder', 'cb_attachment', 'chit_disputes', 'entity_compliance', 'entity_profile', 'entity_wallet', 'usage_ledger',
  'network_design', 'catalogue_face',   // b111/b112 — per-entity design draft + catalogue face (WITH RLS); guard a context-free query the same way
  // b104/b123 — the intake queue and the inbound channel map. Both are per-entity FORCE RLS and were missing from
  // this list, so a context-free query against either went unwatched. The webhook's own lookup is exempt by
  // construction, not by omission: it goes through the SECURITY DEFINER channel_owner(), whose SQL never names
  // the table, which is exactly the narrow hole that guard is meant to leave room for.
  'capture', 'channel_binding'];
const RLS_TENANT_RE = new RegExp('\\b(' + RLS_TENANT_TABLES.join('|') + ')\\b', 'i');

function rlsGuardMode() {
  const explicit = (process.env.RLS_GUARD || '').toLowerCase();
  if (explicit === 'off' || explicit === 'warn' || explicit === 'throw') return explicit;
  // G1 — do NOT default to 'off' in production (that gave comfort where it didn't run). 'warn' logs context-free tenant
  // queries as a security signal without breaking; set RLS_GUARD=throw to hard-fail, or =off to silence.
  return 'warn';
}

function rlsGuardCheck(text) {
  const mode = rlsGuardMode();
  if (mode === 'off') return;
  const m = RLS_TENANT_RE.exec(text);
  if (!m) return;
  const msg = `[RLS-GUARD] tenant table "${m[1]}" queried via context-free query() — route must use `
    + `withEntity(entityId, db => db.query(...)). SQL: ${text.replace(/\s+/g, ' ').trim().substring(0, 140)}`;
  if (mode === 'throw') throw new Error(msg);
  console.warn(msg);
}

const query = async (text, params) => {
  if (!pool) await ensurePool();          // cold start: wait for the pool instead of failing the request
  rlsGuardCheck(text);
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    /**
     * ⚠️ THIS RODE ON `NODE_ENV === 'development'` AND WAS OFF BY ACCIDENT. The live API runs with a leading
     * space (" development"), so the comparison has been false in production — fortunate rather than intended.
     * Trimming it would have been the obvious fix and the wrong one: it would silently switch query logging ON
     * across production, on the hottest path in the system.
     *
     * ⭐ A debug aid gets its OWN switch. Environment names have proven unreliable here, and "should this log
     * every query" is a decision worth making explicitly rather than inheriting from a word.
     */
    if (String(process.env.DB_QUERY_LOG || '').trim() === 'true') {
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
  if (!pool) await ensurePool();
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
    /**
     * ⭐⭐ TWO SETTINGS, ONE ROUND TRIP. `app.current_actor` joins `app.current_entity` here because b146's
     * version trigger stamps `changed_by` from it and NOTHING had ever set it — every catalogue version row
     * recorded a change with no author, and `NULLIF(current_setting(...,true),'')` turned the omission into a
     * tidy NULL that looked intended.
     *
     * ⚠️ IT MUST NOT COST A TRIP. This function is already four (BEGIN · set_config · the query · COMMIT) and
     * that count is why `onEntity` exists. Two `set_config` calls in ONE statement keep it at four — a second
     * `await client.query` would have added a fifth to every transaction on the platform to carry one string.
     *
     * ⚠️ SET LOCAL, so both reset on COMMIT/ROLLBACK and neither can leak to the next request off a pooled
     * connection — the same property that makes the entity binding safe makes this one safe.
     *
     * ⚠️ NO REQUEST, NO ACTOR, NO CHANGE. Jobs, migrations and tests have no ALS store, so this writes `''` and
     * the trigger's NULLIF yields exactly the NULL it yields today. Strictly additive.
     */
    await client.query(
      `SELECT set_config('app.current_entity', $1, true), set_config('app.current_actor', $2, true)`,
      [entityId == null ? '' : String(entityId), require('../lib/reqctx').currentActor() || '']);
    return fn(client);
  });
};

/**
 * ── ⭐ onEntity(entity_id, dbOrNull, fn) — RUN INSIDE A CALLER'S TRANSACTION, OR OPEN YOUR OWN ──────────────────
 *
 * Athi, 2026-08-14, after a Playwright run measured 2.8s to open a chit and 5.4s to save one line:
 * *"go ahead with the round trip fix."*
 *
 * withEntity() is correct and stays: it wraps every call in a transaction so the RLS binding is SET LOCAL and can
 * never leak between requests. But that costs FOUR round trips each — BEGIN, set_config, the query, COMMIT — and
 * GET /chits/:id made seven of them SEQUENTIALLY, six of which do not depend on each other. Roughly 28 round trips
 * to open one chit.
 *
 * ⚠️ THE FIX IS NOT Promise.all. The pool is max:10, so six parallel transactions per request means two concurrent
 * readers want twelve connections and the third queues — trading a slow page for connection timeouts, which is a
 * worse failure and much harder to diagnose.
 *
 * This lets a lib run on a client the caller already owns: one BEGIN, one set_config, N queries, one COMMIT.
 * Called without a client it behaves exactly as before, so every existing caller is untouched.
 */
async function onEntity(entity_id, db, fn) {
  if (db && typeof db.query === 'function') return fn(db);
  return withEntity(entity_id, fn);
}

/**
 * ⚠️ SAVEPOINTS, AND THEY ARE NOT OPTIONAL HERE. Postgres aborts the WHOLE transaction on any error, so sharing one
 * between six independent reads would mean the first failure poisons every read after it — and these reads fail
 * routinely and harmlessly: `readLines` throws 42P01 before b142, `chit_participants` throws 42883 before b50, and
 * each currently degrades on its own. Without a savepoint, opening a chit on an un-migrated environment would stop
 * returning the chit at all rather than returning it without the optional parts.
 *
 * Returns `fallback` on failure, exactly like the per-call try/catch it replaces.
 */
let _spN = 0;
async function trySavepoint(db, fn, fallback) {
  if (!db || typeof db.query !== 'function') { try { return await fn(); } catch (_) { return fallback; } }
  const sp = 'sp' + (++_spN);
  await db.query('SAVEPOINT ' + sp);
  try { const r = await fn(db); await db.query('RELEASE SAVEPOINT ' + sp); return r; }
  catch (e) { await db.query('ROLLBACK TO SAVEPOINT ' + sp).catch(() => {}); return fallback; }
}

/**
 * ── ⭐⭐ readBatch — an entity-scoped READ in ONE network round trip ──────────────────────────────────────────────
 *
 * withEntity costs four trips (BEGIN · set_config · query · COMMIT). With the API in one region and the database in
 * another (measured 2026-09-05: ~300 ms a trip, so 1.4–2.4 s per request) that is the whole latency. Postgres takes
 * several statements in ONE simple-protocol message when no bind parameters are sent, so this inlines the values
 * as escaped literals and sends BEGIN, the set_config, every statement and COMMIT as one text: one trip, one result
 * per statement. READS ONLY — nothing here should write (a failure mid-way rolls back, but a write belongs in
 * withEntity where SAVEPOINTs and the guard live).
 *
 * Literals: strings via pg's escapeLiteral (E'' when needed), numbers must be finite, booleans, null, Dates as ISO,
 * arrays of strings as ARRAY[...]. Anything else throws BEFORE the query is built — a caller then falls back to
 * withEntity, never to a half-escaped string.
 *
 *   const [list, pending] = await readBatch(entityId, actorId, [
 *     { text: 'SELECT * FROM catalogue_items WHERE entity_id = $1', params: [entityId] },
 *     { text: 'SELECT … WHERE item_id = ANY($1)', params: [[ids]] },
 *   ]);
 */
const { escapeLiteral } = require('pg');
function inlineLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('readBatch: non-finite number'); return String(v); }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return escapeLiteral(v.toISOString()) + '::timestamptz';
  if (typeof v === 'string') return escapeLiteral(v);
  if (Array.isArray(v)) { if (!v.length) return "'{}'"; if (!v.every((x) => typeof x === 'string')) throw new Error('readBatch: only string arrays'); return 'ARRAY[' + v.map(escapeLiteral).join(',') + ']'; }
  throw new Error('readBatch: unsupported literal ' + typeof v);
}
function inlineSql(text, params) {
  const p = params || [];
  const out = String(text).replace(/\$(\d+)/g, (m, n) => { const i = Number(n) - 1; if (i < 0 || i >= p.length) throw new Error('readBatch: $' + n + ' has no value'); return inlineLiteral(p[i]); });
  /* one statement per entry: a ';' followed by more SQL (outside a literal) is refused */
  if (/;\s*\S/.test(out.replace(/'[^']*'/g, ''))) throw new Error('readBatch: one statement per entry');
  return out;
}
const readBatch = async (entityId, actorId, statements) => {
  if (!pool) await ensurePool();
  const head = "BEGIN; SELECT set_config('app.current_entity', " + inlineLiteral(entityId == null ? '' : String(entityId)) + ", true), set_config('app.current_actor', " + inlineLiteral(actorId == null ? '' : String(actorId)) + ", true);";
  const body = statements.map((s) => { rlsGuardCheck(s.text); return inlineSql(s.text, s.params); }).join(';\n') + ';';
  const text = head + '\n' + body + '\nCOMMIT;';
  const res = await pool.query(text);          /* no values → simple protocol → one message, many results */
  const arr = Array.isArray(res) ? res : [res];
  /* results: BEGIN, set_config, …statements…, COMMIT — hand back the middle */
  return arr.slice(2, 2 + statements.length);
};
module.exports = { query, withTransaction, withEntity, onEntity, trySavepoint, sslForHost, RLS_TENANT_TABLES, readBatch, inlineSql, get pool() { return pool; } };
