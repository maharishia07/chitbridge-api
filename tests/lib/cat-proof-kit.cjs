/**
 * tests/lib/cat-proof-kit.cjs — the small kit the CAT proof tests (2026-11-14) share.
 * OWNS      ok() counting, mock() of a module in require.cache, call() of a local http server, a stand-in db.
 * CALLED BY tests/cat-*.test.cjs (the P2 PROOF pass: each test names the backlog line it proves).
 * FLOW      test → kit.mock stubs → real code under test → kit.ok lines → kit.done() exit code
 */
'use strict';
const path = require('path');
const http = require('http');

const API = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (name, cond, info) => {
  if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 400) : '')); }
};
const done = () => { console.log(`\n${pass} ok, ${fail} failed`); process.exit(fail ? 1 : 0); };

/** replace a module (path relative to the api root) in require.cache */
const mock = (relative, exported) => {
  const file = require.resolve(path.join(API, relative));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exported };
};

/** a stand-in db whose query() is answered by `answer(sql, params)`; every call is kept in `calls` */
function standInDb(answer) {
  const calls = [];
  const q = async (sql, params) => { calls.push({ sql: String(sql), params }); return answer(String(sql), params) || { rows: [], rowCount: 0 }; };
  const client = { query: q };
  const known = { query: q, pool: { query: q, connect: async () => Object.assign({ release() {} }, client) }, withEntity: async (id, fn) => fn(client),
    withTransaction: async (fn) => fn(client), onEntity: async (id, db, fn) => fn(client), readBatch: async (e, a, st) => st.map((s) => answer(String(s && s.text ? s.text : s)) || { rows: [] }),
    trySavepoint: async (h, fn, fb) => fn().catch(() => fb) };
  const db = new Proxy(known, { get: (t, n) => (n in t ? t[n] : typeof n === 'symbol' || n === 'then' ? undefined : async () => ({ rows: [], rowCount: 0 })) });
  return { db, calls };
}

const call = (port, method, p, body, headers) => new Promise((resolve) => {
  const b = body === undefined ? '' : JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }, headers || {}) },
    (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } resolve({ status: res.statusCode, headers: res.headers, body: j }); }); });
  r.end(b);
});

module.exports = { API, ok, done, mock, standInDb, call };
