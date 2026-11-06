/**
 * pg-no-deprecation.test.cjs — PLT-42: THE DATABASE LAYER RAISES NO pg DeprecationWarning (pg@9 removes what pg@8 warns about).
 *   pg 8.22 warns "Calling client.query() when the client is already executing a query is deprecated" when a statement is queued
 *   behind another on one client. db/index.js used to fire the session-settings statement from the pool's 'connect' event, so the
 *   first caller's statement queued behind it on every new connection. Now the settings run inside the connection step itself.
 * Proved with a real db module + real pg against a tiny in-process Postgres wire stub (startup, simple + extended protocol answers),
 * in a child process with process.on('warning') recording every warning. Offline: loopback only, no database.
 */
'use strict';
const assert = require('assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const API = path.join(__dirname, '..');

const msg = (type, body) => { const b = Buffer.alloc(5 + body.length); b.write(type, 0); b.writeInt32BE(4 + body.length, 1); body.copy(b, 5); return b; };
const cstr = (s) => Buffer.from(s + '\0');
const ready = () => msg('Z', Buffer.from('I'));
const done = (tag) => msg('C', cstr(tag));

/** startup → AuthenticationOk + ready; then each simple Query / extended Sync is answered with an empty success */
function stubServer() {
  const seen = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0), started = false;
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!started) {
          if (buf.length < 4 || buf.length < buf.readInt32BE(0)) return;
          const first = buf.readInt32BE(4);
          buf = buf.subarray(buf.readInt32BE(0));
          if (first === 80877103) { socket.write('N'); continue; } /* SSLRequest: refused */
          started = true;
          socket.write(Buffer.concat([msg('R', Buffer.from([0, 0, 0, 0])), ready()]));
          continue;
        }
        if (buf.length < 5 || buf.length < 1 + buf.readInt32BE(1)) return;
        const type = String.fromCharCode(buf[0]), body = buf.subarray(5, 1 + buf.readInt32BE(1));
        buf = buf.subarray(1 + buf.readInt32BE(1));
        if (type === 'Q') { seen.push(body.toString().replace(/\0.*/s, '')); socket.write(Buffer.concat([done('OK'), ready()])); }
        else if (type === 'P') socket.write(msg('1', Buffer.alloc(0)));
        else if (type === 'B') socket.write(msg('2', Buffer.alloc(0)));
        else if (type === 'D') socket.write(msg('n', Buffer.alloc(0)));
        else if (type === 'E') socket.write(done('SELECT 0'));
        else if (type === 'S') socket.write(ready());
        else if (type === 'X') socket.end();
      }
    });
  });
  return { server, seen };
}

/* child: the real db module, a pool-level query, a withEntity transaction and a client checkout; print the warnings */
const CHILD = `
const warnings = [];
process.on('warning', (w) => warnings.push(w.name + ': ' + w.message));
const db = require(${JSON.stringify(path.join(API, 'db'))});
(async () => {
  await db.query('SELECT 1');
  await Promise.all([db.query('SELECT 2'), db.query('SELECT 3')]);
  await db.withEntity('00000000-0000-0000-0000-000000000001', (c) => c.query('SELECT 4'));
  await db.withTransaction((c) => c.query('SELECT 5'));
  await new Promise((r) => setTimeout(r, 50));
  console.log('WARNINGS ' + JSON.stringify(warnings));
  process.exit(0);
})().catch((e) => { console.log('FAILED ' + e.message); process.exit(1); });
`;

async function main() {
  const { server, seen } = stubServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'postgres://t:t@127.0.0.1:' + server.address().port + '/t?sslmode=disable';
  const out = await new Promise((resolve) => {
    let text = '';
    const child = spawn(process.execPath, ['-e', CHILD], { cwd: API, env: Object.assign({}, process.env, { DATABASE_URL: url, DB_POOLER_URL: '', NODE_ENV: 'test', RLS_GUARD: 'off' }) });
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    child.on('close', () => resolve(text));
  });
  server.close();
  const line = out.split('\n').find((l) => l.startsWith('WARNINGS '));
  assert.ok(line, 'the child did not finish: ' + out.slice(-600));
  const warnings = JSON.parse(line.slice(9));
  assert.deepStrictEqual(warnings.filter((w) => /pg@9|DeprecationWarning/.test(w)), [], 'pg deprecation warnings: ' + warnings.join(' | '));
  assert.ok(seen.some((s) => /SET TimeZone = 'UTC'/.test(s)), 'the session settings no longer run on a new connection');
  console.log('  ok  no pg DeprecationWarning from the pool, withEntity or withTransaction (' + seen.length + ' statements seen)');
}
main().catch((e) => { console.log('  XX  ' + e.message); process.exit(1); });
