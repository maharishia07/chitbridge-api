#!/usr/bin/env node
// @type: unit
/**
 * db-error-survives.test.cjs — PLT-86: a database restart or a killed pooled connection must NOT crash the api (SIT fault 4).
 * Two suspects, each emitted here with a stand-in (NO real database, no restart) in a CHILD process, because an unhandled
 * 'error' event is an uncaught exception and only a separate process can show "the process lived":
 *   A  src/db.js pool: an idle client dies -> pg emits 'error' on the POOL. That pool had no listener -> the process died.
 *   B  db/index.js withTransaction: the client is checked out and its connection dies -> pg emits 'error' on the CLIENT
 *      (pg-pool removes its own listener while a client is checked out) -> the process died.
 * HAND-COMPUTED expectation per suspect: the child exits 0 and prints ALIVE; the failure is logged exactly ONCE as a
 * leveled JSON line; B's caller gets a normal rejection (the cause), the dead client is released with an error (pg then
 * destroys it) and the NEXT transaction runs on a FRESH client; the open transaction is not committed.
 * RUN       node tests/db-error-survives.test.cjs     (tests/db-error-survives-mutation.test.cjs proves each case can fail)
 * ENV       DB_ERR_SRC_DB / DB_ERR_INDEX = a mutated copy of src/db.js / db/index.js (the mutation test only)
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const EventEmitter = require('events');

const ROOT = path.join(__dirname, '..');
const ROLE = process.argv[2];

/** the module under test: the real file, or a mutated copy named by the env (mutation test only) */
const target = (envName, real) => path.join(ROOT, process.env[envName] || real);

/** child A: the src/db.js pool gets an 'error' event with no other handler anywhere */
function childPool() {
  process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/none';
  const { pool } = require(target('DB_ERR_SRC_DB', 'src/db.js'));
  pool.emit('error', new Error('terminating connection due to administrator command'));
  setImmediate(() => { console.log('ALIVE'); process.exit(0); });
}

/** a stand-in pg: Pool/Client as emitters; every checked-out client is recorded so the test can see who got what */
function fakePg(seen) {
  class Client extends EventEmitter {
    constructor() { super(); this.n = seen.clients.length + 1; this.sql = []; seen.clients.push(this); }
    query(sql) {
      this.sql.push(String(sql).slice(0, 30));
      if (/work-1/.test(sql)) {            // the first client's connection dies in the middle of the work
        const dead = new Error('Connection terminated unexpectedly');
        // pg emits from the socket's event, NOT inside the query call: later in the loop, while the client is still held
        setImmediate(() => this.emit('error', dead));
        return new Promise((_, reject) => setImmediate(() => setImmediate(() => reject(dead))));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
  }
  class Pool extends EventEmitter {
    connect(cb) {
      const c = new Client();
      c.release = (err) => { c.releasedWith = err; };
      if (cb) { cb(null, c, c.release); return undefined; }
      return Promise.resolve(c);
    }
    end() { return Promise.resolve(); }
  }
  return { Pool, Client, escapeLiteral: (s) => "'" + s + "'", defaults: {}, types: { getTypeParser: () => (v) => v, setTypeParser() {} } };
}

/** child B: a transaction whose client errors while held, then a second transaction */
async function childTransaction() {
  process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/none';
  const seen = { clients: [] };
  require.cache[require.resolve('pg')] = { id: 'pg', filename: 'pg', loaded: true, exports: fakePg(seen) };
  const db = require(target('DB_ERR_INDEX', 'db/index.js'));
  let caught = null;
  try { await db.withTransaction((c) => c.query('work-1')); } catch (e) { caught = e; }
  await new Promise((r) => setImmediate(r));              // let an unhandled 'error' event surface as an uncaught exception
  const dead = seen.clients.find((c) => c.sql.some((q) => /work-1/.test(q)));
  const second = await db.withTransaction(async (c) => { await c.query('work-2'); return c.n; });
  console.log('RESULT ' + JSON.stringify({
    caught: caught && caught.message,
    committedDead: dead.sql.some((s) => /COMMIT/.test(s)),
    deadReleasedWithError: !!(dead.releasedWith),
    secondIsFresh: second !== dead.n,
    secondRan: seen.clients.some((c) => c !== dead && c.sql.some((q) => /work-2/.test(q)))
  }));
  console.log('ALIVE');
  process.exit(0);
}

if (ROLE === 'pool') { childPool(); }
else if (ROLE === 'tx') { childTransaction().catch((e) => { console.log('CHILD-FAIL ' + e.message); process.exit(3); }); }
else {
  let fails = 0;
  const check = (ok, label) => { if (!ok) fails++; console.log((ok ? 'ok   ' : 'FAIL ') + label); };
  const run = (role) => spawnSync(process.execPath, [__filename, role], { env: { ...process.env, LOG_LEVEL: 'info', NODE_ENV: 'test' }, encoding: 'utf8', timeout: 60000 });
  /** log lines (stdout + stderr) that name the PLT-86 event */
  const logged = (r, word) => (r.stdout + r.stderr).split('\n').filter((l) => l.includes(word));

  const a = run('pool');
  check(a.status === 0 && /ALIVE/.test(a.stdout), 'A  a pool error on the src/db.js pool: the process lives (exit ' + a.status + ')');
  const aLines = logged(a, 'database pool error');
  check(aLines.length === 1 && /administrator command/.test(aLines[0]) && /"level":"error"/.test(aLines[0]), 'A  and it is logged once, in words, at error level (' + aLines.length + ' line)');

  const b = run('tx');
  const res = (b.stdout.match(/RESULT (.*)/) || [])[1];
  const got = res ? JSON.parse(res) : {};
  check(b.status === 0 && /ALIVE/.test(b.stdout), 'B  a client error while held in withTransaction: the process lives (exit ' + b.status + ')');
  check(got.caught === 'Connection terminated unexpectedly', 'B  the caller gets the normal rejection (the cause), not a crash');
  check(got.committedDead === false, 'B  the broken transaction is never committed');
  check(got.deadReleasedWithError === true, 'B  the dead client is released WITH an error, so the pool destroys it');
  check(got.secondIsFresh === true && got.secondRan === true, 'B  the next transaction runs on a fresh client, not the dead one');
  const bLines = logged(b, 'database client error');
  check(bLines.length === 1 && /Connection terminated/.test(bLines[0]) && /"level":"error"/.test(bLines[0]), 'B  and it is logged once, in words, at error level (' + bLines.length + ' line)');
  process.exit(fails ? 1 : 0);
}
