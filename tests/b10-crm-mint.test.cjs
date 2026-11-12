/**
 * B10 (C10 CRM) - concurrent mint, deleted parties, the door shape. Offline: a small in-memory database that really serialises on the advisory lock,
 * really enforces the two unique indexes (name, handle) and really ABORTS a transaction on a 23505 unless a savepoint is open - the behaviour the
 * 500s ("current transaction is aborted") came from. Each rule fails on main (no lock, no savepoint, no restore) and passes here.
 *   CRM-226/230/231 five adds of one phone, and of one name, at once -> ONE party, no 500; the lock is the lib/xact-lock seam, taken first
 *   CRM-229/247     a NAME that matches a deleted party restores it (same record); a phone-only match is a new party
 * The door shape (CRM-246 cheque, CRM-244 tax id, CRM-243 import phone key, CRM-227 due_at, CRM-233 groups, CRM-237/251 name typed) is tests/b10-crm-door.test.cjs.
 * Run: node tests/b10-crm-mint.test.cjs
 * CARD 11-crm-and-marketing/crm-parties
 */
'use strict';
const assert = require('assert'), path = require('path');
const API = path.join(__dirname, '..');
{ const p = require.resolve(path.join(API, 'lib/schema')); require.cache[p] = { id: p, filename: p, loaded: true, exports: { hasTable: async () => true, hasColumn: async () => true, hasColumns: async () => ({}), checkAllows: async () => true, _reset() {} } }; }
const L = require('../lib/local-identity');
let pass = 0;
const it = async (what, fn) => { try { await fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + (e.stack || e.message).split('\n').slice(0, 5).join('\n      ')); process.exitCode = 1; } };
const tick = () => new Promise((r) => setImmediate(r));
const OWNER = 'e0000000-0000-4000-8000-000000000001';
const squash = (text) => String(text).replace(/\s+/g, ' ').trim();

/** the in-memory database: identities + customer_list, advisory locks held to the end of the transaction, a transaction that aborts on an error outside a savepoint */
function makeDb() {
  const db = { ids: [{ identity_id: OWNER, user_id: 'acme', bridge_id: 'B0' }], cl: [], locks: new Map(), n: 0, lockTaken: [] };
  const waitFor = async (key, tx) => {
    while (db.locks.has(key) && db.locks.get(key) !== tx) await tick();
    db.locks.set(key, tx);
    db.lockTaken.push(key);
  };
  const tailOf = (text) => String(text || '').replace(/\D/g, '').slice(-9);
  db.tx = async (fn) => {
    const tx = { aborted: false, sp: false };
    tx.query = async (sqlRaw, p) => {
      const sql = squash(sqlRaw);
      p = p || [];
      await tick();
      if (/^ROLLBACK TO SAVEPOINT/.test(sql)) { tx.aborted = false; tx.sp = false; return { rows: [] }; }
      if (tx.aborted) { const e = new Error('current transaction is aborted, commands ignored until end of transaction block'); e.code = '25P02'; throw e; }
      if (/^SAVEPOINT/.test(sql)) { tx.sp = true; return { rows: [] }; }
      if (/^RELEASE SAVEPOINT/.test(sql)) { tx.sp = false; return { rows: [] }; }
      if (/^SELECT pg_advisory_xact_lock/.test(sql)) { await waitFor(p[0] + '|' + p[1], tx); return { rows: [] }; }
      if (/^SELECT user_id, bridge_id FROM identities WHERE identity_id/.test(sql)) return { rows: db.ids.filter((i) => i.identity_id === p[0]) };
      if (/FROM customer_list cl JOIN identities i ON i.identity_id = cl.customer_identity_id/.test(sql)) {
        const rows = db.cl.filter((c) => c.owner === p[0] && !c.hidden && tailOf(db.ids.find((i) => i.identity_id === c.id).otp_contact) === p[1]).map((c) => db.ids.find((i) => i.identity_id === c.id));
        return { rows: rows.slice(0, 1) };
      }
      if (/^SELECT identity_id, bridge_id, display_name, user_id FROM identities WHERE parent_entity_id/.test(sql)) {
        const hit = db.ids.find((i) => i.parent_entity_id === p[0] && i.user_id.startsWith(p[1].replace('%', '')) && i.display_name.trim().toLowerCase() === p[2]);
        return { rows: hit ? [hit] : [] };
      }
      if (/^SELECT user_id FROM identities WHERE user_id LIKE/.test(sql)) return { rows: db.ids.filter((i) => i.user_id.startsWith(p[0].replace('%', ''))).sort((a, b) => b.user_id.localeCompare(a.user_id)).slice(0, 1) };
      if (/^INSERT INTO identities/.test(sql)) {
        const clash = db.ids.some((i) => i.user_id.toLowerCase() === p[2].toLowerCase() || (i.parent_entity_id === p[3] && i.user_id.startsWith('~') && i.display_name.toLowerCase() === p[1].toLowerCase()));
        if (clash) { if (!tx.sp) tx.aborted = true; const e = new Error('duplicate key value violates unique constraint'); e.code = '23505'; throw e; }
        const row = { identity_id: 'N' + ++db.n, bridge_id: p[0], display_name: p[1], user_id: p[2], parent_entity_id: p[3] };
        db.ids.push(row);
        return { rows: [row] };
      }
      if (/^INSERT INTO customer_list/.test(sql)) {
        if (db.cl.some((c) => c.owner === p[0] && c.id === p[1])) return { rows: [] };
        db.cl.push({ owner: p[0], id: p[1], via: p[2], hidden: false, list_id: 'CL' + db.cl.length });
        return { rows: [{ customer_list_id: 'CL' + (db.cl.length - 1) }] };
      }
      if (/^UPDATE identities SET otp_contact/.test(sql)) { const r = db.ids.find((i) => i.identity_id === p[0]); r.otp_contact = r.otp_contact || p[1]; return { rows: [] }; }
      if (/^UPDATE customer_list SET hidden_at = NULL/.test(sql)) { const r = db.cl.filter((c) => c.owner === p[0] && c.id === p[1] && c.hidden); r.forEach((c) => { c.hidden = false; }); return { rows: r.map(() => ({ one: 1 })) }; }
      if (/^UPDATE supplier_list SET hidden_at = NULL/.test(sql)) return { rows: [] };
      if (/^SELECT customer_list_id FROM customer_list/.test(sql)) return { rows: db.cl.filter((c) => c.owner === p[0] && c.id === p[1]).map((c) => ({ customer_list_id: c.list_id })) };
      throw new Error('b10 fake db: unexpected SQL: ' + sql.slice(0, 100));
    };
    try { return await fn(tx); } finally { for (const [k, v] of db.locks) if (v === tx) db.locks.delete(k); }
  };
  return db;
}
const add = (db, c) => db.tx((h) => L.addCustomer(h, OWNER, Object.assign({ via: 'manual', number: false }, c)));

(async () => {
  await it('five parallel adds of ONE phone (different names) -> one party, four "exists by phone", no 500', async () => {
    const db = makeDb();
    const out = await Promise.all([1, 2, 3, 4, 5].map((n) => add(db, { name: 'Walk ' + n, phone: '+919840012321' })));
    assert.strictEqual(out.filter((x) => x.local && !x.exists && !x.refused).length, 1, JSON.stringify(out.map((x) => Object.keys(x))));
    assert.strictEqual(out.filter((x) => x.exists && x.by === 'phone').length, 4);
    assert.strictEqual(db.cl.length, 1, 'one customer_list row');
    assert.strictEqual(db.ids.filter((i) => i.parent_entity_id === OWNER).length, 1, 'one minted party');
  });
  await it('five parallel adds of ONE name (no phone) -> one party, four "exists", no 500 and no refusal', async () => {
    const db = makeDb();
    const out = await Promise.all([1, 2, 3, 4, 5].map(() => add(db, { name: 'Corner Hardware' })));
    assert.strictEqual(out.filter((x) => x.exists).length, 4, JSON.stringify(out.map((x) => Object.keys(x))));
    assert.strictEqual(db.cl.length, 1);
    assert.ok(out.every((x) => !x.refused), 'no "Busy" refusal');
  });
  await it('five parallel adds of DIFFERENT names -> five parties with five different ids (the lock is a queue, not a loss)', async () => {
    const db = makeDb();
    const out = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((n) => add(db, { name: 'Shop ' + n })));
    assert.strictEqual(new Set(out.map((x) => x.local.user_id)).size, 5);
  });
  await it('the lock is the lib/xact-lock seam on the owner, taken FIRST, once per add', async () => {
    const db = makeDb();
    await add(db, { name: 'Solo', phone: '9840099999' });
    assert.deepStrictEqual(db.lockTaken, [OWNER + '|party-mint']);
    assert.ok(require('../lib/xact-lock').LOCK_SQL.indexOf('pg_advisory_xact_lock') > 0);
    assert.strictEqual(L.MINT_LOCK, 'party-mint');
  });
  await it('a residual 23505 inside the caller\'s transaction no longer aborts it: the INSERT sits in a SAVEPOINT and mint retries on the next number', async () => {
    const db = makeDb();
    db.ids.push({ identity_id: 'X1', user_id: '~acme.cus-0001', bridge_id: 'BX', display_name: 'Someone Else', parent_entity_id: OWNER }); /* the number a racing writer took */
    const got = await db.tx(async (h) => {
      const top = h.query;
      let first = true;
      const stale = async (sql, p) => { /* the top-number read is stale once: it answers "none", so the first INSERT hits the handle index */
        if (first && /^SELECT user_id FROM identities WHERE user_id LIKE/.test(squash(sql))) { first = false; return { rows: [] }; }
        return top(sql, p);
      };
      return L.mint(OWNER, 'Late Comer', { query: stale, kind: 'cus', savepoint: true });
    });
    assert.strictEqual(got.created, true, JSON.stringify(got));
    assert.notStrictEqual(got.user_id, '~acme.cus-0001', 'not the number the racing writer took');
  });
  await it('CRM-247: a NAME that matches a DELETED customer restores that very party (same id), says so, and adds no second one', async () => {
    const db = makeDb();
    const first = await add(db, { name: 'Old Friend', phone: '9840011111' });
    db.cl[0].hidden = true;
    const again = await add(db, { name: 'old friend' });
    assert.strictEqual(again.restored, true, JSON.stringify(again));
    assert.strictEqual(again.local.identity_id, first.local.identity_id);
    assert.strictEqual(db.cl.length, 1);
    assert.strictEqual(db.cl[0].hidden, false);
    assert.strictEqual(again.exists, undefined);
  });
  await it('CRM-247: a LIVE name match is still "exists", and a phone-only match with a DELETED customer adds a NEW party', async () => {
    const db = makeDb();
    await add(db, { name: 'Live One', phone: '9840022222' });
    assert.strictEqual((await add(db, { name: 'Live One' })).exists, true);
    db.cl[0].hidden = true;
    const other = await add(db, { name: 'Different Name', phone: '9840022222' });
    assert.ok(other.local && !other.restored && !other.exists, 'a new party');
    assert.strictEqual(db.cl.length, 2);
  });
  console.log(pass + ' checks');
  process.exit(process.exitCode || 0);
})();
