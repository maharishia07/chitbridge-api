#!/usr/bin/env node
/**
 * e2e/walk-offer-lab.cjs - THE OFFER LAB ON THE LAB STANDARD, WALKED (W16-W20, Athi 21-22 Oct: "pick on the left, form in the middle, the cart on the right").
 * Black box: the real page, the real offers engine; the api is answered INSIDE the browser by a small stand-in of routes/definitions.js (status without rules
 * never mints a version, a PUT of rules replaces them) and of GET /api/relationships/customers/groups - nothing leaves this machine.
 *   O1  TRIAL: before any tap the left menu lists the eight types under four headings (one thing's price, two things together, bill size, allows or blocks)
 *   O2  TRIAL: picking a type goes straight to its working step (no "What kind of offer?" screen, no step bar); the menu lights it
 *   O3  TRIAL: work it out, add it: the cart on the right ("Your offers (draft)") shows it as a draft - and not one request left the page
 *   O4  TRIAL: Make live / Only for a group say "Sign in to use this in your shop." in the row - still no request
 *   O5  SIGNED IN: add two offers; both are definitions in status draft (no bill can see them)
 *   O6  SIGNED IN: "Only for a group" reads the shop's named groups, picks one: the definition is live with rules.customer_group = group:<name> and the
 *       other rules kept; the row says so
 *   O7  SIGNED IN: "Make live" makes the other live for everyone: status live, no customer_group
 *   O8  390 px: the menu is icons only, so the middle lists the eight types in words; picking one opens the form; "All types" comes back
 *   O9  rule 13 at 1280 and 390, Cream and Dark: AA of every text, no sideways scroll, nothing covering a control, no app.html link
 *  Offer Lab v2 (PR-a1): left = NEW types in folding groups (open) + YOUR offers pinned by status; middle = the one offer open; right = "What this promises"
 *   V1  the four type groups fold and unfold, each says how many types it holds, and starts open (the eight types stay in sight)
 *   V2  YOUR offers: three rows per status then "and N more" (a searchable list); a paused offer is listed under Paused and Resume is one tap away
 *   V3  the right side says, word for word, what the confirm popup of the same next step says (draft, approved, live, paused)
 *   V4  390 px: no icons-only rail; a "New | Your offers (N)" switch (44 px); the shelf under it; the sentence right above the action button; AA in Cream and Dark
 *   M1  390 px, Cream and Dark: a saved percent offer says "Margin on these items: X% → Y%" in the pane and the popup; a cost-blind viewer sees none
 *  UX-109 / walk W21-W48 (Athi 22 Oct: every action that commits a money promise is a deliberate act):
 *   L1  the landing has no "Create an offer" / "Saved offers", no empty circle, no type lit in the menu, and a line saying what to do (W30 W31 W36)
 *   L2  Settings "Change": each of the four boxes is tall enough for its own label, chips and help (W29)
 *   P1  every one of the eight types opens with NOTHING chosen: no category, items, shape, gift or pair; loyalty off; "Work it out" off with a reason (W21-W24)
 *   P2  choosing the reach shows a prominent "Applies to: all N items in <category>" with the true count, and only then is "Work it out" on (W21)
 *   C1  a shelf button asks first: Cancel changes nothing (no request), Confirm commits, and the question names what, whom, on what (count) and from when (W26-W28)
 *   C2  the group picker starts on "Choose a group" with its button off (W25); the shelf title and each row's buttons follow its real status (W32)
 *   C3  the Saved offers page asks before Approve, Go live, Pause, Retire and Delete (W28)
 *   T1  390 px: the landing lists the eight kinds in words, every tool button has a word, the "Work it out" sheet fits the screen and its x can be reached (W33 W34)
 *   T2  Dark is applied through CBAvatar.applyTheme and data-theme says dark; AA of the settings, the form, the sheet and the confirm (W43)
 *   NODE_PATH=e2e/node_modules node e2e/walk-offer-lab.cjs        headless, fast      ·   node e2e/walk-offer-lab.cjs --show   watch it
 */
'use strict';
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const { audit } = require('./lib/rule13.cjs');

const GROUP_HEADINGS = ["One thing's price", 'Two things together', 'Bill size', 'Allows or blocks'];
const TYPE_IDS = ['percent', 'amount', 'qty', 'free', 'bundle', 'spend', 'ship', 'band'];
const NAMED_GROUP = 'Wholesale';

/** a stand-in of routes/definitions.js: enough of list / read / create / update to prove what the cart writes */
function definitionsApi() {
  const db = new Map();
  let seq = 0;
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const handler = async (route) => {
    const req = route.request(), url = new URL(req.url()), parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/api/relationships/customers') return json(route, 200, { count: 7, customers: [] });
    if (url.pathname === '/api/relationships/customers/groups') return json(route, 200, { names: [NAMED_GROUP] });
    if (parts[1] !== 'definitions') return json(route, 404, {});
    const id = parts[2], body = req.postData() ? JSON.parse(req.postData()) : {};
    if (req.method() === 'GET' && !id) {
      return json(route, 200, { count: db.size, definitions: [...db.values()].map((d) => Object.assign({}, d, { rules: d.versions[0].rules })) });
    }
    if (req.method() === 'GET') return db.has(id) ? json(route, 200, { definition: db.get(id), versions: db.get(id).versions }) : json(route, 404, {});
    if (req.method() === 'POST') {
      const created = 'd' + ++seq;
      db.set(created, { definition_id: created, kind: body.kind, sub_kind: body.sub_kind, name: body.name, status: body.status || 'draft', created_at: W.nowIso(), versions: [{ version: 1, rules: body.rules || {} }] });
      return json(route, 201, { definition: db.get(created) });
    }
    if (req.method() === 'PUT' && db.has(id)) {
      const d = db.get(id);
      if (body.status) d.status = body.status;
      if (body.rules) d.versions.unshift({ version: d.versions.length + 1, rules: body.rules });
      return json(route, 200, { message: 'Saved', definition: d });
    }
    return json(route, 404, {});
  };
  return { db, handler };
}

/** the failures of rule 13 on the screen as it stands: AA of every text, clipping, inner scroll, covered controls, app.html links */
async function screenProblems(page, overlayOpen) {
  const pairs = await page.evaluate(measure);
  const bad = pairs.filter((x) => !x.grad && x.ratio < x.need);
  const seen = await audit(page, 'labBody');
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);
  const fails = [].concat(bad.map((x) => 'contrast ' + x.ratio + ' "' + x.text + '"'), seen.clip.map((x) => 'clipped ' + x), seen.scroll.map((x) => 'scroll ' + x),
    (overlayOpen ? [] : seen.cover).map((x) => 'covered ' + x), seen.app.map((x) => 'app.html ' + x), sideways ? ['the page scrolls sideways'] : []);
  return { fails, texts: pairs.length, lowest: Math.min.apply(null, pairs.map((x) => x.ratio)) };
}

/** type "A percentage off" with a small number into the form and add it to the cart (the page's own buttons) */
async function addOne(page, typeId, pct) {
  await page.evaluate(() => closeWork());
  await page.click('[data-testid="skel-nav-' + typeId + '"]');
  await page.waitForSelector('#s2.on');
  if (pct) await page.evaluate((v) => { S.scope = 'item'; S.itemId = 'masala'; S.itemIds = ['masala']; S.pctOff = v; render(); }, pct);
  await page.click('button[onclick="apply()"]');
  await page.waitForSelector('#workScrim.on');
  await page.click('#workSave');
  await page.waitForFunction(() => !document.getElementById('workScrim').classList.contains('on'));
}

/** v2: a saved offer opens in the MIDDLE from the left list; every action lives there. Opens the offer (a left row: by id or status) and returns it. */
async function openRow(page, which) {
  const row = page.locator(which.id ? '[data-testid="cart-row"][data-id="' + which.id + '"]' : '[data-testid="cart-row"]' + (which.status ? '[data-status="' + which.status + '"]' : '')).first();
  const id = which.id || (await row.getAttribute('data-id'));
  const open = page.locator('[data-testid="offer-open"][data-id="' + id + '"]');
  if (!(await open.count())) await row.click();
  await open.waitFor();
  return { id, open };
}

/** answer the lab kit's confirm: read its words, then Cancel or Confirm; returns the text it showed */
async function confirmWords(page, action) {
  await page.waitForSelector('[data-testid="lk-pop"] [data-testid="lk-confirm-text"]');
  const text = ((await page.textContent('[data-testid="lk-confirm-text"]')) || '').replace(/\s+/g, ' ').trim();
  await page.click(action === 'ok' ? '[data-testid="lk-confirm-ok"]' : '[data-testid="lk-confirm-cancel"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="lk-pop"]'));
  return text;
}
/** the four settings boxes after "Change": is each at least as tall as everything inside it (W29) */
async function settingsBoxFit(page) {
  return page.evaluate(() => [...document.querySelectorAll('#s0 .open .sfld')].map((box) => {
    const r = box.getBoundingClientRect(), label = box.querySelector('.lbl'), last = box.lastElementChild.getBoundingClientRect();
    return { label: label ? label.textContent : '?', high: Math.round(r.height), clipped: box.scrollHeight > box.clientHeight + 1 || last.bottom > r.bottom + 1 || getComputedStyle(box).overflow === 'hidden' && box.scrollHeight > box.clientHeight };
  }));
}
const walk = async (w) => {
  const { page, base } = w;
  const api = definitionsApi();
  const apiCalls = [];
  w.ctx.on('request', (q) => { if (/\/api\//.test(q.url())) apiCalls.push(q.method() + ' ' + new URL(q.url()).pathname); });
  await w.ctx.route(/\/api\//, api.handler);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(base + '/offer-lab-next.html?api=' + encodeURIComponent(base));
  await page.waitForSelector('[data-testid="skel-nav-percent"]');

  await w.step('O1', 'Trial: before any tap the left menu lists the eight types in four groups', async () => {
    const menu = await page.evaluate(() => ({
      ids: [...document.querySelectorAll('.side .nav-btn[data-sec]')].map((b) => b.getAttribute('data-sec')),
      heads: [...document.querySelectorAll('.side .nav-group')].map((n) => n.textContent.trim()),
      others: document.querySelectorAll('.side .lab-link, [data-testid="skel-labs"]').length,
      steps: document.querySelectorAll('#steps, .stp').length
    }));
    return { ok: menu.ids.join() === TYPE_IDS.join() && menu.heads.join('|') === GROUP_HEADINGS.join('|') && menu.others === 0 && menu.steps === 0,
      saw: menu.ids.length + ' types · headings ' + menu.heads.join(' / ') + ' · other labs in the menu ' + menu.others + ' · step bar ' + menu.steps };
  });

  await w.step('L1', 'Landing: no second door ("Create an offer", "Saved offers"), no empty circle, nothing lit in the menu, one line saying what to do', async () => {
    const got = await page.evaluate(() => ({
      doors: [...document.querySelectorAll('#s0 button')].map((b) => b.textContent.trim()).filter((t) => /^(Create an offer|Saved offers)/.test(t)),
      circle: !!document.getElementById('bizSw'),
      lit: [...document.querySelectorAll('.side .nav-btn.active')].length,
      hint: ((document.querySelector('[data-testid="landing-hint"]') || {}).textContent || '').trim()
    }));
    return { ok: !got.doors.length && !got.circle && got.lit === 0 && /left/.test(got.hint), saw: 'doors ' + got.doors.length + ' · circle ' + got.circle + ' · lit ' + got.lit + ' · "' + got.hint + '"' };
  });

  await w.step('L2', 'Settings "Change": the four boxes hold their own label, chips and help (no 46px box over 96-122px of content)', async () => {
    await page.click('.fine button');
    const boxes = await settingsBoxFit(page);
    const bad = boxes.filter((b) => b.clipped || b.high < 60);
    return { ok: boxes.length >= 3 && !bad.length, saw: boxes.map((b) => b.label + ' ' + b.high + 'px' + (b.clipped ? ' CLIPPED' : '')).join(' · ') };
  });

  await w.step('O2', 'Trial: pick "A percentage off" on the left -> its working step, the menu lights it', async () => {
    await page.click('[data-testid="skel-nav-percent"]');
    await page.waitForSelector('#s2.on');
    const got = await page.evaluate(() => ({
      title: (document.querySelector('#s2 h2') || {}).textContent,
      lit: [...document.querySelectorAll('.side .nav-btn.active')].map((b) => b.getAttribute('data-sec')),
      pickerScreen: !!document.querySelector('[data-testid="types-list"]'),
      settingsHidden: getComputedStyle(document.getElementById('s0')).display === 'none'
    }));
    return { ok: got.title === 'A percentage off' && got.lit.join() === 'percent' && !got.pickerScreen && got.settingsHidden, saw: '"' + got.title + '" · lit ' + got.lit.join() };
  });

  await w.step('P1', 'Every one of the eight types opens with nothing chosen and "Work it out" off, with its reason; loyalty is off', async () => {
    const seen = [];
    for (const id of TYPE_IDS) {
      await page.evaluate((t) => { pickGoal(t); }, id);
      const got = await page.evaluate(() => ({
        goal: S.goal,
        scopeChosen: !!(S.scope || S.catId || (S.itemIds || []).length),
        lit: document.querySelectorAll('#s2 .shape.on').length,
        picks: [S.giftId, S.itemId, S.pairA, S.pairB, S.bunA, S.bunB].filter(Boolean).length,
        loyOn: !!S.loyOn,
        off: !!(document.querySelector('#s2 button[onclick="apply()"]') || {}).disabled,
        why: ((document.querySelector('#s2 .acts .why') || {}).textContent || '').trim()
      }));
      const needsChoice = ['percent', 'amount', 'qty', 'free', 'bundle'].includes(id);
      const clean = !got.scopeChosen && got.lit === 0 && got.picks === 0 && !got.loyOn && (!needsChoice || (got.off && got.why));
      seen.push(id + (clean ? ' ok' : ' PRE-SET ' + JSON.stringify(got)));
    }
    return { ok: seen.every((x) => / ok$/.test(x)), saw: seen.join(' · ') };
  });

  await w.step('P1b', 'Something free: no shape is lit; each shape then opens with its gift, item, pair or category still on "Choose..." and "Work it out" off', async () => {
    const seen = [];
    for (const shape of ['anything', 'same', 'pair', 'cheapest']) {
      await page.evaluate((v) => { pickGoal('free'); setShape(v); }, shape);
      const got = await page.evaluate(() => ({ chooses: [...document.querySelectorAll('#s2 button')].filter((b) => /^Choose/.test(b.textContent.trim())).length, off: document.querySelector('#s2 button[onclick="apply()"]').disabled, why: (document.querySelector('#s2 .acts .why') || {}).textContent }));
      seen.push(shape + (got.chooses >= 1 && got.off && got.why ? ' ok' : ' PRE-SET ' + JSON.stringify(got)));
    }
    await page.evaluate(() => { S.freeShape = ''; render(); });
    return { ok: seen.every((x) => / ok$/.test(x)), saw: seen.join(' · ') };
  });

  await w.step('P2', 'Choosing a whole category shows "Applies to: all N items in <category>" with the true count, and only then "Work it out" is on', async () => {
    await page.evaluate(() => { pickGoal('percent'); });
    const before = await page.evaluate(() => ({ line: document.querySelector('[data-testid="reach-line"]').textContent, off: document.querySelector('#s2 button[onclick="apply()"]').disabled }));
    const want = await page.evaluate(() => { const c = CATS[1]; applyWholeCategory(c.id); return { n: catItems(c.id).length, name: c.name }; });
    const after = await page.evaluate(() => ({ line: document.querySelector('[data-testid="reach-line"]').textContent, off: document.querySelector('#s2 button[onclick="apply()"]').disabled }));
    const sentence = 'Applies to: all ' + want.n + ' item' + (want.n === 1 ? '' : 's') + ' in ' + want.name;
    await page.evaluate(() => { S.scope = ''; S.catId = ''; S.itemIds = []; render(); });
    return { ok: /nothing chosen yet/.test(before.line) && before.off && after.line === sentence && !after.off, saw: '"' + before.line + '" off ' + before.off + ' -> "' + after.line + '" off ' + after.off };
  });

  await w.step('O3', 'Trial: work it out, add it -> "Your offers (1)" on the left lists it under Draft and it opens in the middle; no request left the page', async () => {
    await addOne(page, 'percent', 10);
    const cart = await page.evaluate(() => ({
      title: (document.querySelector('[data-testid="cart-title"]') || {}).textContent,
      rows: document.querySelectorAll('[data-testid="cart-row"]').length,
      pill: (document.querySelector('[data-testid="cart-row"]') || { getAttribute() {} }).getAttribute('data-status'),
      left: document.querySelector('[data-testid="skel-pinned"]').getBoundingClientRect().right <= document.getElementById('s3').getBoundingClientRect().left + 1,
      open: !!document.querySelector('#s3.on [data-testid="offer-open"]')
    }));
    return { ok: cart.title === 'Your offers (1)' && cart.rows === 1 && cart.pill === 'draft' && cart.left && cart.open && apiCalls.length === 0,
      saw: '"' + cart.title + '" · ' + cart.rows + ' row (' + cart.pill + ') · shelf is left of the middle ' + cart.left + ' · opened in the middle ' + cart.open + ' · api calls ' + apiCalls.length };
  });

  await w.step('O3b', 'Trial: the line after Add says what was saved, on what, and that it is not live', async () => {
    const said = ((await page.textContent('[data-testid="cart-said"]')) || '').trim();
    const sheetPromise = await page.evaluate(() => { S.scope = 'item'; S.itemIds = ['masala']; render(); apply(); const t = document.getElementById('workPromise').textContent; closeWork(); return t; });
    return { ok: /^Added as a draft: A percentage off · 10% off · /.test(said) && /Not live yet/.test(said) && /Saves a draft/.test(sheetPromise) && /Nothing is live until you make it live/.test(sheetPromise), saw: '"' + said + '" · sheet: "' + sheetPromise + '"' };
  });

  await w.step('O4', 'Trial: "Make live" and "Only for a group" say to sign in, in the row; still no request', async () => {
    await page.click('[data-testid="cart-live"]');
    const first = (await page.textContent('[data-testid="cart-note"]')).trim();
    await page.click('[data-testid="cart-group"]');
    const second = (await page.textContent('[data-testid="cart-note"]')).trim();
    return { ok: first === 'Sign in to use this in your shop.' && second === first && apiCalls.length === 0, saw: '"' + first + '" · api calls ' + apiCalls.length };
  });

  await w.step('C3b', 'Trial: Delete asks first and says it cannot be undone; Cancel keeps the offer', async () => {
    await openRow(page, {});
    await page.waitForSelector('[data-testid="shelf-drop"]');
    const before = await page.evaluate(() => SAVED.length);
    await page.click('[data-testid="shelf-drop"]');
    const words = await confirmWords(page, 'cancel');
    const kept = (await page.evaluate(() => SAVED.length)) === before;
    await page.click('[data-testid="shelf-drop"]');
    await confirmWords(page, 'ok');
    const gone = (await page.evaluate(() => SAVED.length)) === before - 1;
    return { ok: kept && gone && /cannot be undone/.test(words), saw: 'cancel kept ' + kept + ' · confirm removed ' + gone + ' · "' + words.slice(0, 100) + '"' };
  });

  /* ── signed in: a second page of the same browser holds the session ─────────────────────────────────────────────── */
  const signed = await w.ctx.newPage();
  await signed.addInitScript((sess) => { localStorage.setItem('cb_sess', sess); }, W.session('Fixture Owner', 'Fixture Shop'));
  await signed.setViewportSize({ width: 1280, height: 860 });
  await signed.goto(base + '/offer-lab-next.html?api=' + encodeURIComponent(base));
  await signed.waitForSelector('[data-testid="skel-nav-percent"]');
  await signed.waitForFunction(() => typeof savedLive === 'function' && savedLive());

  await w.step('O5', 'Signed in: add two offers -> both are definitions in status draft', async () => {
    await addOne(signed, 'percent', 10);
    await addOne(signed, 'percent', 15);
    await signed.waitForFunction(() => document.querySelectorAll('[data-testid="cart-row"]').length === 2);
    const statuses = [...api.db.values()].map((d) => d.status);
    return { ok: statuses.length === 2 && statuses.every((s) => s === 'draft'), saw: statuses.length + ' definitions: ' + statuses.join(', ') };
  });

  await w.step('C2a', 'Signed in: the left heading counts what is on the shelf ("Your offers (2)"), both drafts sit under Draft, and an open draft offers Make live and Only for a group', async () => {
    const got = await signed.evaluate(() => ({ title: document.querySelector('[data-testid="cart-title"]').textContent,
      drafts: document.querySelectorAll('.pin-sec[data-status="draft"] [data-testid="cart-row"]').length, rows: document.querySelectorAll('[data-testid="cart-row"]').length }));
    const { open } = await openRow(signed, { status: 'draft' });
    const buttons = { live: await open.locator('[data-testid="cart-live"]').count(), group: await open.locator('[data-testid="cart-group"]').count() };
    return { ok: got.title === 'Your offers (2)' && got.drafts === 2 && got.rows === 2 && buttons.live === 1 && buttons.group === 1, saw: got.title + ' · ' + got.drafts + ' under Draft · open draft has Make live ' + buttons.live + ', Only for a group ' + buttons.group };
  });

  await w.step('C1', 'Signed in: "Make live" asks first. Cancel changes nothing and sends no request; the question names what, whom, on what (count) and from when', async () => {
    const { id, open } = await openRow(signed, {});
    const callsBefore = apiCalls.length;
    await open.locator('[data-testid="cart-live"]').click();
    const text = await confirmWords(signed, 'cancel');
    const unchanged = api.db.get(id).status === 'draft' && apiCalls.length === callsBefore;
    const wordsOk = /Make this offer live\?|A percentage off/.test(text) && /On: .*1 item: Masala/i.test(text) && /For: every customer/.test(text) && /From: now/.test(text);
    return { ok: unchanged && wordsOk, saw: 'unchanged ' + unchanged + ' · "' + text.slice(0, 220) + '"' };
  });

  await w.step('C2b', 'Signed in: the group picker starts on "Choose a group" and "Make live for them" is off until one is chosen', async () => {
    const { open } = await openRow(signed, {});
    await open.locator('[data-testid="cart-group"]').click();
    await signed.waitForSelector('[data-testid="cart-group-pick"] optgroup option', { state: 'attached' });
    const got = await signed.evaluate(() => { const pick = document.querySelector('[data-testid="cart-group-pick"]'); return { value: pick.value, off: document.querySelector('[data-testid="cart-group-apply"]').disabled }; });
    return { ok: got.value === '' && got.off, saw: 'select value "' + got.value + '" · button off ' + got.off };
  });

  let groupId = null;
  await w.step('O6', 'Signed in: "Only for a group" -> the shop\'s named group -> live, only for them', async () => {
    const { id } = await openRow(signed, {});
    groupId = id;
    await signed.waitForSelector('[data-testid="cart-group-pick"] optgroup option', { state: 'attached' });
    await signed.selectOption('[data-testid="cart-group-pick"]', 'group:' + NAMED_GROUP);
    const enabled = await signed.evaluate(() => !document.querySelector('[data-testid="cart-group-apply"]').disabled);
    await signed.click('[data-testid="cart-group-apply"]');
    const asked = await confirmWords(signed, 'cancel');
    const stillDraft = api.db.get(id).status === 'draft';
    await signed.click('[data-testid="cart-group-apply"]');
    const wordsGroup = await confirmWords(signed, 'ok');
    if (!enabled || !stillDraft || !new RegExp('For: ' + NAMED_GROUP + ' .*only').test(wordsGroup) || !/On: /.test(asked)) return { ok: false, saw: 'enabled ' + enabled + ' · draft after Cancel ' + stillDraft + ' · "' + wordsGroup + '"' };
    await signed.waitForFunction((want) => [...document.querySelectorAll('[data-testid="cart-note"]')].some((n) => n.textContent === want), 'Live, only for ' + NAMED_GROUP + '.');
    const def = api.db.get(id), rules = def.versions[0].rules;
    return { ok: def.status === 'live' && rules.customer_group === 'group:' + NAMED_GROUP && rules.customer_name === NAMED_GROUP && rules.percent === 10 && def.versions.length === 2,
      saw: def.status + ' · customer_group ' + rules.customer_group + ' · percent kept ' + rules.percent + ' · versions ' + def.versions.length };
  });

  await w.step('O7', 'Signed in: "Make live" on the other -> live for everyone (no customer_group)', async () => {
    const { id, open } = await openRow(signed, { status: 'draft' });
    await open.locator('[data-testid="cart-live"]').click();
    await confirmWords(signed, 'ok');
    await signed.waitForFunction((want) => [...document.querySelectorAll('[data-testid="cart-note"]')].some((n) => n.textContent === want), 'Live for everyone.');
    const def = api.db.get(id);
    return { ok: def.status === 'live' && def.versions[0].rules.customer_group === undefined, saw: def.status + ' · customer_group ' + def.versions[0].rules.customer_group };
  });

  await w.step('O7b', 'Signed in: after a reload the group offer still says "only for <group>" (not "for everyone")', async () => {
    await signed.reload();
    await signed.waitForSelector('[data-testid="cart-row"][data-id="' + groupId + '"]');
    await openRow(signed, { id: groupId });
    const said = (await signed.textContent('[data-testid="offer-open"] [data-testid="cart-note"]')).trim();
    const widen = (await signed.textContent('[data-testid="offer-open"] [data-testid="cart-live"]')).trim();
    return { ok: said === 'Live, only for ' + NAMED_GROUP + '.' && widen === 'Make live for everyone', saw: '"' + said + '" · button "' + widen + '"' };
  });

  await w.step('O7c', 'Signed in: Edit the group offer and add it again -> the group is kept in its rules', async () => {
    await signed.evaluate((id) => { openSaved(id); apply(); }, groupId);
    await signed.waitForSelector('#workScrim.on');
    await signed.click('#workSave');
    await signed.waitForFunction(() => !document.getElementById('workScrim').classList.contains('on'));
    const rules = api.db.get(groupId).versions[0].rules;
    return { ok: rules.customer_group === 'group:' + NAMED_GROUP && rules.customer_name === NAMED_GROUP, saw: 'customer_group ' + rules.customer_group + ' · name ' + rules.customer_name };
  });

  await w.step('O7d', 'Signed in: "Make live" on the group offer clears the group and says so (make live = everyone)', async () => {
    const { open } = await openRow(signed, { id: groupId });
    await open.locator('[data-testid="cart-live"]').click();
    const widenWords = await confirmWords(signed, 'ok');
    if (!/it was only for Wholesale/.test(widenWords)) return { ok: false, saw: '"' + widenWords + '"' };
    const want = 'Was only for ' + NAMED_GROUP + ', now for everyone.';
    await signed.waitForFunction((t) => [...document.querySelectorAll('[data-testid="cart-note"]')].some((n) => n.textContent === t), want);
    const def = api.db.get(groupId), rules = def.versions[0].rules;
    return { ok: def.status === 'live' && rules.customer_group === undefined && rules.customer_name === undefined, saw: def.status + ' · customer_group ' + rules.customer_group };
  });

  await w.step('C2c', 'Signed in: both live -> "Your offers (2)" lists them under Live; one more draft -> 3; a live-for-everyone offer has no "Make live"; an approved one says "not live yet" and offers Go live', async () => {
    const allLive = await signed.evaluate(() => ({ title: document.querySelector('[data-testid="cart-title"]').textContent, live: document.querySelectorAll('.pin-sec[data-status="live"] [data-testid="cart-row"]').length }));
    await addOne(signed, 'percent', 20);
    await signed.waitForFunction(() => document.querySelectorAll('[data-testid="cart-row"]').length === 3);
    const title = await signed.evaluate(() => document.querySelector('[data-testid="cart-title"]').textContent);
    const liveIds = await signed.evaluate(() => [...document.querySelectorAll('[data-testid="cart-row"][data-status="live"]')].map((r) => r.getAttribute('data-id')));
    const buttons = [];
    for (const id of liveIds) {
      const { open } = await openRow(signed, { id });
      if (/Live for everyone/.test(await open.textContent())) buttons.push(await open.locator('[data-testid="cart-live"]').count());
    }
    const draft = await openRow(signed, { status: 'draft' });
    await draft.open.locator('[data-testid="shelf-step"]').click();
    await confirmWords(signed, 'ok');
    await signed.waitForSelector('[data-testid="offer-open"] .pill.p-appr');
    const appr = await signed.evaluate(() => (document.querySelector('[data-testid="offer-open"] .pill.p-appr') || {}).textContent);
    const goLive = (await signed.textContent('[data-testid="offer-open"] [data-testid="shelf-step"]')).trim();
    return { ok: allLive.title === 'Your offers (2)' && allLive.live === 2 && title === 'Your offers (3)' && buttons.length >= 1 && buttons.every((n) => n === 0) && /not live yet/.test(appr || '') && goLive === 'Go live',
      saw: 'two live: "' + allLive.title + '" with ' + allLive.live + ' under Live · then "' + title + '" · live-for-everyone offers\' "Make live" buttons ' + buttons.join(',') + ' · approved pill "' + appr + '" with "' + goLive + '"' };
  });

  await w.step('C3', 'Signed in, the open offer: Go live, Pause and Retire each ask first; Cancel changes nothing, Confirm commits', async () => {
    const statusOf = (id) => api.db.get(id).status;
    const approvedId = [...api.db.values()].find((x) => x.status === 'approved').definition_id;
    const { open } = await openRow(signed, { id: approvedId });
    const calls = apiCalls.length;
    await open.locator('[data-testid="shelf-step"]').click();
    const goLive = await confirmWords(signed, 'cancel');
    const cancelled = statusOf(approvedId) === 'approved' && apiCalls.length === calls;
    await open.locator('[data-testid="shelf-step"]').click();
    await confirmWords(signed, 'ok');
    await signed.waitForSelector('[data-testid="offer-open"] .pill.p-live');
    const liveNow = statusOf(approvedId) === 'live';
    await signed.locator('[data-testid="offer-open"] [data-testid="shelf-drop"]').click();
    const retire = await confirmWords(signed, 'cancel');
    const stillThere = api.db.size === 3;
    return { ok: cancelled && liveNow && /Every bill from now on gets it/.test(goLive) && /Bills already made/.test(retire) && stillThere && /From: now/.test(goLive), saw: 'rows ' + api.db.size + ' · cancel kept it approved ' + cancelled + ' · confirm made it live ' + liveNow + ' · retire says "' + retire.slice(0, 120) + '"' };
  });

  const waitStatus = async (id, want) => { for (let i = 0; i < 40 && api.db.get(id).status !== want; i++) await signed.waitForTimeout(100); return api.db.get(id).status; };
  await w.step('C4', 'Signed in: a group offer, Paused then Resumed, keeps its group; the Resume confirm names the group; the group is still in the saved rules', async () => {
    await addOne(signed, 'percent', 30);
    const id = [...api.db.keys()].pop();
    const { open } = await openRow(signed, { id });
    await open.locator('[data-testid="cart-group"]').click();
    await signed.waitForSelector('[data-testid="cart-group-pick"] optgroup option', { state: 'attached' });
    await signed.selectOption('[data-testid="cart-group-pick"]', 'group:' + NAMED_GROUP);
    await signed.click('[data-testid="cart-group-apply"]');
    await confirmWords(signed, 'ok');
    const live1 = await waitStatus(id, 'live');
    await signed.evaluate((x) => { askStatus(x, 'paused'); }, id);
    await confirmWords(signed, 'ok');
    const paused = await waitStatus(id, 'paused');
    await signed.waitForFunction((x) => { const r = document.querySelector('[data-testid="offer-open"][data-id="' + x + '"]'); return r && /Resume/.test(r.textContent); }, id);
    await signed.locator('[data-testid="offer-open"][data-id="' + id + '"] [data-testid="shelf-step"]').click();
    const words = await confirmWords(signed, 'ok');
    const back = await waitStatus(id, 'live');
    const rules = api.db.get(id).versions[0].rules;
    return { ok: live1 === 'live' && paused === 'paused' && back === 'live' && rules.customer_group === 'group:' + NAMED_GROUP && rules.customer_name === NAMED_GROUP && new RegExp('For: ' + NAMED_GROUP + ' .*only').test(words),
      saw: 'live ' + live1 + ' -> ' + paused + ' -> ' + back + ' · customer_group ' + rules.customer_group + ' · "' + words.slice(0, 200) + '"' };
  });

  await w.step('C4c', 'An APPROVED group offer: Go live names the group (not "every customer") and the saved rules keep customer_group', async () => {
    const id = [...api.db.keys()].pop();
    api.db.get(id).status = 'approved';
    await signed.evaluate(() => loadSaved());
    const { open } = await openRow(signed, { id });
    await open.locator('[data-testid="shelf-step"]').click();
    const words = await confirmWords(signed, 'ok');
    const back = await waitStatus(id, 'live');
    const rules = api.db.get(id).versions[0].rules;
    return { ok: back === 'live' && new RegExp('For: ' + NAMED_GROUP + ' .*only').test(words) && !/every customer/.test(words) && rules.customer_group === 'group:' + NAMED_GROUP,
      saw: back + ' · customer_group ' + rules.customer_group + ' · "' + words.slice(0, 160) + '"' };
  });

  await w.step('C4b', 'An automatic group is named with how many customers it holds now (the api stand-in says 7)', async () => {
    const label = await signed.evaluate(async () => { await groupCountFor('new'); return groupLabel('new'); });
    return { ok: label === 'New customers (7 customers now)', saw: label };
  });

  await w.step('C5', 'A saved offer whose items left the catalogue still says a number, never just "the items you chose"', async () => {
    const got = await signed.evaluate(() => ({
      some: savedReachWords({ snap: { goal: 'percent', scope: 'item', itemIds: ['masala', 'gone'] } }),
      none: savedReachWords({ snap: { goal: 'percent', scope: 'item', itemIds: ['gone', 'gone2'] } }),
      free: savedReachWords({ snap: { goal: 'free', freeShape: 'same', itemId: 'gone' } })
    }));
    return { ok: /^1 item: .*, 1 no longer in your catalogue$/.test(got.some) && /^0 items, 2 no longer in your catalogue$/.test(got.none) && /^0 items: .*no longer in your catalogue$/.test(got.free), saw: JSON.stringify(got) };
  });

  await w.step('C6', 'Editing a LIVE offer says in the sheet that it comes off for customers until it is made live again', async () => {
    const id = [...api.db.keys()].pop();
    const said = await signed.evaluate((x) => { openSaved(x); apply(); const t = document.getElementById('workPromise').textContent; closeWork(); return t; }, id);
    return { ok: /Editing takes it off for customers until you make it live again/.test(said), saw: '"' + said + '"' };
  });

  await w.step('C7', 'Esc with a confirm open closes only the confirm; the Work-it-out sheet under it stays until a second Esc', async () => {
    await signed.evaluate(() => { pickGoal('percent'); applyWholeCategory(CATS[1].id); apply(); askPromise({ id: 'x', title: 'A percentage off', detail: '10% off', snap: { goal: 'percent', scope: 'cat', catId: CATS[1].id } }, 'live', null, function () {}); });
    await signed.waitForSelector('[data-testid="lk-pop"]');
    await signed.keyboard.press('Escape');
    const first = await signed.evaluate(() => ({ pop: !!document.querySelector('[data-testid="lk-pop"]'), sheet: document.getElementById('workScrim').classList.contains('on') }));
    await signed.keyboard.press('Escape');
    const second = await signed.evaluate(() => document.getElementById('workScrim').classList.contains('on'));
    return { ok: !first.pop && first.sheet && !second, saw: 'after Esc 1: confirm open ' + first.pop + ', sheet open ' + first.sheet + ' · after Esc 2: sheet open ' + second };
  });

  await w.step('V1', 'Left: the four type groups start open, say how many types they hold, and fold and unfold', async () => {
    const before = await page.evaluate(() => [...document.querySelectorAll('.side .nav-fold')].map((h) => ({ open: h.getAttribute('aria-expanded'), count: h.getAttribute('data-count'), seen: h.nextElementSibling.hidden === false })));
    const first = page.locator('.side .nav-fold').first();
    await first.click();
    const folded = await page.evaluate(() => ({ expanded: document.querySelector('.side .nav-fold').getAttribute('aria-expanded'), shown: !!document.querySelector('.side .nav-items').offsetParent }));
    await first.click();
    const back = await page.evaluate(() => ({ expanded: document.querySelector('.side .nav-fold').getAttribute('aria-expanded'), shown: !!document.querySelector('.side .nav-items').offsetParent }));
    return { ok: before.length === 4 && before.every((h) => h.open === 'true' && h.seen && Number(h.count) >= 1) && before.map((h) => h.count).join() === '3,2,2,1' && folded.expanded === 'false' && !folded.shown && back.expanded === 'true' && back.shown,
      saw: 'groups ' + before.map((h) => h.count).join('/') + ' open · folded: expanded ' + folded.expanded + ' shown ' + folded.shown + ' · unfolded shown ' + back.shown };
  });

  await w.step('V2', 'Your offers: three rows per status then "and N more" (a list); a paused offer sits under Paused and is one tap from Resume; no one-tap commit on the left', async () => {
    for (const pct of [41, 42, 43, 44]) await addOne(signed, 'percent', pct);
    const draftIds = await signed.evaluate(() => [...document.querySelectorAll('.pin-sec[data-status="draft"] [data-testid="cart-row"]')].map((r) => r.getAttribute('data-id')));
    const total = await signed.evaluate(() => SAVED.filter((x) => x.status === 'draft').length);
    const more = await signed.textContent('[data-testid="lk-more-offers-draft"]');
    await signed.click('[data-testid="lk-more-offers-draft"]');
    await signed.waitForSelector('[data-testid="lk-pop"] .cbl-row');
    const popRows = await signed.evaluate(() => document.querySelectorAll('[data-testid="lk-pop"] .cbl-row').length);
    await signed.keyboard.press('Escape');
    const liveId = await signed.evaluate(() => (SAVED.filter((x) => x.status === 'live')[0] || {}).id);
    await signed.evaluate((id) => { askStatus(id, 'paused'); }, liveId);
    await confirmWords(signed, 'ok');
    await signed.waitForSelector('.pin-sec[data-status="paused"] [data-testid="cart-row"]');
    const resumable = await openRow(signed, { id: liveId });
    const stepWord = (await resumable.open.locator('[data-testid="shelf-step"]').textContent()).trim();
    const leftButtons = await signed.evaluate(() => document.querySelectorAll('.side-pinned [data-testid="cart-live"], .side-pinned [data-testid="shelf-step"], .side-pinned [data-testid="shelf-drop"]').length);
    /* UX-117: the shop's own offers come first - the shelf sits above the kinds in the left panel */
    const shelfFirst = await signed.evaluate(() => { const shelf = document.querySelector('.side .side-pinned'), nav = document.querySelector('.side #nav'); return !!shelf && !!nav && !!(shelf.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING); });
    return { ok: shelfFirst && draftIds.length === 3 && total >= 4 && new RegExp('^and ' + (total - 3) + ' more$').test(more.trim()) && popRows >= 1 && stepWord === 'Resume' && leftButtons === 0,
      saw: 'shelf above the kinds ' + shelfFirst + ' · ' + draftIds.length + ' draft rows of ' + total + ' · "' + more.trim() + '" · list rows ' + popRows + ' · paused offer\'s step "' + stepWord + '" · commit buttons on the left ' + leftButtons };
  });

  await w.step('V3', 'Right: "What this promises" says word for word what the confirm popup of the same next step says (draft, approved, live, paused)', async () => {
    const ids = await signed.evaluate(() => { const by = {}; SAVED.forEach((x) => { (by[x.status] = by[x.status] || []).push(x.id); }); return by; });
    const pool = [].concat(...Object.values(ids)), setTo = ['live', 'paused', 'approved', 'draft'];
    pool.slice(0, 4).forEach((id, i) => { api.db.get(id).status = setTo[i]; });
    await signed.evaluate(() => loadSaved());
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const id = pool[i];
      const { open } = await openRow(signed, { id });
      await signed.waitForFunction(() => document.querySelector('[data-testid="promise-text"]'));
      const pane = (await signed.textContent('[data-testid="promise-text"]')).replace(/\s+/g, ' ').trim();
      const button = setTo[i] === 'draft' ? '[data-testid="cart-live"]' : '[data-testid="shelf-step"]';
      await open.locator(button).click();
      const popup = await confirmWords(signed, 'cancel');
      seen.push({ status: setTo[i], same: pane === popup, pane: pane.slice(0, 60) });
    }
    return { ok: seen.every((x) => x.same && x.pane), saw: seen.map((x) => x.status + (x.same ? ' same' : ' DIFFERENT')).join(' · ') + ' · "' + seen[0].pane + '"' };
  });

  const phoneSigned = async (theme) => {
    const phone = await w.ctx.newPage();
    await phone.addInitScript((sess) => { localStorage.setItem('cb_sess', sess); }, W.session('Fixture Owner', 'Fixture Shop'));
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(base + '/offer-lab-next.html?api=' + encodeURIComponent(base));
    await phone.waitForFunction(() => typeof savedLive === 'function' && savedLive() && SAVED.length > 0);
    await phone.evaluate((t) => { CBAvatar.applyTheme(t); }, theme);
    return phone;
  };
  for (const theme of ['cream', 'dark']) {
    await w.step('V4·' + theme, '390 px, ' + theme + ': no icons-only rail; the switch (44 px) has New and Your offers (N); the shelf is under it; the sentence sits right above the action button; AA, no sideways scroll', async () => {
      const phone = await phoneSigned(theme);
      const got = await phone.evaluate(() => ({
        side: getComputedStyle(document.getElementById('side')).display,
        tabs: [...document.querySelectorAll('.lab-switch-btn')].map((b) => ({ word: b.textContent.trim(), high: Math.round(b.getBoundingClientRect().height) })),
        count: SAVED.length
      }));
      await phone.click('[data-testid="lab-switch-yours"]');
      const yours = await phone.evaluate(() => { const shelf = document.querySelector('[data-testid="skel-pinned"]').getBoundingClientRect(); return { shown: shelf.height > 50, within: shelf.left >= 0 && shelf.right <= window.innerWidth, screenHidden: getComputedStyle(document.getElementById('screen')).display === 'none' }; });
      const yoursProblems = await screenProblems(phone);
      await phone.click('[data-testid="cart-row"]');
      await phone.waitForSelector('[data-testid="offer-open"]');
      const above = await phone.evaluate(() => { const pane = document.getElementById('labPromise'), acts = document.querySelector('.offer-open .cartacts'); return { right: pane.nextElementSibling === acts, fixed: getComputedStyle(pane).position === 'fixed', text: pane.textContent.length > 40 }; });
      const openProblems = await screenProblems(phone);
      await phone.screenshot({ path: require('path').join(__dirname, 'shots', 'offer-lab-v2-' + theme + '-390.png') });
      await phone.close();
      const fails = yoursProblems.fails.concat(openProblems.fails);
      return { ok: got.side === 'none' && got.tabs.length === 2 && got.tabs.every((t) => t.high >= 44) && got.tabs[1].word === 'Your offers (' + got.count + ')' && yours.shown && yours.within && yours.screenHidden && above.right && !above.fixed && above.text && !fails.length,
        saw: 'rail ' + got.side + ' · tabs ' + got.tabs.map((t) => t.word + ' ' + t.high + 'px').join(', ') + ' · shelf shown ' + yours.shown + ' · sentence above the buttons ' + above.right + ' fixed ' + above.fixed + (fails.length ? ' · ' + fails.slice(0, 3).join(' · ') : ' · AA clean (lowest ' + Math.min(yoursProblems.lowest, openProblems.lowest) + ')') };
    });
  }

  /* ── margin effect in the promise sentence (Athi 22 Oct) ── */
  for (const theme of ['cream', 'dark']) {
    await w.step('M1·' + theme, '390 px, ' + theme + ': a saved percent offer with known costs says "Margin on these items: X% → Y%" in the pane AND the confirm popup; cost-blind says nothing; AA, no sideways scroll', async () => {
      const phone = await phoneSigned(theme);
      const set = await phone.evaluate(() => {
        const ids = P.slice(0, 3).map((x) => x.id);
        P.slice(0, 3).forEach((x, i) => { x.cost = Math.round(x.price * (0.5 + i * 0.05) * 100) / 100; });
        const item = { id: 'mg1', title: 'A percentage off', detail: '10% off', status: 'approved', n: '—', k: 'saved', snap: { goal: 'percent', scope: 'item', itemIds: ids, pctOff: 10, belowAct: 'exclude', round: '0' } };
        SAVED = [item]; render(); openOffer('mg1');
        const t = totals(lineRows(item.snap));
        return { line: 'Margin on these items: ' + t.marginBefore + '% → ' + t.marginAfter + "% (as if one of each, at today's costs).", pane: document.querySelector('[data-testid="promise-text"]').innerText.replace(/\s+/g, ' ') };
      });
      await phone.locator('[data-testid="offer-open"] [data-testid="shelf-step"]').first().click();
      await phone.waitForSelector('[data-testid="lk-confirm-text"]');
      const popup = (await phone.textContent('[data-testid="lk-confirm-text"]')).replace(/\s+/g, ' ');
      const problems = await screenProblems(phone, true);
      await phone.screenshot({ path: require('path').join(__dirname, 'shots', 'offer-lab-margin-' + theme + '-390.png') });
      await phone.click('[data-testid="lk-confirm-cancel"]');
      const blind = await phone.evaluate(() => { COST_ACCESS.can_see_costs = false; render(); openOffer('mg1'); return document.querySelector('[data-testid="promise-text"]').innerText; });
      await phone.close();
      return { ok: set.pane.includes(set.line) && popup.includes(set.line) && !/[Mm]argin|cost price/.test(blind) && !problems.fails.length, saw: set.line + ' · pane+popup agree ' + (set.pane.includes(set.line) && popup.includes(set.line)) + ' · blind shows ' + /[Mm]argin/.test(blind) + (problems.fails.length ? ' · ' + problems.fails.slice(0, 3).join(' · ') : ' · AA clean') };
    });
  }

  /* ── the phone ─────────────────────────────────────────────────────────────────────────────────────────────────── */
  await w.step('T1', '390 px, first visit: the landing lists the eight kinds in words, every tool button has a word, the "Work it out" sheet fits the screen and its x can be tapped', async () => {
    const phone = await w.ctx.newPage();
    await phone.addInitScript(() => { try { Object.keys(localStorage).filter((k) => k.indexOf('cb_offerlab_settings_') === 0).forEach((k) => localStorage.removeItem(k)); } catch (_) { /* a private window: nothing stored, nothing to clear */ } });
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(base + '/offer-lab-next.html?api=' + encodeURIComponent(base));
    await phone.waitForSelector('[data-testid="types-list"]');
    /* UX-117: the four tools are ONE Tools button on a phone, so the row is one line (60px at most) and the kinds start higher; opening it lists the four */
    const toolsRowHigh = await phone.evaluate(() => Math.round(document.querySelector('.labtools').getBoundingClientRect().height));
    await phone.click('[data-testid="tool-menu"]');
    const landing = await phone.evaluate(() => ({
      onSettings: document.getElementById('s0').classList.contains('on'),
      words: document.querySelectorAll('[data-testid="types-list"] .goal b').length,
      lit: document.querySelectorAll('.side .nav-btn.active').length + document.querySelectorAll('[data-testid="types-list"] .goal.on').length,
      tools: [...document.querySelectorAll('.labtools .tool')].map((b) => ({ word: (b.querySelector('.tx') || {}).textContent, shown: !!b.querySelector('.tx') && getComputedStyle(b.querySelector('.tx')).display !== 'none', high: Math.round(b.getBoundingClientRect().height) }))
    }));
    await phone.evaluate(() => { pickGoal('percent'); applyWholeCategory(CATS[1].id); apply(); });
    await phone.waitForSelector('#workScrim.on');
    const sheet = await phone.evaluate(() => {
      const box = document.querySelector('#workScrim .sheet').getBoundingClientRect(), close = document.querySelector('#workScrim .shhd [data-cbname="close"]').getBoundingClientRect();
      const hit = document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2);
      return { left: Math.round(box.left), right: Math.round(box.right), width: window.innerWidth, closeIn: close.left >= 0 && close.right <= window.innerWidth && close.top >= 0 && close.bottom <= window.innerHeight, closeHit: !!hit && !!hit.closest('[data-cbname="close"]') };
    });
    await phone.click('#workScrim .shhd [data-cbname="close"]');
    const closed = await phone.evaluate(() => !document.getElementById('workScrim').classList.contains('on'));
    await phone.close();
    const toolsOk = toolsRowHigh <= 60 && landing.tools.length === 4 && landing.tools.every((t) => t.shown && t.word && t.word.trim() && t.high >= 44);
    return { ok: landing.onSettings && landing.words === 8 && landing.lit === 0 && toolsOk && sheet.left >= 0 && sheet.right <= sheet.width && sheet.closeIn && sheet.closeHit && closed,
      saw: 'landing on settings ' + landing.onSettings + ' · ' + landing.words + ' kinds in words (tools row ' + toolsRowHigh + 'px shut) · lit ' + landing.lit + ' · tools ' + landing.tools.map((t) => t.word + ' ' + t.high + 'px').join(', ') + ' · sheet ' + sheet.left + '..' + sheet.right + ' of ' + sheet.width + ' · x reachable ' + sheet.closeHit + ' · closed by x ' + closed };
  });

  await w.step('O8', '390 px: the menu is icons only, so the middle lists the eight types in words; pick one -> form; "All types" -> back', async () => {
    const phone = await w.ctx.newPage();
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(base + '/offer-lab-next.html?api=' + encodeURIComponent(base));
    await phone.waitForSelector('[data-testid="types-list"]');
    const first = await phone.evaluate(() => ({
      words: [...document.querySelectorAll('[data-testid="types-list"] .goal b')].map((b) => b.textContent.trim()),
      labelsHidden: [...document.querySelectorAll('.side .nav-btn[data-sec] .label')].every((l) => getComputedStyle(l).display === 'none'),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1
    }));
    await phone.click('[data-testid="type-qty"]');
    await phone.waitForSelector('#s2.on [data-testid="all-types"]');
    const form = await phone.evaluate(() => (document.querySelector('#s2 h2') || {}).textContent);
    await phone.click('[data-testid="all-types"]');
    await phone.waitForSelector('[data-testid="types-list"]');
    await phone.close();
    return { ok: first.words.length === 8 && first.labelsHidden && !first.sideways && form === 'Cheaper when they buy more', saw: first.words.length + ' types in words · menu labels hidden ' + first.labelsHidden + ' · form "' + form + '"' };
  });

  /* ── rule 13: the working step with the cart, signed in, Cream and Dark at 1280 and 390 ──────────────────────────────── */
  for (const theme of ['cream', 'dark']) {
    for (const width of [1280, 390]) {
      await signed.setViewportSize({ width, height: width > 500 ? 860 : 844 });
      await signed.evaluate(() => pickGoal('percent'));
      await signed.evaluate((t) => { CBAvatar.applyTheme(t); }, theme);
      await signed.waitForTimeout(200);
      await w.step('O9·' + theme + '·' + width, 'Offer Lab · ' + theme + ' · ' + width + ' px -> AA contrast, no sideways scroll, nothing over a control, no app.html link', async () => {
        const got = await screenProblems(signed);
        return { ok: !got.fails.length && got.texts > 10, saw: got.texts + ' texts, lowest ' + got.lowest + (got.fails.length ? ' · ' + got.fails.slice(0, 4).join(' · ') : ' · clean') };
      });
      await signed.screenshot({ path: require('path').join(__dirname, 'shots', 'offer-lab-' + theme + '-' + width + '.png') });
    }
  }
  /* ── Dark through the avatar (the stored key alone does not switch it): data-theme must say so, and the new pieces must read in both themes ─────── */
  const SHOWN = {
    settings: () => { labStep(0); S0_OPEN = true; render(); },
    form: () => { closeWork(); pickGoal('percent'); applyWholeCategory(CATS[1].id); edit('loyOn', true); },
    sheet: () => { apply(); },
    confirm: () => { closeWork(); askPromise({ id: 'x', title: 'A percentage off', detail: '10% off', snap: { goal: 'percent', scope: 'cat', catId: CATS[1].id } }, 'live', null, function () {}); }
  };
  for (const theme of ['cream', 'dark']) {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.evaluate((t) => { CBAvatar.applyTheme(t); }, theme);
    const stamped = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    for (const state of Object.keys(SHOWN)) {
      await page.evaluate(SHOWN[state]);
      await page.waitForTimeout(150);
      await w.step('T2·' + theme + '·' + state, 'Offer Lab · ' + theme + ' (data-theme "' + stamped + '") · ' + state + ' -> AA contrast, nothing clipped, no sideways scroll', async () => {
        const got = await screenProblems(page, state === 'sheet' || state === 'confirm');
        return { ok: stamped === theme && !got.fails.length && got.texts > 8, saw: 'data-theme ' + stamped + ' · ' + got.texts + ' texts, lowest ' + got.lowest + (got.fails.length ? ' · ' + got.fails.slice(0, 4).join(' · ') : ' · clean') };
      });
      await page.screenshot({ path: require('path').join(__dirname, 'shots', 'offer-lab-fix-' + theme + '-' + state + '.png') });
      await page.keyboard.press('Escape');
      await page.evaluate(() => { closeWork(); });
    }
  }
  await page.evaluate(() => { CBAvatar.applyTheme('cream'); });

  await w.step('O10', 'No page error on either page', async () => ({ ok: w.errs.length === 0, saw: w.errs.length ? w.errs[0].slice(0, 120) : 'none' }));
};

W.run('offer-lab', walk);
