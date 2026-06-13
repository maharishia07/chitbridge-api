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

async function createPool() {
  const rawUrl = process.env.DATABASE_URL || '';
  let parsed;
  try { parsed = new URL(rawUrl); } catch (e) { throw new Error('Invalid DATABASE_URL'); }

  const password = decodeURIComponent(parsed.password);
  const ref = 'bzacyrdrnzdbficjplcn';
  const sslConfig = { rejectUnauthorized: false };

  // Try each pooler region with both username formats
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
  throw new Error('All pooler regions failed — enable Connection Pooling in Supabase Settings → Database');
}

let pool;

createPool().then(p => {
  pool = p;
  p.on('error', err => console.error('Database error:', err.message));
}).catch(err => {
  console.error('DB init failed:', err.message);
  process.exit(1);
});

const query = async (text, params) => {
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

module.exports = { query, get pool() { return pool; } };
