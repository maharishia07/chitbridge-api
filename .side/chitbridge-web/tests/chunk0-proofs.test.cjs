/**
 * tests/chunk0-proofs.test.cjs — Chunk 0 proofs for six web lines that were "done" with no test behind them.
 * NET-18 uploads run one after another (attach-ui.js) · NET-20 no window.confirm fallback (cap-network.js) · NET-24 no FX table (shop.html)
 * OPS-52 ruleMove places against the full list (cap-folders.js) · OPS-53 empty requirement list = no usable list (app.html supRequiredScope)
 * OPS-54 a standard is met when any one of its documents is met (same function).
 * Source-reading + function extraction, no browser. Run: node tests/chunk0-proofs.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const fnText = (src, head) => { // one top-level function, from its head to the first line that is just "}"
  const i = src.indexOf(head); assert(i >= 0, 'function not found: ' + head);
  const j = src.indexOf('\n}\n', i); assert(j > i, 'function end not found: ' + head);
  return src.slice(i, j + 3);
};
let n = 0; const jobs = []; const ok = (name, f) => { jobs.push(Promise.resolve().then(f).then(() => { n++; console.log("ok - " + name); })); };

ok('NET-18 attach-ui uploads sequentially: the upload loop awaits each file and nothing uses Promise.all', () => {
  const code = noComments(read('app/attach-ui.js'));
  assert(!/Promise\s*\.\s*all/.test(code), 'Promise.all found in attach-ui.js');
  assert(/for\s*\(var index = 0; index < list\.length; index\+\+\)[\s\S]*?await api\(cbAttachEP\(\)/.test(code), 'the upload loop must await api() inside the for');
});

ok('NET-20 cap-network has no window.confirm / bare confirm( fallback (confirmAsk only)', () => {
  const code = noComments(read('app/cap-network.js'));
  assert(!/window\s*\.\s*confirm\b/.test(code), 'window.confirm found');
  assert(!/(^|[^\w.$])confirm\s*\(/.test(code), 'a bare confirm( call found');
  assert(/confirmAsk\(/.test(code), 'confirmAsk is the one ask');
});

ok('NET-24 shop.html carries no FX table (no rate map, no price multiplied by a rate)', () => {
  const code = noComments(read('shop.html'));
  assert(!/\b(FX|FX_RATES|FX_TABLE|fxTable|fxRates|RATES)\b\s*[=:]/.test(code), 'an FX/rates table is declared');
  assert(!/\b(USD|EUR|GBP|AED|AUD|SGD)\s*:\s*\d+(\.\d+)?\s*,\s*(USD|EUR|GBP|AED|AUD|SGD|INR)\s*:/.test(code), 'a currency-to-number map found');
  assert(/NO FX TABLE/.test(read('shop.html')), 'the deletion note should stay');
});

ok('OPS-52 ruleMove places against the full entity-wide list, from a filtered list too', async () => {
  const src = read('app/cap-folders.js');
  const ctx = { writes: [], _FLD: { rules: [{ rule_id: 'b' }, { rule_id: 'd' }], busy: false, err: '' } };
  // the visible list is the folder's: b, d. The entity-wide list is a b c d e (sort = position, all 0 on legacy data would also work).
  ctx._fullList = () => ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ rule_id: id, sort: i }));
  ctx._allRulesForSort = async () => ctx._fullList();
  ctx._fldPaint = () => {}; ctx.loadFolderRules = async () => {};
  ctx.api = async (name, o) => { ctx.writes.push([o.params.rule_id, o.body.sort]); };
  vm.createContext(ctx); vm.runInContext(fnText(src, 'async function ruleMove('), ctx);
  await vm.runInContext('ruleMove("d", -1)', ctx); // d moves above its VISIBLE neighbour b: full order a d b c e
  assert.strictEqual(ctx._FLD.err, '', ctx._FLD.err);
  const final = ctx._fullList(); ctx.writes.forEach(([id, s]) => { final.find((r) => r.rule_id === id).sort = s; });
  assert.deepStrictEqual(final.sort((x, y) => x.sort - y.sort).map((r) => r.rule_id), ['a', 'd', 'b', 'c', 'e']);
  assert.deepStrictEqual(ctx.writes.map((w) => w[0]).sort(), ['b', 'c', 'd'], 'only rows whose sort changed are written');
  assert(!ctx.writes.some(([id]) => id === 'a' || id === 'e'), 'a and e are untouched');
  // and downwards: b moves below its VISIBLE neighbour d (c sits between them in the full list): full order a c d b e
  ctx.writes.length = 0; ctx._FLD.rules = [{ rule_id: 'b' }, { rule_id: 'd' }];
  await vm.runInContext('ruleMove("b", 1)', ctx);
  const down = ctx._fullList(); ctx.writes.forEach(([id, s2]) => { down.find((r) => r.rule_id === id).sort = s2; });
  assert.deepStrictEqual(down.sort((x, y) => x.sort - y.sort).map((r) => r.rule_id), ['a', 'c', 'd', 'b', 'e']);
});

// OPS-53 / OPS-54: supRequiredScope extracted from app.html
const scopeSrc = fnText(read('app.html'), 'function supRequiredScope(');
const scope = (req, rd) => { const c = { _REQ: req }; vm.createContext(c); vm.runInContext(scopeSrc, c); return c.supRequiredScope(rd); };
const rd = (rows) => ({ clearances: rows });
ok('OPS-53 a published requirement with nothing ticked is "no usable list" (null), never "has all 0"', () => {
  assert.strictEqual(scope([], rd([{ standard: 'gst', status: 'gathered' }])), null, 'empty list');
  assert.strictEqual(scope(null, rd([])), null, 'not loaded');
  assert.strictEqual(scope(['gst'], null), null, 'no readiness data');
});
ok('OPS-54 a standard is met when ANY one of its documents is met; need/met/missing add up', () => {
  const r = scope(['fssai', 'gst', 'iso'], rd([
    { standard: 'fssai', status: 'missing' }, { standard: 'fssai', status: 'gathered' },   // one doc met = standard met
    { standard: 'gst', status: 'missing' }, { standard: 'gst', status: 'missing' },         // none met = short
    { standard: 'iso', status: 'expiring' }]));                                             // expiring still counts as met
  assert.deepStrictEqual({ need: r.need, met: r.met, missing: r.missing }, { need: 3, met: 2, missing: ['gst'] });
  const flip = scope(['fssai'], rd([{ standard: 'fssai', status: 'gathered' }, { standard: 'fssai', status: 'missing' }]));
  assert.strictEqual(flip.met, 1, 'row order must not matter');
});
Promise.all(jobs).then(() => console.log(n + ' passed'), (e) => { console.error('FAIL', e.message); process.exit(1); });
