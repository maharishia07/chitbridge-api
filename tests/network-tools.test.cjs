/**
 * tests/network-tools.test.cjs — THE NETWORK OPERATOR'S THREE TOOLS, run as the operator runs them (PLT-45, SIT run 6, 31 Oct 2026).
 * tools/network-cert.cjs (the master's verbs), tools/network-seed-root.cjs (the installer's first root, through the register door) and tools/network-sync.cjs (the timed pulls).
 * Each is spawned as a process with a database that cannot be reached, so only the paths that decide BEFORE any write are proved here: a wrong verb, a missing argument,
 * a scope that is not one, an installer with no handle, a pull on an installation that is not a member. Each refuses in words and with its exit code; none writes.
 * The verbs that write (register, issue, suspend, revoke) are proved through lib/netmember in tests/network-cert.test.cjs and tests/network-sync.test.cjs.
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const CERT = path.join(__dirname, '..', 'tools', 'network-cert.cjs');
const SEED = path.join(__dirname, '..', 'tools', 'network-seed-root.cjs');
const SYNC = path.join(__dirname, '..', 'tools', 'network-sync.cjs');
/* a database nobody answers on: a tool that reached it would fail, so a pass proves the decision came first */
const NO_DB = { DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none', CB_INSTALLER_HANDLE: '', CB_INSTALLER_TOKEN: '', INSTALLATION_KEY: 'tools-test', LOG_LEVEL: 'error' };

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (extra ? '\n          ' + extra : '')); } };
const run = (file, args, env) => spawnSync(process.execPath, [file].concat(args || []), { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, NO_DB, env || {}) });
const said = (r) => (r.stdout || '') + (r.stderr || '');

console.log('\n══ NETWORK TOOLS · refused in words before anything is written ══\n');

let r = run(CERT, ['no-such-verb']);
t('network-cert: an unknown verb is refused with the usage line and exit 2', r.status === 2 && /usage: network-cert\.cjs show \| fingerprint \| next-handle/.test(said(r)), said(r).slice(0, 200));
r = run(CERT, []);
t('network-cert: no verb at all is refused the same way', r.status === 2 && /usage:/.test(said(r)), said(r).slice(0, 200));
r = run(CERT, ['next-handle']);
t('network-cert: next-handle without a scope is refused in words (exit 1)', r.status === 1 && /missing a scope/.test(said(r)), said(r).slice(0, 200));
r = run(CERT, ['next-handle', '1x']);
t('network-cert: a scope that is not 2 to 6 letters is refused before any read', r.status === 1 && /a scope is a country code or a short slug of 2 to 6 letters/.test(said(r)), said(r).slice(0, 200));
r = run(CERT, ['issue']);
t('network-cert: issue without an installation key is refused in words', r.status === 1 && /missing the installation key/.test(said(r)), said(r).slice(0, 200));
t('network-cert: no private key or token is ever printed', !/PRIVATE KEY/.test(said(r)));

r = run(SEED, []);
t('network-seed-root: no CB_INSTALLER_HANDLE → refused, there is no root to make (exit 1)', r.status === 1 && /CB_INSTALLER_HANDLE is not set: there is no root to make/.test(said(r)), said(r).slice(0, 200));

r = run(SYNC, ['member']);
let line = null;
try { line = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (_) { line = null; }
t('network-sync: an installation whose role cannot be read is standalone, so a member pull is refused (fail-closed, exit 1, one JSON line)',
  r.status === 1 && !!line && line.ok === false && line.ran === 'member' && /not a network member with a pinned master/.test(line.why || ''), said(r).slice(0, 300));
r = run(SYNC, ['master']);
try { line = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (_) { line = null; }
t('network-sync: a master pull on an installation that is not a master is refused in words', r.status === 1 && !!line && line.ok === false && /not a network master/.test(line.why || ''), said(r).slice(0, 300));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + pass + ' checks');
process.exit(fail ? 1 : 0);
