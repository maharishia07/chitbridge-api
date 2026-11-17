/**
 * ord-41-attach-ui-wired.test.cjs — ORD-41 (proof 2026-11-14): attach-ui.js is wired into app.html as a plain script beside the cart.
 * OWNS      a static proof over public/app.html and public/app/attach-ui.js: the page loads /app/attach-ui.js exactly once, as a plain <script src> (not defer/async/module, so its
 *           cbAttach* functions exist before any later script uses them), AFTER /app/cart.js (the cart capability; cart-ui.js was folded into cart.js, so "beside cart-ui.js" is now
 *           "beside cart.js") and BEFORE the first use of any cbAttach* name in the page; the file it points at exists and defines the functions the page calls (cbAttachType, cbAttachList, cbAttachButton).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 *   node e2e/ord-41-attach-ui-wired.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(pub, 'app.html'), 'utf8');
const js = fs.existsSync(path.join(pub, 'app', 'attach-ui.js')) ? fs.readFileSync(path.join(pub, 'app', 'attach-ui.js'), 'utf8') : '';
let bad = 0;
const ok = (m, c, info) => { console.log((c ? '  ok   ' : '  FAIL ') + m + (c || !info ? '' : ' -> ' + info)); if (!c) bad++; };

const tags = html.match(/<script\b[^>]*src="\/app\/attach-ui\.js"[^>]*>/g) || [];
ok('app.html loads /app/attach-ui.js exactly once', tags.length === 1, String(tags.length));
ok('as a plain script: no defer, async or type=module', tags.length === 1 && !/\b(defer|async)\b|type="module"/.test(tags[0]), tags[0]);
const at = html.indexOf('src="/app/attach-ui.js"');
const cart = html.indexOf('src="/app/cart.js"');
ok('the cart script is loaded too, and attach-ui.js comes after it (beside the cart)', cart > 0 && at > cart, 'cart@' + cart + ' attach@' + at);
const live = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length)); /* same offsets, HTML comments blanked */
const firstUse = live.search(/\bcbAttach[A-Za-z]*\b/);
ok('attach-ui.js is loaded before the first mention of any cbAttach* name in the page', at > 0 && firstUse > at, 'tag@' + at + ' first use@' + firstUse);
ok('the file it points at exists and defines cbAttachType, cbAttachList and cbAttachButton',
  ['cbAttachType', 'cbAttachList', 'cbAttachButton'].every((n) => new RegExp('^function ' + n + '\\(', 'm').test(js)), String(js.length));
process.exitCode = bad ? 1 : 0;
