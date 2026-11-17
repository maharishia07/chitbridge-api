// till-verify.spec.js — [TILL-05] A COUNTER CAN PROVE ITSELF, AND A DELETED ROW CANNOT HIDE IN IT.
//
// Athi, 2026-09-09, after emptying a catalogue in SQL and reloading it while his counter went on listing the old rows:
// "i am going crazy now — how to gain confidence it is reading the entire catalogue and also not mixing up, and counter works fine
// and rightly synced."
//
// ⚠️⚠️ THE DEFECT. A delta asks for everything with `updated_at > since`. A DELETED row is not late, it is gone — it appears in no
// result set, so it lands in neither the changes nor the removals and the till's merge keeps it for ever. This spec cannot issue a
// raw SQL delete, so it reproduces the STATE that a delete leaves behind (a copy holding a row the shop does not have) and proves
// the counter notices and heals it. That is the mechanism, tested where it actually lives.
//
// ⚠️ CTR-VERIFY (T3-FIXES, 2026-10-14) — THE COUNTER'S OWN REPORT IS RETIRED HERE, HONESTLY. verifyCounter() (the "agrees with
// ChitBridge" slip: right shop, full count, 8 sampled rows, clock age) was deleted from the till on 25 Sep (api be02d62b): it was a
// dead twin no click could reach, and Athi chose delete over reviving it. Its steps here could no longer pass. What still stands,
// and is still proven below: the SERVER's second opinion (GET /api/till/verify — count, shop, a sample spread to the shelf's end),
// compared against the counter's copy by this spec; the ghost row a delete leaves behind, healed by ↻; every row stamped with one
// shop; another shop's catalogue and queue refused. Restoring the report in the counter is a till change for its own round.
const { test, expect } = require('@playwright/test');
const { mintEntity, clickNav } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

test('[TILL-05] the counter checks itself against the shop, and heals a copy that holds too much', async ({ page, context }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Verify ' + Date.now().toString().slice(-6) });

  await test.step('a small shop', async () => {
    await page.evaluate(async () => {
      const rows = [
        { name: 'Tomato', code: 'VVEG1', unit: 'kg', category: 'Vegetables', price: 32, mrp: 45, avail: 'available' },
        { name: 'Onion big', code: 'VVEG2', unit: 'kg', category: 'Vegetables', price: 28, mrp: 38, avail: 'available' },
        { name: 'Toor dal 1 kg', code: 'VPUL1', unit: 'packet', category: 'Pulses', price: 168, mrp: 199, avail: 'available' },
        { name: 'Sunflower oil 1 L', code: 'VOIL1', unit: 'litre', category: 'Edible oil', price: 142, mrp: 175, avail: 'available' },
      ];
      for (const r of rows) await api('prodAdd', { body: { item_data: r } });
    });
  });

  const key = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
    return api('keysMint', { body: { name: 'verify counter', scopes: ['till'], days: 1 } }); })).key;

  await test.step('⭐ the shop answers a second opinion, sampled ACROSS the shelf', async () => {
    const r = await page.request.get(API + '/api/till/verify', { headers: { 'X-Api-Key': key } });
    expect(r.status()).toBe(200);
    const v = await r.json();
    expect(v.total, 'the shop counts its own sellable products').toBe(4);
    expect(v.shop.name, 'and says which shop it is').toBeTruthy();
    expect(v.sample.length, 'a sample to compare against').toBeGreaterThan(0);
    /* ⚠️ spread, not the first N — the offsets must reach the far end, or a counter holding only page one would pass */
    const offs = v.sample.map((s) => s.at_offset);
    expect(Math.max(...offs), 'the sample never reaches the end of the shelf').toBe(v.total - 1);
    for (const s of v.sample) { expect(s.name).toBeTruthy(); expect(typeof s.price).toBe('number'); }
  });

  const till = await context.newPage();
  const threw = [];
  till.on('pageerror', (e) => threw.push(e.message));

  await test.step('the counter pairs and agrees with the shop', async () => {
    await till.goto('/till.html#key=' + encodeURIComponent(key)
      + '&shop=' + encodeURIComponent(await page.evaluate(() => SESSION.entityId)));
    await till.waitForFunction(() => window.CBOffers && window.CBTax && typeof window.refresh === 'function', null, { timeout: 60000 });
    await till.waitForFunction(() => document.getElementById('shopname').textContent !== 'Not paired yet', null, { timeout: 60000 });
    await till.evaluate(() => refresh());
    await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });

    /* the count line Athi asked for — it must say the true total, not the number of rows drawn */
    await expect(till.locator('[data-testid="till-shelf-count"]')).toContainText('4 products on this counter');

    /* the server's sample, compared with the counter's copy HERE (the counter's own report was retired — see the header) */
    const v = await (await page.request.get(API + '/api/till/verify', { headers: { 'X-Api-Key': key } })).json();
    const agree = await till.evaluate((sample) => {
      const mine = (S && S.items) || [];
      return { count: mine.length, wrong: sample.filter((r) => { const o = mine.find((i) => i.item_id === r.item_id);
        return !o || String(o.name) !== String(r.name) || Number(o.price) !== Number(r.price); }).map((r) => r.name) };
    }, v.sample || []);
    expect(agree.count, 'everything is here').toBe(v.total);
    expect(agree.wrong, 'what is here is right — name and price agree with the shop').toEqual([]);
  });

  await test.step('⚠️⚠️ a copy holding a row the shop does not have — what a DELETE leaves behind', async () => {
    /* put a ghost in the stored copy, exactly as a hard-deleted row would survive a merge */
    await till.evaluate(async () => {
      const snap = await DB.get('snapshot');
      snap.items.push({ item_id: 'ghost-0000-0000-0000-000000000000', name: 'Ghost stock 1 kg',
                        unit: 'kg', price: 999, code: 'GHOST', category: 'Vegetables', avail: 'available' });
      await DB.set('snapshot', snap);
      S = snap; paintHits();
    });
    expect(await till.evaluate(() => (S.items || []).length), 'the ghost is in the copy').toBe(5);

    /* the server's count disagrees with the copy before anything is repaired */
    const v = await (await page.request.get(API + '/api/till/verify', { headers: { 'X-Api-Key': key } })).json();
    expect(v.total, 'the shop still has four — the copy holds one it does not').toBe(4);

    /* and a refresh must heal it: the merge will not add up, so the whole shop comes down again */
    await till.evaluate(() => refresh());
    await till.waitForFunction(() => (S.items || []).length === 4, null, { timeout: 60000 });
    const names = await till.evaluate(() => (S.items || []).map((i) => i.name));
    expect(names, 'the ghost survived a refresh — the delta merge is not self-healing').not.toContain('Ghost stock 1 kg');
    expect(names.length, 'it did not recover to the shop\'s own count').toBe(v.total);
  });

  expect(threw, 'the counter threw').toEqual([]);
  await till.close();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// [TILL-06] EVERY ROW IN THE COUNTER'S COPY CAME FROM ONE SHOP — counted, not promised.
//
// Athi, 2026-09-09: "is every row in the catalogue carrying the entity id? can we confirm that the entity id is the same in each
// product row in the counter catalogue — for some reason it mixed it? in the indexed db, can we query that separately and confirm
// that its count is one?"
//
// On the server every row has entity_id and every query filters on it. In the counter the rows carried NO shop id at all, so the
// question could not be asked — which is exactly why the mixing was invisible. Rows are now stamped on arrival (locally: sending
// entity_id on 10,441 rows would add a third of a megabyte to say one thing about the whole copy), and the merge refuses to join
// two shops. This proves both.
test('[TILL-06] the counter stamps every row with its shop, and refuses to merge two', async ({ page, context }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Stamp ' + Date.now().toString().slice(-6) });
  await page.evaluate(async () => {
    for (const r of [{ name: 'Tomato', code: 'SVEG1', unit: 'kg', price: 32 },
                     { name: 'Onion big', code: 'SVEG2', unit: 'kg', price: 28 }])
      await api('prodAdd', { body: { item_data: r } });
  });
  const shopA = await page.evaluate(() => SESSION.entityId);
  const keyA = (await page.evaluate(async () => { if (typeof ensureCap === 'function') await ensureCap('admin');
    return api('keysMint', { body: { name: 'stamp A', scopes: ['till'], days: 1 } }); })).key;

  const till = await context.newPage();
  await till.goto('/till.html#key=' + encodeURIComponent(keyA) + '&shop=' + encodeURIComponent(shopA));
  await till.waitForFunction(() => window.CBTax && typeof window.refresh === 'function', null, { timeout: 60000 });
  await till.waitForFunction(() => document.getElementById('shopname').textContent !== 'Not paired yet', null, { timeout: 60000 });
  await till.evaluate(() => refresh());
  await till.waitForSelector('[data-testid="till-hit-0"]', { timeout: 60000 });

  await test.step('⭐⭐ every row carries the shop it came from, and there is exactly ONE', async () => {
    const seen = await till.evaluate(() => {
      const s = {}; (S.items || []).forEach((i) => { s[i._shop || 'UNSTAMPED'] = (s[i._shop || 'UNSTAMPED'] || 0) + 1; });
      return s;
    });
    const kinds = Object.keys(seen);
    expect(kinds, 'rows are not stamped with their shop: ' + JSON.stringify(seen)).not.toContain('UNSTAMPED');
    expect(kinds.length, 'more than one shop in one copy: ' + JSON.stringify(seen)).toBe(1);
    /* ⚠️ the WHOLE entity id, not a prefix — it never crosses the wire, so there is nothing to save by shortening the one
       value the audit is about, and a prefix can collide */
    expect(kinds[0], 'the stamp is not this shop').toBe(shopA);
    /* (the counter's "Every row is from one shop" line went with verifyCounter on 25 Sep — the count above IS that check) */
  });

  await test.step('⚠️⚠️ ANOTHER SHOP CATALOGUE IS REFUSED — through the real refresh, not a simulation', async () => {
    /* the database records its owner on the first snapshot; forge a different one and the shop's own answer becomes foreign */
    const before = await till.evaluate(async () => {
      await DB.set('owner', 'BBBBBBBB-0000-0000-0000-000000000000');
      return (S.items || []).map((i) => i.name).sort();
    });

    const out = await till.evaluate(() => HOST.refresh());
    expect(out.ok, 'a catalogue for another shop was accepted').toBe(false);
    expect(out.rejected, 'it was not refused as a foreign shop').toBe(true);

    /* ⭐ the guard also refuses to READ rows that disagree with the owner — better to show nothing than another shop's prices */
    const guarded = await till.evaluate(() => DB.get('snapshot'));
    expect(guarded, 'a copy that disagrees with the owner was handed back anyway').toBeFalsy();

    /**
     * ⚠️ REFUSED, NOT SWITCHED: the BYTES on disk must be untouched. Read straight out of IndexedDB, past our own guard —
     * the guard is what is being tested, so it cannot also be the instrument.
     */
    const after = await till.evaluate(() => new Promise((res, rej) => {
      const rq = indexedDB.open(tillStore());
      rq.onsuccess = () => { const db = rq.result;
        const g = db.transaction('kv', 'readonly').objectStore('kv').get('snapshot');
        g.onsuccess = () => res(((g.result && g.result.items) || []).map((i) => i.name).sort());
        g.onerror = () => rej(g.error); };
      rq.onerror = () => rej(rq.error);
    }));
    expect(after, 'the copy on disk was changed by a refusal').toEqual(before);

    /* and it must SAY so, on the bar and in the check, and survive a reload */
    const bar = await till.evaluate(() => { paintStatus(); return document.getElementById('queuenote').textContent; });
    expect(bar, 'the bar does not say a catalogue was refused').toContain('REFUSED');
    const found = await till.evaluate(() => health().filter((h) => h.what.indexOf('another shop was refused') >= 0));
    expect(found.length, 'the health check does not report the refusal').toBe(1);
    expect(found[0].level).toBe('bad');

    await till.reload();
    await till.waitForFunction(() => typeof REJECTED !== 'undefined', null, { timeout: 60000 });
    await till.waitForFunction(() => REJECTED != null, null, { timeout: 30000 });

    /* put it back so the counter is its own again — on disk AND in memory, or the next step tests a state no shop is ever in */
    await till.evaluate(async (a) => { await DB.set('owner', a); OWNER = a; REJECTED = null; await DB.del('kv', 'rejected'); }, shopA);
  });

  await test.step('⭐ and a queued bill from another shop is never sent', async () => {
    const sent = await till.evaluate(async () => {
      /**
       * ⚠️ PLANTED RAW, PAST DB.put — because put() re-stamps every row with this database's owner, so a foreign row cannot even
       * be WRITTEN through the normal path. That is the write guard doing its job. What is tested here is the READ guard: a row
       * that reached the store some other way (a store swapped underneath, data from before stamping, a hand edit) must never be
       * handed back to the drain and posted under this shop's key.
       */
      await new Promise((res, rej) => {
        const rq = indexedDB.open(tillStore());
        rq.onsuccess = () => { const db = rq.result;
          const t = db.transaction('queue', 'readwrite');
          t.objectStore('queue').put({ no: 'FOREIGN/1', at: new Date().toISOString(),
                                       _shop: 'BBBBBBBB-0000-0000-0000-000000000000', lines: [], pays: [], total: 1 });
          t.oncomplete = res; t.onerror = () => rej(t.error); };
        rq.onerror = () => rej(rq.error);
      });
      const rows = await DB.all('queue');
      return { handedBack: rows.filter((r) => r.no === 'FOREIGN/1').length };
    });
    expect(sent.handedBack, 'a queued row belonging to another shop was handed back for sending').toBe(0);
  });

  await till.close();
});
