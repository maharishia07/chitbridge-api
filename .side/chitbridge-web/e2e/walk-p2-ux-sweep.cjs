/* walk-p2-ux-sweep.cjs - THE P2 UX SWEEP OF 12 NOV: ORD-75 · OPS-101 · PPL-32 (axe) · ORD-1 (open order) · CRM-2 (Nothing yet)
 *
 * OWNS       the proof of five small screen fixes: axe (every rule, the sweep's own) finds no color-contrast and no label-title-only on Rail Task/Order
 *            (RAL002/RAL003), Business Suppliers (BUS002) and Co-assists (BUS005) in the light theme at 1366x768 and 390x844, none of the four scrolls
 *            the page, the Co-assists sort box is reached by Tab with its name; an open order no bill names (order_billed:false) says "Not billed yet"
 *            while an issued bill with no figures still says the red error; a customer with no bill reads "Nothing yet", one with a bill still "Settled".
 * TOUCHES    public/app/cap-workforce.js (Co-assists sort name and the coming-soon filter ink), public/app/cap-crm.js, public/app/cap-chit2.js, public/app.html:
 *            a control axe could not name, or a figure the page could not read, is said in words, never by colour or a title alone.
 * CALLED BY  run-shard (walk-*), node e2e/walk-p2-ux-sweep.cjs
 * CARD       none yet (a function card is the librarian's to cut)
 * Run: NODE_PATH=$PWD/e2e/node_modules node e2e/walk-p2-ux-sweep.cjs   (PM/P2-NEXT-2026-11-12.md lane 3; the dark theme's shell-wide findings are not in these ids)
 * A FIXTURE shop: the site is served from this checkout, the API is a stand-in answering inside the page.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const A = require('./lib/a11y-check.cjs');
const PUB = path.join(__dirname, '..', 'public');
const SCREENS = [['task', 'RAL002 Rail Task'], ['order', 'RAL003 Rail Order'], ['suppliers', 'BUS002 Suppliers'], ['coassists', 'BUS005 Co-assists']];
const SIZES = [[1366, 768], [390, 844]];
const RULES = ['color-contrast', 'label-title-only'];
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

/** the source text of one top-level function, found by name and cut at its closing brace */
function cutFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('no function ' + name);
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return src.slice(at, i + 1);
}

/** crmDueCell with a stand-in page around it: the real function, the real words */
function dueCell(party) {
  const src = read('app/cap-crm.js');
  const box = { CRM: { ledger: true, currency: 'INR' }, esc: (s) => String(s), tx: (s) => s, bkMoney: (n) => String(n), bkDate: (d) => d, out: '', P: party };
  vm.runInNewContext(cutFn(src, 'crmNothingDueCell') + cutFn(src, 'crmDueCell') + ';out = crmDueCell(P);', box);
  return box.out;
}

const walk = async (w) => {
  const { ctx, base } = w;
  await ctx.route('**/api/**', async (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/api/entities/me') return C.json(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR', country_code: 'IN' } });
    return C.json(r, 200, {});
  });
  const open = async (width, height) => {
    await w.page.setViewportSize({ width, height });
    await w.page.addInitScript((s) => { try { localStorage.removeItem('cb_vp'); localStorage.setItem('cb_theme', 'light'); localStorage.setItem('cb_sess', s); localStorage.setItem('cb_ids', '1'); } catch (_) { /* a blocked store: the defaults are walked */ } }, W.session('Fixture Owner', 'Fixture Shop'));
    await w.page.goto(base + '/app.html?t=' + Date.now() + '#/', { waitUntil: 'load' });   // clock-ok: cache-buster in the URL, not a business date
    await w.page.waitForSelector('[data-testid^="nav-"]', { state: 'attached', timeout: 15000 });
    await w.page.waitForTimeout(500);
  };
  /** every axe rule (not only the WCAG tags) on the open screen: the violations named in RULES, with the element */
  const axeRules = async () => {
    if ((await w.page.evaluate(() => typeof window.axe)) === 'undefined') await w.page.evaluate(A.source().src);
    const all = await w.page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => String(n.target)) })));
    return all.filter((v) => RULES.includes(v.id));
  };

  for (const [width, height] of SIZES) {
    await open(width, height);
    for (const [nav, label] of SCREENS) {
      await w.step('A-' + nav + '-' + width, label + ' @' + width + ': no color-contrast, no label-title-only, the page does not scroll', async () => {
        await w.page.evaluate((k) => navTo(k), nav);
        await w.page.waitForTimeout(800);
        const bad = await axeRules();
        const over = await w.page.evaluate(() => ({ y: document.documentElement.scrollHeight - window.innerHeight, x: document.documentElement.scrollWidth - window.innerWidth }));
        return { ok: !bad.length && over.y <= 0 && over.x <= 0, saw: JSON.stringify({ bad, over }) };
      });
    }
    await w.step('K-sort-' + width, 'Co-assists @' + width + ': Tab reaches the sort box and it is named (aria-label), the keyboard pass for PPL-32', async () => {
      await w.page.evaluate(() => navTo('coassists'));
      await w.page.waitForSelector('[data-testid="coassist-sort"]', { timeout: 10000 });
      await w.page.focus('button[onclick^="setAcTypeF"]:last-of-type'); /* the type filter's last button; the count after it is a plain span */
      await w.page.keyboard.press('Tab');
      const got = await w.page.evaluate(() => { const a = document.activeElement; return { tid: a.getAttribute('data-testid'), name: a.getAttribute('aria-label') }; });
      return { ok: got.tid === 'coassist-sort' && /sort/i.test(got.name || ''), saw: JSON.stringify(got) };
    });
  }

  await w.step('S-src', 'PPL-32 / ORD-1: the Co-assists sort box carries aria-label, the coming-soon filter is not dimmed by opacity, the Order tab hands order_billed on', async () => {
    const workforce = read('app/cap-workforce.js'), chit2 = read('app/cap-chit2.js');
    const sortNamed = /data-testid="coassist-sort" aria-label="/.test(workforce);
    const dimmed = workforce.includes("comingSoon ? ';opacity") || !workforce.includes('aria-disabled="true"');
    const carried = /frozenMoneyHTML\(\s*\{[^}]*order_billed: d\.order_billed/.test(chit2);
    return { ok: sortNamed && !dimmed && carried, saw: JSON.stringify({ sortNamed, dimmed, carried }) };
  });

  await w.step('O-1', 'ORD-1: an open order no bill names says "Not billed yet" (neutral); an issued bill with no figures keeps the red error', async () => {
    await open(1366, 768);
    const got = await w.page.evaluate((issuedAt) => {
      const html = (c) => frozenMoneyHTML(Object.assign({ issued_at: issuedAt, currency: 'INR' }, c), 'w', 't');
      return { open: html({ order_billed: false }), billed: html({ order_billed: true }), plain: html({}) };
    }, W.nowIso());
    const neutral = /data-testid="chit-money-unbilled"/.test(got.open) && /Not billed yet/.test(got.open) && !/class="err"/.test(got.open);
    const stillRed = /chit-money-error/.test(got.billed) && /chit-money-error/.test(got.plain);
    return { ok: neutral && stillRed, saw: JSON.stringify({ neutral, stillRed }) };
  });

  await w.step('C-2', 'CRM-2: a customer with no bill reads "Nothing yet"; one with a bill reads Settled; a supplier is not guessed', async () => {
    const base0 = { party_id: 'p1', balance_minor: 0, customer: {}, supplier: null };
    const none = dueCell(Object.assign({ txn_count: 0 }, base0));
    const paid = dueCell(Object.assign({ txn_count: 3 }, base0));
    const supplier = dueCell(Object.assign({ txn_count: 0 }, base0, { supplier: {} }));
    const owed = dueCell(Object.assign({ txn_count: 0 }, base0, { balance_minor: 500 }));
    const ok = /Nothing yet/.test(none) && !/Settled/.test(none) && /Settled/.test(paid) && /Settled/.test(supplier) && /get/.test(owed) && /data-testid="party-due-p1"/.test(none);
    return { ok, saw: JSON.stringify({ none, paid, supplier }) };
  });
};
walk.opts = { viewport: { width: 1366, height: 768 } };
W.run('p2-ux-sweep', walk);
