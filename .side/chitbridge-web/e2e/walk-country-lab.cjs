#!/usr/bin/env node
/**
 * e2e/walk-country-lab.cjs - THE COUNTRY LAB, WALKED (CL1, 2026-10-12 · CL2, 2026-10-13): what registering in another country would look like, shown from the packs.
 * Black box: the real page, the real adopted engines (engine/tax.js carries reg-in · reg-au · reg-ae · regulation · tax-packs · tax-slab · tax,
 * one release), no API at all - the lab reads nothing from a server. The journeys at 1366 px, then the owner's eight CL2 findings, then 390 px;
 * each step shoots the screen (e2e/shots/walk-country-lab-NN.png) - Cream and Dark at both widths are among them (C1 · L8 · C9).
 *   L1  the pickers list exactly the registered packs (IN · AU · AE, the registry's own list) and the setup step's other countries as pack-less
 *   L2  IN -> AU: every row is read from the packs and marked - currency INR -> AUD, April -> July, state-split GST -> one-head GST, BAS with its boxes
 *   L3  IN -> AU: the ABN check box answers from the pack (a wrong digit is said); the GSTIN box from the profile-map engine
 *   L4  IN -> AU: the cart is billed by the tax engine under both - CGST+SGST on one side, one GST head on the other, the GST-free line said in the notes
 *   L5  AU -> AE: GST -> VAT, BAS -> VAT201 with its boxes, TRN 15 digits with no check digit (said); a kind the UAE pack does not know is said by the engine
 *   L6  IN -> SA (pack-less): the TO side paints the server's sentence; the cart is NOT billed under Saudi Arabia; every row says "no pack"
 *   L7  this shop: with no product or transaction the rows that differ are the list; with one, the country is final and a new entity is named
 *   C1  (#1) Cream and Dark: every visible text is AA on the ground it is painted on (e2e/lib/theme-measure.cjs, the crm-themes eyes); the TO cell is
 *       marked by a rule, never a tinted column - its ground is the FROM cell's ground; the bill's differing figures are underlined, not tinted
 *   C2  (#2) no sentence says a shop changes country: the title, the subtitle, the "This shop" choice and the final-sentence all speak of REGISTERING
 *   C3  (#3) the way out is Home (/), never app.html
 *   C4  (#4) the cart never cuts: beside the outcome it stacks as cards, every item name and supply kind is shown whole, no scroll bar inside the panel
 *   C5  (#5) one plain line per cell (<= 20 words visible), the legal detail and its citation behind a closed "why" fold (DL Art. 45 is in the fold only)
 *   C6  (#6) a reserved right gutter: the table ends before the window's edge; nothing fixed overlaps the "what it means" column
 *   C7  (#7) India's supply kinds say "India: each item's own GST rate decides."
 *   C8  (#8) AU -> AU: sixteen rows are the same, collapsed under "16 rows are the same"; show opens them; IN -> AU folds only the voucher row
 *   L8  at 390 px (Cream): no sideways scroll, the rows read one under the other, the bills stack, the cart lines are cards with nothing cut
 *   C9  at 390 px (Dark): AA everywhere, no sideways scroll, the TO cell still carries its rule
 *   ── CL3 (owner, 13 Oct: "where we are with it" · "if login not required, still avatar, and font, and other things should be intact") ──
 *   R1  signed out, the STANDARD SHELL: the CBShell header, the avatar's "Sign in" (to Home, no sign-in window over the lab), the skeleton
 *       (sidebar + main), the kural foot, the shell's font on the lab, and the text size reaching the lab's own words
 *   R2  IN -> AU: "Where ChitBridge is for Australia" beside the TO side — the pack line, one row per product area (✅ ⚠️ ❌), Payroll "—",
 *       each row one short line, read from /data/country-ready.json (never typed: the rows equal the file's)
 *   R3  -> UAE: the block follows the TO side; -> Saudi Arabia (pack-less): it says there is no pack, not a made-up row
 *   R4  rule 13, SIGNED OUT, Cream and Dark at 1366 and 390: AA on every text, nothing clipped, no inner sideways scroll, nothing floating over
 *       the block, no link to app.html, the copy within its budget
 *   R5  the same, SIGNED IN (the avatar's initial, never "Sign in"); the readiness block and the flow are the same for both
 *
 *   NODE_PATH=e2e/node_modules node e2e/walk-country-lab.cjs         headless, fast
 *   node e2e/walk-country-lab.cjs --show                              watch it
 */
'use strict';
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');   /* the contrast measurement, run INSIDE the page - one copy, shared with crm-themes.cjs */
const SA_WHY = 'ChitBridge does not keep books for Saudi Arabia yet — selling and the rail still work; books arrive when its pack ships.';
const text = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }, sel);
const verdicts = async (page) => { const raw = await page.evaluate(() => { const o = {}; document.querySelectorAll('#rows-body tr[data-row]').forEach((t) => { o[t.dataset.row] = t.querySelector('.verdict').textContent.trim(); }); return o; }); Object.keys(raw).forEach((k) => { raw[k] = kind(raw[k]); }); return raw; };
/** CTRY-49: a verdict cell reads "Same" or "Changes: ..." - the word is the first one */
const kind = (t) => (/^Same/.test(t) ? 'Same' : /^Changes/.test(t) ? 'Changes' : t);
/** CTRY-49: open a row's popup (the labs' one popup), read it whole, close it with its x; the table keeps one short line, the detail lives here */
const detail = async (page, key) => {
  await page.click('[data-testid="cl-more-' + key + '"]'); await page.waitForSelector('[data-testid="lk-pop"]', { timeout: 5000 });
  const t = await text(page, '[data-testid="lk-pop"]');
  await page.click('[data-testid="lk-pop-close"]'); await page.waitForSelector('[data-testid="lk-pop"]', { state: 'detached', timeout: 5000 });
  return t;
};
/** the row's line plus its popup: what the CL1 cell once said whole */
const full = async (page, key) => (await text(page, '[data-testid="cl-row-' + key + '"]')) + ' ' + (await detail(page, key));
const pick = async (page, side, code) => { await page.selectOption('[data-testid="cl-' + side + '"]', code); await page.waitForTimeout(150); };
const theme = async (page, key) => { await page.evaluate((k) => { CBAvatar.applyTheme(k); }, key); await page.waitForTimeout(120); };
/** every visible text on the page against the ground it is painted on; the failing pairs (a gradient ground is not measurable and is left out) */
const contrast = async (page) => { const pairs = await page.evaluate(measure); return { n: pairs.length, bad: pairs.filter((x) => !x.grad && x.ratio < x.need) }; };
/** the words a cell SHOWS: its text with every closed fold's body taken out (the "why" summary stays - it is visible) */
const visibleWords = `(el) => { const c = el.cloneNode(true); c.querySelectorAll('details:not([open])').forEach((d) => { [...d.children].forEach((ch) => { if (ch.tagName !== 'SUMMARY') ch.remove(); }); });
  return c.textContent.replace(/\\s+/g, ' ').trim().split(' ').filter(Boolean).length; }`;
/** does the text in an input or select fit its box? measured with the control's own font (a cut name is the owner's "Cooking c") */
const fits = `(el) => { const cs = getComputedStyle(el); const cv = document.createElement('canvas').getContext('2d'); cv.font = cs.font;
  const t = el.tagName === 'SELECT' ? (el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '') : el.value;
  const w = cv.measureText(t).width, room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (el.tagName === 'SELECT' ? 20 : 0);
  return { t, w: Math.round(w), room: Math.round(room), ok: w <= room + 0.5 }; }`;

const walk = async (w) => {
  const { page, base } = w;
  await page.goto(base + '/country-lab.html#/compare');   /* R6: the side-by-side tool is #/compare; the default is the Countries view */
  await page.waitForSelector('[data-testid="cl-rows"] tr[data-row]', { timeout: 15000 });

  await w.step('L1', 'The pickers list exactly the registered packs, then the setup step\'s other countries as pack-less', async () => {
    const r = await page.evaluate(() => ({
      packs: CBRegulation.list().map((p) => p.id),
      opts: [...document.querySelectorAll('#to option')].map((o) => ({ v: o.value, t: o.textContent })),
      chip: document.getElementById('src').textContent, nofuel: document.getElementById('nofuel').hidden,
    }));
    const withPack = r.opts.filter((o) => / pack /.test(o.t)).map((o) => o.v), without = r.opts.filter((o) => /no pack/.test(o.t)).map((o) => o.v);
    const ok = r.nofuel && JSON.stringify(withPack) === JSON.stringify(r.packs) && without.includes('SA') && !without.some((c) => r.packs.includes(c));
    return { ok, saw: r.chip + ' · pack-less: ' + without.join(' ') };
  });

  await w.step('L2', 'IN -> AU: every row read from the packs and marked - INR -> AUD, April -> July, state-split GST -> one head, BAS with its nine boxes', async () => {
    await pick(page, 'from', 'IN'); await pick(page, 'to', 'AU');
    const v = await verdicts(page);
    const cur = await full(page, 'currency'), fy = await full(page, 'fy'), sch = await full(page, 'scheme');
    const ret = await full(page, 'returns'), led = await full(page, 'ledgers');
    const ok = Object.keys(v).length === 16 && Object.entries(v).every(([k, x]) => x === (k === 'voucher' ? 'Same' : 'Changes'))   /* CTRY-39: six more rows; IN and AU share one voucher shape */
      && /INR/.test(cur) && /AUD/.test(cur) && /April/.test(fy) && /July/.test(fy) && /split by state/.test(sch) && /border/.test(sch) && /heads gst/.test(sch)
      && /none in the pack/.test(ret) && /no returns member/.test(ret) && /BAS/.test(ret) && /9 boxes/.test(ret)   /* reg-au adopted in v1.97.0 (4f0bda0a) carries nine BAS boxes, not eight */ && /added/.test(led) && /renamed/.test(led);
    return { ok, saw: Object.keys(v).length + ' rows · ' + Object.values(v).filter((x) => x === 'Changes').length + ' different (voucher numbers the same) · ' + ret.slice(0, 400) + ' · ledgers ' + led.slice(0, 200) + ' · scheme ' + sch.slice(0, 200) };
  });

  await w.step('L3', 'IN -> AU: the ABN box answers from the pack (a wrong digit is said); the GSTIN box from the profile-map engine', async () => {
    await page.fill('[data-testid="cl-id-to"]', '51 824 753 556');
    const good = await text(page, '[data-testid="cl-idres-to"]');
    await page.fill('[data-testid="cl-id-to"]', '51 824 753 557');
    const bad = await text(page, '[data-testid="cl-idres-to"]');
    await page.fill('[data-testid="cl-id-from"]', '33AABCK1234F1Z6');
    const gst = await text(page, '[data-testid="cl-idres-from"]');
    const ok = /valid ABN/.test(good) && /check digits do not match|wrong/.test(bad) && /valid GSTIN/.test(gst);
    return { ok, saw: good + ' | ' + bad.slice(0, 50) + ' | ' + gst };
  });

  await w.step('L4', 'IN -> AU: the cart billed under both - CGST+SGST on one side, one GST head on the other, the GST-free line said in the notes', async () => {
    const r = await page.evaluate(() => ({
      fromTotal: document.querySelector('[data-testid="cl-total-from"]').textContent, toTotal: document.querySelector('[data-testid="cl-total-to"]').textContent,
      fromHeads: document.querySelector('[data-testid="cl-heads-from"]').textContent, toHeads: document.querySelector('[data-testid="cl-heads-to"]').textContent,
      toNotes: document.querySelector('[data-testid="cl-notes-to"]').textContent, diffs: document.querySelectorAll('#bill .diff').length,
      sameAsEngine: (function () { const b = BILLS.to.money; return document.querySelector('[data-testid="cl-total-to"]').textContent === CBLocale.money(b.total, 'AUD'); })(),
    }));
    const ok = /CGST/.test(r.fromHeads) && /SGST/.test(r.fromHeads) && /GST 10%/.test(r.toHeads) && !/CGST/.test(r.toHeads) && /GST-free/.test(r.toNotes) && r.diffs > 0 && r.sameAsEngine && /₹/.test(r.fromTotal) && /A\$/.test(r.toTotal);
    return { ok, saw: r.fromTotal + ' vs ' + r.toTotal + ' · ' + r.diffs + ' figures marked · ' + r.toNotes.slice(0, 40) + '…' };
  });

  await w.step('L5', 'AU -> AE: GST -> VAT, BAS -> VAT201 with its boxes, TRN 15 digits with no check digit; a kind the UAE pack does not know is said', async () => {
    await pick(page, 'from', 'AU'); await pick(page, 'to', 'AE');
    const sch = await full(page, 'scheme'), ret = await full(page, 'returns'), tid = await full(page, 'taxid');
    const inv = await full(page, 'invoice');
    await page.fill('[data-testid="cl-id-to"]', '100 0000 0000 0003');
    const trn = await text(page, '[data-testid="cl-idres-to"]');
    const notes = await text(page, '[data-testid="cl-notes-to"]');
    /* the rice line names gst_free (Australia's word); the UAE pack has standard · zero_rated · exempt */
    await page.selectOption('[data-testid="cl-kind-1"]', 'zero_rated'); await page.waitForTimeout(100);
    const notes2 = await text(page, '[data-testid="cl-notes-to"]');
    const ok = /GST/.test(sch) && /VAT/.test(sch) && /BAS/.test(ret) && /VAT201/.test(ret) && /boxes/.test(ret) && /ABN/.test(tid) && /TRN/.test(tid) && /no check digit/.test(tid)
      && /valid TRN/.test(trn) && /not a supply kind this pack knows/.test(notes) && /Zero-rated/.test(notes2) && /simplified invoice/.test(inv) && /English accepted/.test(inv);
    return { ok, saw: trn + ' · ' + notes.slice(0, 60) + '… · then: ' + notes2.slice(0, 40) + '…' };
  });

  await w.step('L6', 'IN -> SA (pack-less): the server\'s sentence on the TO side, the cart NOT billed under Saudi Arabia, every row says "no pack"', async () => {
    await pick(page, 'from', 'IN'); await pick(page, 'to', 'SA');
    const st = await text(page, '[data-testid="cl-status-to"]'), bill = await text(page, '[data-testid="cl-bill-to"]'), v = await verdicts(page);
    const billedFrom = !!(await page.$('[data-testid="cl-total-from"]')), billedTo = !!(await page.$('[data-testid="cl-total-to"]'));
    const ok = st.includes(SA_WHY) && bill.includes('not billed') && bill.includes(SA_WHY) && billedFrom && !billedTo && Object.values(v).every((x) => x === 'no pack');
    return { ok, saw: st.slice(0, 80) + '… · IN billed ' + billedFrom + ' · SA billed ' + billedTo };
  });

  await w.step('L7', 'This shop: with no product or transaction the differing rows are the list; with one, the country is final and a new entity is named', async () => {
    await pick(page, 'to', 'AU');
    const before = await text(page, '[data-testid="cl-rederive"]');
    await page.click('[data-testid="cl-fixed-yes"]'); await page.waitForTimeout(100);
    const after = await text(page, '[data-testid="cl-blocked"]');
    await page.click('[data-testid="cl-fixed-no"]'); await page.waitForTimeout(100);
    const ok = /re-derive/.test(before) && /Currency/.test(before) && /Financial year/.test(before) && /Chart of accounts/.test(before) && /corrected/.test(before)
      && /Final/.test(after) && /registered in India/.test(after) && /never changes/.test(after) && /new entity/.test(after) && /never a silent switch/.test(after);
    return { ok, saw: before.slice(0, 70) + '… | ' + after.slice(0, 90) + '…' };
  });

  /* ── CL2: the owner's eight findings, IN -> AU at 1366 px ─────────────────────────────────────────────────────────────────────────── */
  await w.step('C1', '(#1) Cream and Dark: every text AA on its ground; the TO cell is marked by a rule, never a tinted column; differing figures underlined', async () => {
    const out = [];
    let ok = true;
    for (const k of ['cream', 'dark']) {
      await theme(page, k);
      const c = await contrast(page);
      const m = await page.evaluate(() => {
        const tr = document.querySelector('#rows-body tr.different'), f = tr.querySelector('td.v.from'), t = tr.querySelector('td.v.to');
        const cf = getComputedStyle(f), ct = getComputedStyle(t);
        const underlined = [...document.querySelectorAll('#bill .diff')].every((d) => getComputedStyle(d).boxShadow !== 'none' && getComputedStyle(d).backgroundColor === 'rgba(0, 0, 0, 0)');
        return { sameGround: cf.backgroundColor === ct.backgroundColor, rule: /inset/.test(ct.boxShadow) && !/rgba\(0, 0, 0, 0\)/.test(ct.boxShadow), underlined, diffs: document.querySelectorAll('#bill .diff').length, themed: document.documentElement.getAttribute('data-theme') };
      });
      const good = c.bad.length === 0 && m.sameGround && m.rule && m.underlined && m.diffs > 0 && m.themed === k;
      ok = ok && good;
      out.push(k + ': ' + c.n + ' texts, ' + c.bad.length + ' below AA' + (c.bad.length ? ' (' + c.bad.slice(0, 3).map((x) => '"' + x.text + '" ' + x.ratio + '/' + x.need).join(', ') + ')' : '') + ' · TO ground = FROM ground ' + m.sameGround + ' · rule ' + m.rule + ' · ' + m.diffs + ' figures underlined ' + m.underlined);
    }
    return { ok, saw: out.join(' | ') };   /* the step ends in Dark: this shot is Dark at 1366 */
  });

  await w.step('C2', '(#2) No sentence says a shop changes country: title, subtitle, the "This shop" choice and its final sentence speak of registering', async () => {
    await theme(page, 'cream');
    const r = await page.evaluate(() => {
      /* every word on the page, folds included, scripts and styles out (a comment in the script is not a sentence the owner reads) */
      const c = document.body.cloneNode(true); c.querySelectorAll('script,style').forEach((n) => n.remove());
      const all = c.textContent.replace(/\s+/g, ' ');
      const forbidden = /what changes when|country changes|changes country|moving this shop|change of country|country change|country may (still )?change|a switch would/i;
      const hit = all.match(forbidden);
      return { hit: hit ? hit[0] : null, title: document.querySelector('h1').textContent.trim(), sub: document.querySelector('[data-testid="cl-sub"]').textContent.trim(),
        th: document.getElementById('th-to').textContent, radios: [...document.querySelectorAll('input[name=fixed]')].map((i) => i.parentElement.textContent.trim()), heads: [...document.querySelectorAll('.pane.left .sec')].map((s) => s.textContent.trim()) };
    });
    const words = (s) => s.split(/\s+/).filter(Boolean).length;
    const ok = !r.hit && words(r.title) <= 5 && /registering in another country/i.test(r.sub) && words(r.sub) <= 12 && /Registering/.test(r.th)
      && /no product or transaction yet/.test(r.radios[0]) && /has a product or a transaction/.test(r.radios[1]) && r.heads.some((h) => /registering in/i.test(h)) && !r.heads.some((h) => /existing shop/i.test(h));
    return { ok, saw: (r.hit ? 'still says "' + r.hit + '" · ' : '') + '"' + r.sub + '" · ' + r.th + ' · ' + r.radios.join(' / ') };
  });

  await w.step('C3', '(#3) The way out is Home (/), never app.html — the standard shell\'s switcher (CL3: the lab\'s own header is gone)', async () => {
    const r = await page.evaluate(() => ({ home: (function () { const a = document.querySelector('[data-testid="shell-switch-home"]'); return a ? { path: new URL(a.href).pathname, text: a.textContent.trim() } : null; })(), toApp: document.querySelectorAll('a[href*="app.html"]').length }));
    const ok = !!r.home && r.home.path === '/' && /Home/.test(r.home.text) && r.toApp === 0;
    return { ok, saw: (r.home ? r.home.text + ' → ' + r.home.path : 'no home link') + ' · links to app.html: ' + r.toApp };
  });

  await w.step('C4', '(#4) The cart never cuts: beside the outcome it stacks as cards, every name and supply kind shown whole, no scroll bar inside the panel', async () => {
    const r = await page.evaluate((fitsSrc) => {
      const fits = eval(fitsSrc);
      const cart = document.querySelector('.cart'), rows = [...document.querySelectorAll('#cart-body tr')];
      const controls = [...cart.querySelectorAll('input[type=text],select')].map(fits);
      return { stacked: rows.every((t) => getComputedStyle(t).display === 'grid'), paneW: Math.round(cart.getBoundingClientRect().width), noScroll: cart.scrollWidth <= cart.clientWidth && document.querySelector('.pane.left').scrollWidth <= document.querySelector('.pane.left').clientWidth,
        inside: [...cart.querySelectorAll('input,select,button')].every((el) => el.getBoundingClientRect().right <= cart.getBoundingClientRect().right + 1), controls };
    }, fits);
    const cut = r.controls.filter((c) => !c.ok);
    const ok = r.stacked && r.noScroll && r.inside && cut.length === 0 && r.controls.some((c) => /Cooking oil 1 L/.test(c.t)) && r.controls.some((c) => /GST-free/.test(c.t));
    return { ok, saw: 'pane ' + r.paneW + 'px · cards ' + r.stacked + ' · no inner scroll ' + r.noScroll + ' · ' + r.controls.length + ' controls, ' + cut.length + ' cut' + (cut.length ? ' ("' + cut[0].t + '" ' + cut[0].w + ' > ' + cut[0].room + ')' : '') };
  });

  await w.step('C5', '(#5, CTRY-49) One short line per cell (<= 30 words shown), no fold in the table; the legal detail and its citation open in the row\'s popup', async () => {
    await pick(page, 'from', 'AU'); await pick(page, 'to', 'AE');
    const r = await page.evaluate((vwSrc) => {
      const vw = eval(vwSrc);
      const cells = [...document.querySelectorAll('#rows-body tr[data-row] td.v, #rows-body tr[data-row] td.verdict')].map((td) => ({ row: td.parentElement.dataset.row, words: vw(td), folds: td.querySelectorAll('details').length }));
      const hints = [...document.querySelectorAll('.pane.left .hint, .pane.right > .hint')].filter((h) => !h.closest('details') && getComputedStyle(h).display !== 'none').map((h) => ({ words: vw(h), t: h.textContent.trim().slice(0, 30) }));
      return { cells, hints, citeInTable: /DL Art\. 45/.test(document.querySelector('[data-testid="cl-row-kinds"]').textContent), folds: document.querySelectorAll('#rows-body details').length, more: document.querySelectorAll('#rows-body [data-testid^="cl-more-"]').length };
    }, visibleWords);
    const pop = await detail(page, 'kinds');
    const over = r.cells.filter((c) => c.words > 30), overHints = r.hints.filter((h) => h.words > 20);
    const ok = over.length === 0 && overHints.length === 0 && !r.citeInTable && /DL Art\. 45/.test(pop) && r.folds === 0 && r.more === 16;
    await pick(page, 'from', 'IN'); await pick(page, 'to', 'AU');
    return { ok, saw: r.cells.length + ' cells, longest ' + Math.max(...r.cells.map((c) => c.words)) + ' words' + (over.length ? ' (over: ' + over.map((c) => c.row + ' ' + c.words).join(', ') + ')' : '') + ' · ' + r.folds + ' folds in the table · ' + r.more + ' Details buttons · DL Art. 45 in the popup only ' + (!r.citeInTable && /DL Art\. 45/.test(pop)) + ' · hints ≤ 20 words ' + (overHints.length === 0) };
  });

  await w.step('C6', '(#6) A reserved right gutter: the table ends before the window\'s edge and nothing fixed overlaps the "what it means" column', async () => {
    const r = await page.evaluate(() => {
      const pane = document.querySelector('.pane.right'), cmp = document.querySelector('table.cmp').getBoundingClientRect();
      const means = [...document.querySelectorAll('#rows-body td.means')].map((td) => td.getBoundingClientRect());
      const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const overlaps = [...document.querySelectorAll('body *')].filter((el) => { const cs = getComputedStyle(el); if (cs.position !== 'fixed' && cs.position !== 'sticky') return false; const rc = el.getBoundingClientRect(); return rc.width > 0 && means.some((m) => hits(rc, m)); }).map((el) => el.tagName + '.' + el.className);
      const av = document.querySelector('[data-testid="cbavatar"]'); const avHit = av ? means.some((m) => hits(av.getBoundingClientRect(), m)) : false;
      return { gutter: parseFloat(getComputedStyle(pane).paddingInlineEnd), gap: Math.round(window.innerWidth - cmp.right), overlaps, avHit };
    });
    const ok = r.gutter >= 56 && r.gap >= 56 && r.overlaps.length === 0 && !r.avHit;
    return { ok, saw: 'pane ends ' + r.gutter + 'px before the edge · table to edge ' + r.gap + 'px · fixed elements over the column: ' + r.overlaps.length + ' · avatar over it: ' + r.avHit };
  });

  await w.step('C7', '(#7) India\'s supply kinds say "India: each item\'s own GST rate decides."', async () => {
    const t = await text(page, '[data-testid="cl-row-kinds"] td.v.from');
    const ok = t === 'India: each item\'s own GST rate decides.' || t === 'India: each item’s own GST rate decides.';
    return { ok, saw: '"' + t + '"' };
  });

  await w.step('C8', '(#8) AU -> AU: sixteen rows the same, collapsed under "16 rows are the same"; show opens them; IN -> AU folds only the voucher row', async () => {
    await pick(page, 'from', 'AU'); await pick(page, 'to', 'AU');
    const vis = () => page.evaluate(() => ({ same: document.querySelectorAll('#rows-body tr.same').length, shown: [...document.querySelectorAll('#rows-body tr[data-row]')].filter((t) => getComputedStyle(t).display !== 'none').length, fold: (document.querySelector('[data-testid="cl-samefold"]') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim() }));
    const a = await vis();
    await page.click('[data-testid="cl-samefold-btn"]'); await page.waitForTimeout(100);
    const b = await vis();
    await page.click('[data-testid="cl-samefold-btn"]'); await page.waitForTimeout(100);
    const c = await vis();
    await pick(page, 'from', 'IN'); await pick(page, 'to', 'AU');
    const d = await vis();
    const ok = a.same === 16 && a.shown === 0 && /^16 rows are the same · show/.test(a.fold) && b.shown === 16 && /hide/.test(b.fold) && c.shown === 0 && d.same === 1 && /^1 row is the same/.test(d.fold) && d.shown === 15;
    return { ok, saw: 'AU→AU: ' + a.same + ' same, ' + a.shown + ' shown, "' + a.fold.slice(0, 40) + '" → show: ' + b.shown + ' → hide: ' + c.shown + ' · IN→AU: ' + d.same + ' same row folded' };
  });

  /* ── CTRY-49 (Athi, 23 Oct): "Same" / "Changes", a row compared part by part, the full detail in a popup ───────────────────────────────── */
  await w.step('D1', '(CTRY-49) IN -> AU, Currency: the line reads "Changes: ₹ → A$ · same rule: 2 decimals" (the code alone no longer decides)', async () => {
    await pick(page, 'from', 'IN'); await pick(page, 'to', 'AU');
    const cur = await text(page, '[data-testid="cl-verdict-currency"]');
    await pick(page, 'to', 'IN');
    const none = await text(page, '[data-testid="cl-samefold"]');
    await pick(page, 'to', 'AU');
    const ok = cur === 'Changes: ₹ → A$ · same rule: 2 decimals' && /^\d+ rows are the same/.test(none);
    return { ok, saw: '"' + cur + '" · IN→IN: "' + none.slice(0, 40) + '…"' };
  });

  await w.step('D2', '(CTRY-49) every row says "Same" or "Changes: …" and names its parts; no chip says SAME or DIFFERENT any more', async () => {
    const r = await page.evaluate(() => [...document.querySelectorAll('#rows-body tr[data-row] .verdict')].map((td) => ({ row: td.parentElement.dataset.row, t: td.textContent.trim() })));
    const bad = r.filter((x) => !(/^Same$/.test(x.t) || /^Changes: /.test(x.t)) || /SAME|DIFFERENT/.test(x.t));
    const arrows = r.filter((x) => /→/.test(x.t)).length;
    return { ok: r.length === 16 && bad.length === 0 && arrows >= 10, saw: r.length + ' rows, ' + bad.length + ' not in the new words · ' + arrows + ' name what changed with an arrow · e.g. fy "' + (r.find((x) => x.row === 'fy') || {}).t + '" · scheme "' + ((r.find((x) => x.row === 'scheme') || {}).t || '').slice(0, 70) + '…"' };
  });

  await w.step('D3', '(CTRY-49) the Details button opens the popup: both countries\' values, what it means, what ChitBridge does; the x, Esc and a press outside close it', async () => {
    await page.click('[data-testid="cl-more-currency"]'); await page.waitForSelector('[data-testid="lk-pop"]');
    const r = await page.evaluate(() => { const q = (s) => (document.querySelector(s) || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(); return {
      title: q('[data-testid="lk-pop"] header b'), verdict: q('[data-testid="cl-detail-verdict"]'), from: q('[data-testid="cl-detail-from"]'), to: q('[data-testid="cl-detail-to"]'), means: q('[data-testid="cl-detail-means"]'), does: q('[data-testid="cl-detail-does"]'),
      parts: document.querySelectorAll('[data-testid="cl-parts"] tbody tr').length, modal: document.querySelector('[data-testid="lk-pop"]').getAttribute('aria-modal') }; });
    await page.click('[data-testid="lk-pop-close"]'); const x = await page.$('[data-testid="lk-pop"]');
    await page.click('[data-testid="cl-more-fy"]'); await page.waitForSelector('[data-testid="lk-pop"]'); await page.keyboard.press('Escape'); const esc = await page.$('[data-testid="lk-pop"]');
    await page.click('[data-testid="cl-more-fy"]'); await page.waitForSelector('[data-testid="lk-pop"]'); await page.mouse.click(4, 4); await page.waitForTimeout(100); const out = await page.$('[data-testid="lk-pop"]');
    const ok = /Currency · India vs Australia/.test(r.title) && /^Changes: ₹ → A\$/.test(r.verdict) && /INR/.test(r.from) && /AUD/.test(r.to) && /What it means for the shop/.test(r.means) && /What ChitBridge does/.test(r.does) && r.parts >= 2 && r.modal === 'true' && !x && !esc && !out;
    return { ok, saw: '"' + r.title + '" · ' + r.parts + ' parts · from "' + r.from.slice(0, 40) + '" · to "' + r.to.slice(0, 40) + '" · closes with x ' + !x + ', Esc ' + !esc + ', outside ' + !out };
  });

  await w.step('D4', '(CTRY-49) the popup, Cream and Dark at 1366 and 390 px: AA on every text, no sideways scroll, nothing cut', async () => {
    const bad = [], notes = [];
    for (const [th, wd, ht] of [['cream', 1366, 900], ['dark', 1366, 900], ['cream', 390, 844], ['dark', 390, 844]]) {
      await page.setViewportSize({ width: wd, height: ht }); await theme(page, th); await page.waitForTimeout(200);
      await page.click('[data-testid="cl-more-invoice"]'); await page.waitForSelector('[data-testid="lk-pop"]'); await page.waitForTimeout(150);
      const c = await contrast(page);
      const g = await page.evaluate(() => { const p = document.querySelector('[data-testid="lk-pop"]'), b = p.getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, inside: b.left >= 0 && b.right <= window.innerWidth + 1, inner: p.scrollWidth > p.clientWidth + 1 }; });
      await page.click('[data-testid="lk-pop-close"]');
      if (c.bad.length || g.sw > g.iw || !g.inside || g.inner) bad.push(th + '@' + wd + ' ' + c.bad.slice(0, 2).map((x) => '"' + x.text + '" ' + x.ratio + '/' + x.need).join(', ') + ' sw ' + g.sw + '/' + g.iw + ' inside ' + g.inside + ' inner ' + g.inner);
      notes.push(th + '@' + wd + ': ' + c.n + ' texts');
    }
    await theme(page, 'cream'); await page.setViewportSize({ width: 1366, height: 900 });
    return { ok: bad.length === 0, saw: notes.join(' · ') + (bad.length ? ' · FAIL ' + bad.join(' | ') : ' · all AA, no sideways scroll, popup inside the window') };
  });

  await w.step('D5', '(UX-112) the popup keeps its header: its body scrolls, the title and the x stay in view; a list inside the popup scrolls in its own list, under its own header', async () => {
    await page.setViewportSize({ width: 1366, height: 420 });   /* short window: the detail is longer than the popup */
    await page.click('[data-testid="cl-more-invoice"]'); await page.waitForSelector('[data-testid="lk-pop"]'); await page.waitForTimeout(150);
    const inView = () => page.evaluate(() => {
      const p = document.querySelector('[data-testid="lk-pop"]'), h = p.querySelector('header'), x = p.querySelector('.lk-pop-x'), b = p.querySelector('.lk-pop-body');
      const hr = h.getBoundingClientRect(), pr = p.getBoundingClientRect(), xr = x.getBoundingClientRect();
      const hit = document.elementFromPoint(xr.left + xr.width / 2, xr.top + xr.height / 2);
      return { long: b.scrollHeight > b.clientHeight + 4, bodyTop: Math.round(b.scrollTop), frameTop: Math.round(p.scrollTop),
        header: hr.top >= pr.top - 1 && hr.top >= 0 && hr.bottom <= window.innerHeight, x: !!hit && (hit === x || x.contains(hit)) };
    });
    await page.evaluate(() => { const b = document.querySelector('[data-testid="lk-pop"] .lk-pop-body'); b.scrollTop = b.scrollHeight; });
    await page.waitForTimeout(100);
    const a = await inView();
    await page.click('[data-testid="lk-pop-close"]');
    /* the same popup holding a CBList ("and N more"): the list scrolls in its own .cbl-list, its column header stays, the popup body does not move */
    for (const part of ['css', 'click', 'wire']) await page.addScriptTag({ url: base + '/app/list-ctl-' + part + '.js' });   /* the list control's three parts load BEFORE the unit (list-ctl.js throws without them) */
    await page.addScriptTag({ url: base + '/app/list-ctl.js' });
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'ux112-host'; document.body.appendChild(host);
      const items = []; for (let i = 1; i <= 120; i++) items.push({ name: 'Line ' + i, note: 'row ' + i });
      CBLabKit.more(host, { id: 'ux112', title: 'Many lines', items, columns: [{ key: 'name', label: 'Name' }, { key: 'note', label: 'Note' }] });
    });
    await page.click('[data-testid="lk-more-ux112"]'); await page.waitForSelector('[data-testid="lk-pop"] .cbl-list'); await page.waitForTimeout(200);
    await page.evaluate(() => { const l = document.querySelector('[data-testid="lk-pop"] .cbl-list'); l.scrollTop = l.scrollHeight; });
    await page.waitForTimeout(100);
    const c = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="lk-pop"]'), l = p.querySelector('.cbl-list'), ch = p.querySelector('[role=columnheader]'), h = p.querySelector('header');
      const lr = l.getBoundingClientRect(), cr = ch ? ch.getBoundingClientRect() : null;
      return { listTop: Math.round(l.scrollTop), bodyTop: Math.round(p.querySelector('.lk-pop-body').scrollTop), header: h.getBoundingClientRect().top >= 0,
        col: !!cr && cr.top >= 0 && cr.bottom <= lr.bottom && cr.bottom <= window.innerHeight };
    });
    await page.click('[data-testid="lk-pop-close"]'); await page.evaluate(() => document.getElementById('ux112-host').remove());
    await page.setViewportSize({ width: 1366, height: 900 });
    const ok = a.long && a.bodyTop > 0 && a.frameTop === 0 && a.header && a.x && c.listTop > 0 && c.bodyTop === 0 && c.header && c.col;
    return { ok, saw: 'detail: longer than the popup ' + a.long + ', body scrolled ' + a.bodyTop + ' px, frame ' + a.frameTop + ' px, title in view ' + a.header + ', x pressable ' + a.x +
      ' · list popup: list scrolled ' + c.listTop + ' px, popup body ' + c.bodyTop + ' px, title in view ' + c.header + ', column header in view ' + c.col };
  });

  await w.step('K1', '(CTRY-38) one line says what the side-by-side is, and that any pack can be picked on either side', async () => {
    await pick(page, 'from', 'IN'); await pick(page, 'to', 'AU');
    const a = await text(page, '[data-testid="cl-what"]');
    await pick(page, 'to', 'JP');
    const b = await text(page, '[data-testid="cl-what"]');
    const n = await page.evaluate(() => CBRegulation.list().length);
    const words = (s) => s.split(/s+/).filter(Boolean).length;
    const ok = /^Side by side: India with Australia./.test(a) && /^Side by side: India with Japan./.test(b) && new RegExp('any of the ' + n + ' packs on either side').test(b) && words(b) <= 16;
    await pick(page, 'to', 'AU');
    return { ok, saw: '"' + a + '" → "' + b + '"' };
  });

  await w.step('K2', '(CTRY-39) the pack rows the lab did not show: records, tax heads paid, time zones, dates and numbers, voucher numbers - read from the engine, none blank, for every pack pair', async () => {
    const r = await page.evaluate(() => {
      const ids = CBRegulation.list().map((p) => p.id), keys = ['retention', 'kept', 'payheads', 'zones', 'formats', 'voucher'], blank = [];
      ids.forEach((id) => { LAB.from = id; LAB.to = id; repaint(); keys.forEach((k) => { const t = document.querySelector('[data-testid="cl-row-' + k + '"] td.v.from').textContent.trim(); if (!t || /undefined|NaN|[?]$/.test(t)) blank.push(id + '/' + k); }); });
      const rt = CBCountries.rulesTable({ year: 2026 });
      LAB.from = 'IN'; LAB.to = 'AU'; repaint();
      return { ids, blank, inYears: document.querySelector('[data-testid="cl-row-retention"] td.v.from').textContent.trim(), engineIn: rt.rules.filter((x) => x.key === 'records')[0].values.IN,
        gst: document.querySelector('[data-testid="cl-row-kept"] td.v.from').textContent, aeKept: (LAB.from = 'AE', repaint(), document.querySelector('[data-testid="cl-row-kept"] td.v.from').textContent) };
    });
    await pick(page, 'from', 'IN'); await pick(page, 'to', 'AU');
    const ok = !r.blank.length && r.inYears === r.engineIn && /72/.test(r.gst) && /real estate vat/.test(r.aeKept);
    return { ok, saw: r.ids.length + ' packs · blank cells: ' + (r.blank.join(' ') || 'none') + ' · IN keeps records "' + r.inYears + '" (engine: "' + r.engineIn + '")' };
  });

  /* ── 390 px: Cream, then Dark ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
  await w.step('L8', 'At 390 px (Cream): no sideways scroll, the rows read one under the other, the bills stack, the cart lines are cards with nothing cut', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    const r = await page.evaluate((fitsSrc) => {
      const fits = eval(fitsSrc);
      const rows = [...document.querySelectorAll('#rows-body tr[data-row]')].filter((t) => getComputedStyle(t).display !== 'none'), a = document.querySelector('[data-testid="cl-bill-from"]').getBoundingClientRect(), b = document.querySelector('[data-testid="cl-bill-to"]').getBoundingClientRect();
      const stacked = rows.every((t) => { const f = t.querySelector('td.v.from').getBoundingClientRect(), g = t.querySelector('td.v.to').getBoundingClientRect(); return g.top >= f.bottom - 1; });
      const cart = document.querySelector('.cart'), cut = [...cart.querySelectorAll('input[type=text],select')].map(fits).filter((x) => !x.ok);
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, stacked, billsStack: b.top >= a.bottom - 1, rows: rows.length, cards: [...document.querySelectorAll('#cart-body tr')].every((t) => getComputedStyle(t).display === 'grid'), cut: cut.length, innerScroll: cart.scrollWidth > cart.clientWidth, firstRow: rows[0].innerText.replace(/\s+/g, ' ').slice(0, 60) };
    }, fits);
    const ok = r.sw <= r.iw && r.stacked && r.billsStack && r.rows === 15 && r.cards && r.cut === 0 && !r.innerScroll;
    return { ok, saw: 'scroll ' + r.sw + ' / ' + r.iw + ' · rows stacked ' + r.stacked + ' · bills stacked ' + r.billsStack + ' · cart cards ' + r.cards + ', ' + r.cut + ' cut · "' + r.firstRow + '"' };
  });

  await w.step('C9', 'At 390 px (Dark): AA everywhere, no sideways scroll, the TO cell still carries its rule', async () => {
    await theme(page, 'dark');
    const c = await contrast(page);
    const r = await page.evaluate(() => { const t = document.querySelector('#rows-body tr.different td.v.to'), cs = getComputedStyle(t); return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, rule: parseFloat(cs.borderLeftWidth) >= 3 && cs.borderLeftColor !== 'rgba(0, 0, 0, 0)', ground: cs.backgroundColor === getComputedStyle(document.querySelector('#rows-body tr.different td.v.from')).backgroundColor }; });
    const ok = c.bad.length === 0 && r.sw <= r.iw && r.rule && r.ground;
    return { ok, saw: c.n + ' texts, ' + c.bad.length + ' below AA' + (c.bad.length ? ' (' + c.bad.slice(0, 3).map((x) => '"' + x.text + '" ' + x.ratio + '/' + x.need).join(', ') + ')' : '') + ' · scroll ' + r.sw + ' / ' + r.iw + ' · rule ' + r.rule };
  });
  await theme(page, 'cream');
  await page.setViewportSize({ width: 1366, height: 900 });

  /* ── CL3 · the standard shell and "Where ChitBridge is for <country>" ─────────────────────────────────────────────────────────── */
  await w.step('R1', 'Signed out: the standard shell — header, avatar "Sign in" (to Home, no window over the lab), skeleton, kural, the shell\'s font, text size', async () => {
    const r = await page.evaluate(() => {
      const fam = (el) => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const door = document.querySelector('[data-testid="shell-avatar"] [data-testid="signin-door"]');
      const sec = document.querySelector('.pane.left .sec'), before = parseFloat(getComputedStyle(sec).fontSize);
      CBAvatar.set('fs', 'xl'); const after = parseFloat(getComputedStyle(sec).fontSize); CBAvatar.set('fs', 'm');
      return { shell: !!document.querySelector('[data-testid="cbshell"][data-mode="app"]'), side: !!document.querySelector('[data-testid="skel-side"]'), main: !!document.querySelector('[data-testid="skel-main"] [data-testid="cl-work"]'),
        door: door ? { t: door.textContent.trim(), href: door.getAttribute('href') } : null, window: (document.querySelector('[data-testid="shell-signin"]') || { innerHTML: '' }).innerHTML.trim().length,
        kural: !!document.querySelector('[data-testid="kural-footer"]'), labFont: fam(document.querySelector('.labbar h1')), shellFont: fam(document.querySelector('[data-testid="cbshell"]')),
        ownHeader: !!document.querySelector('#cl header, body > header'), before, after };
    });
    const ok = r.shell && r.side && r.main && r.door && r.door.t === 'Sign in' && r.door.href === '/' && r.window === 0 && r.kural && r.labFont === r.shellFont && !r.ownHeader && r.after > r.before * 1.2;
    return { ok, saw: 'shell ' + r.shell + ' · sidebar ' + r.side + ' · lab in main ' + r.main + ' · avatar "' + (r.door && r.door.t) + '" → ' + (r.door && r.door.href) + ' · sign-in window ' + (r.window ? 'drawn' : 'none') + ' · kural ' + r.kural + ' · font ' + r.labFont + ' = ' + r.shellFont + ' · text size ' + r.before + ' → ' + r.after + 'px' };
  });

  const ready = () => page.evaluate(() => ({ title: (document.querySelector('[data-testid="cl-ready-title"]') || {}).textContent || '', pack: (document.querySelector('[data-testid="cl-ready-pack"]') || {}).textContent || '',
    none: (document.querySelector('[data-testid="cl-ready-none"]') || {}).textContent || '',
    rows: [...document.querySelectorAll('[data-testid="cl-ready-row"]')].map((r) => ({ state: r.dataset.state, text: r.textContent.replace(/\s+/g, ' ').trim() })) }));
  await w.step('R2', 'IN -> AU: "Where ChitBridge is for Australia" — the pack line, a row per product area (✅ ⚠️ ❌), Payroll "—", read from the file', async () => {
    await pick(page, 'from', 'IN'); await pick(page, 'to', 'AU'); await page.waitForTimeout(200);
    const r = await ready();
    const file = await page.evaluate(() => fetch('/data/country-ready.json').then((x) => x.json()));
    const au = file.countries.AU, want = au.areas.length + au.out.length;
    const syms = r.rows.every((x) => /^(✅|⚠️|❌|—) /.test(x.text)), words = Math.max(...r.rows.map((x) => x.text.split(' ').length));
    const same = r.rows.slice(0, au.areas.length).every((x, i) => x.state === au.areas[i].state && x.text.indexOf(au.areas[i].area) >= 0);
    const pay = r.rows.find((x) => /Payroll/.test(x.text));
    const ok = /Where ChitBridge is for Australia/.test(r.title) && /Australia · GST · \d+ of \d+ rules ready · not yet checked by a local accountant/.test(r.pack) && r.rows.length === want && syms && same && words <= 20
      && !!pay && pay.state === 'out' && /Not offered in Australia/.test(pay.text) && r.rows.some((x) => x.state === 'partial') && r.rows.some((x) => x.state === 'ok');
    return { ok, saw: '"' + r.title + '" · "' + r.pack + '" · ' + r.rows.length + '/' + want + ' rows · symbols ' + syms + ' · = file ' + same + ' · longest ' + words + ' words · "' + (pay ? pay.text : 'no payroll row') + '" · e.g. "' + (r.rows[2] || {}).text + '"' };
  });
  await w.step('R3', '-> UAE: the block follows the TO side; -> Saudi Arabia (pack-less): it says there is no pack, never a made-up row', async () => {
    await pick(page, 'to', 'AE'); await page.waitForTimeout(150);
    const a = await ready();
    await pick(page, 'to', 'SA'); await page.waitForTimeout(150);
    const b = await ready();
    await pick(page, 'to', 'AU'); await page.waitForTimeout(150);
    const ok = /United Arab Emirates/.test(a.title) && /VAT/.test(a.pack) && a.rows.length > 10 && /Saudi Arabia/.test(b.title) && b.rows.length === 0 && /No pack for Saudi Arabia yet/.test(b.none);
    return { ok, saw: '"' + a.title + '" ' + a.rows.length + ' rows · "' + b.title + '" — "' + b.none + '"' };
  });

  /** rule 13 on this page as it stands: AA everywhere, nothing clipped, no inner sideways scroll, nothing floating over the block, no app.html, the budget */
  const rule13 = async () => {
    const c = await contrast(page);
    const r = await page.evaluate(() => {
      const el = document.getElementById('ready'), box = el.getBoundingClientRect(), cl = document.getElementById('cl');
      const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const floating = [...document.querySelectorAll('body *')].filter((x) => { const cs = getComputedStyle(x); if (cs.position !== 'fixed' && cs.position !== 'sticky') return false; if (x.contains(el)) return false; const rc = x.getBoundingClientRect(); return rc.width > 0 && rc.height > 0 && hits(rc, box); }).map((x) => x.tagName + '.' + x.className);
      const clipped = [...el.querySelectorAll('span, div')].filter((x) => x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflow !== 'visible').length
        + [...el.querySelectorAll('.kv > span')].filter((x) => x.getBoundingClientRect().right > box.right + 1).length;
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, inner: cl.scrollWidth > cl.clientWidth + 1 || el.scrollWidth > el.clientWidth + 1, floating, clipped,
        toApp: document.querySelectorAll('a[href*="app.html"]').length, kural: (function () {
          /* the kural band's ground is a gradient (the measure leaves it out), so its words are read against the band's own base colour here */
          const k = document.querySelector('[data-testid="kural-footer"]'); if (!k || k.hidden) return null;
          const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number), lum = (c) => { const v = rgb(c).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
          const a = lum(getComputedStyle(k).color), b = lum(getComputedStyle(k).backgroundColor), kb = k.getBoundingClientRect();
          return { ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100, atFoot: kb.top >= document.querySelector('.app').getBoundingClientRect().bottom - 1 };
        })(), maxWords: Math.max(...[...el.querySelectorAll('.kv, .hint')].map((x) => x.textContent.trim().split(/\s+/).length)) };
    });
    const ok = c.bad.length === 0 && r.sw <= r.iw && !r.inner && r.floating.length === 0 && r.clipped === 0 && r.toApp === 0 && r.maxWords <= 20 && (!r.kural || (r.kural.ratio >= 4.5 && r.kural.atFoot));
    return { ok, saw: c.n + ' texts, ' + c.bad.length + ' below AA' + (c.bad.length ? ' (' + c.bad.slice(0, 3).map((x) => '"' + x.text + '" ' + x.ratio + '/' + x.need).join(', ') + ')' : '') + ' · scroll ' + r.sw + '/' + r.iw + ' · inner scroll ' + r.inner + ' · floating over the block ' + r.floating.length + (r.floating.length ? ' (' + r.floating[0] + ')' : '') + ' · clipped ' + r.clipped + ' · app.html ' + r.toApp + ' · longest line ' + r.maxWords + ' words · kural ' + (r.kural ? r.kural.ratio + ':1, at the foot ' + r.kural.atFoot : 'hidden') };
  };
  const looks = [['cream', 1366, 900], ['dark', 1366, 900], ['cream', 390, 844], ['dark', 390, 844]];
  for (const [th, wd, ht] of looks) {
    await w.step('R4', 'Rule 13, signed out, ' + th + ' at ' + wd + ' px: AA · nothing clipped · no inner scroll · nothing over the block · no app.html · the budget (≤ 20 words a line)', async () => {
      await page.setViewportSize({ width: wd, height: ht }); await theme(page, th); await page.waitForTimeout(200);
      await page.evaluate(() => document.getElementById('ready-sec').scrollIntoView({ block: 'start' }));
      return rule13();
    });
  }
  await theme(page, 'cream'); await page.setViewportSize({ width: 1366, height: 900 });

  /* signed in: the same page with a session in this browser — the avatar's initial, the same block, the same flow */
  await page.evaluate((s) => { localStorage.setItem('cb_sess', s); }, W.session('Walk Owner', 'Walk Shop'));
  await page.reload(); await page.waitForSelector('[data-testid="cl-rows"] tr[data-row]', { timeout: 15000 });
  await pick(page, 'from', 'IN'); await pick(page, 'to', 'AU'); await page.waitForTimeout(200);
  for (const [th, wd, ht] of looks) {
    await w.step('R5', 'Rule 13, SIGNED IN, ' + th + ' at ' + wd + ' px: the avatar\'s initial (not Sign in), the same block, AA · nothing clipped · nothing over it', async () => {
      await page.setViewportSize({ width: wd, height: ht }); await theme(page, th); await page.waitForTimeout(200);
      await page.evaluate(() => document.getElementById('ready-sec').scrollIntoView({ block: 'start' }));
      const who = await page.evaluate(() => ({ door: !!document.querySelector('[data-testid="shell-avatar"] [data-testid="signin-door"]'), rows: document.querySelectorAll('[data-testid="cl-ready-row"]').length, title: document.getElementById('ready-sec').textContent }));
      const r = await rule13();
      return { ok: r.ok && !who.door && who.rows > 10 && /Australia/.test(who.title), saw: 'avatar ' + (who.door ? '"Sign in"' : 'signed in') + ' · ' + who.rows + ' rows · ' + r.saw };
    });
  }
  await theme(page, 'cream'); await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(() => localStorage.removeItem('cb_sess'));
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run('country-lab', walk);
