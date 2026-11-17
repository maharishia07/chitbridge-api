// promo-pair.spec.js — [PROMO-02] A SCREEN JOINS WITH SIX CHARACTERS, AND SHOWS THE SHOP'S OWN PICTURE.
//
// Athi, 2026-09-09: "please add pairing so we can test 1 to many devices" and "if we add our own image for a product, that image
// should come, correct? can you add an image and see that works?"
//
// ⚠️ THIS SPEC EXISTS BECAUSE BOTH CLAIMS ARE EASY TO BELIEVE AND HARD TO SEE. A pairing flow that silently hands over the WRONG
// authority looks identical to one that works, and an image that fails to load leaves a category emblem that also looks fine. So
// the scope of the minted key is asserted directly, and the picture is checked in PIXELS — a real colour, drawn where the
// medallion is.
const { test, expect } = require('@playwright/test');
const { mintEntity } = require('../fixtures');
const API = process.env.CB_API_BASE || 'https://chitbridge-api-production.up.railway.app';

/* a 64×64 solid magenta PNG — a colour nothing else in the design uses, so finding it proves the PICTURE drew, not the fallback */
function magentaPng() {
  const zlib = require('zlib');
  const W = 64, H = 64;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = 255; raw[o + 1] = 0; raw[o + 2] = 220;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(require('zlib').crc32 ? require('zlib').crc32(td) >>> 0 : crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  function crc32(buf) { let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc = (crc >>> 8) ^ c; }
    return (crc ^ 0xffffffff) >>> 0; }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('[PROMO-02] a screen pairs with a code, gets a READ-ONLY key, and draws the product picture', async ({ page, context, browser }) => {
  test.setTimeout(300000);
  await mintEntity(page, { fresh: true, name: 'Pair ' + Date.now().toString().slice(-6) });

  let pid;
  await test.step('a shop with a product', async () => {
    pid = await page.evaluate(async () => {
      const r = await api('prodAdd', { body: { item_data: { name: 'Pictured masala 100 g', code: 'PIC1',
        unit: 'packet', category: 'Spices', price: 42, mrp: 60, avail: 'available' } } });
      return (r && r.item && r.item.item_id) || null;
    });
    expect(pid).toBeTruthy();
  });

  let hasImage = false;
  await test.step('⭐ and a picture on it — the shop\'s own, not a stock photo', async () => {
    const b64 = magentaPng().toString('base64');
    const out = await page.evaluate(async (a) => {
      try { return await api('prodMediaAdd', { params: { id: a.pid },
        body: { name: 'masala.png', mime: 'image/png', data_base64: a.b64 } }); }
      catch (e) { return { error: String(e && e.message) }; }
    }, { pid, b64 });
    /* ⚠️ the media store may not be configured on this deployment; that is a real answer, not a failure of pairing */
    hasImage = !!(out && out.id);
    if (!hasImage) console.log('   (no media store here: ' + JSON.stringify(out).slice(0, 160) + ')');
  });

  let code;
  await test.step('⭐⭐ the shop asks for a pairing code', async () => {
    const r = await page.evaluate(async () => api('tillPair', { body: {} }));
    code = r && r.code;
    expect(code, 'no code came back').toBeTruthy();
    expect(code, 'a code must be six characters a person can read off a screen').toMatch(/^[A-Z0-9]{6}$/);
    /* ⚠️ the ambiguous glyphs must not be in it — O and 0 read the same on a television across a room */
    expect(code).not.toMatch(/[O0I1L]/);
  });

  await test.step('⚠️ a wrong code is refused, and says so in words', async () => {
    const bad = await page.request.post(API + '/api/till/pair/claim', { data: { code: 'ZZZZZZ' } });
    expect(bad.status()).toBe(404);
    expect((await bad.json()).message).toContain('expired');
  });

  const tv = await context.newPage();
  const threw = [];
  tv.on('pageerror', (e) => threw.push(e.message));

  await test.step('⭐⭐⭐ the television types the code and joins — with NO key of its own to begin with', async () => {
    await tv.goto('/promo.html');
    await tv.waitForSelector('[data-testid="promo-pair-code"]', { timeout: 60000 });
    /* an unpaired screen must ASK, not show an empty stage that looks broken */
    await expect(tv.locator('#pairwrap')).toBeVisible();

    await tv.fill('[data-testid="promo-pair-code"]', code);
    await tv.click('[data-testid="promo-pair-go"]');
    await tv.waitForFunction(() => typeof SLIDES !== 'undefined' && SLIDES.length > 0, null, { timeout: 90000 });
    await expect(tv.locator('#pairwrap')).toBeHidden();
    expect(await tv.evaluate(() => (S && S.items || []).length), 'it did not receive the shop').toBeGreaterThan(0);
  });

  await test.step('⚠️⚠️ and what it was given can only READ — a wall-mounted screen cannot record a sale', async () => {
    const key = await tv.evaluate(() => localStorage.getItem('cb_till_key'));
    expect(key).toBeTruthy();
    /* the snapshot: allowed */
    expect((await page.request.get(API + '/api/till/snapshot', { headers: { 'X-Api-Key': key } })).status()).toBe(200);
    /* recording a sale: refused. This is the whole reason pairing is safe to leave on a screen in a public part of a shop. */
    const sale = await page.request.post(API + '/api/chits/send', { headers: { 'X-Api-Key': key },
      data: { recipients: [{ self: true, name: 'self' }], purpose: 'general', subject: 'x',
              line_items: [{ particulars: 'x', quantity: 1, price: 1, total: 1 }] } });
    expect(sale.status(), 'a SCREEN key was able to record a sale').toBe(403);
    /* and it cannot read the shop's bills either */
    expect((await page.request.get(API + '/api/till/bills', { headers: { 'X-Api-Key': key } })).status()).toBe(403);
  });

  await test.step('⚠️ the code is spent — a second screen cannot reuse what it read off the first', async () => {
    const again = await page.request.post(API + '/api/till/pair/claim', { data: { code } });
    expect(again.status(), 'a used code was accepted a second time').toBe(404);
  });

  await test.step('⭐ ONE TO MANY: a second code pairs a second screen, independently', async () => {
    const r2 = await page.evaluate(async () => api('tillPair', { body: {} }));
    expect(r2.code).not.toBe(code);
    /**
     * ⚠️ A SECOND SCREEN IS A SECOND DEVICE, NOT A SECOND TAB. Opening promo.html in the same context found the key the first
     * screen had just stored and paired itself silently — correct behaviour (one browser, one storage) but it tests nothing.
     * A television across the shop has its own storage, so the test needs its own context.
     */
    const ctx2 = await browser.newContext();
    const tv2 = await ctx2.newPage();
    await tv2.goto('/promo.html');
    await tv2.waitForSelector('[data-testid="promo-pair-code"]', { timeout: 60000 });
    await tv2.fill('[data-testid="promo-pair-code"]', r2.code);
    await tv2.click('[data-testid="promo-pair-go"]');
    await tv2.waitForFunction(() => typeof SLIDES !== 'undefined' && SLIDES.length > 0, null, { timeout: 90000 });
    /* two screens, two DIFFERENT keys — so one can be revoked without darkening the other */
    const k1 = await tv.evaluate(() => localStorage.getItem('cb_till_key'));
    const k2 = await tv2.evaluate(() => localStorage.getItem('cb_till_key'));
    expect(k2, 'both screens share one key — revoking one would darken both').not.toBe(k1);
    await tv2.close(); await ctx2.close();
  });

  await test.step('⭐⭐ THE PICTURE IS ON THE SCREEN — in pixels, not in a field', async () => {
    test.skip(!hasImage, 'no media store on this deployment, so there is no picture to draw');
    const item = await tv.evaluate(() => (S.items || []).find((i) => i.name === 'Pictured masala 100 g'));
    expect(item, 'the product did not reach the screen').toBeTruthy();
    expect(item.image, 'the snapshot did not carry the picture').toBeTruthy();

    /* park on a slide about that product, wait for the image, then look for its colour */
    const drew = await tv.evaluate(async (name) => {
      const n = shown().findIndex((s) => (s.item && s.item.name === name)
        || (s.items || []).some((i) => i.name === name));
      if (n < 0) return { why: 'no slide about it' };
      AT = n; paint(false);
      /* the fetch is asynchronous; give it a moment and repaint */
      await new Promise((r) => setTimeout(r, 4000));
      paint(false);
      const c = document.getElementById('c'), g = c.getContext('2d');
      let magenta = 0;
      for (let i = 0; i < 4000; i++) {
        const d = g.getImageData((i * 61) % c.width, (i * 79) % c.height, 1, 1).data;
        if (d[0] > 200 && d[1] < 80 && d[2] > 160) magenta++;
      }
      return { magenta, exported: (function(){ try { c.toDataURL('image/png'); return true; } catch (_) { return false; } })() };
    }, 'Pictured masala 100 g');

    expect(drew.magenta, 'the product picture was not drawn: ' + JSON.stringify(drew)).toBeGreaterThan(0);
    /* ⚠️ AND THE CANVAS IS STILL EXPORTABLE. A cross-origin image drawn without crossOrigin taints the canvas and every later
       toDataURL throws — Save and Share would break on exactly the slides that look best. */
    expect(drew.exported, 'the canvas is tainted — Save and Share are broken by the picture').toBe(true);
  });

  expect(threw, 'the screen threw').toEqual([]);
  await tv.close();
});
