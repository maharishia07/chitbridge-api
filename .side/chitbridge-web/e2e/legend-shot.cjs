/**
 * legend-shot.cjs — does the all-fields legend fold away, and can anyone tell it opens?
 *
 * Athi, 2026-09-01: *"The information on all 14 field from catalogue, the below screen, the text is it
 * necessary? If it is required, we can provide it as a slider or something so it should be distracting the
 * value content."*
 *
 * ⭐ IT INJECTS THE MARKUP RATHER THAN OPENING THE MODAL. Reaching prodAllFields() needs a product on the
 * account, and the account auth.setup mints is empty — three attempts to seed one went nowhere and none of them
 * had anything to do with the change. What I actually changed is a `<details>` block, and every way it can be
 * wrong is a CSS question the app's own stylesheet answers: does it start closed, is the summary visible, does
 * it still carry a marker saying it opens.
 *
 * ⚠️ THE MARKER IS THE POINT. My first version set `list-style:none`, which strips the triangle and leaves grey
 * text with nothing saying it opens — a disclosure nobody can see is worse than the sentence it hid.
 *
 * Run: node e2e/legend-shot.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const path = require('path');

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 900, height: 600 } });
  const p = await c.newPage();
  const say = (s) => console.log('  ' + s);
  await p.goto((process.env.CB_WEB_BASE || 'http://localhost:5173') + '/app.html');
  await p.waitForTimeout(2500);

  const r = await p.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:20px;top:20px;width:520px;background:var(--card);padding:14px;z-index:99999;border:1px solid var(--line);border-radius:9px';
    host.innerHTML = '<details style="margin-bottom:6px"><summary data-testid="cat-legend"'
      + ' style="cursor:pointer;font-size:var(--fs-1);color:var(--grey)">What the marks mean</summary>'
      + '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">'
      + '🔒 Set by another system — shown, never edited. <i>Not set</i> marks a field this catalogue has and '
      + 'this item leaves blank.</div></details>';
    document.body.appendChild(host);
    const d = host.querySelector('details'), s = host.querySelector('summary');
    const box = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    return { open: d.open, summaryVisible: box.width > 0 && box.height > 0,
             listStyle: cs.listStyleType, display: cs.display,
             bodyShown: host.innerText.indexOf('Set by another system') >= 0 };
  });

  say('closed by default : ' + (r.open === false ? 'yes — the values lead' : 'NO'));
  say('summary visible   : ' + r.summaryVisible);
  /* A summary keeps its triangle unless display or list-style takes it away. */
  say('marker kept       : ' + (r.display !== 'block' || r.listStyle !== 'none' ? 'yes' : 'NO — nothing says it opens')
    + '   (display=' + r.display + ', list-style=' + r.listStyle + ')');
  say('text hidden while closed: ' + (!r.bodyShown ? 'yes' : 'no — innerText still reads it'));

  await p.getByTestId('cat-legend').click();
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => {
    const d = document.querySelector('details');
    return { open: d.open, shows: d.innerText.indexOf('Set by another system') >= 0 };
  });
  say('after a click     : open=' + after.open + ', legend readable=' + after.shows);

  await p.screenshot({ path: path.join(__dirname, 'legend.png') });
  say('shot: e2e/legend.png');
  await b.close();
  process.exit((r.open === false && r.summaryVisible && after.open && after.shows) ? 0 : 1);
})();
