/**
 * public-base-host.test.cjs — SEC-114 (OWASP host-header injection, WSTG-INPV-17): a forged Host (or X-Forwarded-Host / -Proto) must change no link, redirect or connector-kit address. apiBase reads PUBLIC_API_BASE only;
 * with none set a loopback Host (a developer's machine) is the one fallback, anything else answers '' (relative). Positive control: PUBLIC_API_BASE is used verbatim, its trailing slash trimmed.
 * Run: node tests/public-base-host.test.cjs
 */
'use strict';
const assert = require('assert');
const path = require('path');
const API = path.join(__dirname, '..');
process.env.NODE_ENV = 'test';
const { apiBase } = require(path.join(API, 'lib', 'public-base.js'));
const O = require(path.join(API, 'routes', 'openapi.js'));
let n = 0;
const ok = (name, cond, why) => { assert.ok(cond, name + (why ? ' - ' + why : '')); n++; console.log('  ok  ' + name); };
const req = (host, proto, fwdHost) => ({ protocol: proto || 'https', get: (h) => ({ host, 'x-forwarded-host': fwdHost }[String(h).toLowerCase()]) });

delete process.env.PUBLIC_API_BASE; delete process.env.PUBLIC_API_URL;
for (const forged of ['evil.example', 'evil.example:8443', 'api.chitbridge.test.evil.example', 'localhost.evil.example', '127.0.0.1.evil.example', 'localhost@evil.example', '', 'evil.example/x']) {
  ok('no config, Host "' + forged + '": apiBase names no host', apiBase(req(forged, 'https', 'evil.example')) === '', JSON.stringify(apiBase(req(forged))));
}
ok('no config, a loopback Host is the developer fallback (http, no forwarded proto)', apiBase(req('localhost:3000', 'https')) === 'http://localhost:3000' && apiBase(req('127.0.0.1')) === 'http://127.0.0.1');
ok('no request at all answers empty', apiBase() === '');
process.env.PUBLIC_API_BASE = 'https://api.chitbridge.test/';
ok('config set: forged Host and X-Forwarded-Host change nothing (trailing slash trimmed)', apiBase(req('evil.example', 'http', 'evil.example')) === 'https://api.chitbridge.test');
ok('OpenAPI server url follows config, not Host', O.assemble(req('evil.example')).servers[0].url === 'https://api.chitbridge.test');
delete process.env.PUBLIC_API_BASE;
ok('OpenAPI with no config and a forged Host names no host', O.assemble(req('evil.example')).servers[0].url === '/');
ok('no routes or lib file builds a link from the Host header any more', (() => {
  const fs = require('fs');
  const bad = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name) && /get\((['"])host\1\)|headers\.host|x-forwarded-host/i.test(fs.readFileSync(p, 'utf8')) && !/public-base\.js$/.test(p)) bad.push(path.relative(API, p)); });
  ['routes', 'lib', 'middleware'].forEach((d) => walk(path.join(API, d)));
  return bad.length === 0 ? true : false;
})());
console.log('\n' + n + ' passed, 0 failed');
