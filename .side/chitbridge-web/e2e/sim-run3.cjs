/* sim-run3.cjs — A DAY AT desktop3, WORKED AS A PERSON WOULD ([TILL-129])
 *
 * Athi: *"sign-in as entity, do the start of the day ritual, change the billing seq to julian date. then create
 * couple of bills. then sign-out. sign-in as coassist a, do couple of bills, then sign-out, sign-in as coassist
 * b, do couple of bills, then sign-out. then login as entity, do couple of bills, check todays sale."*
 *
 * Every product goes on the bill by typing its name and pressing Enter, every sale is taken with Pay → Cash →
 * F9, and every change of person goes through the dialog a shopkeeper opens with F7. Nothing calls an API.
 *
 * Run: node e2e/sim-run3.cjs        (the counter must be up on 7351)
 */
'use strict';
const { chromium } = require('@playwright/test');
const fs = require('fs');

const TILL = 'http://127.0.0.1:7351';
const HOME = 'C:/dev/counter-sim/desktop3';
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(26) + '\u00b7 ' + d + '  ' + (ok ? 'OK' : (bad++, '\u2717 FAILED'))); };
const step = (t) => console.log('\n\u2500\u2500 ' + t + ' ' + '\u2500'.repeat(Math.max(4, 56 - t.length)));

/**
 * ⚠️⚠️ THE COUNTER ASKS ITS OWN QUESTIONS. ask() opens #askdlg — the page's own alert, confirm and prompt in one
 * box — not a browser dialog, so page.on('dialog') never fires and a script just waits for a prompt that is
 * already on screen. The drawer-float question at the start of a shift is the first one it hits.
 */
async function answerAny(p, v) {
  if (!(await p.locator('#askdlg[open]').count())) return false;
  const inp = p.locator('[data-testid="till-ask-input"]');
  if (await inp.isVisible().catch(() => false)) await inp.fill(String(v == null ? '' : v));
  await p.locator('[data-testid="till-ask-ok"]').click({ timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(400);
  return true;
}

/**
 * ── ⭐ RING UP A BILL BY TYPING, WHICH IS WHAT THE SCREEN INVITES ───────────────────────────────────────────
 *
 * ⚠️ THE ROW-LEVEL ADD BUTTONS (till-add-N) ONLY EXIST IN THE LIST, IN SELL MODE. A counter showing quick keys
 * — which is what desktop3 opens on, with photographs — has none of them, so the first version of this clicked
 * nothing and then waited for a Pay button that could never appear.
 * ⭐ The search box states the method on its own placeholder: "Item name, code or barcode… ↓↑ to choose, Enter
 * to add". Typing is both the most human path and the one that works in every view.
 */
async function bill(p, names, note) {
  for (const nm of names) {
    await p.locator('#q').click();
    await p.locator('#q').fill(nm);
    await p.waitForTimeout(650);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(700);
    await answerAny(p);
  }
  const lines = await p.evaluate(() => (window.CART || []).length);
  if (!lines) { console.log('    (nothing went on the bill for ' + JSON.stringify(names) + ')'); return null; }

  /**
   * ⚠⚠ TWO LAYOUTS, TWO WAYS TO TAKE MONEY. The pay CARD (till-paygo) appears only when payAsCard() is on;
   * the keyboard TERMINAL — which is what a desktop counter opens on — has no Pay button at all: the tenders
   * sit on screen and "Save & print · F9" ends the sale. Assuming the card is why this waited ten seconds for
   * a button that was never going to exist.
   */
  const card = await p.locator('[data-testid="till-paygo"]').count();
  if (card) { await p.locator('[data-testid="till-paygo"]').click({ timeout: 8000 }); await p.waitForTimeout(800); }
  await p.locator('[data-testid="till-pay-cash"]').click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(400);
  /* ⭐ the same key the footer advertises — and the button, if the key does not land */
  await p.keyboard.press('F9');
  await p.waitForTimeout(1500);
  if (await p.evaluate(() => (window.CART || []).length)) await p.locator('#save').click({ timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(1600);
  await answerAny(p);
  await p.waitForTimeout(900);
  /**
   * ⚠⚠ THE SLIP STAYS ON SCREEN AFTER A SALE, and it is modal — the next customer cannot be started until
   * somebody closes it. Playwright reported it exactly: "<dialog open id=slipdlg> intercepts pointer events".
   * A person closes it; so does this.
   */
  if (await p.locator('#slipdlg[open]').count()) {
    await p.getByRole('button', { name: 'Close' }).last().click({ timeout: 4000 }).catch(async () => {
      await p.evaluate(() => { const d = document.getElementById('slipdlg'); if (d && d.open) d.close(); });
    });
    await p.waitForTimeout(700);
  }
  const last = await p.evaluate(() => (window.LAST && window.LAST.no) || null);
  console.log('    ' + String(note || '').padEnd(10) + ' bill ' + String(last || '?').padEnd(20) + '(' + lines + ' line(s))');
  return last;
}

(async () => {
  const b = await chromium.launch({ headless: false, slowMo: 110 });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();

  /** sign a person in through the dialog a shopkeeper opens with F7, and answer the float question */
  const signIn = async (testid, label) => {
    await p.evaluate(() => window.openWho());
    await p.waitForTimeout(800);
    await p.locator(testid).click({ timeout: 8000 });
    await p.waitForTimeout(800);
    await answerAny(p, 0);
    await p.waitForTimeout(900);
    const w = await p.evaluate(() => window.WHO);
    say('signed in', !!(w && w.name), label + ' \u2014 ' + JSON.stringify(w && { name: w.name, kind: w.kind }));
    return w;
  };

  await p.goto(TILL);
  await p.waitForFunction(() => typeof window.shopReady === 'function', null, { timeout: 30000 });
  await p.waitForTimeout(1500);

  step('the shop');
  const items = await p.evaluate(() => ((window.S && window.S.items) || []).length);
  say('products', items > 0, items + ' on the counter');

  step('who is at the counter \u2014 the SHOP itself');
  await signIn('[data-testid="till-who-entity"]', 'desktop3');

  step('the start-of-day ritual');
  await p.evaluate(() => { try { menuSection('day'); } catch (_) {} });
  await p.waitForTimeout(1300);
  const dayBtn = await p.locator('[data-testid="till-day-begin"]').count();
  if (dayBtn) await p.locator('[data-testid="till-day-begin"]').click({ timeout: 8000 });
  else { console.log('    (Open-the-day was not on screen \u2014 calling beginDay directly)');
         await p.evaluate(() => { try { beginDay(); } catch (_) {} }); }
  await p.waitForTimeout(1400);
  say('day opened', await p.evaluate(() => window.dayOpened && window.dayOpened()), 'the counter is marked open for today');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);

  step('the bill series \u2014 julian dating');
  await p.evaluate(() => { try { openSettings('device'); } catch (_) {} });
  await p.waitForTimeout(1300);
  await p.locator('[data-testid="till-set-dating"]').selectOption('julian').catch(() => {});
  await p.waitForTimeout(1600);
  await p.evaluate(() => { try { setClose(); } catch (_) {} });
  await p.waitForTimeout(700);
  /**
   * ── ⚠️⚠️⚠️ THIS CHECK USED TO BE `say('julian', true, …)` ([TILL-175]) ──────────────────────────────
   *
   * Athi: *"julian dating did not take, and the check was weak — the harness reported 'julian OK' from the
   * fact that the option had been SELECTED, not from the number that came out. Assert the EMITTED number."*
   *
   * He was right about the check and half right about the cause. The setting is not ignored: a scheme is
   * stored ON the series and adopted at the next roll, because renumbering mid-run leaves a hole in a series
   * a shop may have to show a tax officer. A series that has issued NOTHING adopts it at once.
   *
   * ⭐ SO THE HARNESS NOW ASKS THE NUMBERER, and accepts either honest answer — adopted now, or deferred and
   * SAYING so. What it will not accept is a claim with nothing behind it.
   */
  /**
   * ⚠️⚠️ AND THE PROBE MUST NOT MINT ONE. My first version called nextNumber('sale'), which CONSUMES a bill
   * number and persists it — a test that burns a number out of a shop's legal series to satisfy itself is a
   * worse fault than the one it was written to catch. It asks the same engine for the same period key that
   * the numberer would use, and touches nothing.
   */
  const ser = await p.evaluate(async () => {
    const scheme = (typeof tillScheme === 'function') ? tillScheme() : null;
    let had = null; try { had = await DB.get('series'); } catch (_) {}
    const eff = (had && Number(had.next) > 1 && had.scheme) ? had.scheme : scheme;
    let key = null;
    try {
      key = window.CBDoc && window.CBDoc.periodKey
        ? window.CBDoc.periodKey({ country: (typeof country !== 'undefined' ? country : 'IN'), at: new Date(), scheme: eff })
        : null;
    } catch (_) {}
    return { chose: scheme && scheme.dating, effective: eff && eff.dating, key: key,
             issued: had ? Number(had.next) : 1,
             when: (typeof schemeTakesEffect === 'function') ? await schemeTakesEffect() : null };
  });
  /* a julian period is the day of the year (5 digits: 2-digit year + 3-digit day); an FY period is "26-27" */
  const isJulian = /^\d{5}$/.test(String(ser.key || ''));
  const deferred = ser.effective !== 'julian' && /next reset/.test(String(ser.when || ''));
  say('julian', ser.chose === 'julian' && (isJulian || deferred),
    isJulian ? ('the next number would carry the julian day: ' + ser.key)
             : (deferred ? ('held mid-run (issued ' + ser.issued + ') and says so: ' + ser.when)
                         : ('⚠️ chosen, but the period is still ' + ser.key + ' and nothing says why')));

  step('two bills as the shop');
  await bill(p, ['Idli', 'Dosa'], 'desktop3');
  await bill(p, ['Vada'], 'desktop3');

  /**
   * ⚠️ HANDING OVER IS HOW A PERSON LEAVES, and signing the next one in is what makes "who took the money"
   * answerable afterwards — the entire reason the person is recorded at all.
   */
  const ids = await p.evaluate(() => ((window.S && window.S.staff) || []).map((x) => ({ id: x.id, name: x.name })));
  console.log('\n    staff on this counter: ' + JSON.stringify(ids.map((x) => x.name)));
  const anita = ids.find((x) => /anita/i.test(x.name));
  const bala = ids.find((x) => /bala/i.test(x.name));

  step('over to Anita');
  if (anita) {
    await signIn('[data-testid="till-who-' + anita.id + '"]', 'Anita');
    await bill(p, ['Idli'], 'Anita');
    await bill(p, ['Pongal', 'Dosa'], 'Anita');
  } else { say('Anita', false, 'not in the staff list'); }

  step('over to Bala');
  if (bala) {
    await signIn('[data-testid="till-who-' + bala.id + '"]', 'Bala');
    await bill(p, ['Vada'], 'Bala');
    await bill(p, ['Dosa'], 'Bala');
  } else { say('Bala', false, 'not in the staff list'); }

  step('back to the shop itself');
  await signIn('[data-testid="till-who-entity"]', 'desktop3');
  await bill(p, ['Idli'], 'desktop3');
  await bill(p, ['Vada', 'Dosa'], 'desktop3');

  step("today's sale");
  const after = await p.evaluate(() => fetch('/api/state').then((r) => r.json()));
  say('the day', (after.today && after.today.count) > 0, JSON.stringify(after.today));

  /* ⭐ who took what — the whole reason the person is recorded */
  const byWho = await p.evaluate(() => fetch('/api/bills').then((r) => r.json()).then((j) => (j.bills || []).map((x) => ({
    no: x.no, total: x.total, by: (x.by && x.by.name) || 'nobody', kind: (x.by && x.by.kind) || '-' }))));
  console.log('\n  the day, bill by bill:');
  for (const x of byWho.slice().reverse()) {
    console.log('    ' + String(x.no).padEnd(22) + String(x.by).padEnd(12) + String(x.kind).padEnd(10) + x.total);
  }
  say('every bill attributed', byWho.length > 0 && byWho.every((x) => x.by !== 'nobody'),
    byWho.length + ' bill(s), none anonymous');

  fs.writeFileSync(HOME + '/sim-run.json', JSON.stringify({ today: after.today, bills: byWho, folder: after.folder }, null, 2));
  await p.screenshot({ path: 'C:/dev/chitbridge-web/png/sim-run3.png' });
  await b.close();
  console.log('\n' + (bad ? '\u2717 ' + bad + ' FAILED\n' : '\u2713 the day is done\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('\n\u2717 broke:\n' + (e && e.stack || e)); process.exit(1); });
