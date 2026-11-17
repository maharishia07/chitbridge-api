/* till-modes.cjs — Do the three modes actually work in a browser? (2026-09-08)
 * The arithmetic and the rules are unit-tested outside a browser (tests/till-vendor.test.js). This is the other half: the menu
 * switches, each pane appears, the search box changes what it means, and the two new screens paint without throwing.
 * No key and no shop — the point is the wiring, not the data.
 * Run: node e2e/till-modes.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const WEB = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ baseURL: WEB });
  const threw = [];
  p.on('pageerror', (e) => threw.push(e.message));
  await p.goto('/till.html');
  await p.waitForFunction(() => typeof window.setMode === 'function' && !!window.CBSearch, null, { timeout: 30000 });

  /**
   * ── ⚠️⚠️ THIS ASSERTION WAS MOVED, NOT DELETED (2026-09-16) ────────────────────────────────────────────────
   *
   * It read `[data-testid="till-mode-<m>"]).className === 'on'` — THREE BUTTONS, one lit. On 2026-09-09 the
   * three became one dropdown (Athi: *"sell, receive, despatch can be in a dropdown box"*), and this guard was
   * written the day before. It has thrown `Cannot read properties of null` on every run since, inside a suite
   * with other reds, where a genuine regression is indistinguishable from stale tooling.
   *
   * ⭐ THE QUESTION IT ASKS IS STILL THE RIGHT ONE — does choosing a mode actually switch the screen? — so the
   * question stays and only the control changes: the select now carries the answer, and it is DRIVEN rather
   * than read, so this proves the wiring a person uses and not a function call. [[feedback-probe-through-the-gate]]
   */
  for (const mode of ['sell', 'receive', 'despatch']) {
    await p.selectOption('[data-testid="till-mode"]', mode);
    const r = await p.evaluate((m) => {
      const sel = document.querySelector('[data-testid="till-mode"]');
      const shown = ['sell', 'receive', 'despatch'].filter((k) => document.getElementById('pane_' + k).style.display !== 'none');
      return { lit: sel ? sel.value : null, shown, placeholder: document.getElementById('q').placeholder, keys: document.getElementById('keys').innerText.replace(/\s+/g, ' ') };
    }, mode);
    const ok = r.lit === mode && r.shown.length === 1 && r.shown[0] === mode;
    console.log((ok ? '  ok   ' : '  FAIL ') + mode.padEnd(9) + '· pane ' + r.shown.join(',') + ' · "' + r.placeholder.slice(0, 44) + '"');
    console.log('         keys: ' + r.keys.slice(0, 110));
  }

  /* receiving: count something that was never ordered, and see the money add up */
  const rcv = await p.evaluate(() => {
    setMode('receive');
    RCV = rcvBlank();
    rcvAdd({ item_id: 'i1', name: 'Toor dal 1 kg', unit: 'kg', price: 126 }, 25);
    rcvAdd({ item_id: 'i2', name: 'Ponni rice 25 kg', unit: 'bag', price: 1180 }, 40);
    RCV.costs.freight = 2000;
    paintReceive();
    const landed = rcvLanded();
    return { rows: document.querySelectorAll('[data-testid^="rcv-line-"]').length,
             goods: rcvGoods(), extras: rcvExtras(),
             shares: landed.map((x) => x.share), sum: document.getElementById('rcv_sum').innerText.replace(/\s+/g, ' ') };
  });
  console.log('  receive · ' + rcv.rows + ' line(s) · goods ₹' + rcv.goods + ' · freight split ' + rcv.shares.join(' + ') + ' = ' + rcv.shares.reduce((a, c) => a + c, 0));
  console.log('         ' + rcv.sum);

  /* despatch: a scan for something not on the order must be refused */
  const dsp = await p.evaluate(() => {
    setMode('despatch');
    let said = '';
    window.alert = (m) => { said = m; };
    DSP = { task: { chit_id: 'c-1', party: 'Chola Auto Care' }, ref: '', weight: null, carton: 1,
            lines: [{ line_id: 'L1', item_id: 'i9', name: 'Brake pad set', unit: 'set', ordered: 12, picked: 0, reason: '', carton: 1 }] };
    dspScan({ item_id: 'i9', name: 'Brake pad set' }, 12);
    const afterGood = DSP.lines[0].picked;
    dspScan({ item_id: 'iX', name: 'Engine oil' }, 1);
    paintDespatch();
    return { afterGood, lines: DSP.lines.length, said, sum: document.getElementById('dsp_sum').innerText.replace(/\s+/g, ' ') };
  });
  console.log('  despatch · picked ' + dsp.afterGood + '/12 · lines still ' + dsp.lines + ' · ' + dsp.sum);
  console.log('         refused: ' + dsp.said.split('\n')[0]);

  console.log(threw.length ? 'THREW: ' + threw.join(' | ') : 'no errors on the page');
  await b.close();
  process.exit(threw.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
