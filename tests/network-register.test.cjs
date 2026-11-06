/**
 * tests/network-register.test.cjs — A KEY IS NEVER RE-USED (PLT-64, 31 Oct 2026). lib/netmember.registerMember with the database stubbed, plus the SIT kit knobs.
 *   · a new key is inserted once, and the SQL can never overwrite a row (ON CONFLICT DO NOTHING, no DO UPDATE)
 *   · a key that already has a row, retired or active, is refused in words (NET_KEY_TAKEN) and nothing is updated or deleted:
 *     re-using the retired sit-ae would have overwritten its tombstone and made the master's next pull delete its mirrored ids (lib/netsync.js pullOne)
 *   · DB_POOL_MAX (db/connect-config.poolMax): 10 by default, a whole number 1-100, anything else refused
 *   · the kit: up.sh takes INSTALL_KEY and SIT_COMPOSE_EXTRA and keeps both in .env; install.sh passes the spin key; spin.sh refuses a taken key before touching the target
 * On sit/run6 before this change: registerMember upserted over any non-local row, the pool was fixed at 10, up.sh had neither knob.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const sqls = [];
let answers = () => [];
G.harness({ rows: (s, p) => { sqls.push({ s, p }); return answers(s, p); } });
const net = require(path.join(API, 'lib', 'netmember'));
const { poolMax } = require(path.join(API, 'db', 'connect-config'));

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (extra ? '\n          ' + extra : '')); } };
const reset = () => { sqls.length = 0; answers = () => []; };
const writes = () => sqls.filter((x) => /\b(UPDATE|DELETE)\b/i.test(x.s));
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const AE2 = { installation_key: 'sit-ae2', domain: '129-225-73-238.sslip.io', country: 'AE', root_handle: 'cbae02-root', root_bridge_id: 'CBXXXXXXXX' };

(async () => {
  console.log('\n══ NETWORK · register: a key is never re-used ══\n');

  answers = (s) => (/INSERT INTO installation/.test(s) ? [{ installation_key: 'sit-ae2' }] : []);
  const ok = await net.registerMember(AE2);
  const ins = sqls.filter((x) => /INSERT INTO installation/.test(x.s));
  t('a new key is inserted once, as a remote member with its endpoint', ok.installation_key === 'sit-ae2' && ok.endpoint === 'https://129-225-73-238.sslip.io/api/ctp/deliver' && ins.length === 1 && ins[0].p[0] === 'sit-ae2');
  t('the insert can never overwrite a row: ON CONFLICT DO NOTHING, no DO UPDATE', /ON CONFLICT \(installation_key\) DO NOTHING/.test(ins[0].s) && !/DO UPDATE/.test(ins[0].s));
  t('nothing is updated or deleted for a new key', writes().length === 0);

  reset();
  answers = (s) => (/SELECT domain, active, hosted_locally FROM installation/.test(s) ? [{ domain: '140-245-252-156.sslip.io', active: false, hosted_locally: false }] : []);
  let e = await refusal(() => net.registerMember({ installation_key: 'sit-ae', domain: '129-225-73-238.sslip.io', country: 'AE' }));
  t('a RETIRED key is refused in words, naming its old domain and the way out', e && e.code === 'NET_KEY_TAKEN' && /sit-ae already has a row on this master \(a retired member, at 140-245-252-156\.sslip\.io\)/.test(e.message) && /new key/.test(e.message), e && e.message);
  t('the retired row is left as it was: no UPDATE, no DELETE', writes().length === 0);

  reset();
  answers = (s) => (/SELECT domain, active, hosted_locally FROM installation/.test(s) ? [{ domain: '129-225-85-65.sslip.io', active: true, hosted_locally: false }] : []);
  e = await refusal(() => net.registerMember({ installation_key: 'sit-in', domain: '129-225-85-65.sslip.io', country: 'IN' }));
  t('an ACTIVE key is refused too, and points to issue for a new certificate', e && e.code === 'NET_KEY_TAKEN' && /an active member/.test(e.message) && /issue sit-in/.test(e.message) && writes().length === 0, e && e.message);

  reset();
  answers = (s) => (/SELECT domain, active, hosted_locally FROM installation/.test(s) ? [{ domain: '144-24-145-121.sslip.io', active: true, hosted_locally: true }] : []);
  e = await refusal(() => net.registerMember({ installation_key: 'sit-root', domain: 'x.example.com' }));
  t('the own installation key is refused as "this installation itself"', e && /this installation itself/.test(e.message) && writes().length === 0, e && e.message);

  /* ── DB_POOL_MAX ── */
  t('DB_POOL_MAX unset or blank: 10, as before', poolMax({}) === 10 && poolMax({ DB_POOL_MAX: ' ' }) === 10);
  t('DB_POOL_MAX 5 and 100 are taken', poolMax({ DB_POOL_MAX: '5' }) === 5 && poolMax({ DB_POOL_MAX: '100' }) === 100);
  t('DB_POOL_MAX 0, 101, 2.5 or words stop the boot in words', ['0', '101', '2.5', 'ten', '-3'].every((v) => { try { poolMax({ DB_POOL_MAX: v }); return false; } catch (x) { return /Invalid DB_POOL_MAX/.test(x.message); } }));
  t('db/index.js sizes the pool from poolMax, resolved before any connect', /const max = poolMax\(process\.env\)/.test(fs.readFileSync(path.join(API, 'db', 'index.js'), 'utf8')) && /\.\.\.a\.config, max, idleTimeoutMillis/.test(fs.readFileSync(path.join(API, 'db', 'index.js'), 'utf8')));

  /* ── the kit ── */
  const up = fs.readFileSync(path.join(API, 'deploy', 'sit', 'up.sh'), 'utf8');
  const inst = fs.readFileSync(path.join(API, 'deploy', 'network', 'install.sh'), 'utf8');
  const spin = fs.readFileSync(path.join(API, 'deploy', 'network', 'spin.sh'), 'utf8');
  t('up.sh: INSTALL_KEY replaces the kit key, checked, and kept in .env', /INSTALL_KEY=\$\(keep_kv INSTALL_KEY\)/.test(up) && /KEY=\$INSTALL_KEY/.test(up) && /\^\[a-z\]\[a-z0-9-\]\{1,39\}\$/.test(up));
  t('up.sh: SIT_COMPOSE_EXTRA must be a file and joins the compose line', /SIT_COMPOSE_EXTRA=\$\(keep_kv SIT_COMPOSE_EXTRA\)/.test(up) && /\$\{SIT_COMPOSE_EXTRA:\+ -f \$SIT_COMPOSE_EXTRA\}/.test(up));
  t('up.sh: neither knob reaches the api env file', /\|SIT_PROJECT\|INSTALL_KEY\|SIT_COMPOSE_EXTRA\)=/.test(up));
  t('install.sh passes the spin key as INSTALL_KEY and uses the same extra file', /INSTALL_KEY=\$SPIN_KEY/.test(inst) && /\$\{EXTRA:\+ -f \$EXTRA\}/.test(inst));
  t('spin.sh refuses a taken key BEFORE it touches the target', spin.indexOf('already has a row on this master') > 0 && spin.indexOf('already has a row on this master') < spin.indexOf("$SSH 'mkdir -p ~/net"));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  ' + pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
