#!/usr/bin/env node
/**
 * e2e/list-fit-noise.cjs — a column is left out of a CBList only when the rest truly cannot fit (list-ctl.js fitWidths › need()).
 *
 * OWNS      the proof that float noise never costs a column: widths such as 107.6 + 90.8 summed to 1324.0000000000002 against an avail of 1324, so the
 *           Day book left its Risk column out when everything fitted once the stretch column gave up its overage (hygui 17 Nov, firm Day book at 1366).
 * Method    mount one list (Party stretches; Amount and Risk are header-limited fractions; Kind is the lowest priority) at every width in a sweep and, when
 *           Risk (prio 1, not keep) is out, require that the stretch column could NOT have given up Risk's width (rendered Party - Risk's width < its 240 px floor).
 * CALLED BY e2e/run-shard.cjs (list-*.cjs) · CARD 29-qa-test-tooling-ux-locale-and-design-system/list-control
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/list-fit-noise.cjs      (CBL_ROOT=<a copy of public/> to point it at another tree)
 */
'use strict';
const { chromium } = require('@playwright/test');
const { serve, PUBLIC } = require('./lib/serve.cjs');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  XX   ' + m); } };
const FLOOR = 242; /* list-ctl STRETCH_FLOOR_PX 240 + the list frame's 2 px */

(async () => {
  const S = await serve(process.env.CBL_ROOT || PUBLIC), b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1400, height: 800 }, serviceWorkers: 'block' })).newPage();
  await p.goto(S.url('/list-lab.html')); await p.waitForSelector('.cbl-row, .cbl-lrec');
  const EVS = ['No file', 'No source', 'File attached', 'No tax invoice', 'Awaiting upload', 'Invoice missing']; /* six evidence widths: each moves where the stretch column sits against the box, and so the float residue of the sum */
  const mk = (ev) => Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, entry: 'SV/2025-26/' + (1000 + i), party: 'demo: walk-in sales on a long enough line to hold the stretch ' + i, ev, amt: 'A$385.00', risk: String(i % 3), kind: 'Sales' }));
  const out = [];
  for (const ev of EVS) out.push(...await p.evaluate(async (data) => {
    const res = [], host = document.createElement('div');
    document.body.appendChild(host);
    const col = (key, label, extra) => Object.assign({ key, label, cell: (r) => r[key === 'amt' || key === 'risk' || key === 'kind' || key === 'party' || key === 'entry' ? key : key], value: (r) => r[key] }, extra);
    for (let W = 720; W <= 900; W++) {
      host.innerHTML = '<div id="fit' + W + '" style="width:' + W + 'px"></div>';
      const el = host.firstChild;
      const api = window.CBList.mount(el, {
        key: 'fit-noise-' + W, defaultCols: ['entry', 'party', 'ev', 'amt', 'risk', 'kind'], view: 'grid', rows: () => data, id: (r) => r.id, head: () => ({ title: 'Fit' }),
        columns: [col('entry', 'Entry', { prio: 1 }), col('party', 'Party', { prio: 1, stretch: true }), col('ev', 'Evidence', { prio: 1 }), col('amt', 'Amount', { prio: 1, num: true }), col('risk', 'Risk', { prio: 1, num: true }), col('kind', 'Kind', { prio: 2 })]
      });
      await new Promise((r) => setTimeout(r, 25));
      const heads = Array.from(el.querySelectorAll('.cbl-hdr [role=columnheader]')).map((h) => ({ t: h.textContent.replace(/[⇅▲▼]/g, '').trim(), w: h.getBoundingClientRect().width }));
      res.push({ W, heads });
      if (api && api.destroy) api.destroy();
    }
    return res;
  }, mk(ev)));
  if (process.env.FIT_DEBUG) out.filter((o, i) => i % 20 === 0).forEach((o) => console.log(o.W, o.heads.map((h) => h.t.slice(0, 6) + ':' + Math.round(h.w)).join(' ')));
  const seen = out.filter((o) => o.heads.length);
  ok(seen.length === out.length, 'every width drew a header (' + seen.length + '/' + out.length + ')');
  const bad = [];
  seen.forEach((o) => {
    const has = (n) => o.heads.some((h) => h.t.indexOf(n) === 0), party = o.heads.filter((h) => h.t.indexOf('Party') === 0)[0];
    if (!has('Risk') && has('Amount') && party && party.w - 90.8 >= FLOOR - 0.5) bad.push(o.W + 'px: Risk left out with Party at ' + Math.round(party.w));
  });
  ok(bad.length === 0, 'Risk is never left out while the stretch column could give up its width' + (bad.length ? ' — ' + bad.slice(0, 6).join('; ') : ''));
  ok(seen.some((o) => o.heads.some((h) => h.t.indexOf('Risk') === 0)) && seen.some((o) => !o.heads.some((h) => h.t.indexOf('Risk') === 0)), 'the sweep crosses the width where Risk goes (the proof is not vacuous)');
  await b.close(); S.close();
  console.log('\nlist-fit-noise: ' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
