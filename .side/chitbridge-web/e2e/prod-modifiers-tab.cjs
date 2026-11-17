/* prod-modifiers-tab.cjs — THE MODIFIERS TAB IS A THIN PAINT OVER A CAPABILITY, NOT A SECOND OPINION
 * (design's own reasoning: "no onion", extra cheese, spice level, half/full — [TILL-33])
 *
 * ⚠️⚠️⚠️ THIS DOES NOT MINT AN ENTITY OR SIGN IN. app.html's product page needs a live catalogue to open for
 * real, but prodModifiersTab()/prodModGroups() take a plain item_data object and CBVariant — nothing about
 * UI.prods, a session or a network call — so this proves the RENDER side offline, the same way
 * tests/variant.test.js already proves the ENGINE side offline. The mutator/save half (prodModAddGroup and
 * friends, which do touch UI.prods and call api()) is exercised here too, with api() stubbed to behave like
 * the real merge:true endpoint (routes/products.js PATCH /:id) without a server.
 *
 * Run: node e2e/prod-modifiers-tab.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + srv.address().port + '/app.html');
  await p.waitForFunction(() => typeof prodModifiersTab === 'function' && typeof window.CBVariant === 'object',
    null, { timeout: 30000 });

  console.log('\n── ⭐⭐⭐ the tab is a PAINT over CBVariant, nothing else — same data, same shape ' + '─'.repeat(0));
  const empty = await p.evaluate(() => ({
    view: prodOutcomeHTML('modifiers', { modifiers: [] }),
    edit: prodModifiersTab({ modifiers: [] }, true),
  }));
  say('an empty product says so in View', /No modifiers yet/.test(empty.view), 'the outcome line names the gap');
  say('and Edit offers the one way in', /prod-mod-add"/.test(empty.edit), '"+ Add a group" is on screen');

  const filled = await p.evaluate(() => {
    let g = CBVariant.addGroup([], 'Spice level');
    g = CBVariant.setGroup(g, 0, { required: true, max: 1 });
    g = CBVariant.addOption(g, 0, 'Mild', 0);
    g = CBVariant.addOption(g, 0, 'Hot', 0);
    return { view: prodOutcomeHTML('modifiers', { modifiers: g }), edit: prodModifiersTab({ modifiers: g }, true), groups: g };
  });
  say('View reads it straight from CBVariant.summary, no second count kept here',
    /1 group.*2 options/.test(filled.view), filled.view);
  say('Edit shows the real group name and both real options',
    /Spice level/.test(filled.edit) && /value="Mild"/.test(filled.edit) && /value="Hot"/.test(filled.edit),
    'found in the rendered HTML');
  say('the required flag and the max really came from the data, not a default',
    /checked/.test(filled.edit.match(/prod-mod-required-0"[^>]*/)[0]), 'required is checked');

  console.log('\n── ⭐⭐ EVERY CONTROL CALLS A REAL FUNCTION — pages-parse.test.js’s own rule, checked here too ' + '─'.repeat(0));
  const wired = await p.evaluate(() => {
    const html = prodModifiersTab({ modifiers: [{ name: 'X', required: false, max: 1, options: [{ name: 'Y', price: 0 }] }] }, true);
    const calls = Array.from(html.matchAll(/onclick="([a-zA-Z0-9_]+)\(/g)).map((m) => m[1])
      .concat(Array.from(html.matchAll(/onchange="[^"]*?([a-zA-Z0-9_]+)\(/g)).map((m) => m[1]));
    const missing = Array.from(new Set(calls)).filter((fn) => typeof window[fn] !== 'function');
    return { calls: Array.from(new Set(calls)), missing: missing };
  });
  say('every onclick/onchange in the rendered tab calls a real function', wired.missing.length === 0,
    wired.missing.length ? 'missing: ' + wired.missing.join(', ') : wired.calls.join(', '));

  console.log('\n── ⭐⭐⭐ SAVED AS YOU GO — a mutator calls the real merge:true shape, then updates the product in place ' + '─'.repeat(0));
  const saved = await p.evaluate(async () => {
    const calls = [];
    /* stand in for routes/products.js's PATCH /:id — merge:true, echoing back what a real merge-patch would */
    window.api = async function (name, opts) {
      calls.push({ name: name, opts: opts });
      return { item: { item_data: Object.assign({}, opts.body.item_data) } };
    };
    /* ⚠️ UI is `let UI = {...}` at the page's own top level — window.UI = {...} would create a SEPARATE
       property that the page's own bare `UI` references never see. Mutating its existing fields is the
       only way in from here, and it is exactly what a real caller does too. */
    UI.prods = [{ item_id: 'i1', item_data: { modifiers: [] } }];
    UI.prodSel = 'i1';
    /* prodRepaintSection needs a real #detailpane; stub it so the save path completes without one */
    window.prodRepaintSection = function () { window.__repainted = true; };
    await prodModAddGroup();
    return { calls: calls, item_data: UI.prods[0].item_data, repainted: window.__repainted };
  });
  say('it called the product endpoint, not a bespoke one', saved.calls.length === 1 && saved.calls[0].name === 'prodEdit',
    saved.calls[0] && saved.calls[0].name);
  say('with merge:true — never the whole record (EXP-01’s own rule)', saved.calls[0].opts.body.merge === true,
    JSON.stringify(saved.calls[0].opts.body.merge));
  say('the PATCH body carries ONLY modifiers, nothing else on the record', Object.keys(saved.calls[0].opts.body.item_data).join(',') === 'modifiers',
    Object.keys(saved.calls[0].opts.body.item_data).join(','));
  say('the product in memory now carries the new group', saved.item_data.modifiers.length === 1, JSON.stringify(saved.item_data.modifiers));
  say('and the tab repainted itself', !!saved.repainted, 'prodRepaintSection was called');

  console.log('\n── ⚠️⚠️⚠️ THE SHAPE-GUARD REALLY RUNS ON SAVE — an extra field on an option never reaches the PATCH ' + '─'.repeat(0));
  const stripped = await p.evaluate(async () => {
    let body = null;
    window.api = async function (n, opts) { body = opts.body; return { item: { item_data: opts.body.item_data } }; };
    UI.prods = [{ item_id: 'i3', item_data: { modifiers: [] } }];
    UI.prodSel = 'i3';
    /* exactly what a careless import or an old draft could carry — a cost price alongside the customer-facing price */
    let g = CBVariant.addOption(CBVariant.addGroup([], 'Spice'), 0, 'Hot', 5);
    g[0].options[0].cost = 99; g[0].options[0].supplier_code = 'X9';   /* smuggled in directly, bypassing setOption */
    await prodModSave(g);
    return body.item_data.modifiers[0].options[0];
  });
  say('the extra fields never left the browser', Object.keys(stripped).sort().join(',') === 'name,price',
    JSON.stringify(stripped));

  console.log('\n── ⚠️⚠️⚠️ IF THE ENGINE EVER FAILED TO LOAD, SAVE MUST REFUSE, NOT SAVE UNCLEANED ' + '─'.repeat(0));
  const guarded = await p.evaluate(async () => {
    let called = false;
    window.api = async function () { called = true; return { item: { item_data: {} } }; };
    const real = window.CBVariant; window.CBVariant = undefined;
    UI.prods = [{ item_id: 'i4', item_data: {} }]; UI.prodSel = 'i4';
    await prodModSave([{ name: 'X', options: [{ name: 'Y', price: 0, cost: 5 }] }]);
    window.CBVariant = real;
    return { called: called };
  });
  say('a missing engine refuses the save instead of writing unclean data', guarded.called === false, 'api() was never called');

  console.log('\n── ⚠️⚠️ A GROUP MID-TYPE SURVIVES A SAVE — it must stay on screen to be finished, not vanish ' + '─'.repeat(0));
  const midType = await p.evaluate(async () => {
    window.api = async function (n, opts) { return { item: { item_data: Object.assign({}, opts.body.item_data) } }; };
    window.prodRepaintSection = function () {};
    /* a group with a name typed but no option added yet — exactly the moment right after "+ Add a group" */
    UI.prods = [{ item_id: 'i2', item_data: { modifiers: [{ name: 'Spice', required: false, max: 1, options: [] }] } }];
    UI.prodSel = 'i2';
    await prodModSetGroup(0, { required: true });      /* an ordinary edit on the still-incomplete group */
    return {
      stillThere: UI.prods[0].item_data.modifiers.length === 1,
      name: UI.prods[0].item_data.modifiers[0] && UI.prods[0].item_data.modifiers[0].name,
      soldAt: CBVariant.groupsOf(UI.prods[0].item_data).length,
      warned: prodModifiersTab(UI.prods[0].item_data, true),
    };
  });
  say('the incomplete group is not silently dropped on an unrelated save', midType.stillThere && midType.name === 'Spice',
    JSON.stringify(midType.stillThere) + ' name=' + midType.name);
  say('groupsOf() keeps it off the sell screen on its own, with no extra guard needed here', midType.soldAt === 0,
    midType.soldAt + ' groups would show at the counter');
  say('and the edit view names what is still missing', /has no options yet/.test(midType.warned), 'the row says so');

  console.log('\n── ⭐⭐⭐ THE PREVIEW — SEE THE BEHAVIOUR WHILE AUTHORING (Athi’s own words) ' + '─'.repeat(0));
  const preview = await p.evaluate(() => {
    UI.prods = [{ item_id: 'i5', item_data: { modifiers: [
      { name: 'Spice', required: true, max: 1, options: [{ name: 'Mild', price: 0 }, { name: 'Hot', price: 0 }] },
      { name: 'Extra', required: false, max: 2, options: [{ name: 'Paneer', price: 20 }, { name: 'Cheese', price: 15 }] },
    ] } }];
    UI.prodSel = 'i5'; MODPREV_ID = null; MODPREV = [];   /* force a fresh preview for this product */
    let html = prodModifiersTab(UI.prods[0].item_data, true);
    const beforePick = { needsSpice: /Still needs: Spice/.test(html), hasButtons: /prod-mod-preview-0-0/.test(html) };
    prodModPreviewPick(0, 1);   /* tap "Hot" in the required Spice group */
    html = prodModifiersTab(UI.prods[0].item_data, true);
    const afterPick = { ready: /Ready to add/.test(html), showsHot: /✓ Hot/.test(html) };
    return { beforePick: beforePick, afterPick: afterPick };
  });
  say('an unfinished required pick is named, before anything is tapped', preview.beforePick.needsSpice, 'shown');
  say('real, clickable option buttons render for each group', preview.beforePick.hasButtons, 'found');
  say('picking the required option clears the warning', preview.afterPick.ready, '"Ready to add" shown');
  say('and the picked option shows as picked', preview.afterPick.showsHot, '✓ Hot rendered');

  const noSave = await p.evaluate(() => {
    let apiCalled = false;
    window.api = async function () { apiCalled = true; };
    prodModPreviewPick(1, 0);   /* Extra → Paneer */
    prodModPreviewPick(1, 1);   /* Extra → Cheese, max 2, both fit */
    return { apiCalled: apiCalled, item_data: UI.prods[0].item_data };
  });
  say('the preview never calls the save API — it is a preview, not an edit', noSave.apiCalled === false, 'api() never touched');
  say('and the product’s real, saved modifiers are untouched by tapping the preview', noSave.item_data.modifiers.length === 2,
    JSON.stringify(noSave.item_data.modifiers.map((g) => g.name)));

  const resetAndSwitch = await p.evaluate(() => {
    prodModPreviewReset();
    const afterReset = /Still needs: Spice/.test(prodModifiersTab(UI.prods[0].item_data, true));
    /* a DIFFERENT product must never inherit the last one's taps — opening ITS tab is what resets MODPREV,
       exactly as switching products in the real UI always renders the tab before any click can reach it */
    UI.prods.push({ item_id: 'i6', item_data: { modifiers: [{ name: 'Size', required: true, max: 1, options: [{ name: 'Small', price: 0 }] }] } });
    UI.prodSel = 'i6';
    prodModifiersTab(UI.prods[1].item_data, true);   /* opening i6's tab — this is what resets MODPREV for it */
    prodModPreviewPick(0, 0);
    UI.prodSel = 'i5';
    const stillFresh = /Still needs: Spice/.test(prodModifiersTab(UI.prods[0].item_data, true));
    return { afterReset: afterReset, stillFresh: stillFresh };
  });
  say('"Reset preview" clears every pick back to the start', resetAndSwitch.afterReset, 'Spice is needed again');
  say('switching products does not carry a pick over to a product it was never made on', resetAndSwitch.stillFresh,
    'i5 was not touched by a pick made while i6 was open');

  console.log('\n── ⚠️⚠️ A STALE PICK DOES NOT OUTLIVE THE OPTION IT WAS MADE ON ' + '─'.repeat(30));
  const stalePick = await p.evaluate(() => {
    UI.prodSel = 'i5';
    prodModPreviewPick(0, 1);   /* re-pick "Hot" in Spice, on a clean product */
    /* the option is renamed underneath the pick (a direct edit here, not a round trip through the async
       save, which is already covered elsewhere — this isolates the PREVIEW's own cleanup, the thing built) */
    UI.prods[0].item_data.modifiers[0].options[1].name = 'Mild renamed';
    const html = prodModifiersTab(UI.prods[0].item_data, true);
    return { stillClaimsHot: /✓ Hot/.test(html), stillNeedsSpice: /Still needs: Spice/.test(html) };
  });
  say('the renamed option is no longer shown as picked', !stalePick.stillClaimsHot, 'no stale ✓ Hot');
  say('and the required group is correctly reported unanswered again', stalePick.stillNeedsSpice, 'Spice is needed');

  console.log('\n── ⚠️⚠️⚠️ "+ ADD AN OPTION" ACTUALLY ADDS ONE — the exact button, no name supplied by hand ' + '─'.repeat(0));
  const addOpt = await p.evaluate(async () => {
    window.api = async function (n, opts) { return { item: { item_data: opts.body.item_data } }; };
    UI.prods = [{ item_id: 'i7', item_data: { modifiers: [] } }];
    UI.prodSel = 'i7';
    await prodModAddGroup();            /* real button, no args — now seeds a WORKED EXAMPLE (2 real options) */
    const afterGroup = UI.prods[0].item_data.modifiers[0].options.length;
    await prodModAddOption(0);          /* real button, no args — the exact call "+ Add an option" makes */
    const groups = UI.prods[0].item_data.modifiers;
    const last = groups[0].options[groups[0].options.length - 1];
    return { groupCount: groups.length, afterGroup: afterGroup, optionCount: groups[0] ? groups[0].options.length : -1, lastOptName: last && last.name };
  });
  say('the group was actually created', addOpt.groupCount === 1, addOpt.groupCount + ' group(s)');
  say('⭐ and it starts as a worked EXAMPLE, not empty — the answer to "I don’t know what to provide"',
    addOpt.afterGroup === 2, addOpt.afterGroup + ' example option(s) already on it');
  say('⚠️⚠️⚠️ "+ Add an option" really adds a THIRD, not stripped in the same call that created it',
    addOpt.optionCount === 3, addOpt.optionCount + ' option(s)');
  say('with a real, editable placeholder name, not blank', !!addOpt.lastOptName, '"' + addOpt.lastOptName + '"');

  console.log('\n── ⭐⭐⭐ A PRODUCT THAT ALREADY HAS MODIFIERS OPENS SHOWING THEM, READY TO EDIT (Athi: "i assume we' + '─'.repeat(0));
  console.log('   already have some products with modifiers we should be able to open those... and edit as well") ' + '─'.repeat(0));
  const existing = await p.evaluate(async () => {
    window.api = async function (n, opts) { return { item: { item_data: opts.body.item_data } }; };
    /* the exact shape a product imported or seeded earlier would carry — Tiffin Combo's own scenario */
    UI.prods = [{ item_id: 'combo1', item_data: { name: 'Tiffin Combo', modifiers: [
      { name: 'Choice of tiffin', required: true, max: 1, options: [{ name: 'Idli', price: 0 }, { name: 'Dosa', price: 0 }, { name: 'Pongal', price: 10 }] },
      { name: 'Extra chutney', required: false, max: 2, options: [{ name: 'Coconut', price: 5 }, { name: 'Tomato', price: 5 }] },
    ] } }];
    UI.prodSel = 'combo1';
    const viewHTML = prodModifiersTab(UI.prods[0].item_data, false);
    const editHTML = prodModifiersTab(UI.prods[0].item_data, true);
    /* now actually EDIT an existing option's price — the real, exact call the price input's onchange makes */
    await prodModSetOption(0, 2, { price: 15 });
    return {
      viewHTML: viewHTML, editHTML: editHTML,
      afterEdit: UI.prods[0].item_data.modifiers[0].options[2],
      groupCountUnchanged: UI.prods[0].item_data.modifiers.length === 2,
    };
  });
  say('View shows the real, existing groups — not "No modifiers yet"',
    /Choice of tiffin/.test(existing.viewHTML) && /Extra chutney/.test(existing.viewHTML) && !/No modifiers yet/.test(existing.viewHTML),
    'both real group names shown, the empty-state message is gone');
  say('Edit pre-fills the first group’s real name', /value="Choice of tiffin"/.test(existing.editHTML), 'found');
  say('and every one of its real options, not a blank form', /value="Idli"/.test(existing.editHTML) && /value="Dosa"/.test(existing.editHTML) && /value="Pongal"/.test(existing.editHTML),
    'all three found');
  say('the second, unrelated group is untouched by opening the tab', /value="Extra chutney"/.test(existing.editHTML), 'found');
  say('editing an EXISTING option (not a newly added one) actually changes its price', existing.afterEdit.price === 15, JSON.stringify(existing.afterEdit));
  say('and the edit did not add or remove any group in the process', existing.groupCountUnchanged, 'still 2 groups');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nthe Modifiers tab is a thin paint over CBVariant, saves through the same safe merge-patch shape, and previews the real behaviour live');
  process.exit(bad || errs.length ? 1 : 0);
})();
