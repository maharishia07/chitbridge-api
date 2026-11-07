/* CALLED BY src/services/catalogue.js, src/services/chit.js, src/services/network.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs] */
const { Pool } = require('pg');
const { sslFor } = require('../db/connect-config'); /* HX1: TLS from config (the URL's sslmode · PGSSLMODE · PGSSL=disable · the env), never a guess */
const ssl = sslFor(process.env.DATABASE_URL || '', process.env);
const pool = new Pool(Object.assign({ connectionString: process.env.DATABASE_URL }, ssl === undefined ? {} : { ssl }));
/* PLT-86: an idle client dying (a database restart, a killed pooled connection) makes pg emit 'error' on the POOL; with no listener that is an
   uncaught exception and the api dies (SIT fault 4). Log it in words; pg already drops the dead client, so the next connect() is a fresh one. */
pool.on('error', (err) => require('../lib/logger').error('database pool error: an idle connection died, the pool replaces it', { err: err.message, code: err.code || null }));
async function withTx(fn) {
  const c = await pool.connect();
  let died = null;   /* PLT-86: same as db/index.js withTransaction: a held client that errors is logged and destroyed, never an uncaught exception */
  const onError = (err) => { died = err; require('../lib/logger').error('database client error: a connection died inside a transaction, it is discarded', { err: err.message, code: err.code || null }); };
  c.on('error', onError);
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.removeListener('error', onError);
    c.release(died || undefined);
  }
}
module.exports = { pool, withTx };
