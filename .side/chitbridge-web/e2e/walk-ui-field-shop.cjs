#!/usr/bin/env node
/**
 * e2e/walk-ui-field-shop.cjs — THE FIELD PART ON THE SHOP PAGE (field-2, 2026-11-13; docs WEB-FIELD-PART rev 2, section 11, the checks that apply to non-money fields).
 * Black box: the real public/shop.html with a stand-in api. The page's own renderers paint each surface (the declared-fields form, the order's delivery and who steps,
 * the login gate, the support sheet, the search band); every ui.field on them is then measured. Check numbers are the design's.
 *   1  visible label, accessible name = the label (axe `label` clean) · 2 for/id, aria-describedby resolves, the error is role=alert only after ui.field.error()
 *   3  Required is a word; focusFirstError (14) · 4 44 px at 390, no sideways scroll · 5 keyboard: Tab, a visible ring, Space on a checkbox, Enter commits nothing
 *   6  the field edge is 3:1 in Cream and Dark · 7 canonical value (ASCII, ".", ISO), Arabic-Indic digits · 8 same id, same testid as before the conversion
 *   9  data-cbsid CMP055-*, mount on the page's list · 10 label <= 3 words, hint <= 8 · 12 "1,50" is an error sentence, never 150; the browser language does not change it
 *   13 no role=alert on first render · 15 autocomplete tokens · 16 320 px reflow · 17 RTL · 18 a date echoes as words · rule 13 (cream/dark x 1366/390)
 *   Not here: 11 (grouped money paste) and the money half of 7 — the money kind is its own PR.
 *   NODE_PATH=e2e/node_modules node e2e/walk-ui-field-shop.cjs
 */
'use strict';
const fs = require('fs'), path = require('path');
const W = require('./lib/walk.cjs');
const A = require('./lib/a11y-check.cjs');
const { rule13 } = require('./lib/rule13.cjs');
const J = (o, status) => ({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
const VIEW = { available: true, visibility: 'public', categories: [],
  shop: { bridge_id: 'CBSIMFIT', display_name: 'Sim Fit', currency_code: 'INR', country: 'IN', is_verified: true, business_status: 'open', storefront_access: 'browse',
    unit_rules: {}, showcase: { template: null, sections: [] }, viewer_groups: [], connector: null,
    order_input: { preset: 'cart', pipeline: 'commerce', showsPrice: true, negotiable: false, schema: null, documents: [] }, order_method: 'cart' },
  schema: null, fields: [], offers: [],
  items: Array.from({ length: 6 }, (_, i) => ({ item_id: 'i' + i, item_data: { name: 'Basmati rice ' + (i + 1) + ' kg', unit: 'bag', price: 640 + i, category: 'Grains' } })) };
const SCHEMA = { properties: { contact_name: { type: 'string', maxLength: 60 }, notes: { type: 'string', maxLength: 500 }, quantity: { type: 'number' }, agree: { type: 'boolean' } }, required: ['contact_name'] };

/** the id -> data-testid receipt of the conversion: what the page wrote before and must still write (check 8) */
const BEFORE = {
  f_contact_name: 'shop-f-contact_name', f_notes: 'shop-f-notes', f_quantity: 'shop-f-quantity', f_agree: 'shop-f-agree',
  o_loc: 'shop-area', o_date: 'shop-date', o_time: 'shop-time', o_remark: 'shop-remark', o_name: 'shop-name', o_contact: 'shop-contact', o_otp: 'shop-otp',
  o_qty: 'shop-qty', lg_contact: null, lg_otp: null, sup_what: 'shop-support-what', sup_contact: 'shop-support-contact', sup_otp: 'shop-support-otp', p_search: 'shop-search'
};
const MOUNTS = Array.from({ length: 22 }, (_, i) => 'SHP001-U' + String(i + 1).padStart(2, '0'));

W.run('ui-field-shop', async (w) => {
  const { page } = w;
  await page.route('**/api/**', (r) => r.fulfill(J({ ok: true })));
  await page.route('**/api/assist/regions*', (r) => r.fulfill(J({ regions: [] })));
  await page.route('**/api/catalogue/CBSIMFIT*', (r) => r.fulfill(J(VIEW)));
  const posts = [];
  page.on('request', (r) => { if (r.method() !== 'GET') posts.push(r.method() + ' ' + r.url()); });

  const open = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.goto(w.base + '/shop.html?s=CBSIMFIT&api=' + encodeURIComponent(w.base));
    await page.waitForSelector('[data-testid="shop-head"], [data-sc="share"]', { timeout: 15000 });
    await page.waitForTimeout(400);
  };
  /** paint a surface; the support sheet and the login gate are painted by calling the page's own builders */
  const paint = async (name) => {
    const err = await page.evaluate(([name, schema]) => {
      try {
        /* one surface at a time: the order panel and any open sheet of an earlier surface would leave duplicate ids */
        try { ohost().innerHTML = ''; } catch (e) { /* no order host yet */ }
        document.querySelectorAll('dialog[open]').forEach((d) => d.close());
        document.querySelectorAll('#sheet, .sheet, #modal').forEach((n) => { if (n.id !== 'app') n.innerHTML = ''; });
        if (name === 'schema') { _read = {}; el('app').innerHTML = '<div id="fxhost">' + _schemaFields(schema, {}) + '</div>'; }
        if (name === 'mode') { _ord = { mode: 'delivery', loc: '', date: '', time: '', remark: '', name: '', contact: '', otp: '', qty: '2', payload: {} }; el('app').innerHTML = '<div id="fxhost">' + _cartModeFieldsHtml() + '</div>'; }
        if (name === 'order') { el('app').innerHTML = ''; _FIN = [{ it: { name: 'Wall paint', item_id: 'p1', unit: 'L', price: 100, combinations: [] } }]; orderOpen(0); }
        if (name === 'who') { window._cartStepReview = function () { return ''; }; _ord = { mode: 'delivery', step: 'otp', loc: '', date: '', time: '', remark: '', name: '', contact: 'me@example.com', otp: '', qty: '2', payload: {} }; el('app').innerHTML = '<div id="fxhost">' + _cartStepWho() + '</div>'; }
        if (name === 'login') { _lg = { step: 'otp', contact: 'me@example.com', otp: '' }; renderLoginGate((typeof _SHOPDATA !== 'undefined' && _SHOPDATA && _SHOPDATA.shop) || { display_name: 'Sim Fit' }); }
        if (name === 'support') { _sup = { step: 'say', what: '', contact: '', sev: '', urgency: null }; supOpen(); }
        return '';
      } catch (e) { return String(e && e.message || e); }
    }, [name, SCHEMA]);
    await page.waitForTimeout(200);
    return err;
  };
  const surfaces = ['schema', 'mode', 'who', 'order', 'login', 'support'];
  const fieldsOn = () => page.evaluate(() => [...document.querySelectorAll('[data-cbname="field"]')].map((f) => ({
    id: f.id, kind: f.getAttribute('data-cbkind'), testid: f.getAttribute('data-testid'), cbsid: f.getAttribute('data-cbsid'), mount: f.getAttribute('data-cbmount'),
    auto: f.getAttribute('autocomplete'), dir: getComputedStyle(f).direction })));

  await open(1366, 768);
  await w.step('U0', 'every surface paints from the page\'s own renderers with ui.field on it', async () => {
    const out = [];
    for (const s of surfaces) { const err = await paint(s); const n = (await fieldsOn()).length; out.push(s + ':' + (err ? 'ERR ' + err.slice(0, 60) : n)); }
    return { ok: out.every((x) => !/ERR|:0$/.test(x)), saw: out.join(' · ') };
  });

  await w.step('U1', 'checks 1, 2, 3, 8 · each field has a visible label for its id; the name is that label; describedby resolves; Required is a word; the id and testid are as before', async () => {
    const bad = [];
    for (const s of surfaces) {
      await paint(s);
      const r = await page.evaluate((BEFORE) => [...document.querySelectorAll('[data-cbname="field"]')].map((f) => {
        const label = document.querySelector('label[for="' + f.id + '"]'), why = [];
        if (!label || !label.textContent.trim()) why.push('no label');
        else if (!f.labels || ![...f.labels].some((l) => l === label)) why.push('label not bound');
        if (f.placeholder && label && f.placeholder === label.textContent.trim()) why.push('placeholder is the label');
        (f.getAttribute('aria-describedby') || '').split(' ').filter(Boolean).forEach((id) => { if (!document.getElementById(id)) why.push('describedby ' + id + ' missing'); });
        if (f.required && !(f.closest('.cbf').querySelector('.cbf-req') || {}).textContent) why.push('required without the word');
        if (Object.prototype.hasOwnProperty.call(BEFORE, f.id) && BEFORE[f.id] && f.getAttribute('data-testid') !== BEFORE[f.id]) why.push('testid ' + f.getAttribute('data-testid') + ' != ' + BEFORE[f.id]);
        return why.length ? f.id + ': ' + why.join(',') : null;
      }).filter(Boolean), BEFORE);
      bad.push(...r.map((x) => s + ' ' + x));
    }
    await paint('schema');
    const axe = await A.check(page);
    const labelRules = axe.violations.filter((v) => /^label/.test(v.id));
    const ids = await page.evaluate(() => [...document.querySelectorAll('[data-cbname="field"]')].map((f) => f.id));
    const keep = ['f_contact_name', 'f_notes', 'f_quantity', 'f_agree'].every((id) => ids.includes(id));
    return { ok: !bad.length && !labelRules.length && keep, saw: bad.length ? bad.slice(0, 4).join(' · ') : 'all labelled, bound and described; ids kept; axe label rules clean (' + axe.violations.length + ' other)' };
  });

  await w.step('U2', 'checks 9, 15 · every field wears CMP055-*, its mount is on the page list, and the autocomplete token is right', async () => {
    const seen = {}; const bad = [];
    for (const s of surfaces) { await paint(s); for (const f of await fieldsOn()) { if (!seen[f.id]) seen[f.id] = f; if (!/^CMP055-(I0[1-4]|T01)$/.test(f.cbsid || '')) bad.push(f.id + ' cbsid ' + f.cbsid); if (!MOUNTS.includes(f.mount)) bad.push(f.id + ' mount ' + f.mount); } }
    const want = { o_name: 'name', o_contact: 'username', o_loc: 'street-address', o_otp: 'one-time-code', lg_otp: 'one-time-code', o_qty: 'off', sup_what: 'off', f_notes: 'off', o_remark: 'off' };
    Object.keys(want).forEach((id) => { if (!seen[id]) bad.push(id + ' not painted'); else if (seen[id].auto !== want[id]) bad.push(id + ' autocomplete ' + seen[id].auto + ' != ' + want[id]); });
    return { ok: !bad.length, saw: bad.length ? bad.slice(0, 5).join(' · ') : Object.keys(seen).length + ' fields, all CMP055 on a listed mount; tokens right' };
  });

  await w.step('U3', 'check 10 · label at most 3 words, hint at most 8 (the page\'s own words; the declared form\'s labels are the shop\'s data)', async () => {
    const bad = [];
    for (const s of surfaces.filter((x) => x !== 'schema')) {
      await paint(s);
      const r = await page.evaluate(() => [...document.querySelectorAll('[data-cbname="field"]')].map((f) => {
        const l = (document.querySelector('label[for="' + f.id + '"]') || {}).textContent || '', h = (document.querySelector('#' + f.id + '-h > span') || {}).textContent || '';
        const lw = l.trim().split(/\s+/).filter(Boolean).length, hw = h.trim().split(/\s+/).filter(Boolean).length;
        return (lw > 3 ? f.id + ' label ' + lw + ' words' : '') + (hw > 8 ? f.id + ' hint ' + hw + ' words' : '');
      }).filter(Boolean));
      bad.push(...r);
    }
    const packs = ['ar', 'fr', 'hi', 'ta'].filter((l) => !/CMP055\.required/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'strings-' + l + '.js'), 'utf8')));
    return { ok: !bad.length && !packs.length, saw: bad.length ? bad.join(' · ') : 'within 3 / 8 words; "Required" is in the four packs' };
  });

  await w.step('U4', 'check 7, 12, 18 · typed text reads as ASCII decimal; "1,50" is a sentence, never 150; the browser language changes nothing; a date echoes as words', async () => {
    await paint('mode'); await page.evaluate(() => { _ord.mode = 'delivery'; });
    await paint('who'); await paint('schema');
    const r = await page.evaluate(async () => {
      const q = document.getElementById('f_quantity'), out = {};
      const type = (v) => { q.focus(); q.value = v; q.dispatchEvent(new Event('input', { bubbles: true })); q.blur(); return { value: q.value, read: ui.field.read(q), echo: (document.getElementById(q.id + '-x') || {}).textContent, err: (document.getElementById(q.id + '-e') || {}).textContent || '', invalid: q.getAttribute('aria-invalid') }; };
      out.grouped = type('1,234.5');
      out.arabic = type('١٢٣');
      Object.defineProperty(navigator, 'language', { configurable: true, get: () => 'de-DE' });
      Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['de-DE'] });
      out.comma = type('1,50');
      out.bad = type('12,34.5');
      out.fixed = type('7');
      return out;
    });
    await paint('mode');
    const dateEcho = await page.evaluate(() => { const d = document.getElementById('o_date'); d.value = '2026-11-13'; d.dispatchEvent(new Event('change', { bubbles: true })); return (document.getElementById('o_date-x') || {}).textContent; });
    const ok = r.grouped.value === '1234.5' && r.grouped.read.value === '1234.5' && r.grouped.echo === '1,234.5' && r.arabic.value === '123'
      && r.comma.value === '1,50' && r.comma.invalid === 'true' && /dot|\./.test(r.comma.err) && Number.isNaN(r.comma.read.value) && r.bad.invalid === 'true'
      && r.fixed.value === '7' && r.fixed.invalid === null && /13 Nov 2026/.test(dateEcho);
    return { ok, saw: '"1,234.5" -> ' + r.grouped.value + ' echo ' + r.grouped.echo + ' · Arabic -> ' + r.arabic.value + ' · "1,50" -> kept, error "' + r.comma.err + '", read ' + r.comma.read.value + ' (browser language de-DE) · "12,34.5" invalid=' + r.bad.invalid + ' · date echo "' + dateEcho + '"' };
  });

  await w.step('U5', 'checks 2, 13, 14 · no role=alert on first render; ui.field.error adds exactly one; focusFirstError lands on the first error with its sentence', async () => {
    await paint('who');
    const first = await page.evaluate(() => document.querySelectorAll('#fxhost [role="alert"], #app [role="alert"]').length);
    const r = await page.evaluate(() => {
      const fs = [...document.querySelectorAll('[data-cbname="field"]')];
      ui.field.error(fs[1], 'Not sent. That is not a phone or email. Check it.');
      ui.field.error(fs[0], 'Not sent. Type your name.');
      const alerts = document.querySelectorAll('[role="alert"]').length;
      const got = ui.field.focusFirstError(document.getElementById('app'));
      const act = document.activeElement;
      const out = { alerts, firstIsFirst: got === act && act === fs[0], described: (act.getAttribute('aria-describedby') || '').includes(act.id + '-e'), invalid: act.getAttribute('aria-invalid') };
      ui.field.error(fs[0], null); ui.field.error(fs[1], null);
      out.cleared = !document.querySelector('[role="alert"]') && !document.querySelector('[aria-invalid="true"]');
      return out;
    });
    return { ok: first === 0 && r.alerts === 2 && r.firstIsFirst && r.described && r.invalid === 'true' && r.cleared, saw: 'first render alerts ' + first + ' · after two errors ' + r.alerts + ' · focus on first ' + r.firstIsFirst + ' · described ' + r.described + ' · cleared ' + r.cleared };
  });

  await w.step('U6', 'check 5 · keyboard only: Tab reaches each field in order with a measured focus ring; Space toggles a checkbox; Enter in a text field sends nothing', async () => {
    await open(1366, 768);
    await paint('schema');
    const before = posts.length;
    await page.evaluate(() => { document.body.focus(); document.activeElement && document.activeElement.blur(); });
    const order = [], noRing = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const s = await page.evaluate(() => { const e = document.activeElement; if (!e || e.getAttribute('data-cbname') !== 'field') return null; const cs = getComputedStyle(e); return { id: e.id, ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }; });
      if (s) { order.push(s.id); if (!s.ring) noRing.push(s.id); }
    }
    await page.focus('#f_agree'); await page.keyboard.press('Space');
    const toggled = await page.evaluate(() => document.getElementById('f_agree').checked);
    await page.focus('#f_contact_name'); await page.keyboard.type('Asha'); await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const stillThere = await page.evaluate(() => !!document.getElementById('f_contact_name'));
    const same = order.slice(0, 4).join() === ['f_contact_name', 'f_notes', 'f_quantity', 'f_agree'].join();
    return { ok: same && !noRing.length && toggled && stillThere && posts.length === before, saw: 'order ' + order.join('>') + (noRing.length ? ' · NO RING ' + noRing : ' · rings 2px+') + ' · Space checks it ' + toggled + ' · Enter made ' + (posts.length - before) + ' requests' };
  });

  await w.step('U7', 'check 6 · the field edge reaches 3:1 on its card in Cream and Dark; the error colour reaches 4.5:1', async () => {
    const res = [];
    for (const theme of ['cream', 'dark']) {
      await page.evaluate((t) => CBAvatar.applyTheme(t), theme); await page.waitForTimeout(150);
      await paint('schema');
      await page.evaluate(() => { ui.field.error(document.getElementById('f_notes'), 'Not saved. Too long. Shorten it.'); });
      const m = await page.evaluate(() => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
        const rgb = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const f = document.getElementById('f_contact_name'), cs = getComputedStyle(f), e = document.getElementById('f_notes-e');
        const ground = rgb(getComputedStyle(document.body).backgroundColor);
        return { edge: Math.round(ratio(rgb(cs.borderTopColor), rgb(cs.backgroundColor)) * 100) / 100, edgeOnPage: Math.round(ratio(rgb(cs.borderTopColor), ground) * 100) / 100, err: Math.round(ratio(rgb(getComputedStyle(e).color), rgb(cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.body).backgroundColor : cs.backgroundColor)) * 100) / 100 };
      });
      res.push(theme + ' edge ' + m.edge + ' (page ' + m.edgeOnPage + ') error ' + m.err); res[res.length - 1] = { t: res[res.length - 1], ok: m.edge >= 3 && m.edgeOnPage >= 3 && m.err >= 4.5 };
    }
    await page.evaluate(() => CBAvatar.applyTheme(CBAvatar.themeKey()));
    return { ok: res.every((x) => x.ok), saw: res.map((x) => x.t).join(' · ') };
  });

  await w.step('U8', 'checks 4, 16 · at 390 and 320 px each field is 44 px high (the checkbox row too), nothing scrolls sideways, no label, hint or error is clipped', async () => {
    const out = [];
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      for (const s of surfaces) {
        await paint(s);
        await page.evaluate(() => { const f = document.querySelector('[data-cbname="field"]:not([type=checkbox]):not([type=file])'); if (f) ui.field.error(f, 'Not saved. This one needs a fix. Check it.'); });
        const m = await page.evaluate(() => {
          const small = [...document.querySelectorAll('[data-cbname="field"]')].filter((f) => { const box = f.type === 'checkbox' ? f.closest('label') : f.type === 'file' ? f.closest('label') : f; const r = box.getBoundingClientRect(); return r.width > 0 && r.height < 43.5; }).map((f) => f.id);
          const clip = [...document.querySelectorAll('.cbf-l,.cbf-h,.cbf-e,.cbf-fb span')].filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.className);
          return { small, clip, over: document.documentElement.scrollWidth - innerWidth };
        });
        if (m.small.length || m.clip.length || m.over > 0) out.push(width + ' ' + s + ' small ' + m.small + ' clip ' + m.clip + ' over ' + m.over);
      }
    }
    return { ok: !out.length, saw: out.length ? out.slice(0, 3).join(' · ') : 'all fields 44+ px, no sideways scroll, nothing clipped at 390 and 320' };
  });

  await w.step('U9', 'check 17 · RTL: the label sits on the right, a number stays left-to-right', async () => {
    await page.setViewportSize({ width: 800, height: 800 });
    await paint('schema');
    const m = await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
      const l = document.querySelector('label[for="f_contact_name"]').getBoundingClientRect(), box = document.getElementById('f_contact_name').getBoundingClientRect(), q = document.getElementById('f_quantity');
      const out = { labelRight: Math.round(box.right - l.right), qDir: getComputedStyle(q).direction };
      document.documentElement.dir = 'ltr';
      return out;
    });
    return { ok: m.labelRight <= 40 && m.qDir === 'ltr', saw: 'label ends ' + m.labelRight + ' px from the right edge · number direction ' + m.qDir };
  });

  await w.step('U10', 'the converted inputs still work: a typed value reaches the page (the order\'s qty, the support text) and the file field names its file', async () => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await paint('support');
    await page.fill('#sup_contact', 'asha@example.com');
    await page.fill('#sup_what', 'The bag was torn');
    const held = await page.evaluate(() => ({ contact: _sup.contact, what: _sup.what }));
    await paint('schema');
    await page.evaluate(() => { document.getElementById('fxhost').insertAdjacentHTML('beforeend', ui.field({ mount: 'SHP001-U02', kind: 'file', label: 'Attach photo', testid: 'fx-file' })); });
    await page.setInputFiles('[data-testid="fx-file"]', { name: 'rice.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
    const named = await page.evaluate(() => (document.querySelector('[data-testid="fx-file"]').closest('.cbf').querySelector('.cbf-fn') || {}).textContent);
    return { ok: held.contact === 'asha@example.com' && held.what === 'The bag was torn' && named === 'rice.jpg', saw: 'page state ' + JSON.stringify(held) + ' · file named "' + named + '"' };
  });

  await open(1366, 768);
  await w.step('U11', 'axe finds nothing on the surfaces at 1366 and 390', async () => {
    const bad = [];
    for (const width of [1366, 390]) { await page.setViewportSize({ width, height: 844 }); for (const s of surfaces) { await paint(s); const r = await A.check(page); if (r.violations.length) bad.push(width + ' ' + s + ' ' + r.violations.map((v) => v.id + 'x' + v.count).join('/')); } }
    return { ok: !bad.length, saw: bad.length ? bad.join(' · ') : 'no violations' };
  });

  for (const s of ['mode', 'who']) {
    await open(1366, 768);
    await paint(s);
    await rule13(w, 'R13-' + s, 'the order ' + s + ' fields', 'app', page, async () => { await paint(s); });
  }
  const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
  await open(390, 844); await paint('who'); await page.screenshot({ path: path.join(shots, 'ui-field-shop-who-390.png') });
  await page.evaluate(() => CBAvatar.applyTheme('dark')); await paint('who'); await page.screenshot({ path: path.join(shots, 'ui-field-shop-who-390-dark.png') });
});
