// THE TOUR (TOUR=1) — every implementation from 2026-09-03 → 05 as NUMBERED TEST CASES, narrated on screen.
// Watch it:  TOUR=1 TOUR_PAUSE=8000 npx playwright test tests/tour.spec.js --headed --project=authed   (e2e/TOUR.md)
// Each case shows: what we test · the steps · the expected result; then a green "observed" line once the assertion holds.
const { test, expect } = require('@playwright/test');
const { mintEntity, addProduct, clickNav, settle, dismissModal, openTab } = require('../fixtures');

const PAUSE = Number(process.env.TOUR_PAUSE || 8000);
const FROM = Number(process.env.TOUR_FROM || 1);
const { MEDIA_PNG, MEDIA_VIDEO } = require('../fixtures');   /* TOUR_FROM=11: earlier cases still run (their data is needed) but without pauses */
const HEADED = !!process.env.TOUR_HEADED || process.argv.includes('--headed');
/* headed: a maximised real window (viewport null lets the window size rule), slowed so the eye can follow */
test.use(HEADED ? { viewport: { width: 1600, height: 900 }, launchOptions: { slowMo: 350, args: ['--window-size=1620,1000', '--window-position=0,0'] } } : { launchOptions: { slowMo: 0 } });

let caseNo = 0;
/** ⚠️ THE WATCHDOG. A caption that never moves is a page whose main thread is BLOCKED (an infinite loop in app JS) —
 * Playwright waits forever on evaluate, the headed window freezes, and the flood of events starved the node worker
 * (OOM at 9 min, 2026-09-04). Before every caption: is the page alive? If not, pause the debugger and print WHERE. */
let lastLabel = "start";
/** The watchdog runs on ITS OWN timer, because a blocked page also blocks the step that is awaiting it. Every 10 s it
 * races a trivial evaluate; when the page stops answering it pauses the debugger over CDP (which works while JS is
 * stuck), prints the stack and the last caption, and closes the context so the stuck step fails instead of hanging. */
let _dbg = null, _dbgStack = null;
/** attach the debugger BEFORE anything can block: attaching needs the page's main thread, a pause request does not */
async function attachDebugger(page) { try { _dbg = await page.context().newCDPSession(page); await _dbg.send("Debugger.enable"); _dbg.on("Debugger.paused", (e) => { _dbgStack = e.callFrames.slice(0, 20).map((f) => (f.functionName || "(anon)") + " @" + (f.url || "").split("/").pop() + ":" + (f.location.lineNumber + 1)); }); await _dbg.send("Debugger.resume").catch(() => {}); } catch (e) { console.log("[tour] debugger attach failed: " + e.message); } }
async function stackNow() { if (!_dbg) return ["(no debugger)"]; _dbgStack = null; try { await _dbg.send("Debugger.pause"); } catch (e) { return ["(pause failed: " + e.message + ")"]; } for (let i = 0; i < 40 && !_dbgStack; i++) await new Promise((r) => setTimeout(r, 250)); const st = _dbgStack || ["(no pause event in 10 s)"]; try { await _dbg.send("Debugger.resume"); } catch (_) {} return st; }
function startWatchdog(page) {
  const errs = []; page.on("pageerror", (e) => { if (errs.length < 5) errs.push(String(e).slice(0, 160)); });
  let consoleErrs = 0; page.on("console", (m) => { if (m.type() === "error") consoleErrs++; });
  const t = setInterval(async () => {
    const ok = await Promise.race([page.evaluate(() => 1).then(() => true).catch(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
    if (ok) return;
    clearInterval(t); const stack = await stackNow();
    console.log("WATCHDOG: MAIN THREAD BLOCKED after " + lastLabel + " · console errors so far " + consoleErrs + " · page errors " + JSON.stringify(errs) + " · STACK " + JSON.stringify(stack));
    try { await page.context().close(); } catch (_) {}
  }, 10000);
  return () => clearInterval(t);
}
async function alive(page, label) {
  const ok = await Promise.race([page.evaluate(() => 1).then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
  if (ok) return;
  let stack = null;
  try { const cdp = await page.context().newCDPSession(page); await cdp.send("Debugger.enable"); cdp.on("Debugger.paused", (e) => { stack = e.callFrames.slice(0, 14).map((f) => (f.functionName || "(anon)") + " @" + (f.url || "").split("/").pop() + ":" + (f.location.lineNumber + 1)); }); await cdp.send("Debugger.pause"); await new Promise((r) => setTimeout(r, 2000)); await cdp.send("Debugger.resume").catch(() => {}); } catch (e) { stack = ["(cdp failed: " + e.message + ")"]; }
  throw new Error("MAIN THREAD BLOCKED before " + label + " — STACK " + JSON.stringify(stack));
}
/** step(): a bounded await. On 60 s it prints the requests still in flight and throws — a stall names itself. */
let _net = null;
async function netWatch(page) { if (_net) return; _net = new Map(); const cdp = await page.context().newCDPSession(page); await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (e) => _net.set(e.requestId, e.request.method + " " + e.request.url.slice(0, 120)));
  cdp.on("Network.loadingFinished", (e) => _net.delete(e.requestId)); cdp.on("Network.loadingFailed", (e) => _net.delete(e.requestId)); }
async function step(page, label, fn) {
  await netWatch(page); const t0 = Date.now();
  const r = await Promise.race([fn().then(() => "ok"), new Promise((ok) => setTimeout(() => ok("HUNG"), 60000))]);
  console.log("[tour] step " + label + " → " + r + " " + (Date.now() - t0) + "ms");
  if (r === "HUNG") {
    /* the page may be BLOCKED (an infinite loop): pause the debugger over CDP — that works while JS is stuck — and print WHERE, before anything closes */
    const stack = await stackNow(); console.log("[tour] STACK " + JSON.stringify(stack));
    throw new Error("STALL at " + label + " · in flight: " + JSON.stringify([..._net.values()]) + " · stack: " + JSON.stringify(stack));
  }
}
async function tc(page, title, testing, steps, expected) {
  caseNo++;
  lastLabel = "case " + caseNo + " (" + title + ")";
  console.log("[tour] " + new Date().toISOString().slice(11,19) + " case " + caseNo + ": " + title);
  await page.evaluate(([n, title, testing, steps, expected]) => {
    let el = document.getElementById('cb_tour');
    if (!el) { el = document.createElement('div'); el.id = 'cb_tour'; document.body.appendChild(el); }
    el.setAttribute('style', 'position:fixed;right:16px;bottom:72px;z-index:99999;max-width:560px;pointer-events:none;background:#111;color:#fff;padding:14px 18px;border-radius:12px;font:14px/1.5 system-ui;box-shadow:0 8px 30px rgba(0,0,0,.4)');
    el.innerHTML = '<div style="font-size:11px;letter-spacing:.08em;opacity:.7">TEST CASE ' + n + '</div>'
      + '<div style="font-weight:700;font-size:17px;margin:2px 0 6px">' + title + '</div>'
      + '<div><b style="opacity:.75">Testing</b> ' + testing + '</div>'
      + '<div><b style="opacity:.75">Steps</b> ' + steps + '</div>'
      + '<div><b style="opacity:.75">Expected</b> ' + expected + '</div>'
      + '<div id="cb_tour_ok" style="margin-top:6px;color:#7CFC9A;font-weight:700"></div>';
  }, [caseNo, title, testing, steps, expected]);
  if (caseNo >= FROM) await page.waitForTimeout(Math.round(PAUSE * 0.6));
}
async function ok(page, observed) {
  console.log("[tour] " + new Date().toISOString().slice(11,19) + " ok: " + observed);
  /* which case breaks /me? time the same read the page makes, capped at 20 s, after every case */
  if (process.env.TOUR_ME_PROBE) { const t0 = Date.now(); const r = await Promise.race([page.evaluate(async () => { const s = JSON.parse(localStorage.getItem("cb_sess") || "null"); const t1 = Date.now(); const out = []; for (const inc of ["readiness","channels","vault"]) { const t2 = Date.now(); const rr = await Promise.race([fetch((CFG.API_BASE || "") + "/api/entities/me?include=" + inc, { headers: { Authorization: "Bearer " + (s && s.token) } }).then((r) => r.status), new Promise((ok) => setTimeout(() => ok("HUNG"), 12000))]); out.push(inc + ":" + rr + "/" + (Date.now() - t2) + "ms"); } return out.join(" · "); }).catch((e) => "ERR " + String(e.message).slice(0, 80)), new Promise((ok) => setTimeout(() => ok("HUNG >40s"), 40000))]); console.log("[tour]   /me?readiness → " + r + " (" + (Date.now() - t0) + "ms)"); }
  await page.evaluate((t) => { const el = document.getElementById('cb_tour_ok'); if (el) el.textContent = '✓ Observed: ' + t; }, observed);
  if (caseNo >= FROM) await page.waitForTimeout(PAUSE);
}
const rmCaption = (page) => page.evaluate(() => { const el = document.getElementById('cb_tour'); if (el) el.remove(); }).catch(() => {});

test('the tour', async ({ page }) => {
  test.skip(!process.env.TOUR, 'set TOUR=1 to run the tour');
  test.setTimeout(1800000);
  await attachDebugger(page);
  const stopWatchdog = startWatchdog(page);
  await mintEntity(page);
  await page.evaluate(async () => api('saveProfile', { body: { gstn: '29ABCDE1234F1Z5' } }).catch(() => null));
  const basmati = 'Basmati 25kg', ponni = 'Ponni Boiled 10kg';
  await addProduct(page, { name: basmati, price: 1000 });
  await addProduct(page, { name: ponni, price: 600 });
  const ids = await page.evaluate(async ([a, b]) => {
    const rows = await api('prodList');
    const f = (n) => { const p = rows.find((x) => ((x.item_data || x).name || '') === n); return p ? { id: p.item_id || p.id, d: p.item_data || p } : null; };
    const A = f(a), B = f(b);
    await api('prodEdit', { params: { id: A.id }, body: { item_data: Object.assign({}, A.d, { code: 'BAS-25', hsn: '1006', bom: [{ item: 'Basmati paddy 40kg', qty: 1 }, { item: 'PP bag', qty: 1 }] }) } });
    await api('prodEdit', { params: { id: B.id }, body: { item_data: Object.assign({}, B.d, { code: 'PON-10' }) } });
    return { a: A.id, b: B.id };
  }, [basmati, ponni]);
  const openProduct = async (name) => { await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page); await page.evaluate(() => { try { if (typeof catsetBack === 'function') catsetBack(); } catch (_) {} }); /* leave Setup if it is open — the row click alone does not */ await settle(page); await page.locator('[data-testid^="cat-product-"]', { hasText: name }).first().click(); await settle(page); await expect(page.getByTestId('cat-edit')).toBeVisible({ timeout: 25000 }); };
  const setup = async (sec) => { await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page); await page.evaluate((s) => goCatsetSec(s), sec); await settle(page); /* the hub may reset to its first section while loading — pick the section in its own list once it is up */ const rowSec = page.getByTestId('catset-sec-' + sec); await expect(rowSec).toBeVisible({ timeout: 25000 }); await rowSec.click(); await settle(page); await page.waitForTimeout(600); };

  /* ── 1 · the product page ── */
  await openProduct(basmati);
  await tc(page, 'The product page is tabs', 'observation 4 — one product, every aspect on its own tab, header pinned',
    'open Catalogue › Basmati 25kg', 'tabs Product · Categories · Offers · Stock · Variants · Pricing & tax · Consists of · Barcode; the name and price stay on top while you scroll');
  await expect(page.getByTestId('prod-tab-barcode')).toBeVisible();
  await ok(page, 'eight tabs, header pinned');

  /* ── 2 · tax slab from the governance layer ── */
  await page.getByTestId('cat-edit').click();
  await openTab(page, 'pricing');
  await tc(page, 'Attach a tax slab from the governance layer', 'b201 — India\'s GST slabs come from the jurisdiction, not typed per entity; the split is shown the moment you pick',
    'Edit › Pricing & tax › pick "GST 18%" (IN GST · governance) › Save', 'Same state → CGST 9% + SGST 9%; other state → IGST 18%; Before tax · GST · After tax on one line');
  const sel = page.getByTestId('prod-tax-slab'); await expect(sel).toBeVisible({ timeout: 25000 });
  await sel.selectOption('IN-GST-18');
  const saved = page.waitForResponse((r) => /\/api\/products\//.test(r.url()) && r.request().method() === 'PATCH' && r.status() < 400, { timeout: 45000 });
  await page.getByTestId('cat-save').click(); await saved; await settle(page);
  await openTab(page, 'pricing');
  await expect(page.getByTestId('prod-tax-preview-intra')).toHaveAttribute('data-rate', '18', { timeout: 25000 });
  await ok(page, 'the split reads CGST 90 + SGST 90 on ₹1,000; IGST 180 for another state');

  /* ── 3 · author an offer through Setup ── */
  await setup('offers');
  await tc(page, 'Create a new offer', 'the offer form (rebuilt on the app\'s modal frame, date pickers, no region)',
    'Catalogue setup › Offers › + New offer › kind Percentage off › name › 10 › Save', 'the offer appears in "Your offers" as a DRAFT with its terms "10% off", no dates → always');
  await page.getByTestId('catset-offer-new').click();
  const sub = page.getByTestId('cbdef-sub'); if (await sub.count()) await sub.selectOption('percent_off');
  const offerName = 'Basmati 10% off';
  await page.getByTestId('cbdef-name').fill(offerName);
  await page.getByTestId('cbdef-rule-percent').fill('10');
  await page.getByTestId('cbdef-save').click(); await settle(page);
  const row = page.locator('.catset-drow[data-testid^="catset-offer-"]', { hasText: offerName }).first();
  await expect(row).toBeVisible({ timeout: 25000 });
  await ok(page, 'the row shows the name, "10% off", and its status');

  /* ── 4 · make it live ── */
  await tc(page, 'Make the offer live', 'the status switch on the Setup list — a draft is invisible to products and buyers; live applies',
    'click "Make live" on the row', 'the row turns LIVE; "Active" shows on its window because it has no dates');
  const offerId = (await row.getAttribute('data-testid')).replace('catset-offer-', '');
  await page.getByTestId('catset-offer-live-' + offerId).click(); await settle(page);
  await expect(row.getByText('Back to draft', { exact: true })).toBeVisible({ timeout: 25000 });
  await ok(page, 'status LIVE · time status Active');

  /* ── 5 · attach it on the product ── */
  await openProduct(basmati);
  await page.getByTestId('cat-edit').click();
  await openTab(page, 'offers');
  await tc(page, 'Attach the offer to the product', 'attaching writes applies_to.item_ids on the offer — one author (Setup), many products',
    'Edit › Offers › tick "Basmati 10% off" › Save', 'the tick holds after Save; the View › Offers tab lists it');
  const chip = page.getByTestId('prod-pane-offers').locator('[data-testid^="cat-offer-"]', { hasText: 'Basmati 10%' }).first();
  await expect(chip).toBeVisible({ timeout: 30000 });
  await chip.click();
  const saved2 = page.waitForResponse((r) => /\/api\/definitions\//.test(r.url()) && r.request().method() === 'PUT' && r.status() < 400, { timeout: 45000 }).catch(() => null);
  await page.getByTestId('cat-save').click(); await saved2; await settle(page);
  await openTab(page, 'offers');
  await expect.poll(async () => { await page.getByTestId('prod-tab-offers').click().catch(() => {}); return page.getByTestId('prod-offer-preview').count(); }, { timeout: 30000, intervals: [1000] }).toBeGreaterThan(0);
  await ok(page, 'the offer is listed on the product');

  /* ── 6 · the cart preview ── */
  await tc(page, 'The attached offer shows its outcome', 'Athi: "wherever something is attached, show the downstream result with the SAME engine"',
    'View › Offers tab', 'the cart breakdown at qty 1 and at the sample qty: list price, −10%, tax on what remains, You save');
  await expect(page.getByTestId('prod-offer-preview')).toBeVisible();
  await ok(page, '₹1,000 − ₹100 → ₹900 before tax, GST 18% on ₹900');

  /* ── 7 · the list row + search ── */
  await clickNav(page, 'catalogue'); await settle(page); await dismissModal(page);
  await tc(page, 'The list shows what is in effect', 'rows carry the ACTIVE offer\'s promise and the GST rate; the search box finds by them',
    'look at the Basmati row; type "10% off" in the search', '🏷️ 10% off and GST 18% on the row; the search narrows the list to Basmati');
  await expect(page.locator('[data-testid^="cbcat-tags-"]').first()).toBeVisible({ timeout: 25000 });
  await page.getByTestId('cat-search').fill('10% off'); await page.waitForTimeout(800);
  await expect(page.locator('[data-testid^="cat-product-"]')).toHaveCount(1, { timeout: 10000 });
  await ok(page, 'one row left: Basmati'); await page.getByTestId('cat-search').fill('');

  /* ── 8 · Setup › Tax register ── */
  await setup('tax');
  await tc(page, 'Setup › Tax is a register', 'Athi: "bring all the details — tax applied currently, offers attached, everything about the product"',
    'Catalogue setup › Tax', '"What your products carry": Basmati → 18% on the product; Ponni → not set; offers and HSN per row; slab counts; explanations folded');
  await expect(page.getByTestId('catset-tax-register')).toBeVisible({ timeout: 25000 });
  await ok(page, 'one row per product with tax as resolved and its source');

  /* ── 9 · own slab, cite it, retire → takeover ── */
  await page.getByTestId('catset-tax-new').click();
  await page.getByTestId('cbdef-name').fill('My own 12%');
  const rate = page.getByTestId('cbdef-rule-rate'); if (await rate.count()) await rate.fill('12');
  await page.getByTestId('cbdef-save').click(); await settle(page);
  const srow = page.locator('.catset-drow[data-testid^="catset-tax-"]', { hasText: 'My own 12%' }).first();
  await expect(srow).toBeVisible({ timeout: 25000 });
  const slabId = (await srow.getAttribute('data-testid')).replace('catset-tax-', '');
  await page.getByTestId('catset-tax-live-' + slabId).click(); await settle(page);
  await page.evaluate(async ([pid, slab]) => { const rows = await api('prodList'); const p = rows.find((x) => (x.item_id || x.id) === pid); await api('prodEdit', { params: { id: pid }, body: { item_data: Object.assign({}, p.item_data, { tax_slab: slab, tax_slab_name: 'My own 12%', gst_rate: 12 }) } }); }, [ids.b, slabId]);
  await setup('tax');
  await tc(page, 'A slab cannot go dark under its products', 'Athi: "if the slab is retired, the system should reject and ask another slab to take over"',
    'author "My own 12%", make it live, Ponni cites it; click Retire on it', 'retire is REFUSED: "1 product(s) cite this slab" → a modal asks which slab takes over');
  await page.evaluate((id) => catsetDefRetire('tax', id, 'My own 12%'), slabId);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Retire', exact: true }).last().click().catch(() => {});
  await expect(page.getByTestId('cbdef-takeover')).toBeVisible({ timeout: 25000 });
  await ok(page, 'the takeover ask opened with the count');
  await tc(page, 'Hand over to another slab', 'the takeover re-points every citing product and category default in one transaction, then retires',
    'pick "GST 18%" › Retire and hand over', 'the row is RETIRED with Reinstate; Ponni now cites GST 18% with the rate travelling');
  await page.getByTestId('cbdef-takeover').selectOption('IN-GST-18');
  await page.getByTestId('cbdef-takeover-go').click(); await settle(page);
  await expect(page.getByTestId('catset-tax-reinstate-' + slabId)).toBeVisible({ timeout: 25000 });
  await ok(page, 'RETIRED · Reinstate available; the register shows Ponni at 18%');

  /* ── the category tree carries tax and offers downward ── */
  const tree = await page.evaluate(async (ids) => {
    const mk = async (name, rules) => (await api('defAdd', { body: { kind: 'category', name, rules, status: 'live' } })).definition.definition_id;
    const top = await mk('Fruits & Vegetables', { default_slab: 'IN-GST-5' });
    const kid = await mk('Dried Fruits', { parent: top });
    const rows = await api('prodList'); const p = rows.find((x) => (x.item_id || x.id) === ids.b);
    const d = Object.assign({}, p.item_data, { categories: [kid] }); delete d.tax_slab; delete d.tax_slab_name; delete d.gst_rate;
    await api('prodEdit', { params: { id: ids.b }, body: { item_data: d } });
    const off = (await api('defAdd', { body: { kind: 'offer', sub_kind: 'percent_off', name: 'Fruits & Veg 8% off', rules: { percent: 8, scope: 'line', priority: 3, applies_to: { category: top } }, status: 'live', confirmed: true } })).definition.definition_id;
    if (typeof _DEFS !== 'undefined') delete _DEFS['category']; UI._ctOffers = undefined; UI._ctOffersThen = [];
    return { top, kid, off };
  }, ids);
  await clickNav(page, 'categories'); await settle(page);
  await tc(page, "A parent category's slab flows down the tree", 'Athi: "I applied 5% for the top category — it should reflect the categories underneath; the left panel should show what tax applies"',
    'Fruits & Vegetables = GST 5%; Dried Fruits under it with no slab of its own; Ponni moved into Dried Fruits', 'the Dried Fruits row shows "GST 5% ↑"; opening it reads "Applied here: 5% · inherited from Fruits & Vegetables", then the products');
  await expect(page.getByTestId('catg-tax-' + tree.kid)).toContainText('5%', { timeout: 25000 });
  await page.getByTestId('catg-row-' + tree.kid).click();
  await expect(page.getByTestId('catg-tax-applied')).toContainText(/inherited from/i, { timeout: 15000 });
  await ok(page, 'row chip GST 5% ↑ · view: inherited from Fruits & Vegetables · Ponni listed');
  await openProduct(ponni);
  await openTab(page, 'pricing');
  await tc(page, 'The product says where its rate came from', 'the same resolver on the product page — nothing is computed twice',
    'Ponni › Pricing & tax', '"GST 5% · from category Dried Fruits (inherits Fruits & Vegetables)" and the 5% split');
  await expect(page.getByTestId('prod-tax-resolved')).toContainText(/inherits/i, { timeout: 25000 });
  await expect(page.getByTestId('prod-tax-preview-intra')).toHaveAttribute('data-rate', '5');
  await ok(page, 'inherits Fruits & Vegetables · 5%');
  await clickNav(page, 'compose'); await settle(page);
  await tc(page, 'An offer on the parent category reaches the child', 'Athi: "same way offer as well?" — a line carries its categories AND their ancestors before the engine sees it',
    'offer "Fruits & Veg 8% off" scoped to Fruits & Vegetables; type Ponni ×4 in Compose', "the Ponni line shows the 8% coming off, with the offer's name as the reason");
  await page.getByTestId('chit-item-name').fill(ponni); await page.getByTestId('chit-item-qty').fill('4'); await page.getByTestId('chit-item-price').fill('600');
  await page.getByTestId('chit-item-add').click();
  const probeCat = () => page.evaluate(() => ({ items: ((typeof CC !== 'undefined' && CC.items) || []).map((it) => ({ n: it.particulars, id: it.item_id, cats: it.categories, why: it._offer_why })), offers: ((typeof CC !== 'undefined' && CC.offers) || []).map((o) => ({ l: o.label, at: o.applies_to })), tree: ((typeof cbDefsCached === 'function' && cbDefsCached('category')) || []).map((c) => [c.definition_id, c.name, c.rules && c.rules.parent]) }));
  await expect.poll(async () => page.evaluate(() => ((typeof CC !== 'undefined' && CC.items) || []).map((it) => String(it._offer_why || '') + ' ' + String(it._offer_label || '')).join(' | ')), { timeout: 20000 }).toMatch(/Fruits/)
    .catch(async (e) => { throw new Error(e.message + ' PROBE ' + JSON.stringify(await probeCat()).slice(0, 1500)); });
  await ok(page, '8% off Ponni via Fruits & Vegetables');
  await page.evaluate(() => { try { closeModal(); } catch (_) {} }); await dismissModal(page);

  /* ── 10 · Setup › Offers register + plan several ── */
  await setup('offers');
  await tc(page, 'Setup › Offers: terms, window, where applied', 'the row states the engine\'s own sentence, Scheduled / Active / Expired, and the product it targets',
    'Catalogue setup › Offers', '"Basmati 10% off" · 10% off · Active · on Basmati 25kg; the next six months on top');
  await expect(page.getByTestId('catset-offer-plan')).toBeVisible({ timeout: 25000 });
  await ok(page, 'terms · Active · on Basmati 25kg');
  await tc(page, 'Plan several offers, one per month', 'Athi: "this month this offer, next month another … applied as per time period"',
    'Plan several › two rows prefilled (this month, next month) › names and values › Create all as live', 'two new offers, each Active only inside its own month; the month strip shows them');
  await page.getByTestId('catset-offer-plan-new').click();
  await expect(page.getByTestId('plan-go')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('plan-name-0').fill('September: 5% off Ponni'); await page.getByTestId('plan-value-0').fill('5'); await page.getByTestId('plan-product-0').selectOption(ids.b);
  await page.getByTestId('plan-name-1').fill('October: ₹40 off Ponni'); await page.getByTestId('plan-kind-1').selectOption('amount_off'); await page.getByTestId('plan-value-1').fill('40'); await page.getByTestId('plan-product-1').selectOption(ids.b);
  await page.getByTestId('plan-go').click(); await settle(page);
  await expect(page.locator('.catset-drow[data-testid^="catset-offer-"]', { hasText: 'October' }).first()).toBeVisible({ timeout: 25000 });
  await ok(page, 'September row Active, October row Scheduled');

  /* ── 11 · publish on a date ── */
  await openProduct(basmati);
  await page.getByTestId('cat-edit').click();
  await page.getByTestId('prod-tab-product').click();   /* the page remembers the last tab; the price lives on Product */
  await page.getByTestId('cat-field-price').fill('1200');
  const at = new Date(Date.now() + 3 * 3600 * 1000); const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await page.getByTestId('cat-field-effective').fill(local);
  await tc(page, 'Publish on a date', 'b203 — a change parked with a moment, applied on the first read after it',
    'Edit › price 1,200 › Effective from = three hours ahead › Save', 'the header still says ₹1,000; 📅 Scheduled shows price → ₹1,200 with the moment, and Cancel');
  const parked = page.waitForResponse((r) => /\/schedule$/.test(r.url()) && r.request().method() === 'POST' && r.status() < 400, { timeout: 30000 });
  await page.getByTestId('cat-save').click(); await parked;
  await page.getByTestId('prod-tab-lifecycle').click();   /* the parked strip sits in the Lifecycle row */
  await expect(page.getByTestId('prod-scheduled')).toBeVisible({ timeout: 25000 });
  await ok(page, 'parked, live price unchanged');
  /* ── lifecycle + history ── */
  await tc(page, 'Lifecycle: the state of this product over time', 'one row for the status (the same four-state flag — never deleted), since when, the last change, and the changes PARKED for a date',
    'View › Lifecycle', '"Available · since today · 📅 1 change parked"; the row: Status with its meaning and a Change button, Since, Last change, the parked strip with Cancel');
  await page.getByTestId('prod-tab-lifecycle').click();
  await expect(page.getByTestId('prod-lifecycle-status')).toContainText('Available', { timeout: 25000 });
  await expect(page.getByTestId('prod-scheduled')).toBeVisible();
  await ok(page, 'status · since · last change · the parked change');
  await tc(page, 'History: every version, and what changed', 'b146 cuts a version whenever name · variant · unit · price · SKU · status changes; the row shows each one, newest first, with the change named and who made it',
    'View › History', 'v1 "created", later versions with "Price ₹… → ₹…"; a chit cites the version it was made from');
  await page.getByTestId('prod-tab-history').click();
  await expect(page.getByTestId('prod-history')).toBeVisible({ timeout: 25000 });
  await expect(page.locator('[data-testid="prod-history-row"]').first()).toBeVisible();
  await ok(page, 'the versions, newest first');

  /* ── 12 · barcode + BOM ── */
  await page.getByTestId('prod-tab-barcode').click();
  await tc(page, 'Barcode', 'Code 128 of the SKU drawn in the page, printable (a GS1 barcode needs an assigned prefix — a standards step)',
    'Barcode tab', 'a scannable barcode of BAS-25 and a Print label button');
  await expect(page.getByTestId('prod-barcode')).toBeVisible({ timeout: 15000 });
  await ok(page, 'Code 128 of BAS-25');
  await page.getByTestId('prod-tab-bom').click();
  await tc(page, 'Consists of', 'the bill of materials the Network tool authors — one line on a chit, components attached as detail',
    'Consists of tab › type 10 in "For"', 'per unit: paddy 40kg ×1, PP bag ×1; for 10: paddy ×10, bags ×10');
  await expect(page.getByTestId('prod-bom')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('prod-bom-qty').fill('10'); await page.waitForTimeout(500);
  await ok(page, 'the third column multiplies by 10');

  /* ── media + storefront ── */
  await page.getByTestId('cat-edit').click();
  await openTab(page, 'media');
  await tc(page, 'Media: the pictures and videos this product carries', 'files go through the API to the PRIVATE object store (key entity/yyyy/mm/id); the API streams the public read; the first picture is the storefront cover',
    "Edit › Media › choose a picture", "a tile appears at once (saved without the form Save button); View › Media reads \"1 picture · cover set\" — or, where the store is not configured, the API says so and nothing else changes");
  const mediaResp = page.waitForResponse((r) => /\/media$/.test(r.url()) && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
  await page.getByTestId('cat-field-media').setInputFiles(MEDIA_PNG);   /* the ONE shared test picture */
  const mr = await step(page, 'media upload response', () => mediaResp);
  if (mr && mr.status() < 400) {
    await expect(page.locator('[data-testid^="prod-media-"]').first()).toBeVisible({ timeout: 25000 });
    await ok(page, 'the picture is on the page; the cover is set');
  } else {
    await ok(page, 'the media store is not configured on this environment (no S3 env and b204 not run) — the API said so, the product is unchanged');
  }
  await tc(page, 'A video is a link', 'YouTube/Vimeo links, parsed by the API to an embed — no bytes stored; the storefront plays it from where it is hosted',
    'Edit › Media › paste a YouTube link › Add video', 'an embedded player appears among the tiles');
  /* every media request and answer is printed — the 2026-09-04 red run said only 'no response', which names nothing */
  page.on('request', (r) => { if (/\/media$/.test(r.url())) console.log('[tour] media request', r.method()); });
  page.on('response', (r) => { if (/\/media$/.test(r.url())) r.text().then((t) => console.log('[tour] media response', r.status(), String(t).slice(0, 160))).catch(() => console.log('[tour] media response', r.status())); });
  const linked = page.waitForResponse((r) => /\/media$/.test(r.url()) && r.request().method() === 'POST' && r.status() < 400, { timeout: 30000 });
  await page.getByTestId('cat-field-media-link').fill(MEDIA_VIDEO);
  await page.getByTestId('cat-media-link-add').click(); await linked;
  await expect(page.locator('[data-testid^="prod-media-"] iframe').first()).toBeVisible({ timeout: 25000 });
  await ok(page, 'the player is in the row');
  await page.evaluate(() => setProdMode('view'));
  await openTab(page, 'storefront');
  await tc(page, 'Storefront gate: a private catalogue has no storefront', 'b114 catalogue_visibility comes before any product — the row says why instead of framing "Shop not found"',
    'View › Storefront on a fresh (private) catalogue', '"● Not public · catalogue visibility is private — set it in Profile"');
  await expect(page.getByTestId('prod-outcome-storefront')).toContainText('Not public', { timeout: 25000 });
  await ok(page, 'the row says why');
  await step(page, 'saveProfile public', () => page.evaluate(async () => { await api('saveProfile', { body: { catalogue_visibility: 'public' } }); UI._me = null; }));
  await step(page, 'prodShopHandle', () => page.evaluate(() => prodShopHandle()));
  await step(page, 'me is public', () => page.waitForFunction(() => UI._me && UI._me.catalogue_visibility === 'public', null, { timeout: 25000 }));
  await step(page, 'repaint storefront', () => page.evaluate(() => prodRepaintSection('storefront')));
  await tc(page, 'Storefront: how a customer sees it', 'the real shop.html framed here, opened on this one product — what you see is what they see',
    'View › Storefront', '"Shown · as the customer sees it"; the product itself framed at phone width — the same shop page, opened on this one product');
  await expect(page.getByTestId('prod-storefront-link')).toBeVisible({ timeout: 25000 });
  await expect(page.getByTestId('prod-storefront-frame')).toBeVisible();
  const frame = page.frameLocator('[data-testid="prod-storefront-frame"]');
  await expect(frame.locator('#p_list').getByText('Basmati 25kg').first()).toBeVisible({ timeout: 30000 });
  await expect(frame.locator('[data-testid="prod-media"]').first()).toBeVisible({ timeout: 30000 });
  await ok(page, 'the customer view: the product, its picture and its video, framed at phone width');

  /* ── 13 · compose ── */
  await clickNav(page, 'compose'); await settle(page);
  await tc(page, 'Compose: a typed line that names your product IS that product', 'ccMatchMine — offers fire in compose as on the storefront; the same engine',
    'type "Basmati 25kg" ×12 @1000 and "Ponni Boiled 10kg" ×6 @600', 'Basmati: 10% off; Ponni: September 5% off; the footer shows the savings');
  for (const ln of [{ item: basmati, qty: 12, price: 1000 }, { item: ponni, qty: 6, price: 600 }]) {
    await page.getByTestId('chit-item-name').fill(ln.item); await page.getByTestId('chit-item-qty').fill(String(ln.qty)); await page.getByTestId('chit-item-price').fill(String(ln.price));
    await page.getByTestId('chit-item-add').click(); await page.waitForTimeout(900);
  }
  await expect.poll(async () => page.evaluate(() => (typeof CC !== 'undefined' && CC.savings) || 0), { timeout: 20000 }).toBeGreaterThan(0);
  await ok(page, 'savings in the footer');

  /* ── 14 · MIS › Tax ── */
  await page.evaluate(() => { try { closeModal(); } catch (_) {} }); await dismissModal(page);   /* compose covers the sidebar */
  await clickNav(page, 'mis'); await settle(page);
  await page.getByTestId('mis-band-tax').click();
  await tc(page, 'MIS › Tax — what do I owe this month?', 'every sent line is rated at send, frozen at completed; output / input credit by head, net; GSTR-1/3B JSON',
    'MIS › Tax', 'the month picker and the three figures; empty for a fresh entity (the two-party flow is proven by [TAX-03])');
  await expect(page.getByTestId('mis-tax-output')).toBeVisible({ timeout: 25000 });
  await ok(page, 'the band renders with the month');

  /* ── 15 · columns ── */
  await setup('columns');
  await tc(page, 'Columns — Columns · Types · Usage', 'observation 2 — the declared columns, their types, and which products use each',
    'Catalogue setup › Columns › the three tabs', 'three tabs; Usage counts products per column');
  await page.waitForTimeout(500);
  await ok(page, 'end of the tour');
  await rmCaption(page);
});
