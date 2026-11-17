// LIGHTHOUSE / CLS (reviewer §5) — quantify cumulative-layout-shift (CLS) + performance per key screen. "Screen slips
// away" during load is usually high CLS (content jumping as it loads); Lighthouse measures it. Flags high-CLS screens.
//   Run:  node lighthouse-check.js       (needs the app up + a Chrome install; uses the local `lighthouse` via npx)
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.CB_WEB_BASE || 'https://chitbridge-web.vercel.app';
const SCREENS = [
  { name: 'entry (app.html)',     url: BASE + '/app.html' },
  { name: 'storefront (shop.html)', url: BASE + '/shop.html' },
];

let bad = 0;
for (const s of SCREENS) {
  const out = path.join(os.tmpdir(), `lh-${Date.now()}.json`);
  try {
    execSync(`npx --yes lighthouse "${s.url}" --quiet --chrome-flags="--headless=new" --only-categories=performance --output=json --output-path="${out}"`, { stdio: 'ignore' });
    const lhr = JSON.parse(fs.readFileSync(out, 'utf8'));
    const cls = lhr.audits['cumulative-layout-shift'].numericValue;
    const perf = Math.round((lhr.categories.performance.score || 0) * 100);
    const lcp = lhr.audits['largest-contentful-paint'].displayValue;
    const high = cls > 0.1;                                  // Google's "needs improvement" threshold
    if (high) bad++;
    console.log(`${s.name}: CLS=${cls.toFixed(3)} ${high ? '⚠ HIGH — screen jumps on load' : 'ok'} · perf=${perf} · LCP=${lcp}`);
  } catch (e) {
    console.log(`${s.name}: lighthouse failed — ${String(e.message).slice(0, 90)}`);
  } finally { try { fs.unlinkSync(out); } catch (e) {} }
}
process.exit(bad ? 1 : 0);
