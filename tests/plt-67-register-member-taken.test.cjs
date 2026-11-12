'use strict';
/**
 * tests/plt-67-register-member-taken.test.cjs — PLT-67 (owner cb-network): lib/netmember.registerMember never overwrites a locally hosted key or revives a RETIRED member (NET_KEY_TAKEN);
 * an ACTIVE member is updated only with { update: true } (tools/network-cert.cjs register --update, which deploy/network/spin.sh passes on every spin); a new key is inserted.
 * CALLED BY scripts/guards.cjs. Reuses lib/netmember.js with db.query stood in. No DB, no network.
 * CARD      platform/network-members
 * Run: node tests/plt-67-register-member-taken.test.cjs
 */
const path = require('path');
const fs = require('fs');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const ROOT = path.join(__dirname, '..');
let rowOf = null;
let inserts = 0;
const query = async (sql) => {
  if (/^SELECT active, hosted_locally/.test(sql)) return { rows: rowOf ? [rowOf] : [] };
  if (/^\s*INSERT INTO installation/.test(sql)) inserts++;
  return { rows: [] };
};
const dbId = require.resolve(path.join(ROOT, 'db'));
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { ...require(dbId), query } };
const netmember = require(path.join(ROOT, 'lib', 'netmember.js'));
const m = { installation_key: 'sit-x', domain: 'x.example.org' };
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' :: ' + detail)); };
const attempt = async (row, opts) => {
  rowOf = row;
  inserts = 0;
  try { await netmember.registerMember(m, opts); return { inserts }; } catch (e) { return { code: e.code, inserts, said: e.message }; }
};
(async () => {
  let r = await attempt(null);
  check('a new key is inserted', !r.code && r.inserts === 1, JSON.stringify(r));
  r = await attempt({ active: true, hosted_locally: true }, { update: true });
  check('a locally hosted key is refused even with --update, nothing written', r.code === 'NET_KEY_TAKEN' && r.inserts === 0, JSON.stringify(r));
  r = await attempt({ active: false, hosted_locally: false }, { update: true });
  check('a RETIRED member is refused even with --update (no revival), nothing written', r.code === 'NET_KEY_TAKEN' && /retired/.test(r.said) && r.inserts === 0, JSON.stringify(r));
  r = await attempt({ active: true, hosted_locally: false });
  check('an active member without --update is refused and the words name the flag', r.code === 'NET_KEY_TAKEN' && /--update/.test(r.said) && r.inserts === 0, JSON.stringify(r));
  r = await attempt({ active: true, hosted_locally: false }, { update: true });
  check('an active member with --update is updated (the re-run of spin.sh)', !r.code && r.inserts === 1, JSON.stringify(r));
  const spin = fs.readFileSync(path.join(ROOT, 'deploy', 'network', 'spin.sh'), 'utf8');
  check('spin.sh passes --update on its register', /register "\$KEY" "\$HOST" --update/.test(spin), 'spin.sh');
  console.log(failed ? failed + ' FAILED' : 'all ok');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed :: ' + (e && e.stack || e)); process.exit(1); });
