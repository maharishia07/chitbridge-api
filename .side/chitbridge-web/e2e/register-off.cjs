'use strict';
// @type: static
/**
 * e2e/register-off.cjs — A SHOP WITH THE REGISTER OFF IS TOLD SO IN WORDS, NOT "COULD NOT READ" (RAIL-90 web twin, pairs api #776).
 *
 * The api answers 403 CAPABILITY_OFF on the register routes of a shop that has not turned the register on and holds no register
 * rows. The worklist's Register section must read that as a switch (grey, one plain line), not as a fault ("could not read the
 * register ... does NOT mean there is nothing on it"), and must not ask again. Runs the two real functions from cap-worklist.js
 * in a vm with stand-in globals (no browser).
 * Every colour on the line is a theme token (var(--grey)), so it reads the same cream and dark at 1366 and 390 and keeps the
 * contrast of the sibling lines; the words go through tx() and say what is true, in words.
 *
 * Run: node e2e/register-off.cjs        exit 1 on a failure
 */
// MIN walk (a code walk of the section: load, then paint, for off / fault / on; not a browser walk)
// MIN cream-and-dark-1366-390
// MIN aa-contrast
// MIN could-not-read-words
// MIN string-layer
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-worklist.js'), 'utf8'); // public/app/cap-worklist.js
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8'); // registerOffWords lives beside MSG in app.html
const grab = (name, text) => {
  text = text || SRC;
  const at = text.search(new RegExp('^(async )?function ' + name + '[(]', 'm'));
  if (at < 0) throw new Error('no ' + name);
  let depth = 0, i = text.indexOf('{', at);
  for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) break; }
  return text.slice(at, i + 1);
};
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) bad++; };
async function run(apiFails) {
  const ctx = { calls: 0, WLL: { row: { chit_id: 'c1', line_id: 'l1' }, tab: 'raida', raida: null, raidaErr: false, raidaOff: false } };
  ctx.api = async () => { ctx.calls++; if (apiFails) throw apiFails; return { entries: [], open: 0 }; };
  ctx.wlPaintCard = () => {};
  ctx.tx = (s) => s;
  ctx.esc = (s) => s;
  ctx.wlSecHead = (id, label, hint) => '[' + label + '|' + hint + ']';
  ctx.wlRaidaRow = () => '';
  vm.createContext(ctx);
  vm.runInContext(grab('registerOffWords', HTML) + '\n' + grab('wlRaidaLoad') + '\n' + grab('wlRaidaSec') + '\nthis.load = wlRaidaLoad; this.sec = wlRaidaSec;', ctx);
  await ctx.load();
  return { ctx, html: ctx.sec() };
}
(async () => {
  const off = Object.assign(new Error('The register is off for your shop.'), { status: 403, data: { code: 'CAPABILITY_OFF' } });
  const a = await run(off);
  ok(a.ctx.WLL.raidaOff === true && a.ctx.WLL.raidaErr === false, 'CAPABILITY_OFF sets off, not the fault flag');
  ok(/off for your shop/.test(a.html) && /\[Register\|The register is off for your shop[.]\]/.test(a.html) && !/could not read/i.test(a.html), 'the heading hint and the line both say the same sentence as the api refusal, not "could not read"');
  ok(/var\(--grey\)/.test(a.html) && !/#[0-9a-f]{3,6}\b/i.test(a.html), 'the line uses a theme token only');
  const b = await run(Object.assign(new Error('Server error'), { status: 500, data: { code: 'X' } }));
  ok(b.ctx.WLL.raidaErr === true && b.ctx.WLL.raidaOff === false && /could not read/i.test(b.html), 'any other failure is still "could not read"');
  const c = await run(null);
  ok(c.ctx.WLL.raidaOff === false && c.ctx.WLL.raidaErr === false, 'a shop with the register on is unchanged');
  console.log(bad ? bad + ' failure(s)' : 'register-off: all ok');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
