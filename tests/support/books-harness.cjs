/**
 * tests/support/books-harness.cjs — load the ledger modules against the in-memory store, a stubbed db, and the books
 * engines v1.8.0 (BOOKS_ENGINES_SRC, else the sibling ../chitbridge-engines/src when it is v1.8.0). No database.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const API = path.join(__dirname, '..', '..');
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';

/** where the v1.8.0 engines are, or null with the reason */
function enginesSrc() {
  const c = [process.env.BOOKS_ENGINES_SRC, path.join(API, '..', 'chitbridge-engines', 'src')].filter(Boolean);
  for (const d of c) {
    try { if (fs.existsSync(path.join(d, 'ledger.js')) && typeof require(path.join(d, 'accounts-packs')).withAccounts === 'function') return { dir: d }; } catch (_) {}
  }
  return { dir: null, why: 'books engines v1.8.1 not found (set BOOKS_ENGINES_SRC to chitbridge-engines/src on the books-v2 branch) — tried ' + c.join(' · ') };
}

function load(opt) {
  const o = opt || {};
  const M = require('./books-memory.cjs');
  const store = M.create();
  const dbStub = {
    query: async (t) => M.fakeDb.query(t),
    withEntity: async (e, fn) => fn(M.fakeDb),
    trySavepoint: async (db, fn, fallback) => { try { return await fn(db); } catch (_) { return fallback; } },
    onEntity: async (e, fn) => fn(M.fakeDb),
  };
  for (const k of Object.keys(require.cache)) if (k.indexOf(path.join(API, 'lib', 'books')) === 0 || k.indexOf(path.join(API, 'lib', 'party-fields')) === 0 || k.indexOf(path.join(API, 'routes', 'books')) === 0) delete require.cache[k];
  require.cache[require.resolve(path.join(API, 'db'))] = { exports: dbStub };
  require.cache[require.resolve(path.join(API, 'lib', 'books-store'))] = { exports: store };
  if (o.auth) require.cache[require.resolve(path.join(API, 'middleware', 'auth'))] = { exports: o.auth };
  const E = require(path.join(API, 'lib', 'books-engines'));
  E.reset();
  const src = o.engines === false ? { dir: null, why: 'asked for none' } : enginesSrc();
  for (const [name, file] of [['posting', 'posting'], ['packs', 'accounts-packs'], ['receivables', 'receivables'], ['ledger', 'ledger'], ['bookpack', 'bookpack']])
    E.inject(name, src.dir ? require(path.join(src.dir, file)) : null);
  const B = require(path.join(API, 'lib', 'books'));
  return { API, store, T: store.T, E, B, db: M.fakeDb, src, dbStub };
}

module.exports = { load, enginesSrc, API };
