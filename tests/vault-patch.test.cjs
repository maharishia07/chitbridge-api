/**
 * tests/vault-patch.test.cjs — SET-WALK1 · W25 (2026-10-15): the vault is saved as a MERGE-PATCH with a VERSION, never replaced blind.
 *
 * Offline. Held here:
 *   · lib/vault-patch: RFC 7386 semantics (null removes · object merges · scalar and array replace) · the key rule (type|label, t:tag / n:name,
 *     #2 on a repeat — the SAME examples chitbridge-web e2e/vault-keys.cjs pins for cap-shop.js vaultKeys) · keyed ↔ array round trip
 *   · THE WALK'S LOST UPDATE, replayed: screen A saves the legal name, screen B (opened earlier) saves only the phone → both survive
 *   · the real PUT /api/governance/profile/vault over a stand-in db: a patch with the right version writes once and answers { vault, version };
 *     a stale version is 409 VAULT_CHANGED with its sentence; the old whole body over an existing vault is 409 VAULT_VERSION_REQUIRED;
 *     a first fill (no row) takes the whole body with no version. Never a 500, never e.message.
 * Run: node tests/vault-patch.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(96) + (ok ? '' : JSON.stringify(got) + '   want ' + JSON.stringify(want)));
};
const mock = (rel, exports) => { const f = require.resolve(API + rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

/* ── the pure helper ── */
const VP = require(API + '/lib/vault-patch');
const VAULT = { sections: [
  { type: 'identity', label: '', rows: [{ name: 'Legal name', tag: 'legal_name', value: 'Fixture Pty Ltd' }, { name: 'Phone', tag: 'phone', value: '02 9000 0000' }, { name: 'Shop colour', value: 'green' }] },
  { type: 'bank', label: 'Export receipts', rows: [{ name: 'IBAN', tag: 'iban', value: 'AU11' }] },
  { type: 'bank', label: 'Export receipts', rows: [{ name: 'IBAN', tag: 'iban', value: 'AU22' }] },
] };

console.log('\n-- W25: the key rule (pinned on the web too) --\n');
const K = VP.keyed(VAULT);
t('sections keyed type|label; a repeat gets #2', Object.keys(K.sections), ['identity|', 'bank|Export receipts', 'bank|Export receipts#2']);
t('rows keyed t:<tag>, else n:<name>', Object.keys(K.sections['identity|'].rows), ['t:legal_name', 't:phone', 'n:Shop colour']);
t('keyed → unkeyed is the vault again', VP.unkeyed(K), VAULT);

console.log('\n-- W25: RFC 7386 --\n');
t('null removes a key', VP.mergePatch({ a: 1, b: 2 }, { b: null }), { a: 1 });
t('an object merges key by key, a scalar replaces', VP.mergePatch({ a: { x: 1, y: 2 }, c: 'old' }, { a: { y: 3 }, c: 'new' }), { a: { x: 1, y: 3 }, c: 'new' });
t('an array replaces whole', VP.mergePatch({ a: [1, 2] }, { a: [3] }), { a: [3] });
t('a patch onto nothing makes the object', VP.mergePatch(undefined, { a: { b: 1 } }), { a: { b: 1 } });

console.log('\n-- W25: the walk\'s lost update, replayed --\n');
/* screen A (Your shop) saved the new legal name; screen B (Account, opened earlier) changes only the phone and sends only that */
const afterA = VP.applyVaultPatch(VAULT, { sections: { 'identity|': { rows: { 't:legal_name': { name: 'Legal name', tag: 'legal_name', value: 'Austore One Pty Ltd' } } } } });
const afterB = VP.applyVaultPatch(afterA, { sections: { 'identity|': { rows: { 't:phone': { name: 'Phone', tag: 'phone', value: '02 9111 1111' } } } } });
t('A\'s legal name survives B\'s save', afterB.sections[0].rows[0].value, 'Austore One Pty Ltd');
t('B\'s phone is in', afterB.sections[0].rows[1].value, '02 9111 1111');
t('the untouched row and the banks are untouched', [afterB.sections[0].rows[2].value, afterB.sections.length], ['green', 3]);
t('null removes a row; a new section lands last', VP.applyVaultPatch(VAULT, { sections: { 'identity|': { rows: { 'n:Shop colour': null } }, 'licence|': { type: 'licence', label: '', rows: { 't:abn': { name: 'ABN', tag: 'abn', value: '51 824 753 556' } } } } }).sections.map((s) => s.type + ':' + s.rows.length), ['identity:2', 'bank:1', 'bank:1', 'licence:1']);
t('null removes a whole section', VP.applyVaultPatch(VAULT, { sections: { 'bank|Export receipts#2': null } }).sections.length, 2);

/* ── the route over a stand-in db ── */
process.env.VAULT_ENC_KEY = process.env.VAULT_ENC_KEY || Buffer.alloc(32, 7).toString('base64');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const crypto = require(API + '/lib/vaultcrypto');
const DB = { row: null, writes: [] };   /* one entity_profile row: { vault: envelope, version } */
const answer = async (text, params) => {
  const sql = String(text);
  if (/FROM entity_profile/.test(sql) && /SELECT vault/.test(sql)) return { rows: DB.row ? [{ vault: DB.row.vault, version: DB.row.version }] : [], rowCount: DB.row ? 1 : 0 };
  if (/INSERT INTO entity_profile/.test(sql)) {
    const expect = params[2];
    if (DB.row && expect != null && String(expect) !== DB.row.version) return { rows: [], rowCount: 0 };   /* the conditional write finds a newer row */
    DB.row = { vault: JSON.parse(params[1]), version: String(Number(DB.row ? DB.row.version : 1000) + 1) }; DB.writes.push(DB.row.vault);   /* jsonb comes back parsed */
    return { rows: [{ version: DB.row.version }], rowCount: 1 };
  }
  if (/FROM identities/.test(sql)) return { rows: [{ country: 'AU', gstn: null, address: null }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
};
const db = { query: answer, withTransaction: async (fn) => fn({ query: answer }), withEntity: async (e, fn) => fn({ query: answer }), readBatch: async (e, a, st) => Promise.all(st.map((s) => answer(s.text, s.params))) };
mock('/db', db); mock('/db/index', db);
mock('/middleware/auth', Object.assign((req, res, next) => { req.identity = { identity_id: 'e1', identity_type: 'entity' }; next(); }, {
  entityOf: () => 'e1', requireScope: () => (req, res, next) => next(), forgetKey: () => {}, SCOPE_NAMES: [] }));
mock('/lib/policy', { patchKey: async () => ({}), get: async () => ({}), defaults: () => ({}), flagOf: () => null });
mock('/lib/shopchanged', { shopChanged: () => {} });
const app = express(); app.use(express.json());
app.use('/api/governance', require(API + '/routes/governance'));
const call = (port, method, p, body) => new Promise((ok) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ port, path: p, method, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
    let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (_) {} ok({ status: res.statusCode, json: j }); });
  });
  if (data) req.write(data); req.end();
});
const stored = () => crypto.decryptVault(DB.row.vault);

(async () => {
  const srv = app.listen(0); const port = srv.address().port;
  console.log('\n-- W25: PUT /api/governance/profile/vault --\n');
  let r = await call(port, 'PUT', '/api/governance/profile/vault', { vault: VAULT });
  t('a first fill takes the whole body with no version → 200 { vault, version }', [r.status, !!r.json.vault, r.json.version], [200, true, '1001']);
  r = await call(port, 'GET', '/api/governance/profile');
  t('GET /profile answers vault_version', r.json && r.json.vault_version, '1001');
  r = await call(port, 'PUT', '/api/governance/profile/vault', { vault: VAULT });
  t('the whole body over an existing vault with no version → 409 VAULT_VERSION_REQUIRED, a sentence', [r.status, r.json.code, typeof r.json.message], [409, 'VAULT_VERSION_REQUIRED', 'string']);
  r = await call(port, 'PUT', '/api/governance/profile/vault', { version: '1001', patch: { sections: { 'identity|': { rows: { 't:legal_name': { name: 'Legal name', tag: 'legal_name', value: 'Austore One Pty Ltd' } } } } } });
  t('screen A: a patch with the right version → 200, the new version', [r.status, r.json.version], [200, '1002']);
  t('…and only the legal name moved in the store', stored().sections[0].rows.map((x) => x.value), ['Austore One Pty Ltd', '02 9000 0000', 'green']);
  r = await call(port, 'PUT', '/api/governance/profile/vault', { version: '1001', patch: { sections: { 'identity|': { rows: { 't:phone': { name: 'Phone', tag: 'phone', value: '02 9111 1111' } } } } } });
  t('screen B (opened before A saved) → 409 VAULT_CHANGED "Changed since you opened it — reload?"', [r.status, r.json.code, r.json.message], [409, 'VAULT_CHANGED', 'Changed since you opened it — reload?']);
  t('…and nothing was written by the refused save', DB.writes.length, 2);
  r = await call(port, 'PUT', '/api/governance/profile/vault', { version: '1002', patch: { sections: { 'identity|': { rows: { 't:phone': { name: 'Phone', tag: 'phone', value: '02 9111 1111' } } } } } });
  t('B after a reload (the new version) → 200; A\'s name AND B\'s phone are both in', [r.status, stored().sections[0].rows[0].value, stored().sections[0].rows[1].value], [200, 'Austore One Pty Ltd', '02 9111 1111']);
  r = await call(port, 'PUT', '/api/governance/profile/vault', { version: '1003', vault: VAULT });
  t('the whole body WITH the current version is still taken (an older screen that reloaded)', [r.status, r.json.version], [200, '1004']);
  srv.close();
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed\n');
  process.exit(fail ? 1 : 0);
})();
