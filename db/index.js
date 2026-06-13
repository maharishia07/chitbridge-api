// db/index.js — PostgreSQL connection pool
const { Pool } = require('pg');
const dns = require('dns').promises;

let pool;

async function createPool() {
  const rawUrl = process.env.DATABASE_URL || '';
  let parsed;
  try { parsed = new URL(rawUrl); } catch (e) { throw new Error('Invalid DATABASE_URL'); }

  // Resolve hostname to IPv4 to avoid Railway IPv6 issue
  let host = parsed.hostname;
  try {
    const addresses = await dns.resolve4(parsed.hostname);
    if (addresses && addresses.length > 0) {
      host = addresses[0];
      console.log(`DB resolved ${parsed.hostname} to IPv4: ${host}`);
    }
  } catch (e) {
    console.log(`DNS resolve failed, using hostname: ${host}`);
  }

  const p = new Pool({
    host,
    port: parseInt(parsed.port) || 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace('/', ''),
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  p.on('connect', () => { if (process.env.NODE_ENV !== 'test') console.log('Database connected'); });
  p.on('error', (err) => { console.error('Database error:', err.message); });
  return p;
}

createPool().then(p => { pool = p; }).catch(err => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log(`Query: ${text.substring(0, 50)} | ${duration}ms | ${result.rowCount} rows`);
    }
    return result;
  } catch (err) {
    console.error('Query error:', err.message, '\nQuery:', text);
    throw err;
  }
};

module.exports = { query, get pool() { return pool; } };
