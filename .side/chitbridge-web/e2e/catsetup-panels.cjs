/**
 * catsetup-panels.cjs — every panel on the Catalogue setup hub renders something.
 *
 * ⚠️⚠️ WHY IT RENDERS INSTEAD OF NAVIGATING. The obvious version clicks through the rail and reads the pane —
 * and it STALLS: catsetSetSec triggers async loads (fields, face, adoptions), so a walk of ten panels outruns
 * any sane timeout and gets killed mid-loop. Its partial result then reads as a failure, which is exactly the
 * false alarm that produced this file. Rendering each body into a detached node applies the SAME renderer and
 * the SAME text extraction with no load race.
 *
 * ⭐ AND IT MEASURES TEXT, NOT MARKUP LENGTH. A panel can return a fat string of cards whose content is all
 * empty — the question is whether a reader sees anything, so innerText is the only honest measure.
 *
 * ⚠️ An async panel showing its own "reading…" placeholder is CONTENT, not a blank: it tells the reader
 * something is coming. A panel below the floor is one that says nothing at all.
 *
 * Run: node e2e/catsetup-panels.cjs        (exit 1 if any panel is blank or throws)
 */
const { chromium } = require('@playwright/test');
const { attachSession } = require('./session.cjs');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ storageState: path.join(__dirname, '.auth', 'user.json'), viewport: { width: 1280, height: 1000 } });
  /* ⚠️ storageState is keyed by ORIGIN and the API base is inherited — see session.cjs. Without this the page
     sits on the login screen, no lazy capability ever loads, and the failure reads as "CATSET_SECS is not
     defined", which looks like a broken screen and is really a probe that was never signed in. */
  await attachSession(c);
  const p = await c.newPage();
  const say = (s) => console.log('  ' + s);
  await p.goto((process.env.CB_WEB_BASE || 'http://localhost:5173') + '/app.html');
  await p.waitForTimeout(4500);
  await p.evaluate(() => navTo('catsetup'));
  await p.waitForTimeout(4000);
  const out = await p.evaluate(() => {
    const res = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    for (const s of CATSET_SECS) {
      let html = '', err = '';
      const was = CATSET.sec;
      try { CATSET.sec = s.key; html = catsetBody ? catsetBody(s.key) : ''; }
      catch (e) { err = e.message; }
      CATSET.sec = was;
      host.innerHTML = html || '';
      const t = (host.innerText || '').replace(/\s+/g, ' ').trim();
      res.push({ key: s.key, n: t.replace(/\s/g, '').length, err, head: t.slice(0, 66) });
    }
    host.remove();
    return res;
  });
  const thin = [];
  out.forEach((r) => {
    say(r.key.padEnd(12) + String(r.n).padStart(5) + ' chars   ' + (r.err ? 'THREW: ' + r.err : r.head));
    if (r.err || r.n < 40) thin.push(r.key + (r.err ? ' (threw)' : ''));
  });
  say(thin.length ? '  x THIN OR BLANK: ' + thin.join(', ') : '  + every panel renders content');
  await b.close();
  process.exit(thin.length ? 1 : 0);
})();
