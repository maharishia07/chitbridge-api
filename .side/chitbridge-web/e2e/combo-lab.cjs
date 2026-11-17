/* combo-lab.cjs — TRY A MODIFIER, THEN APPLY IT TO THE REAL PRODUCT
 *
 * Athi: "modifiers are part of product creation / offer creation, so can we include as a facility in offer
 * lab, so people can try how the modifiers can be created and once if they are happy, we would be able to
 * save that modifier and apply it to the real product. which is apply button so it will be part of the
 * product catalogue." Combo Lab started life as a modal inside offer-lab-next.html; [Labs split, 2026-09-26]
 * — "bring offer lab and combo lab as a separate item... combo lab earned its place now" — moved it to its
 * own page, combo-lab.html, which boots straight into what used to be the modal.
 *
 * Run: node e2e/combo-lab.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(58) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  /* ⭐ T2-LABS: the Combo Lab is a mode of the Offer Lab — combo-lab.html only forwards (every old link still lands here) */
  await p.goto('http://127.0.0.1:' + srv.address().port + '/combo-lab.html?api=x');
  await p.waitForURL(/offer-lab-next\.html\?mode=combo&api=x$/, { timeout: 10000 }).catch(() => {});
  say('combo-lab.html forwards to offer-lab-next.html?mode=combo, keeping what it was asked', /offer-lab-next\.html\?mode=combo&api=x$/.test(p.url()), p.url());
  await p.goto('http://127.0.0.1:' + srv.address().port + '/offer-lab-next.html?mode=combo');
  await p.waitForTimeout(200);

  console.log('\n── ⭐⭐⭐ [Labs split] the page IS the lab now — no "open" step, a product picker first ' + '─'.repeat(0));
  const opened = await p.evaluate(() => ({
    onLoad: document.getElementById('modLabOverlay').classList.contains('on'),
    title: document.title,
    /* ⭐ openModLab() itself still exists and still works (used to reset/reopen) — just never needs calling
     * to get here, since the page's own boot sequence already did. */
    stillCallable: typeof openModLab === 'function',
  }));
  say('the page boots straight into the lab, no "open" click needed', opened.onLoad, 'modLabOverlay is on from page load');
  say('the tab is titled for what it is (string layer: the locale name)', opened.title === 'Combo Lab · ChitBridge', opened.title);
  say('what it could not read is said in words, never undefined or NaN', !/undefined|NaN/.test(await p.evaluate(() => document.body.innerText)), 'no raw undefined or NaN on screen');
  say('openModLab() still exists, for a reset/reopen', opened.stillCallable, 'confirmed');
  /* L3 (small-fixes): the lab opens IN the page frame - the header (the frame's: title · Home · avatar, SHELL-ONE) is on screen above it, it is not a fixed pop-up over an empty page */
  for (const vp of [{ width: 1366, height: 800 }, { width: 390, height: 844 }]) {
    await p.setViewportSize(vp); await p.waitForTimeout(250);
    const f = await p.evaluate(() => {
      const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const top = document.querySelector('[data-testid="shell-header"]'), ov = document.getElementById('modLabOverlay'), panel = ov && ov.querySelector('.ovlpanel');
      const topB = top ? top.getBoundingClientRect() : null, pB = panel ? panel.getBoundingClientRect() : null;
      /* what is painted at the header's centre is the header, not the lab's scrim */
      const hit = topB ? document.elementFromPoint(topB.left + 20, topB.top + topB.height / 2) : null;
      return { title: vis(document.querySelector('[data-testid="shell-title"], [data-testid="shell-switcher"]')), home: vis(document.querySelector('[data-testid="shell-home"]')), avatar: vis(document.querySelector('[data-testid="shell-avatar"] .cbav-btn, [data-testid="shell-avatar"] [data-testid="signin-door"]')),
        pos: ov ? getComputedStyle(ov).position : '', headerHit: !!(hit && top && top.contains(hit)), below: !!(topB && pB && pB.top >= topB.bottom - 1), sw: document.documentElement.scrollWidth, iw: window.innerWidth,
        inert: ['strip', 'steps'].every((id) => { const e = document.getElementById(id); return !e || !vis(e) || !e.innerText.trim(); }) };
    });
    say('L3 @' + vp.width + ': the header (title, Home, avatar) is on screen', f.title && f.home && f.avatar, JSON.stringify({ title: f.title, home: f.home, avatar: f.avatar }));
    say('L3 @' + vp.width + ': the lab is in the page frame, not a fixed pop-up (position ' + f.pos + ')', f.pos !== 'fixed' && f.headerHit && f.below, 'header hit ' + f.headerHit + ' · lab below header ' + f.below);
    say('L3 @' + vp.width + ': nothing of the inert Offer Lab shows, and no sideways scroll', f.inert && f.sw <= f.iw, 'scroll ' + f.sw + ' / ' + f.iw);
    await p.screenshot({ path: path.join(__dirname, 'shots', 'small-fixes', 'combo-lab-' + vp.width + '.png') }).catch(() => {});
  }
  await p.setViewportSize({ width: 1280, height: 720 });
  /**
   * ⚠️⚠️ REWRITTEN FOR THE TWO-TAB REDESIGN (63d8b2a6). This used to require a table of EVERY product.
   * It is not that screen any more and should not be: the Modifiers tab lists the products that already
   * HAVE modifiers — which is what somebody opening a modifier lab came to see — and every other product
   * is one "+ Add to another product" away. The assertion moved with the design rather than holding it to
   * a shape Athi replaced on purpose.
   */
  const picker = await p.evaluate(() => ({
    hasSearch: !!document.getElementById('modLabSearch'),
    rows: document.querySelectorAll('#modLabBody .modlist .row, #modLabBody .modlist .prow').length,
    withMods: (typeof modLabModsTotals === 'function') ? modLabModsTotals().withMods : -1,
    addOther: /Add to another product/.test(document.getElementById('modLabBarExtra').innerHTML),
    emptySays: /No modifiers yet|Nothing here yet/.test(document.getElementById('modLabBody').innerText),
    emptyText: document.getElementById('modLabBody').innerText.replace(/s+/g, ' ').trim().slice(0, 52),
    total: P.length,
  }));
  /* ⚠️ AT THIS POINT THE FIXTURE HAS NO MODIFIERS YET — the test adds one further down. So the honest
     assertion here is that the tab SAYS SO rather than showing a silent blank, which is what the redesign
     promises for a shop that has never made one. The populated case is asserted where it is populated. */
  say('with nothing to show yet, the tab says so rather than sitting blank',
    picker.withMods === 0 && picker.emptySays, '"' + picker.emptyText + '"');
  say('⭐ and every OTHER product is one button away, not a wall of rows',
    picker.addOther, '"+ Add to another product"');
  say('with a search box', picker.hasSearch, 'found');

  console.log('\n── ⚠️⚠️ [OFFR-03] "CREATE NEW COMBO" IS A REAL HEADING, THE PICKER IS STILL UNDERNEATH ' + '─'.repeat(0));
  /* ⚠️ the heading moved onto the TAB when the screen became two of them — same promise, new place */
  const combo = await p.evaluate(() => {
    const tabs = document.getElementById('modLabTabs');
    return { tabs: tabs ? tabs.innerText.replace(/\s+/g, ' ').trim() : '',
             build: /Build a combo/.test((document.getElementById('modLabBarExtra') || {}).innerHTML || '') };
  });
  say('the screen says plainly that combos live here too', /Combos/.test(combo.tabs), '"' + combo.tabs + '"');

  console.log('\n── ⭐⭐⭐ [OFFR-07] "the modifier example has only extra cheese only... we need the entire stuff, ' + '─'.repeat(0));
  console.log('   provide the combo name, add the price, then what each section is" — Athi, pointing at the ' + '─'.repeat(0));
  console.log('   real till combo chooser beside the old one-group example ' + '─'.repeat(0));
  const builtFresh = await p.evaluate(() => {
    modLabBuildFresh();
    const html = document.getElementById('modLabBody').innerHTML;
    return {
      building: MODLAB.building, notTiedToProduct: MODLAB.pid === null,
      hasName: !!MODLAB.name, hasPrice: Number(MODLAB.price) > 0,
      nameFieldShown: /value="Tiffin Combo"/.test(html), priceFieldShown: new RegExp('value="' + MODLAB.price + '"').test(html),
      groupCount: modLabGroups().length,
      hasRealGroup: /value="Choose the main"/.test(html), hasRealOptions: /value="Masala Dosa"/.test(html) && /value="Idli \(2 pc\)"/.test(html),
      editable: /onchange="modLabSetGroup/.test(html), hasPreviewButton: /modLabPreviewLikeTill/.test(html),
      hasSaveAsButton: /modLabSaveAsOpen/.test(document.getElementById('modLabFoot').innerHTML),
      hasCreateNewButton: /modLabCreateNew/.test(document.getElementById('modLabFoot').innerHTML),
    };
  });
  say('"Build a combo" opens a real builder, not tied to any product yet', builtFresh.building && builtFresh.notTiedToProduct, 'confirmed');
  say('it comes with a real NAME already, editable in a real field', builtFresh.hasName && builtFresh.nameFieldShown, 'found');
  say('and a real PRICE already, editable in a real field', builtFresh.hasPrice && builtFresh.priceFieldShown, 'found');
  say('seeded with THE ENTIRE STUFF — several real sections, not one lone group', builtFresh.groupCount >= 3, builtFresh.groupCount + ' group(s)');
  say('each section is a REAL, EDITABLE group — inputs, not static text', builtFresh.hasRealGroup && builtFresh.editable, 'found');
  say('with real options already on it', builtFresh.hasRealOptions, 'found');
  say('and "👁 Preview like the till" is offered here too — the real dialog, not an inline approximation', builtFresh.hasPreviewButton, 'found');
  say('a "Save as…" button is offered from here too', builtFresh.hasSaveAsButton, 'found');
  say('and so is "Create as a new product" — a whole new combo, not just a modifier on one that exists', builtFresh.hasCreateNewButton, 'found');

  console.log('\n── ⭐⭐⭐ "SAVE AS" — POSTs to /api/combo-templates (b266) ' + '─'.repeat(0));
  const saved = await p.evaluate(async () => {
    let call = null;
    window.apiFetch = async (method, url, body) => {
      if (method === 'POST' && /\/api\/combo-templates$/.test(url)) { call = { method, url, body }; return { ok: true, body: { template: Object.assign({ id: 'tpl1' }, body) } }; }
      return { ok: true, body: { templates: [] } };
    };
    BIZ.mine = { name: 'My Shop', cats: [], prods: [], margin: 25, cap: 10, d: {} };
    S.biz = 'mine'; window.savedLive = () => true;
    modLabSaveAsOpen();
    const prefilled = document.getElementById('modLabSaveName').value;
    document.getElementById('modLabSaveName').value = 'My topping combo';
    await modLabSaveAsConfirm();
    return { call: call, dialogClosed: !MODLAB.savingAs, prefilled: prefilled };
  });
  say('the save name starts prefilled with the combo’s own name — one less thing to retype', saved.prefilled === 'Tiffin Combo', '"' + saved.prefilled + '"');
  say('Save as posts the built groups under the typed name', saved.call && saved.call.body.name === 'My topping combo', saved.call ? JSON.stringify(saved.call.body.name) : 'not called');
  say('carrying the real group definition — all three sections, not a stub', saved.call && Array.isArray(saved.call.body.definition) && saved.call.body.definition.length === 3, saved.call ? JSON.stringify(saved.call.body.definition.map((g) => g.name)) : '');
  say('and the inline save row closes on success', saved.dialogClosed, 'confirmed');
  say('saving with NO name is refused before any request is made', await p.evaluate(async () => {
    let called = false; window.apiFetch = async () => { called = true; return { ok: true, body: {} }; };
    modLabSaveAsOpen(); document.getElementById('modLabSaveName').value = '  ';
    await modLabSaveAsConfirm();
    return !called;
  }), 'confirmed');

  console.log('\n── ⭐⭐⭐ "A MECHANISM OF OPEN THE SAME AGAIN" — the saved-combo library ' + '─'.repeat(0));
  const TPL = { id: 'tpl1', name: 'My topping combo', definition: [{ name: 'Extra toppings', required: false, max: 2, options: [{ name: 'Extra cheese', price: 20 }, { name: 'Extra chutney', price: 10 }] }] };
  const lib = await p.evaluate(async (tpl) => {
    window.apiFetch = async (method, url) => {
      if (method === 'GET' && /\/api\/combo-templates$/.test(url)) return { ok: true, body: { templates: [tpl] } };
      return { ok: true, body: {} };
    };
    modLabCancelBuild(true);           /* clear the earlier draft so the "used" groups below are unambiguous */
    await modLabOpenLibrary();
    const html = document.getElementById('modLabBody').innerHTML;
    return { open: MODLAB.libraryOpen, showsSavedName: html.indexOf('My topping combo') >= 0, showsCount: /2 groups?/.test(html) === false && /1 group/.test(html) };
  }, TPL);
  say('"My saved combos" opens a real library, fetched from the server', lib.open, 'confirmed');
  say('showing the combo saved a moment ago, by the name it was given', lib.showsSavedName, 'found');
  say('with an honest group/option count, not a guess', lib.showsCount, 'confirmed');

  const reopened = await p.evaluate(() => {
    modLabUseTemplate('tpl1');
    const groups = MODLAB.building ? MODLAB.draft : P[0].modifiers;
    return { closedLibrary: !MODLAB.libraryOpen, resumedBuilding: MODLAB.building, groupName: groups[groups.length - 1] && groups[groups.length - 1].name };
  });
  say('"Use" closes the library and brings the saved groups back in', reopened.closedLibrary && reopened.groupName === 'Extra toppings', 'confirmed');
  say('landing back in the builder, ready to keep editing', reopened.resumedBuilding, 'confirmed');

  const deleted = await p.evaluate(async () => {
    let call = null;
    window.apiFetch = async (method, url) => { if (method === 'DELETE') { call = url; return { ok: true, body: {} }; } return { ok: true, body: { templates: [] } }; };
    await modLabDeleteTemplate('tpl1', 'My topping combo');
    return { call: call };
  });
  say('deleting a saved combo calls the real DELETE route', deleted.call && /\/api\/combo-templates\/tpl1$/.test(deleted.call), deleted.call);

  console.log('\n── ⭐⭐⭐ [OFFR-08] "push to product list" — create the first time, update the next ' + '─'.repeat(0));
  const pushCreate = await p.evaluate(async () => {
    let call = null;
    window.apiFetch = async (method, url) => {
      if (method === 'POST' && /\/push$/.test(url)) { call = { method, url }; return { ok: true, body: { verb: 'created', item: { item_id: 'newp1', item_data: { name: 'Pushed combo' } } } }; }
      return { ok: true, body: {} };
    };
    BIZ.mine = { name: 'My Shop', cats: [], prods: [], margin: 25, cap: 10, d: {} };
    S.biz = 'mine'; window.savedLive = () => true;
    await modLabPushTemplate('tpl1');
    return { call: call };
  });
  say('"Push to products" calls the real /:id/push route', pushCreate.call && /\/api\/combo-templates\/tpl1\/push$/.test(pushCreate.call.url), pushCreate.call ? pushCreate.call.url : 'not called');
  say('…as a POST, never a GET that could be prefetched', pushCreate.call && pushCreate.call.method === 'POST', pushCreate.call ? pushCreate.call.method : '');

  console.log('\n── ⭐⭐ [OFFR-08→simplified] "preview and edit option should be there" — no auto-copy into the library ' + '─'.repeat(0));
  const liveCombo = await p.evaluate(async () => {
    P.push({ id: 'livecombo1', name: 'Already a combo', cat: 'combos', price: 90, cost: null,
      modifiers: [{ name: 'Pick one', required: true, max: 1, options: [{ name: 'A', price: 0 }, { name: 'B', price: 0 }] }] });
    window.apiFetch = async (method, url) => { if (method === 'GET' && /\/api\/combo-templates$/.test(url)) return { ok: true, body: { templates: [] } }; return { ok: true, body: {} }; };
    await modLabOpenLibrary();
    const html = document.getElementById('modLabBody').innerHTML;
    return {
      shown: html.indexOf('Already a combo') >= 0,
      saysAlreadyOnList: /already on your product list/.test(html),
      hasPreview: /openComboTillPreview\(/.test(html),
      hasEdit: /modLabCloseLibrary\(\);modLabPick\('livecombo1'\)/.test(html),
      noAdoptButton: !/modLabAdoptExisting/.test(html) && !/Bring into this library/.test(html),
    };
  });
  say('an existing combo PRODUCT (never Saved As) still appears here', liveCombo.shown, 'found');
  say('honestly labelled as already live, not a draft', liveCombo.saysAlreadyOnList, 'confirmed');
  say('with "👁 Preview" — the same popup a saved template gets', liveCombo.hasPreview, 'found');
  say('and "✏️ Edit" — opens the SAME per-product screen every product opens through', liveCombo.hasEdit, 'found');
  say('no "bring into this library" step — nothing copied just to be listed', liveCombo.noAdoptButton, 'confirmed');

  const editedLive = await p.evaluate(() => {
    modLabCloseLibrary(); modLabPick('livecombo1');
    return { pid: MODLAB.pid, templateIdCleared: MODLAB.templateId === null };
  });
  say('"✏️ Edit" opens that exact product, not a copy', editedLive.pid === 'livecombo1', editedLive.pid);
  say('…with no template id attached — editing the product directly means Apply, not Save', editedLive.templateIdCleared, 'confirmed');
  await p.evaluate(() => { modLabBack(); P.pop(); });

  console.log('\n── ⚠️⚠️ AN UNSAVED DRAFT OFFERS ITSELF TO THE NEXT PRODUCT PICKED, IT IS NOT LOST ' + '─'.repeat(0));
  const draftFlow = await p.evaluate(() => {
    modLabCancelBuild(true); modLabBack();
    modLabBuildFresh();
    modLabCancelBuild(false);   /* "Apply to a product ▸" — keep the draft, go pick one */
    const html = document.getElementById('modLabBody').innerHTML;
    const bannerShown = /unsaved combo/i.test(html);
    modLabAttachDraftTo(P[0].id);
    return { bannerShown: bannerShown, attachedTo: P[0].id === MODLAB.pid, gotGroups: P[0].modifiers.length > 0, draftCleared: MODLAB.draft.length === 0 };
  });
  say('the picker warns a combo is waiting to be applied', draftFlow.bannerShown, 'banner shown');
  say('picking a product attaches the draft to it', draftFlow.attachedTo && draftFlow.gotGroups, 'confirmed');
  say('and the draft is spent, not left lying around for the next visit', draftFlow.draftCleared, 'confirmed');
  const stillReal = await p.evaluate(() => {
    modLabBack();
    return !!document.querySelector('#modLabBody .modlist') || /Nothing here yet|No modifiers yet/.test(document.getElementById('modLabBody').innerText);
  });
  say('the lab returns to its own list once the builder is done with', stillReal, 'back at the Modifiers tab');

  console.log('\n── ⭐⭐⭐ [OFFR-07] "CREATE AS A NEW PRODUCT" — the combo becomes a real, sellable product ' + '─'.repeat(0));
  const createdNew = await p.evaluate(async () => {
    modLabBuildFresh();   /* fresh 'Tiffin Combo' example: a real name, a real price, three real sections */
    let postCall = null;
    const realApiFetch = window.apiFetch, realFetch = window.fetch;
    window.apiFetch = async (method, url, body) => {
      if (method === 'POST' && /\/api\/products$/.test(url)) { postCall = { method: method, url: url, body: body }; return { ok: true, body: { item: { item_id: 'newcombo1' } } }; }
      return realApiFetch(method, url, body);
    };
    window.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });   /* labUseMine()'s own re-read after creating */
    BIZ.mine = { name: 'My Shop', cats: [], prods: [], margin: 25, cap: 10, d: {} };
    S.biz = 'mine'; window.savedLive = () => true;
    await modLabCreateNew();
    window.apiFetch = realApiFetch; window.fetch = realFetch;
    return { postCall: postCall, buildingAfter: MODLAB.building, nameAfter: MODLAB.name };
  });
  say('"Create as a new product" POSTs to the real /api/products, not a combo-templates row', createdNew.postCall && createdNew.postCall.method === 'POST', createdNew.postCall ? createdNew.postCall.url : 'not called');
  say('carrying the real name, the real price, and all three sections — not a stub', createdNew.postCall
    && createdNew.postCall.body.item_data.name === 'Tiffin Combo' && createdNew.postCall.body.item_data.price === 110
    && createdNew.postCall.body.item_data.modifiers.length === 3,
    createdNew.postCall ? JSON.stringify(createdNew.postCall.body.item_data) : '');
  say('and the builder resets once the product exists for real', !createdNew.buildingAfter && !createdNew.nameAfter, 'confirmed');

  const refusedNoPrice = await p.evaluate(async () => {
    modLabBuildFresh(); modLabSetPrice('');
    let called = false; const real = window.apiFetch;
    window.apiFetch = async (m, u) => { if (/\/api\/products$/.test(u)) called = true; return real(m, u); };
    await modLabCreateNew();
    window.apiFetch = real;
    const refused = !called;
    modLabCancelBuild(true);
    return refused;
  });
  say('creating with no price is refused before any request is made', refusedNoPrice, 'confirmed');

  /* ⚠️ cleanup — the draft-attach above put a real group on P[0], and the save-as test above switched to a
     'mine' catalogue to prove the real PATCH shape; the sections below assume a clean slate on both, the
     same way they always could before this run added a combo-builder story ahead of them. */
  await p.evaluate(() => { P[0].modifiers = []; MODLAB.pid = null; S.biz = 'hotel'; });

  console.log('\n── ⭐⭐⭐ picking a product opens the group editor and a live preview ' + '─'.repeat(0));
  const picked = await p.evaluate(() => {
    modLabPick(P[0].id);
    return {
      backButton: /All products/.test(document.getElementById('modLabBody').innerText),
      hasAddGroup: /modLabAddGroup/.test(document.getElementById('modLabBody').innerHTML),
      name: P[0].name,
      shown: document.getElementById('modLabBody').innerText.indexOf(P[0].name) >= 0,
    };
  });
  say('a way back to the picker', picked.backButton, 'found');
  say('the real product name is shown, not a placeholder', picked.shown, picked.name);
  say('a real "add a group" control is on screen', picked.hasAddGroup, 'found');

  console.log('\n── ⭐⭐ building a group — the same CBVariant verbs app.html’s tab uses, not a second implementation ' + '─'.repeat(0));
  const built = await p.evaluate(() => {
    modLabAddGroup();
    modLabSetGroup(0, { name: 'Spice level', required: true, max: 1 });
    modLabAddOption(0);
    modLabSetOption(0, 0, { name: 'Hot', price: 0 });
    modLabAddOption(0);
    modLabSetOption(0, 1, { name: 'Mild', price: 0 });
    return { groups: P[0].modifiers, sellable: CBVariant.groupsOf({ modifiers: P[0].modifiers }).length };
  });
  say('the draft group is exactly what was built', built.groups.length === 1 && built.groups[0].name === 'Spice level', JSON.stringify(built.groups[0]));
  say('it is already sellable-shaped (name + at least one option)', built.sellable === 1, built.sellable + ' group(s)');

  console.log('\n── ⭐⭐⭐ [TILL/OFFR-08] "Preview like the till" opens the REAL till dialog, not a lookalike ' + '─'.repeat(0));
  const preview = await p.evaluate(() => {
    modLabPreviewLikeTill();
    const opened = document.getElementById('comboTillPreviewOverlay').classList.contains('on');
    const usesRealMarkup = /class="modg/.test(document.getElementById('comboTillPreviewBody').innerHTML)
      && /class="modopt/.test(document.getElementById('comboTillPreviewBody').innerHTML);
    const bodyBefore = document.getElementById('comboTillPreviewBody').innerHTML;
    comboTillPreviewPick(0, 0);   /* Hot */
    const after = document.getElementById('comboTillPreviewBody').innerHTML;
    const footAfter = document.getElementById('comboTillPreviewFoot').innerHTML;
    closeComboTillPreview();
    const closed = !document.getElementById('comboTillPreviewOverlay').classList.contains('on');
    return {
      opened: opened, usesRealMarkup: usesRealMarkup, closed: closed,
      neededBefore: /waiting for a pick/.test(bodyBefore), readyAfter: /Ready/.test(footAfter),
      showsHot: /class="modopt on"[^>]*><span class="mn">Hot/.test(after),
    };
  });
  say('"👁 Preview like the till" opens the real popup', preview.opened, 'confirmed');
  say('rendered with the SAME classes till.html itself uses (.modg/.modopt) — CBVariant.chooserHTML(), not a lookalike', preview.usesRealMarkup, 'found');
  say('a required, unanswered group is named before any tap', preview.neededBefore, 'shown');
  say('picking the option clears the warning', preview.readyAfter, '"Ready" shown');
  say('and the picked option renders as picked, in the real dialog', preview.showsHot, 'class="modopt on" found');
  say('closing the popup really closes it', preview.closed, 'confirmed');

  console.log('\n── ⭐⭐⭐ APPLY — on the sample books it tries locally, never calls a real API ' + '─'.repeat(0));
  const sampleApply = await p.evaluate(async () => {
    let called = false;
    window.apiFetch = async () => { called = true; };
    await modLabApply();
    return { called: called, saved: P[0].modifiers.length === 1 };
  });
  say('a sample-catalogue Apply never touches the real API', sampleApply.called === false, 'apiFetch never called');
  say('but the draft still becomes the product’s own modifiers, right there in the Lab', sampleApply.saved, 'saved locally');

  console.log('\n── ⭐⭐⭐ APPLY on a real, signed-in catalogue — the exact merge:true PATCH setCost() uses ' + '─'.repeat(0));
  const realApply = await p.evaluate(async () => {
    let call = null;
    window.apiFetch = async (method, url, body) => { call = { method, url, body }; return { ok: true, body: {} }; };
    /* render() (called by modLabApply() now — see the fix this run caught) reads BIZ[S.biz].name, so a real
       'mine' entry has to exist here, the same as labUseMine()/buildBiz('mine',…) always provides for real */
    BIZ.mine = { name: 'My Shop', cats: [], prods: [], margin: 25, cap: 10, d: {} };
    S.biz = 'mine';
    window.savedLive = () => true;
    await modLabApply();
    return { call: call, expectUrl: 'https://chitbridge-api-production.up.railway.app/api/products/' + P[0].id,
      toast: (document.getElementById('labtoast') || {}).textContent };
  });
  say('it PATCHes the real product endpoint', realApply.call && realApply.call.method === 'PATCH' && realApply.call.url === realApply.expectUrl,
    realApply.call ? realApply.call.method + ' ' + realApply.call.url : 'not called');
  say('with merge:true — never the whole record', realApply.call && realApply.call.body.merge === true, JSON.stringify(realApply.call && realApply.call.body.merge));
  say('the PATCH body carries only modifiers', realApply.call && Object.keys(realApply.call.body.item_data).join(',') === 'modifiers',
    realApply.call ? Object.keys(realApply.call.body.item_data).join(',') : '');
  say('a REAL success says so in both places — the Lab AND the catalogue', /Lab and in your catalogue/.test(realApply.toast), realApply.toast);

  console.log('\n── ⚠️⚠️ [found live-testing] a REFUSED save must say so, never claim success (apiFetch never throws on 4xx/5xx) ' + '─'.repeat(0));
  const refusedApply = await p.evaluate(async () => {
    window.apiFetch = async () => ({ ok: false, status: 400, body: { message: 'modifiers: too many groups' } });
    BIZ.mine = { name: 'My Shop', cats: [], prods: [], margin: 25, cap: 10, d: {} };
    S.biz = 'mine'; window.savedLive = () => true;
    await modLabApply();
    return { toast: (document.getElementById('labtoast') || {}).textContent };
  });
  say('a refused PATCH shows "NOT in your catalogue", not "saved"', /NOT in your catalogue/.test(refusedApply.toast) && /too many groups/.test(refusedApply.toast),
    refusedApply.toast);

  console.log('\n── going back to the picker works (closing the lab is its own test, below — closeModLab() now' + '─'.repeat(0));
  console.log('   navigates Home, so nothing after it can still assume this page) ' + '─'.repeat(0));
  const backAndClose = await p.evaluate(() => {
    modLabBack();
    const backAtPicker = !!document.querySelector('#modLabBody .modlist')
      || /Nothing here yet|No modifiers yet/.test(document.getElementById('modLabBody').innerText);
    return { backAtPicker: backAtPicker };
  });
  say('"← All products" returns to the list', backAndClose.backAtPicker, 'back at the Modifiers tab');

  console.log('\n── ⭐⭐⭐ A PRODUCT THAT ALREADY HAS MODIFIERS OPENS SHOWING THEM, READY TO EDIT (Athi: "i assume we' + '─'.repeat(0));
  console.log('   already have some products with modifiers we should be able to open those... and edit as well") ' + '─'.repeat(0));
  const existing = await p.evaluate(() => {
    /* the exact shape a real, already-imported product would carry — Combo Deluxe (existing mods)'s own scenario */
    P.push({ id: 'combo1', name: 'Combo Deluxe (existing mods)', cat: 'combos', price: 110, cost: null, modifiers: [
      { name: 'Choice of tiffin', required: true, max: 1, options: [{ name: 'Idli', price: 0 }, { name: 'Dosa', price: 0 }] },
      { name: 'Extra chutney', required: false, max: 2, options: [{ name: 'Coconut', price: 5 }] },
    ] });
    modLabBack();   /* make sure the picker (not a lingering product view) is what paints next */
    modLabSearch('Combo Deluxe (existing mods)');
    /* ⚠️ the row moved from a table cell to the .modlist when the lab became two tabs — same fact, new place */
    const rows = [...document.querySelectorAll('#modLabBody .modlist *')].filter((n) => n.children.length === 0 || /row|prow|nm/.test(n.className));
    const pickerRowText = (rows.find((tr) => tr.textContent.indexOf('Combo Deluxe (existing mods)') >= 0) || {}).textContent || ('NOT FOUND among ' + rows.length + ' row(s): ' + rows.map((r) => r.textContent).join(' | '));
    modLabPick('combo1');
    const editHTML = document.getElementById('modLabBody').innerHTML;
    modLabSetOption(0, 0, { price: 8 });   /* the real onchange call, on an EXISTING option */
    return {
      /* ⭐ THE REDESIGN SAYS MORE, NOT LESS. This asked for "2 groups"; the row now NAMES them — "Choice of
         tiffin", "Extra chutney" — which answers both how many and which, before it is opened. Assertion
         moved to the better fact rather than held to the weaker one. */
      countedInPicker: /Choice of tiffin/.test(pickerRowText) && /Extra chutney/.test(pickerRowText),
      pickerRowText: pickerRowText,
      hasIdli: /value="Idli"/.test(editHTML), hasDosa: /value="Dosa"/.test(editHTML), hasChoiceGroup: /value="Choice of tiffin"/.test(editHTML),
      afterEdit: byId('combo1').modifiers[0].options[0],
      stillTwoGroups: byId('combo1').modifiers.length === 2,
    };
  });
  say('the list NAMES a product’s groups before it is even opened', existing.countedInPicker,
    '"' + existing.pickerRowText.replace(/s+/g, ' ').slice(0, 58) + '"');
  say('Edit pre-fills the real group name', existing.hasChoiceGroup, 'found');
  say('and its real, existing options — not a blank form', existing.hasIdli && existing.hasDosa, 'both found');
  say('editing an EXISTING option really changes it, in place', existing.afterEdit.price === 8, JSON.stringify(existing.afterEdit));
  say('without disturbing the other, unrelated group', existing.stillTwoGroups, 'still 2 groups');

  console.log('\n── ⭐⭐⭐ [Labs split] APPLY STILL REFRESHES THE (NOW INVISIBLE, HARMLESS) PAGE UNDERNEATH ' + '─'.repeat(0));
  console.log('   (the original bug, on offer-lab-next.html: Apply worked but a Settings card stayed stale — ' + '─'.repeat(0));
  console.log('   that card has no viewer here any more, since closing this page closes the tab, not a screen) ' + '─'.repeat(0));
  const cardFresh = await p.evaluate(async () => {
    let renderCalls = 0;
    const realRender = window.render;
    window.render = function () { renderCalls++; return realRender.apply(this, arguments); };
    modLabPick(P[1].id);
    modLabAddGroup();
    const beforeApply = renderCalls;
    await modLabApply();     /* modLabApply()'s own call to render() is unchanged by the Labs split */
    const afterApply = renderCalls;
    window.render = realRender;
    return { beforeApply: beforeApply, afterApply: afterApply };
  });
  say('Apply still refreshes the page behind the overlay (unchanged behaviour, now harmless)',
    cardFresh.afterApply > cardFresh.beforeApply,
    'render() called ' + (cardFresh.afterApply - cardFresh.beforeApply) + ' time(s) by modLabApply()');

  console.log('\n── ⭐⭐⭐ [found live, 2026-10-01] CLOSING THIS LAB GOES HOME, NEVER THE INERT SHELL UNDERNEATH ' + '─'.repeat(0));
  console.log('   ("if i open the combo lab, something else is happening and then the current offer lab is' + '─'.repeat(0));
  console.log('   opening") — window.close() is refused on a tab the person opened themselves, so closeModLab()' + '─'.repeat(0));
  console.log('   now leaves for Home (location.href=\'/\') instead. THE LAST TEST IN THIS FILE — the page is' + '─'.repeat(0));
  console.log('   gone once this runs, so nothing after it may still assume combo-lab.html. ' + '─'.repeat(0));
  const before = await p.evaluate(() => {
    openModLab();   /* a prior section already navigated this page back to combo-lab's picker — reopen so this
                        test starts from a known, showing state */
    return document.getElementById('modLabOverlay').classList.contains('on');
  });
  say('the overlay was showing before the close', before, 'confirmed');
  let threw = null;
  try {
    await Promise.all([
      p.waitForURL((u) => u.pathname === '/' || u.pathname === '/index.html', { timeout: 8000 }),
      p.evaluate(() => { closeModLab(); }),
    ]);
  } catch (e) { threw = e.message; }
  say('closeModLab() never throws, even though window.close() can’t actually close a Playwright page', threw === null, threw || 'confirmed');
  const landed = (await p.url()).replace('http://127.0.0.1:' + srv.address().port, '').split('?')[0].split('#')[0];
  say('it leaves for Home — never reveals the inert Offer Lab shell this page carries under the modal', landed === '/' || landed === '/index.html', 'landed on "' + landed + '"');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close(); srv.close();
  console.log(bad || errs.length ? '\n' + (bad + errs.length) + ' failed'
    : '\nthe modifier lab lets you try a modifier and only Apply ever commits it, through the same safe merge-patch shape');
  process.exit(bad || errs.length ? 1 : 0);
})();
