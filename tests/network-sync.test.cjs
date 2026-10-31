/**
 * tests/network-sync.test.cjs — THE PULLS (PLT-45 / RAIL-96, 25 Oct 2026). lib/netsync with the database and the signed question stubbed.
 *   member:  the certificate is stored only if it is for US, signed by the PINNED key and in date; the directory only if its seal verifies against the pinned key and it was written
 *            for us; revoked serials are replaced by the list; peers become remote installation rows; peers the master dropped go inactive; hand-made peers are left alone
 *   master:  registry_changes is read from the stored sequence, applied as upserts (ids, kind, world, status), the cursor moves, a count that disagrees triggers ONE full resync,
 *            an unreachable member is recorded, not hidden
 *   locate:  a hint from the master is kept only if the named installation confirms the business on its own domain
 * On main there is no lib/netsync.
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const sqls = [];
let answers = (s) => [];
G.harness({ rows: (s, p) => { sqls.push({ s, p }); return answers(s, p); } });
const keys = require(path.join(API, 'lib', 'ctpkeys'));
const netcert = require(path.join(API, 'lib', 'netcert'));
const ctpquery = require(path.join(API, 'lib', 'ctpquery'));
const net = require(path.join(API, 'lib', 'netmember'));
const sync = require(path.join(API, 'lib', 'netsync'));

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (extra ? '\n          ' + extra : '')); } };
const wrote = (re) => sqls.filter((x) => re.test(x.s));
const reset = () => { sqls.length = 0; answers = () => []; };

const MASTER = keys.generate('network'), ROGUE = keys.generate('network'), OWN = keys.generate(), OTHER = keys.generate();
const NOWMS = Date.now();
const PIN = { installation_key: 'master-1', domain: 'master.example.com', public_key: MASTER.public_key };

function mint(by, patch) {
  process.env.CB_NETWORK_ROOT_KEY = by.CB_NETWORK_ROOT_KEY; keys._reset();
  const out = netcert.issue(Object.assign({ installation_key: 'me-1', domain: 'me.example.com', public_key: OWN.public_key, issued_by: 'master-1' }, patch || {}));
  return out;
}
function self() {
  process.env.INSTALLATION_KEY = 'me-1'; process.env.CTP_PRIVATE_KEY = OWN.CTP_PRIVATE_KEY; keys._reset(); net._reset();
  answers = (s) => (/FROM installation WHERE installation_key = \$1 AND hosted_locally/.test(s) ? [{ domain: 'me.example.com' }] : []);
}

(async () => {
  console.log('\n══ NETWORK · the pulls ══\n');

  /* ── member: certificate ── */
  self();
  let c = mint(MASTER);
  self();
  let r = await sync.takeCertificate(PIN, { found: true, membership: c });
  t('a certificate for us, signed by the pinned key, is stored', r.ok === true && wrote(/INSERT INTO membership_certificate/).length === 1 && wrote(/INSERT INTO membership_certificate/)[0].p[0] === c.cert.serial);
  reset(); self(); c = mint(ROGUE); self();
  r = await sync.takeCertificate(PIN, { found: true, membership: c });
  t('a certificate signed by another key is refused in words and nothing is stored', r.ok === false && /not signed by the master this installation pinned/.test(r.why) && wrote(/INSERT INTO membership_certificate/).length === 0);
  reset(); self(); c = mint(MASTER, { installation_key: 'au-9' }); self();
  r = await sync.takeCertificate(PIN, { found: true, membership: c });
  t('a certificate issued to someone else is refused', r.ok === false && /issued to au-9, not to me-1/.test(r.why) && wrote(/INSERT INTO membership_certificate/).length === 0);
  reset(); self(); c = mint(MASTER, { public_key: OTHER.public_key }); self();
  r = await sync.takeCertificate(PIN, { found: true, membership: c });
  t('a certificate for a different signing key is refused (a copy cannot take it)', r.ok === false && /different signing key/.test(r.why));
  reset(); self();
  r = await sync.takeCertificate(PIN, { found: false, why: 'the certificate of me-1 is suspended' });
  t('"suspended" from the master is passed on, not turned into an error', r.ok === false && r.why === 'the certificate of me-1 is suspended');

  /* ── member: directory ── */
  const dirBody = (patch) => { process.env.CB_NETWORK_ROOT_KEY = MASTER.CB_NETWORK_ROOT_KEY; keys._reset(); const d = Object.assign({ v: 1, at: new Date().toISOString(), for: 'me-1', revoked: ['M-a', 'M-b'], peers: [{ installation_key: 'au-1', domain: 'au.example.com', endpoint: 'https://au.example.com/api/ctp/deliver', country: 'AU', label: 'au-1' }] }, patch); return { found: true, directory: d, sealed: netcert.seal(d) }; };
  reset(); self();
  const good = dirBody();
  self();
  r = await sync.takeDirectory(PIN, good);
  t('a sealed directory replaces the revoked list', r.ok && r.revoked === 2 && wrote(/DELETE FROM network_revoked/).length === 1 && JSON.stringify(wrote(/INSERT INTO network_revoked/)[0].p[0]) === '["M-a","M-b"]');
  t('its peers become REMOTE installation rows that never overwrite a local row', wrote(/INSERT INTO installation/).length === 1 && /hosted_locally, ctp_endpoint|VALUES \(\$1, \$2, 'network', 'oracle', \$3, 'base', false/.test(wrote(/INSERT INTO installation/)[0].s) && /WHERE NOT installation\.hosted_locally/.test(wrote(/INSERT INTO installation/)[0].s));
  t('peers the master dropped go inactive, but only rows this sync owns (purpose network)', /UPDATE installation SET active = false WHERE purpose = 'network'/.test(wrote(/UPDATE installation SET active = false/)[0].s) && JSON.stringify(wrote(/UPDATE installation SET active = false/)[0].p[0]) === '["au-1"]');
  reset(); self();
  const tampered = dirBody(); tampered.directory.revoked = [];
  self();
  r = await sync.takeDirectory(PIN, tampered);
  t('an edited directory is refused and nothing changes', r.ok === false && /do not match its seal/.test(r.why) && sqls.length === 0 || (r.ok === false && wrote(/network_revoked|INSERT INTO installation/).length === 0));
  reset(); self();
  const rogue = (() => { process.env.CB_NETWORK_ROOT_KEY = ROGUE.CB_NETWORK_ROOT_KEY; keys._reset(); const d = { v: 1, at: 'x', for: 'me-1', revoked: [], peers: [] }; return { found: true, directory: d, sealed: netcert.seal(d) }; })();
  self();
  r = await sync.takeDirectory(PIN, rogue);
  t('a directory sealed by another key is refused', r.ok === false && /not signed by the master this installation pinned/.test(r.why));
  reset(); self();
  const forOther = dirBody({ for: 'au-1' });
  self();
  r = await sync.takeDirectory(PIN, forOther);
  t('a directory written for another installation is refused', r.ok === false && /written for au-1, not for this installation/.test(r.why));

  /* ── master: pull by sequence ── */
  process.env.INSTALLATION_KEY = 'master-1'; process.env.CB_NETWORK_ROOT_KEY = MASTER.CB_NETWORK_ROOT_KEY; keys._reset(); net._reset();
  const calls = [];
  let script = [];
  ctpquery.ask = async (target, want, deps) => { calls.push({ target, want, signedWithNetworkKey: deps && deps.signer && typeof deps.signer.sign === 'function', peer: deps && deps.resolvePeer ? await deps.resolvePeer(target) : null }); return script.shift() || { ok: false, why: 'script ran out' }; };
  const ROW = { installation_key: 'au-1', domain: 'au.example.com', ctp_endpoint: 'https://au.example.com/api/ctp/deliver' };
  const ch = (seq, id, status, change) => ({ seq, bridge_id: id, entity_type: 'general', population: 'live', status, change: change || 'created' });
  const state = { cursor: 0, entries: 0 };
  const dbFor = (s, p) => {
    if (/SELECT last_seq FROM registry_cursor/.test(s)) return state.cursor ? [{ last_seq: state.cursor }] : [];
    if (/SELECT count\(\*\)::int AS n FROM registry_entry/.test(s)) return [{ n: state.entries }];
    return [];
  };
  reset(); answers = dbFor; state.cursor = 4; state.entries = 2; calls.length = 0;
  script = [{ ok: true, changes: [ch(5, 'CBAAAAAAA1', 'pending'), ch(6, 'CBAAAAAAA1', 'active', 'status')], entities: 2, last_seq: 6 }];
  r = await sync.pullOne(ROW, false);
  t('it asks from the stored sequence, signed with the network key', calls[0].want.after === 4 && calls[0].want.want === 'registry_changes' && calls[0].signedWithNetworkKey === true && calls[0].target.domain === 'au.example.com');
  t('the member is asked at ITS registered row (key + endpoint), never whoever answers the domain now (SIT run 4)', !!calls[0].peer && calls[0].peer.installation_key === 'au-1' && calls[0].peer.endpoint === 'https://au.example.com/api/ctp/deliver');
  t('each change is an idempotent upsert of ids, kind, world, status only', wrote(/INSERT INTO registry_entry/).length === 2 && /ON CONFLICT \(installation_key, bridge_id\) DO UPDATE/.test(wrote(/INSERT INTO registry_entry/)[0].s) && wrote(/INSERT INTO registry_entry/)[0].p.length === 5);
  t('no name, handle, contact or money column is ever written to the registry', !wrote(/INSERT INTO registry_entry/).some((x) => /display_name|user_id|email|phone|amount|total/i.test(x.s)));
  t('the cursor moves to the last sequence read', wrote(/INSERT INTO registry_cursor/)[0].p[1] === 6 && r.ok === true && r.entities === 2);

  reset(); answers = dbFor; state.cursor = 0; state.entries = 1; calls.length = 0;
  script = [{ ok: true, changes: [ch(1, 'CBAAAAAAA1', 'active')], entities: 3, last_seq: 1 }, { ok: true, changes: [ch(1, 'CBAAAAAAA1', 'active'), ch(2, 'CBBBBBBBB2', 'active'), ch(3, 'CBCCCCCCC3', 'active')], entities: 3, last_seq: 3 }];
  state.entries = 1;
  const origCount = answers;
  let readsOfCount = 0;
  answers = (s, p) => { if (/count\(\*\)::int AS n FROM registry_entry/.test(s)) { readsOfCount++; return [{ n: readsOfCount === 1 ? 1 : 3 }]; } return dbFor(s, p); };
  r = await sync.pullOne(ROW, false);
  t('a count that disagrees triggers ONE full resync from 0 (a gap is never ignored)', r.resynced === true && calls.length === 2 && calls[1].want.after === 0 && wrote(/DELETE FROM registry_entry WHERE installation_key/).length === 1 && r.ok === true);

  reset(); answers = dbFor; state.cursor = 9; calls.length = 0;
  script = [{ ok: false, why: 'could not reach https://au.example.com/api/ctp/query: timed out' }];
  r = await sync.pullOne(ROW, false);
  t('an unreachable member is recorded with the reason and the cursor is NOT moved', r.ok === false && /timed out/.test(r.why) && wrote(/INSERT INTO registry_cursor/)[0].p[1] === 9 && wrote(/INSERT INTO registry_cursor/)[0].p[3].includes('timed out'));

  /* ── locate: the hint is verified at the far domain ── */
  process.env.INSTALLATION_KEY = 'me-1'; process.env.CB_MASTER_DOMAIN = PIN.domain; process.env.CB_MASTER_INSTALLATION = PIN.installation_key; process.env.CB_MASTER_KEY = PIN.public_key;
  reset(); keys._reset(); net._reset();
  answers = (s) => (/to_jsonb\(i\) ->> 'network_role'/.test(s) ? [{ network_role: 'member' }] : []);
  script = [];
  ctpquery.ask = async (target, want) => {
    if (want.want === 'locate') return { ok: true, found: true, hints: [{ installation_key: 'au-1', domain: 'au.example.com' }, { installation_key: 'ae-1', domain: 'ae.example.com' }, { installation_key: 'in-1', domain: 'in.example.com' }] };
    if (target.domain === 'au.example.com') return { ok: true, found: true, bridge_id: want.handle, installation_key: 'au-1', address: want.handle + '@au.example.com', display_name: 'Heat Co' };
    if (target.domain === 'ae.example.com') return { ok: true, found: false, why: 'no business here called ' + want.handle };
    return { ok: true, found: true, bridge_id: want.handle, installation_key: 'someone-else', address: 'x' };
  };
  r = await sync.locate('CBHEAT0001');
  t('locate keeps only the hint the far installation itself confirms', r.found === true && r.verified.length === 1 && r.verified[0].installation_key === 'au-1' && r.verified[0].address === 'CBHEAT0001@au.example.com');
  t('and says why the others were dropped', r.rejected.length === 2 && /no business here called/.test(r.rejected.find((x) => x.installation_key === 'ae-1').why));

  process.env.CB_MASTER_KEY = ''; net._reset();
  r = await sync.locate('CBHEAT0001');
  t('without a pinned master it says so instead of guessing', r.ok === false && /with a pinned master/.test(r.why));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  ' + pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
