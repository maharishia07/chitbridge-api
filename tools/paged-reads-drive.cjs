#!/usr/bin/env node
'use strict';
/*
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
const base = valueOf('--base');
const tokenFile = valueOf('--tokens');
if (!base || !tokenFile) throw new Error('usage: --base <url> --tokens <file.json>');
const tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
const only = valueOf('--only');
const device = valueOf('--device'); /* the device id the tokens were signed in with (the sign-in binds a token to it) */
const register = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'api-register.json'), 'utf8'));
const routes = register.routes.filter((row) => row.method === 'GET' && !/:/.test(row.path) && row.path.startsWith('/api/') && (!only || row.path.includes(only)));

/** the longest top-level array of an answer, or the answer itself when it is one */
const rowsOf = (body) => (Array.isArray(body) ? body.length : body && typeof body === 'object' ? Object.values(body).reduce((most, value) => (Array.isArray(value) && value.length > most ? value.length : most), -1) : -1);

(async () => {
  const lines = [];
  for (let seat = 0; seat < tokens.length; seat++) {
    for (const row of routes) {
      const started = Date.now();
      let status = 0, rows = -1, total = null, bytes = 0;
      try {
        const res = await fetch(base + row.path, { headers: Object.assign({ authorization: 'Bearer ' + tokens[seat] }, device ? { 'x-device-id': device } : {}), signal: AbortSignal.timeout(30000) });
        status = res.status;
        const text = await res.text();
        bytes = text.length;
        try { const body = JSON.parse(text); rows = rowsOf(body); total = body && typeof body.total === 'number' ? body.total : null; } catch (failure) { /* not JSON */ }
      } catch (failure) { status = -1; }
      lines.push({ seat, key: row.key, status, ms: Date.now() - started, rows, total, bytes });
    }
  }
  const out = valueOf('--out');
  const text = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
  if (out) fs.writeFileSync(out, text); else process.stdout.write(text);
  console.error(routes.length + ' routes x ' + tokens.length + ' sign-ins = ' + lines.length + ' calls, ' + lines.filter((line) => line.status >= 200 && line.status < 300).length + ' answered 2xx, ' + lines.filter((line) => line.status >= 500 || line.status < 0).length + ' 5xx/failed');
})();
