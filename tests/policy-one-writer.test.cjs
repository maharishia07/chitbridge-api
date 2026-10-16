'use strict';
/**
 * policy-one-writer.test.cjs — T2-POLICY (POL1 + SET4, 2026-10-14): ONE flag definition, ONE writer of policy_flags, ONE writer of the
 * shop's tax number and address. Offline (no database): source scans + the writers run against a stand-in db.
 *
 * MEASURE (the round's metric, before → after):
 *   direct writes of identities.policy_flags outside lib/policy.js (lib · routes · middleware)   22 → 0   (ratchet: 0)
 *   statements writing the shop's gstn / address outside lib/profile.js                           3 → 0   (ratchet: 0; a party row —
 *                                                                                                  `parent_entity_id` in the statement — is a counterparty's, not the shop's)
 *   definitions of the Business rules card's rows (api FLAGS + web POLICY_FLAGS)                   2 → 1   (the web guard asserts its side)
 *
 * Run: node tests/policy-one-writer.test.cjs
 */
const fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, more) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (more ? '\n      ' + more : '')); } };

/* ── the scans ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(c|m)?js$/.test(f)) files.push(p); } })
  .call(null, path.join(API, 'lib'));
for (const d of ['routes', 'middleware']) (function walk(dir) { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(c|m)?js$/.test(f)) files.push(p); } })(path.join(API, d));
if (fs.existsSync(path.join(API, 'server.js'))) files.push(path.join(API, 'server.js'));
const rel = (p) => path.relative(API, p).replace(/\\/g, '/');

const PF_WRITE = /SET\s+policy_flags\b|policy_flags\s*=\s*(COALESCE|jsonb_set|policy_flags|\$|')/;
const pfWriters = [];
for (const f of files) {
  if (rel(f) === 'lib/policy.js') continue;
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (PF_WRITE.test(line)) pfWriters.push(rel(f) + ':' + (i + 1)); });
}
console.log('\n── POL1 · one writer of identities.policy_flags ──');
ok('no statement outside lib/policy.js writes policy_flags (found ' + pfWriters.length + ') — use policy.patchKey / policy.set', pfWriters.length === 0, pfWriters.join(' · '));

const idWriters = [];
for (const f of files) {
  if (rel(f) === 'lib/profile.js') continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/`[^`]*`/g)) {
    const s = m[0];
    if (!/UPDATE\s+identities\b/i.test(s) || /parent_entity_id/.test(s)) continue;   /* a party row is the counterparty's own */
    if (/\b(gstn|address)\s*=/.test(s)) idWriters.push(rel(f) + ':' + (src.slice(0, m.index).split('\n').length));
  }
}
console.log('\n── SET4 · one writer of the shop\'s tax number and address ──');
ok('no UPDATE identities outside lib/profile.js sets gstn / address on the shop (found ' + idWriters.length + ') — use profile.setShopIdentity / shopIdentitySql',
  idWriters.length === 0, idWriters.join(' · '));
const ent = fs.readFileSync(path.join(API, 'routes', 'entities.js'), 'utf8');
ok('no "15 characters" GSTIN assumption on the profile save — the pack decides (profile.taxIdRefusal)', !/body\('gstn'\)[^\n]*isLength\(\{\s*max:\s*15/.test(ent) && /taxIdRefusal/.test(ent));
const cs = fs.readFileSync(path.join(API, 'lib', 'country-setup.js'), 'utf8');
ok('country setup checks the number with the same function (no private GSTIN/ABN/TRN check left)', /taxIdRefusal/.test(cs) && !/gstinChecksum/.test(cs));

/* ── the writers, against a stand-in db ─────────────────────────────────────────────────────────────────────────────────── */
const PP = require('./support/policy-patch.cjs');
const ROWS = { shop: { country: 'IN', gstn: null, address: null, policy_flags: {} } };
const SEEN = [];
const q = async (sql, params) => {
  const s = String(sql); SEEN.push({ s, params });
  if (PP.isPatch(s)) { const r = ROWS[PP.entityOf(s, params)]; return PP.apply(s, params, r.policy_flags); }
  if (/^SELECT country, gstn, address FROM identities/.test(s) || /^SELECT country FROM identities/.test(s)) { const r = ROWS[params[0]]; return { rows: r ? [r] : [] }; }
  if (/^UPDATE identities SET (gstn|address) = /.test(s)) {
    const r = ROWS[params[params.length - 1]];
    for (const m of s.matchAll(/(gstn|address) = \$(\d+)/g)) r[m[1]] = params[Number(m[2]) - 1];
    return { rowCount: 1, rows: [] };
  }
  return { rows: [], rowCount: 0 };
};
const dbPath = require.resolve(path.join(API, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: q, withEntity: async (id, fn) => fn({ query: q }), withTransaction: async (fn) => fn({ query: q }), readBatch: async () => [],
  trySavepoint: async (db, fn, fb) => { try { return await fn(db); } catch (_) { return fb; } } } };
const policy = require(path.join(API, 'lib', 'policy'));
const profile = require(path.join(API, 'lib', 'profile'));

(async () => {
  console.log('\n── policy.patchKey · each op ──');
  const pf = () => ROWS.shop.policy_flags;
  await policy.patchKey(null, 'shop', ['counters', 'C1'], { held_by: 'k1', held_at: null }, { op: 'merge' });
  await policy.patchKey(null, 'shop', ['counters', 'C1'], { name: 'Front' }, { op: 'merge' });
  ok('merge: a counter record is shallow-merged, a null VALUE is stored (counters.patchCounter)', pf().counters.C1.held_by === 'k1' && pf().counters.C1.held_at === null && pf().counters.C1.name === 'Front');
  await policy.patchKey(null, 'shop', ['network_catalogue', 'pending', 'S1'], { id: 'r1' });
  ok('set: missing parents are created (network-catalogue setPending)', pf().network_catalogue.pending.S1.id === 'r1');
  const lost = await policy.patchKey(null, 'shop', ['network_catalogue', 'pending', 'S1'], null, { op: 'remove', when: { path: ['network_catalogue', 'pending', 'S1', 'id'], equals: 'r0' } });
  ok('remove with `when`: another record\'s id does not win (network-catalogue apply)', lost.rowCount === 0 && !!pf().network_catalogue.pending.S1);
  const won = await policy.patchKey(null, 'shop', ['network_catalogue', 'pending', 'S1'], null, { op: 'remove', when: { path: ['network_catalogue', 'pending', 'S1', 'id'], equals: 'r1' } });
  ok('remove with `when`: the matching record is removed and RETURNING says so', won.rowCount === 1 && !pf().network_catalogue.pending.S1);
  await policy.patchKey(null, 'shop', [], { api_keys: [{ jti: 'a' }, { jti: 'b' }] }, { op: 'merge' });
  await policy.patchKey(null, 'shop', ['api_keys'], { seen: 'now' }, { op: 'merge_item', match: ['jti', 'b'] });
  ok('merge_item: only the matching key is merged (keys.patchKey)', !pf().api_keys[0].seen && pf().api_keys[1].seen === 'now');
  await policy.patchKey(null, 'shop', ['devices', 'D9', 'till'], { prefix: 'C1' }, { parents: false });
  ok('parents:false: a device that is not listed is not invented (keys claimDevice)', !(pf().devices && pf().devices.D9));
  let threw = null; try { policy.patchSql([], { gst_registration: 'bogus' }, { op: 'merge' }); } catch (e) { threw = e; }
  ok('a FLAGS key is coerced — an invalid value is a 400, not stored', threw && threw.status === 400);
  threw = null; try { policy.patchSql(['self_copy_pref'], 'both'); } catch (e) { threw = e; }
  ok('a column-proxied flag is refused (policy.set writes its column)', threw && threw.status === 400);
  threw = null; try { policy.patchSql([], { dispute_scope: 'shared' }, { op: 'merge' }); } catch (e) { threw = e; }
  ok('a platform-bound key is refused', threw && threw.status === 400);
  await policy.set('shop', { trade_side: 'receive' });
  ok('policy.set writes through patchKey (one shape)', pf().trade_side === 'receive' && PP.isPatch(SEEN[SEEN.length - 2].s));

  console.log('\n── POL1 · FLAGS carries the card and who may change ──');
  const card = Object.keys(policy.FLAGS).filter((k) => policy.FLAGS[k].ui).concat(Object.keys(policy.BOUND_SCHEMA).filter((k) => policy.BOUND_SCHEMA[k].ui));
  ok('17 card rows carry label · level · gov · order (was the web\'s POLICY_FLAGS)', card.length === 17
    && card.every((k) => { const u = (policy.FLAGS[k] || policy.BOUND_SCHEMA[k]).ui; return u.label && u.level && u.gov && u.order > 0; }));
  ok('a row\'s shown options are the flag\'s own options, only reordered', card.every((k) => { const f = policy.FLAGS[k] || policy.BOUND_SCHEMA[k]; return !f.ui.options || f.ui.options.slice().sort().join() === f.options.slice().sort().join(); }));
  ok('owner-only is data: system_folders / books refused for a co-assist, in the flag\'s own words', policy.refusalFor({ books: {} }, false) === 'Only the owner may let the books post by themselves.'
    && policy.refusalFor({ system_folders: {} }, false) === 'Only the owner may switch folders on or off.' && policy.refusalFor({ books: {} }, true) === null && policy.refusalFor({ trade_side: 'sell' }, false) === null);

  console.log('\n── SET4 · one check, one writer ──');
  ok('India: a GSTIN by its checksum', profile.taxIdRefusal('IN', '33AAAAA0000A1Z5') && profile.taxIdRefusal('IN', '27AAPFU0939F1ZV') === null);
  ok('Australia: an ABN by the pack (not "15 characters")', !!profile.taxIdRefusal('AU', '123') && profile.taxIdRefusal('AU', '51824753556') === null);
  ok('no pack: any number up to 40, never a GSTIN rule', profile.taxIdRefusal(null, 'ANY-NUMBER-1') === null && !!profile.taxIdRefusal(null, 'X'.repeat(41)));
  ok('shopIdentitySql writes only what is present (null clears)', profile.shopIdentitySql({ tax_id: null }, 4).sql === 'gstn = $4' && profile.shopIdentitySql({}, 1).sql === '');
  await profile.setShopIdentity(null, 'shop', { tax_id: '27AAPFU0939F1ZV', address: '1 Main Rd' }, { country: 'IN' });
  ok('setShopIdentity writes the columns', ROWS.shop.gstn === '27AAPFU0939F1ZV' && ROWS.shop.address === '1 Main Rd');
  threw = null; try { await profile.setShopIdentity(null, 'shop', { tax_id: '27AAPFU0939F1ZX' }, { country: 'IN' }); } catch (e) { threw = e; }
  ok('…and refuses a number the pack refuses, in words (400 TAX_ID_BAD)', threw && threw.status === 400 && threw.code === 'TAX_ID_BAD' && ROWS.shop.gstn === '27AAPFU0939F1ZV');

  console.log('\n' + (fail ? '✗ ' + fail + ' FAIL, ' : '✓ ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ crashed: ' + (e && e.stack)); process.exit(1); });
