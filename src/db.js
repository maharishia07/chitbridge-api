const { Pool } = require("pg");
const { sslFor } = require("../db/connect-config");   /* HX1: TLS from config (the URL's sslmode · PGSSLMODE · PGSSL=disable · the env), never a guess */
const ssl = sslFor(process.env.DATABASE_URL || "", process.env);
const pool = new Pool(Object.assign({ connectionString: process.env.DATABASE_URL }, ssl === undefined ? {} : { ssl }));
async function withTx(fn) {
  const c = await pool.connect();
  try { await c.query("begin"); const r = await fn(c); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback"); throw e; }
  finally { c.release(); }
}
module.exports = { pool, withTx };
