'use strict';
/**
 * one-writer.test.cjs — ⭐⭐⭐ T2-WRITERS (14 Oct): ONE WRITER PER PRIMITIVE, AND THE COUNT CAN ONLY GO DOWN.
 *
 *   primitive                      the one writer                         before → after (this guard asserts the after)
 *   a product UPDATE               lib/catalogue-write patchItems/Where   21 statements in 8 files → 0 outside
 *   a person's task count          lib/assign-chit taskCount               13 statements in 2 files → 0 outside
 *   who holds a chit copy          lib/assign-chit assignChit/reroute…     9 `SET assigned_to_actor_id` in 4 files → 0 outside (W1-RAIL, 15 Oct)
 *   an OTP generator               lib/otp generateOTP(kind)               3 private generators + 4 `fixedOtp() ||` → 0 outside
 *   the shopper's code issue/spend lib/otp issueShopperOtp/spendShopperOtp 2 issues + 4 spends in routes/catalogue.js → 0
 *   a local customer (mint 'cus')  lib/local-identity addCustomer          4 copies, 3 phone checks → 1 helper, phoneOf
 *
 * Reads the SOURCE (comments blanked), then runs each helper against a recording stand-in for the database.
 * Run: node tests/one-writer.test.cjs · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');

let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

function sources() {
  const out = [];
  ['routes', 'lib', 'middleware', 'src', 'db'].forEach(function walk(dir) {
    const d = path.join(API, dir);
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const rel = dir + '/' + e.name;
      if (e.isDirectory()) walk(rel); else if (/\.(c?js)$/.test(e.name)) out.push(rel);
    });
  });
  return out.concat(['server.js']).filter((f) => fs.existsSync(path.join(API, f)));
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
            .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}
const CODE = sources().map((rel) => ({ rel, src: stripComments(fs.readFileSync(path.join(API, rel), 'utf8')) }));
function hits(re, allowed) {
  const out = [];
  CODE.forEach(({ rel, src }) => {
    if (allowed.indexOf(rel) >= 0) return;
    const g = new RegExp(re.source, 'g' + (re.flags.replace('g', '')));
    let m; while ((m = g.exec(src))) out.push(rel + ':' + src.slice(0, m.index).split('\n').length);
  });
  return out;
}
const none = (list, why) => assert.deepStrictEqual(list, [], why + '\n      at: ' + list.join(', '));

(async () => {
  console.log('\n-- the source: one writer each (the ratchet — zero outside the canonical file) --');
  await it('CAT-W1: no UPDATE of catalogue_items outside lib/catalogue-write.js', () =>
    none(hits(/UPDATE\s+catalogue_items\b/i, ['lib/catalogue-write.js']), 'a product write must go through catalogue-write.patchItems / patchWhere'));
  await it('CAT-W1: the import writes its rows in ONE transaction (no withEntity per row)', () => {
    const src = CODE.find((c) => c.rel === 'routes/products.js').src;
    assert.ok(/catwrite\.patchItems\(db, entity_id, updates\)/.test(src) && /catwrite\.insertStamped\(db, entity_id, sid, inserts\)/.test(src), 'the import calls the one writer once');
    const loop = src.slice(src.indexOf('const outcome = [], updates = [], inserts = [];'), src.indexOf('if (updates.length || inserts.length)'));
    assert.ok(loop.length > 100 && !/withEntity\(/.test(loop), 'no withEntity inside the per-line loop');
  });
  await it('TA1: no write of current_task_count outside lib/assign-chit.js', () =>
    none(hits(/(SET|,)\s*current_task_count\s*=/i, ['lib/assign-chit.js']), 'a task count change must go through assign-chit.taskCount'));
  await it('W1-RAIL: no write of assigned_to_actor_id outside lib/assign-chit.js (pull · push · return · route · leave · auto · bulk · connector · ticket)', () =>
    none(hits(/(SET|,)\s*assigned_to_actor_id\s*=/i, ['lib/assign-chit.js']), 'who holds a chit copy is written only by assign-chit.assignChit / rerouteOpenTasks'));
  await it('W1-RAIL: lib/assign-chit.js holds exactly two SET spellings (a holder, the pool) — one UPDATE shape each', () => {
    const src = CODE.find((c) => c.rel === 'lib/assign-chit.js').src;
    assert.strictEqual((src.match(/SET\s+assigned_to_actor_id\s*=/g) || []).length, 2, 'SET_HOLDER and SET_POOL, nothing else');
    assert.ok(!/current_status\s*=\s*\$/.test(src) && !/SET[^;]*current_status\s*=/.test(src), 'the assignment writer never SETs current_status — rail-status does');
  });
  await it('SH-OTP1: no OTP generator outside lib/otp.js (randomInt(100000…) or fixedOtp(…) ||)', () => {
    none(hits(/randomInt\(\s*100000/, ['lib/otp.js']), 'a six-digit code must come from otp.generateOTP(kind)');
    none(hits(/fixedOtp\([^)]*\)\s*\|\|/, ['lib/otp.js']), 'the fixed-code fallback lives inside otp.generateOTP');
  });
  await it('SH-OTP1: the shopper code is issued and spent only by lib/otp.js', () => {
    none(hits(/SET\s+otp_code\s*=\s*\$1,\s*otp_expires_at\s*=\s*\$2,\s*otp_contact/i, ['lib/otp.js']), 'issueShopperOtp is the one issue');
    none(hits(/status\s*=\s*'active',\s*otp_code\s*=\s*NULL/i, ['lib/otp.js']), 'spendShopperOtp is the one spend');
  });
  await it('CRM-MINT1: no local customer minted outside lib/local-identity.js (mint … kind \'cus\')', () =>
    none(hits(/\.mint\([^;]{0,120}kind:\s*'cus'/, ['lib/local-identity.js']), 'add a local customer through local-identity.addCustomer'));

  console.log('\n-- the helpers, against a recording stand-in --');
  const rec = () => { const calls = []; const db = { query: async (sql, p) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), p }); return { rows: [{ item_id: 'x' }], rowCount: 1 }; } }; return { db, calls }; };
  const CW = require(path.join(API, 'lib', 'catalogue-write'));

  await it('patchItems: many edits → ONE statement; the same id twice is folded (merges compose, a replace wins)', async () => {
    const { db, calls } = rec();
    await CW.patchItems(db, 'E', [{ item_id: 'a', merge: { x: 1 } }, { item_id: 'b', replace: { n: 'B' } }, { item_id: 'a', merge: { y: 2 } }, { item_id: 'b', replace: { n: 'B2' } }]);
    assert.strictEqual(calls.length, 1);
    const [ids, datas, modes, actives, eid] = calls[0].p;
    assert.deepStrictEqual(ids, ['a', 'b']); assert.deepStrictEqual(modes, ['merge', 'replace']);
    assert.deepStrictEqual(datas.map((d) => JSON.parse(d)), [{ x: 1, y: 2 }, { n: 'B2' }]);
    assert.deepStrictEqual(actives, [null, null]); assert.strictEqual(eid, 'E');
    assert.ok(/WHERE c\.item_id = u\.id AND c\.entity_id = \$5 RETURNING c\.item_id$/.test(calls[0].sql.trim()), calls[0].sql);
  });
  await it('patchItems: one change for many ids · a soft remove leaves item_data and updated_at · returning is c.-prefixed · activeOnly', async () => {
    const { db, calls } = rec();
    await CW.patchItems(db, 'E', { ids: ['a', 'b'], merge: { status: 'unavailable' } }, { returning: 'item_id, item_data' });
    assert.deepStrictEqual(calls[0].p[2], ['merge', 'merge']);
    assert.ok(/RETURNING c\.item_id, c\.item_data$/.test(calls[0].sql.trim()));
    await CW.patchItems(db, 'E', [{ item_id: 'a', active: false }], { returning: '*', activeOnly: true });
    assert.deepStrictEqual(calls[1].p[1], [null]); assert.deepStrictEqual(calls[1].p[2], [null]); assert.deepStrictEqual(calls[1].p[3], [false]);
    assert.ok(/updated_at = CASE WHEN u\.mode IS NULL THEN c\.updated_at ELSE NOW\(\) END/.test(calls[1].sql));
    assert.ok(/AND c\.is_active = true RETURNING c\.\*$/.test(calls[1].sql.trim()));
    await assert.rejects(() => CW.patchItems(db, 'E', [{ item_id: 'a', merge: {} }], { returning: 'item_id; DROP' }));
    const empty = await CW.patchItems(db, 'E', []); assert.strictEqual(empty.rowCount, 0); assert.strictEqual(calls.length, 2, 'no edits → no statement');
  });
  await it('patchWhere: match by an item_data field, merge, optional entity / active-only / activate', async () => {
    const { db, calls } = rec();
    await CW.patchWhere(db, { field: 'tax_slab', value: 's1', activeOnly: true }, { tax_slab: 's2' });
    assert.deepStrictEqual(calls[0].p, ['s1', '{"tax_slab":"s2"}', 'tax_slab']);
    assert.ok(/WHERE is_active = true AND item_data->>\$3 = \$1$/.test(calls[0].sql.trim()));
    await CW.patchWhere(db, { field: 'qa_id', value: 'q', entity_id: 'E', activate: true }, { status: 'approved' });
    assert.ok(/is_active = true, updated_at = NOW\(\) WHERE entity_id = \$4 AND item_data->>\$3 = \$1$/.test(calls[1].sql.trim()));
    await assert.rejects(() => CW.patchWhere(db, { field: "x'; --", value: 1 }, {}));
  });

  await it('taskCount: take · release · clear · add n — the four changes, one statement each; no id → nothing', async () => {
    const { taskCount } = require(path.join(API, 'lib', 'assign-chit'));
    const { db, calls } = rec();
    await taskCount(db, 'P', 'take'); await taskCount((t, p) => db.query(t, p), 'P', 'release');
    await taskCount(db, 'P', 'clear'); await taskCount(db, 'P', { add: 3 }); await taskCount(db, null, 'take');
    assert.strictEqual(calls.length, 4);
    assert.ok(/current_task_count \+ 1, last_assigned_at = NOW\(\)/.test(calls[0].sql));
    assert.ok(/GREATEST\(0, current_task_count - 1\)/.test(calls[1].sql));
    assert.ok(/current_task_count = 0/.test(calls[2].sql));
    assert.deepStrictEqual(calls[3].p, [3, 'P']);
    await assert.rejects(() => taskCount(db, 'P', 'double'));
  });

  await it('assignChit: a person → ONE UPDATE of the four assignment columns (every copy I hold); copy received → that copy only; null → the pool', async () => {
    const { assignChit } = require(path.join(API, 'lib', 'assign-chit'));
    const { db, calls } = rec();
    const asha = { identity_id: 'A1', display_name: 'Asha' };
    const placed = await assignChit(db, 'E', 'C1', asha, 'push');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].sql, 'UPDATE chit_status SET assigned_to_actor_id = $1, assigned_to_actor_display_name = $2, assigned_at = NOW(), assignment_type = $3, updated_at = NOW() WHERE chit_id = $4 AND entity_id = $5');
    assert.deepStrictEqual(calls[0].p, ['A1', 'Asha', 'push', 'C1', 'E']);
    assert.deepStrictEqual(placed, { rows: 1, moved: false, from: null }, 'no mover → the status is not touched');
    await assignChit(db, 'E', 'C1', asha, 'auto', { copy: 'received' });
    assert.ok(/WHERE chit_id = \$4 AND entity_id = \$5 AND direction = 'received'$/.test(calls[1].sql), calls[1].sql);
    await assignChit(db, 'E', 'C1', null);
    assert.strictEqual(calls[2].sql, 'UPDATE chit_status SET assigned_to_actor_id = NULL, assigned_to_actor_display_name = NULL, assigned_at = NULL, assignment_type = NULL, updated_at = NOW() WHERE chit_id = $1 AND entity_id = $2');
    assert.deepStrictEqual(calls[2].p, ['C1', 'E']);
    await assignChit((t, p) => db.query(t, p), 'E', 'C1', null, undefined, { copy: 'received' });   /* a bare query function works too */
    assert.ok(/AND direction = 'received'$/.test(calls[3].sql));
    const nothing = await assignChit(db, 'E', null, asha, 'push');
    assert.deepStrictEqual(nothing, { rows: 0, moved: false, from: null }); assert.strictEqual(calls.length, 4, 'no chit → no statement');
    await assert.rejects(() => assignChit(db, 'E', 'C1', asha, 'grab'), /kind must be pull, push or auto/);
    await assert.rejects(() => assignChit(db, 'E', 'C1', asha, 'push', { copy: 'both' }), /copy must be received or sent/);
  });
  await it('assignChit + me: the received copy goes back to pending THROUGH rail-status.statusGate — the rail decides; a noop writes nothing; a viewer is refused and the assignment still stands', async () => {
    const { assignChit } = require(path.join(API, 'lib', 'assign-chit'));
    const railStatus = require(path.join(API, 'lib', 'rail-status'));
    const asha = { identity_id: 'A1', display_name: 'Asha' };
    const { db, calls } = rec();
    const moved = await assignChit(db, 'E', 'C1', asha, 'pull', { me: railStatus.SYSTEM, from: 'accepted' });
    assert.deepStrictEqual(moved, { rows: 1, moved: true, from: 'accepted' });
    assert.strictEqual(calls.length, 2, 'the assignment UPDATE, then the one status write (opts.from saved the read)');
    assert.ok(/^UPDATE chit_status SET current_status = \$1, updated_at = NOW\(\) WHERE chit_id = \$2 AND entity_id = \$3 AND direction = 'received'$/.test(calls[1].sql), calls[1].sql);
    assert.deepStrictEqual(calls[1].p, ['pending', 'C1', 'E']);
    const already = await assignChit(db, 'E', 'C1', asha, 'push', { me: railStatus.SYSTEM, from: 'pending' });
    assert.deepStrictEqual(already, { rows: 1, moved: false, from: 'pending' }); assert.strictEqual(calls.length, 3, 'already pending → no status write');
    const viewer = await assignChit(db, 'E', 'C1', asha, 'push', { me: { level: 'viewer', holder: null }, from: 'accepted' });
    assert.deepStrictEqual(viewer, { rows: 1, moved: false, from: 'accepted' }); assert.strictEqual(calls.length, 4, 'refused → the assignment is written, the status is not');
    const sentOnly = await assignChit(db, 'E', 'C1', asha, 'push', { me: railStatus.SYSTEM, from: null });
    assert.deepStrictEqual(sentOnly, { rows: 1, moved: false, from: null }, 'no received copy → not_received, quietly');
    const n = calls.length;
    await assignChit(db, 'E', 'C1', asha, 'push', { me: railStatus.SYSTEM });
    assert.ok(/^SELECT current_status FROM chit_status WHERE chit_id = \$1 AND entity_id = \$2 AND direction = 'received'$/.test(calls[n + 1].sql), 'without opts.from the gate reads the copy itself');
  });
  await it('rerouteOpenTasks: everything one person still holds → a colleague (push) or the pool, closed copies excluded, scoped to the shop', async () => {
    const { rerouteOpenTasks, CLOSED_STATUSES } = require(path.join(API, 'lib', 'assign-chit'));
    const { db, calls } = rec();
    assert.deepStrictEqual(CLOSED_STATUSES, ['completed', 'cancelled', 'rejected']);
    const toRavi = await rerouteOpenTasks(db, 'E', 'A1', { identity_id: 'R1', display_name: 'Ravi' });
    assert.strictEqual(toRavi, 1);
    assert.ok(/SET assigned_to_actor_id = \$1, assigned_to_actor_display_name = \$2, assigned_at = NOW\(\), assignment_type = \$3, updated_at = NOW\(\) WHERE assigned_to_actor_id = \$4 AND entity_id = \$5 AND current_status NOT IN \('completed','cancelled','rejected'\)$/.test(calls[0].sql), calls[0].sql);
    assert.deepStrictEqual(calls[0].p, ['R1', 'Ravi', 'push', 'A1', 'E']);
    await rerouteOpenTasks(db, 'E', 'A1', null);
    assert.ok(/SET assigned_to_actor_id = NULL, assigned_to_actor_display_name = NULL, assigned_at = NULL, assignment_type = NULL, updated_at = NOW\(\) WHERE assigned_to_actor_id = \$1 AND entity_id = \$2 AND current_status NOT IN/.test(calls[1].sql), calls[1].sql);
    assert.deepStrictEqual(calls[1].p, ['A1', 'E']);
    assert.strictEqual(await rerouteOpenTasks(db, 'E', null, null), 0); assert.strictEqual(calls.length, 2, 'nobody → nothing');
  });

  await it('issueShopperOtp / spendShopperOtp: a 6-digit code, 15 minutes, attempts DECAY (not zeroed); the spend clears and activates', async () => {
    const OTP = require(path.join(API, 'lib', 'otp'));
    const calls = []; const run = async (sql, p) => { calls.push({ sql: String(sql).replace(/\s+/g, ' '), p }); return { rows: [] }; };
    const t0 = Date.now();
    const code = await OTP.issueShopperOtp(run, 'C1', '9840012345');
    assert.ok(/^[0-9]{4,8}$/.test(code), code);
    assert.strictEqual(calls[0].p[0], code); assert.strictEqual(calls[0].p[2], '9840012345'); assert.strictEqual(calls[0].p[3], 'C1');
    const ttl = calls[0].p[1].getTime() - t0; assert.ok(ttl > 14 * 60000 && ttl <= 15 * 60000 + 1000, String(ttl));
    assert.ok(/otp_attempts = CASE WHEN otp_expires_at IS NULL OR otp_expires_at < NOW\(\) THEN 0 ELSE COALESCE\(otp_attempts, 0\) END/.test(calls[0].sql));
    await OTP.spendShopperOtp(run, 'C1');
    assert.ok(/SET status='active', otp_code=NULL, otp_expires_at=NULL, otp_attempts=0, last_active_at=NOW\(\) WHERE identity_id=\$1/.test(calls[1].sql));
    assert.ok(/^[0-9]{6}$/.test(OTP.generateOTP('connector')) || /^[0-9]{4,8}$/.test(OTP.generateOTP('connector')));
  });

  await it('phoneOf: the reward engine\'s check — blank is no phone, < 8 digits is bad, spaces fold away', () => {
    const L = require(path.join(API, 'lib', 'local-identity'));
    assert.deepStrictEqual(L.phoneOf(''), { phone: null });
    assert.deepStrictEqual(L.phoneOf('98400 12345'), { phone: '9840012345' });
    assert.deepStrictEqual(L.phoneOf('+61 412 345 678'), { phone: '+61412345678' });
    assert.deepStrictEqual(L.phoneOf('12345'), { bad: true });
  });
  await it('addCustomer: refused mint → refused · already listed → exists, no contact written · new → contact into EMPTY slots + a number', async () => {
    const L = require(path.join(API, 'lib', 'local-identity'));
    const calls = []; let listed = false;
    const h = { query: async (sql, p) => {
      sql = String(sql).replace(/\s+/g, ' '); calls.push({ sql, p });
      if (/^SELECT user_id, bridge_id FROM identities WHERE identity_id/.test(sql)) return { rows: [{ user_id: 'acme', bridge_id: 'B' }] };
      if (/FROM identities WHERE parent_entity_id = \$1 AND user_id LIKE/.test(sql)) return { rows: [] };
      if (/^SELECT user_id FROM identities WHERE user_id LIKE/.test(sql)) return { rows: [] };
      if (/^INSERT INTO identities/.test(sql)) return { rows: [{ identity_id: 'N1', bridge_id: p[0], display_name: p[1], user_id: p[2] }] };
      if (/^INSERT INTO customer_list/.test(sql)) { if (listed) return { rows: [] }; listed = true; return { rows: [{ customer_list_id: 'CL1' }] }; }
      return { rows: [] };
    } };
    const bad = await L.addCustomer(h, 'O', { name: 'a@b.com', via: 'manual' });
    assert.ok(bad.refused && bad.refused.status === 400);
    const ok = await L.addCustomer(h, 'O', { name: 'Ravi', phone: '9840012345', via: 'lead' });
    assert.strictEqual(ok.customer_list_id, 'CL1'); assert.strictEqual(ok.local.identity_id, 'N1');
    const ins = calls.find((c) => /^INSERT INTO customer_list/.test(c.sql)); assert.strictEqual(ins.p[2], 'lead');
    const up = calls.find((c) => /^UPDATE identities SET otp_contact = COALESCE\(otp_contact, \$2\)/.test(c.sql));
    assert.ok(up && up.p[1] === '9840012345' && up.p[3] === 'O', 'the contact fills empty slots only, scoped to the owner');
    const n = calls.length;
    const again = await L.addCustomer(h, 'O', { name: 'Ravi', phone: '9840099999', via: 'manual' });
    assert.ok(again.exists);
    assert.ok(!calls.slice(n).some((c) => /^UPDATE identities SET otp_contact/.test(c.sql)), 'nothing written for a party already listed');
  });

  console.log('\n  ' + pass + ' passed' + (process.exitCode ? ' · FAILURES above' : '') + ' · ' + pass + ' checks');
})();
