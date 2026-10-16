/**
 * boot-files.test.cjs — INT7c-READ: the two entry files no other test names — server.js and scripts/check-db-role.js.
 *
 * Offline, by reading the files (no server is started, no database is touched). Held here:
 *   · every route file server.js requires exists
 *   · server.js boots through the ONE preflight (lib/dev-otp) before it listens
 *   · scripts/check-db-role.js is what its header says: read-only — no INSERT · UPDATE · DELETE · DROP · ALTER · TRUNCATE
 *
 * Run: node tests/boot-files.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(88) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};

const serverText = fs.readFileSync(path.join(API, 'server.js'), 'utf8');
const required = [...serverText.matchAll(/require\('\.\/routes\/([a-z0-9-]+)'\)/g)].map((match) => match[1]);
t('server.js requires route files', required.length > 20, true);
t('every route file server.js requires exists', required.filter((name) => !fs.existsSync(path.join(API, 'routes', name + '.js'))), []);

const preflightAt = serverText.indexOf('bootPreflightErrors()');
const listenAt = serverText.search(/\.listen\(/);
t('server.js runs the one boot preflight before it listens', preflightAt > 0 && listenAt > preflightAt, true);

const roleText = fs.readFileSync(path.join(API, 'scripts', 'check-db-role.js'), 'utf8');
const writes = roleText.match(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/g) || [];
t('check-db-role.js is read-only (no statement that writes)', writes, []);

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
