#!/usr/bin/env node
'use strict';
/*
 * tools/paged-reads-drive.cjs — drive every parameter-free GET with nothing asked and let the request lines say how many rows came back
 * OWNER     cb-speed
 * CARD      28-platform-and-operations/api-standard
 * OWNS      driving every parameter-free GET route of the register ONCE per sign-in with NOTHING asked (no ?limit, no ?page), so the api's request lines (lib/request-log.js: rows, total) show what each route really answers on a box's real data.
 * CALLED BY by hand on a SIT box, after which `docker logs <container> | node tools/paged-reads-report.cjs` lists the routes over 100 rows. Never a deploy: it talks to an api container the lane started itself.
 * FLOW      docs/api-register.json (GET rows with no :param) ──▶ GET base+path with each Bearer token ──▶ one line per call: status · ms · rows · total · key
 *
 *   node tools/paged-reads-drive.cjs --base http://127.0.0.1:3991 --tokens <file.json: ["<token>", ...]> [--device <id>] [--only <substring>] [--out <file.jsonl>]
 * Reads only. A route that answers 4xx for a seat (not its door) is recorded as such, never retried. At most one call at a time.
 */
const fs = require('fs');
const path = require('path');

const valueOf = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : null; };

/** the length of the longest top-level array of an answer (or of the answer itself when it is one); -1 when the answer holds no list */
function rowsOf(body) {
  if (Array.isArray(body)) return body.length;
  if (!body || typeof body !== 'object') return -1;
  let longest = -1;
  for (const value of Object.values(body)) if (Array.isArray(value) && value.length > longest) longest = value.length;
  return longest;
}

/** one GET with nothing asked → { status, ms, rows, total, bytes }; status -1 when the box did not answer, rows -1 when the answer is not JSON */
async function callOne(base, routePath, headers) {
  const started = Date.now();
  const line = { status: 0, ms: 0, rows: -1, total: null, bytes: 0 };
  try {
    const res = await fetch(base + routePath, { headers, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    line.status = res.status;
    line.bytes = text.length;
    Object.assign(line, answerOf(text));
  } catch (failure) {
    line.status = -1;
    line.note = String(failure && failure.message);
  }
  line.ms = Date.now() - started;
  return line;
}

/** rows and total of an answer text; { rows: -1, total: null, note } when it is not JSON */
function answerOf(text) {
  try {
    const body = JSON.parse(text);
    return { rows: rowsOf(body), total: body && typeof body.total === 'number' ? body.total : null };
  } catch (failure) {
    return { rows: -1, total: null, note: 'not JSON: ' + String(failure.message).slice(0, 60) };
  }
}

/** the whole run: every parameter-free GET once per sign-in, one line per call */
async function main() {
  const base = valueOf('--base');
  const tokenFile = valueOf('--tokens');
  if (!base || !tokenFile) throw new Error('usage: --base <url> --tokens <file.json>');
  const tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  const only = valueOf('--only');
  const device = valueOf('--device'); /* the device id the tokens were signed in with (the sign-in binds a token to it) */
  const register = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'api-register.json'), 'utf8'));
  const routes = register.routes.filter((row) => row.method === 'GET' && !/:/.test(row.path) && row.path.startsWith('/api/') && (!only || row.path.includes(only)));
  const lines = [];
  for (let seat = 0; seat < tokens.length; seat++) {
    for (const row of routes) {
      const headers = Object.assign({ authorization: 'Bearer ' + tokens[seat] }, device ? { 'x-device-id': device } : {});
      lines.push(Object.assign({ seat, key: row.key }, await callOne(base, row.path, headers)));
    }
  }
  const out = valueOf('--out');
  const text = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
  if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
  console.error(routes.length + ' routes x ' + tokens.length + ' sign-ins = ' + lines.length + ' calls, ' + lines.filter((line) => line.status >= 200 && line.status < 300).length + ' answered 2xx, ' + lines.filter((line) => line.status >= 500 || line.status < 0).length + ' 5xx/failed');
}

if (require.main === module) main();

module.exports = { rowsOf, callOne, answerOf };
