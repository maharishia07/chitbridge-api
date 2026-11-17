#!/usr/bin/env node
/**
 * e2e/walk-employees.cjs - EMPLOYEES, WALKED: the shop's people as a small app (round P1: employees.html + app/cap-employees.js).
 * Black box: it presses what an owner presses - the list, search, a person's row, Reset code, Switch off / on, What they can do, Add a person - and reads
 * what the screen says. Which action is open is the SERVER's answer (GET /api/people, may/why), so the stand-in answers it per person: a refused action
 * must show greyed WITH its sentence, and no write may leave the page for it.
 * A FIXTURE shop ("Fixture Shop" / CBWALK0001): the site is served from this checkout, the API is a stand-in answering inside the page (state kept in memory),
 * so nothing reaches localhost:3000 or the live site and nothing is written anywhere. Not run in the round that wrote it (no Playwright) - first run is the check.
 *
 *   NODE_PATH=C:/dev/toolset/node_modules/e2e node e2e/walk-employees.cjs      headless, fast   (or: sh C:/dev/toolset/e2e.sh <checkout> e2e/walk-employees.cjs)
 *   node e2e/walk-employees.cjs --show                                           watch it: headed, a caption per step, green/red per step, a results page that stays open
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-employees-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');
const W = require('./lib/walk.cjs');
const { measure } = require('./lib/theme-measure.cjs');
const C = require('./lib/contract.cjs');   /* M43: every answer for a route in the API contract is held to it (RAIL-LAB-SRV1: the facts family) */
const J = C.json;
const CRYPTO = require('crypto');
const crmApi = require('./lib/crm-api.cjs');   /* RAIL-LAB-SRV1: the rail card (GET /api/facts/rail) from its one builder */

W.run('employees', async (w) => {
  const { page, ctx, base } = w;

  /* ── the stand-in server: three people, three presets; the owner may do everything except reset a manager's code ── */
  const CHOICES = [
    { key: 'counter', label: 'Counter only', why: 'Bills and sells. Cannot see costs.', level: 'editor', whole_entity: false, can_see_costs: false },
    { key: 'manager', label: 'Manager', why: 'Sees the whole shop. Cannot see costs.', level: 'editor', whole_entity: true, can_see_costs: false },
    { key: 'books', label: 'Books and costs', why: 'Sees the whole shop and what it costs.', level: 'commenter', whole_entity: true, can_see_costs: true },
  ];
  const S = { calls: [], addRefused: false, listDenied: false, nextId: 4, people: [], mode: 'mail', code: '' };
  /* R112: the api's answers for a person with no e-mail (lib/employee-code.js): shown (show_code + expires_at), refused (429 / 503 in words), or an OLD api (delivery_note only). The code is made here, per run - never a fixed number. */
  const newCode = () => { S.code = String(CRYPTO.randomInt(100000, 1000000)); return S.code; };
  const shownAnswer = (name) => ({ show_code: newCode(), expires_in: '30 minutes', expires_at: new Date(TD.nowMs() + 30 * 60000).toISOString(), delivery: 'shown', delivery_note: 'Give this code to ' + name + ' now. It works once, for 30 minutes, and is not shown again.' });
  const refusal = (r) => S.mode === 'limit' ? J(r, 429, { error: 'Too many codes', code: 'CODE_ISSUE_LIMIT', message: 'Five codes were made for this person in the last 15 minutes. Wait a few minutes, then make a new one. Nothing was changed.' })
    : S.mode === 'notready' ? J(r, 503, { error: 'Showing a code is not ready', code: 'CODE_SHOW_NOT_READY', message: 'This environment cannot show a first code yet, so none was made. Add their e-mail, or try again later. Nothing was changed.' }) : null;
  const may = (o) => Object.assign({ access: { ok: true }, email: { ok: true }, reset_pin: { ok: true }, switch: { ok: true, to: 'off' }, cover: { ok: true } }, o || {});
  S.people = [
    { id: 'p1', name: 'Asha Kumar', user_id: 'asha01@walk-shop.br', role: 'Cashier', phone: '9840000001', state: 'on', jobs: 0, last_at: TD.nowIso(), access: CHOICES[0], may: may(), cover: null, cover_options: [{ id: 'p2', name: 'Ravi Nair' }] },
    { id: 'p2', name: 'Ravi Nair', user_id: 'ravi02@walk-shop.br', role: 'Manager', phone: '9840000002', state: 'on', jobs: 2, last_at: null, access: CHOICES[1],
      may: may({ reset_pin: { ok: false, why: "Only the owner can reset a manager's code." } }), cover: null, cover_options: [{ id: 'p1', name: 'Asha Kumar' }] },
    { id: 'p3', name: 'Meena Iyer', user_id: 'meena03@walk-shop.br', role: 'Helper', phone: '', state: 'off', jobs: 0, last_at: null, access: CHOICES[0], may: may({ switch: { ok: true, to: 'on' } }), cover: null, cover_options: [] },
  ];
  const counts = () => ({ on: S.people.filter((p) => p.state !== 'off').length, off: S.people.filter((p) => p.state === 'off').length });
  const find = (id) => S.people.find((p) => p.id === id);

  await ctx.route('**/api/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), m = q.method(), p = u.pathname;
    let body = null; try { body = q.postData() ? JSON.parse(q.postData()) : null; } catch (_) {}
    if (m !== 'GET') S.calls.push(m + ' ' + p + (body ? ' ' + JSON.stringify(body) : ''));
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
    if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 0, customers: 0, in: 0, out: 0, stuck: 0 }));
    if (p === '/api/people' && m === 'GET') {
      if (S.listDenied) return J(r, 403, { message: 'This sign-in cannot open this.' });
      return J(r, 200, { people: S.people, may: { add: S.addRefused ? { ok: false, why: 'Only the owner can add people.' } : { ok: true } }, access_choices: CHOICES, counts: counts(),
        payroll: { here: false, said: 'Pay and payroll filings are not done in ChitBridge yet. Keep paying your people the way you do now.' } });   /* CX6 (E1): api lib/people.js payrollWord — the same line for IN, AU, AE (gated on the pack; tests/people.test.cjs) */
    }
    if (p === '/api/actors/suggest-key' && m === 'POST') {
      const k = String(body && body.display_name || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 6) + '04';
      return J(r, 200, { suggested_key: k, login_format: k + '@walk-shop.br' });
    }
    if (p === '/api/actors' && m === 'POST') {
      if (S.mode === 'limit' || S.mode === 'notready') return refusal(r);
      const id = 'p' + (S.nextId++), key = body.actor_key;
      const c = CHOICES.find((x) => x.level === body.access_level && !!x.whole_entity === !!body.whole_entity) || CHOICES[0];
      S.people.push({ id, name: body.display_name, user_id: key + '@walk-shop.br', role: body.actor_role || '', phone: body.phone || '', state: 'on', jobs: 0, last_at: null, access: c, may: may(), cover: null, cover_options: [] });
      /* SEC2: the server never answers the code — it says where it went (lib/employee-code.deliver delivery_note) */
      if (S.mode === 'show') return J(r, 200, Object.assign({ actor: { identity_id: id, display_name: body.display_name, login_format: key + '@walk-shop.br' } }, shownAnswer(body.display_name)));
      return J(r, 200, { actor: { identity_id: id, display_name: body.display_name, login_format: key + '@walk-shop.br' }, delivery: 'sent', sent_to: 'k***@walk.test', delivery_note: 'The code went to k***@walk.test.' });
    }
    let mm = /^\/api\/actors\/([^/]+)\/pin$/.exec(p);
    if (mm && m === 'DELETE' && S.mode !== 'mail') {
      if (S.mode === 'show') return J(r, 200, shownAnswer(find(mm[1]).name));
      if (S.mode === 'old') return J(r, 200, { delivery: 'none', delivery_note: 'No e-mail on file, so no code was sent. Add their e-mail, then send a new code.' });
      return refusal(r);
    }
    if (mm && m === 'DELETE') return J(r, 200, { delivery: 'sent', sent_to: 'a***@walk.test', delivery_note: 'The code went to a***@walk.test.' });
    mm = /^\/api\/actors\/([^/]+)\/status$/.exec(p);
    if (mm && m === 'PUT') { const x = find(mm[1]); x.state = body.action === 'deactivate' ? 'off' : 'on'; x.may.switch = { ok: true, to: x.state === 'off' ? 'on' : 'off' }; return J(r, 200, body.action === 'reactivate' ? { delivery: 'sent', sent_to: 'm***@walk.test', delivery_note: 'The code went to m***@walk.test.' } : { ok: true }); }
    mm = /^\/api\/actors\/([^/]+)\/delegate$/.exec(p);
    if (mm && m === 'PUT') { const x = find(mm[1]); x.cover = body.delegate_actor_id ? { id: body.delegate_actor_id, name: (find(body.delegate_actor_id) || {}).name } : null; return J(r, 200, { ok: true }); }
    mm = /^\/api\/actors\/([^/]+)$/.exec(p);
    if (mm && m === 'PATCH' && body && 'email' in body) { const x = find(mm[1]); x.email = body.email || null; x.has_email = !!body.email; return J(r, 200, { ok: true }); }
    if (mm && m === 'PATCH') { const x = find(mm[1]); x.access = CHOICES.find((c) => c.level === body.access_level && !!c.whole_entity === !!body.whole_entity && !!c.can_see_costs === !!body.can_see_costs) || x.access; return J(r, 200, { ok: true }); }
    return J(r, 404, { error: 'not found' });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const open = async () => { await page.goto(base + '/employees.html'); await page.waitForSelector('[data-testid="emp-bar"], [data-testid="emp-fail"]', { timeout: 20000 }); await page.waitForTimeout(300); };
  const rows = () => page.locator('[data-testid^="emp-row-"]').count();
  const closeSheet = async () => { await page.click('#emp_x').catch(() => {}); await page.waitForTimeout(200); };
  const confirmYes = async () => { await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 }); await page.click('[data-testid="confirm-ok"]'); await page.waitForTimeout(500); };
  const wrote = (re) => S.calls.filter((c) => re.test(c)).length;

  await open();

  await w.step('E1', 'Employees -> the list has one line per person, the count says 2 on · 1 off, and the sign-in name is the short one', async () => {
    const n = await rows(), cnt = await txt('[data-testid="emp-count"]'), list = await txt('[data-testid="emp-list"]');
    return { ok: n === 3 && /2\s*on/.test(cnt) && /1\s*off/.test(cnt) && /asha01@walk-shop.br/.test(list), saw: n + ' rows; "' + cnt + '"; ' + (/@walk-shop/.test(list) ? 'the whole sign-in name is showing' : 'the sign-in name is cut') };
  });
  await w.step('E2', 'Employees -> type "ravi" in the search box -> only Ravi Nair is left', async () => {
    await page.fill('[data-testid="listctl-search-employees"]', 'ravi'); await page.waitForTimeout(400);
    const n = await rows(), t = await txt('[data-testid="emp-list"]');
    await page.fill('[data-testid="listctl-search-employees"]', ''); await page.waitForTimeout(300);
    return { ok: n === 1 && /Ravi Nair/.test(t), saw: n + ' row(s): ' + t.slice(0, 80) };
  });
  await w.step('E3', 'Employees -> click Asha -> her sheet shows the four actions, all open (the server said yes to each)', async () => {
    await page.click('[data-testid="emp-row-p1"]'); await page.waitForSelector('[data-testid="emp-name"]', { timeout: 6000 });
    const name = await txt('[data-testid="emp-name"]');
    const dis = await page.$$eval('#emp_access, #emp_pin, #emp_switch, #emp_cover', (bs) => bs.map((b) => b.id + (b.disabled ? ':greyed' : ':open')));
    return { ok: /Asha Kumar/.test(name) && dis.length === 4 && dis.every((d) => /:open/.test(d)), saw: name + ' - ' + dis.join(' ') };
  });
  await w.step('E4', 'Asha -> Reset code -> it asks first; Cancel sends nothing', async () => {
    await page.click('#emp_pin'); await page.waitForSelector('[data-testid="confirm-cancel"]', { timeout: 5000 });
    const asked = await txt('[data-testid="confirm"]');
    await page.click('[data-testid="confirm-cancel"]'); await page.waitForTimeout(400);
    return { ok: /Reset code\?/.test(asked) && wrote(/\/pin$/) === 0, saw: 'asked "' + asked.slice(0, 60) + '"; reset calls after Cancel: ' + wrote(/\/pin$/) };
  });
  await w.step('E5', 'Asha -> Reset code -> Reset -> the sheet says where her new code went, in words (never the code)', async () => {
    await page.click('#emp_pin'); await confirmYes();
    const out = await txt('[data-testid="emp-out"]');
    return { ok: /went to a\*\*\*@walk\.test/.test(out) && !/\b\d{6}\b/.test(out) && wrote(/DELETE \/api\/actors\/p1\/pin/) === 1, saw: '"' + out + '" - one reset call' };
  });
  await w.step('E6', 'Asha -> What they can do -> Manager -> Save -> "Saved." and her line now says Manager', async () => {
    await page.click('#emp_access'); await page.click('[data-testid="emp-level-manager"]'); await page.click('[data-testid="emp-access-go"]'); await page.waitForTimeout(600);
    const out = await txt('[data-testid="emp-out"]'), list = await txt('[data-testid="emp-row-p1"]');
    return { ok: /Saved/.test(out) && /Manager/.test(list), saw: '"' + out + '"; her row: ' + list.slice(0, 80) };
  });
  await w.step('E7', 'Asha -> Who stands in -> Ravi -> Save -> the sheet says who stands in', async () => {
    await page.click('#emp_cover'); await page.selectOption('[data-testid="emp-cover-sel"]', 'p2'); await page.click('[data-testid="emp-cover-go"]'); await page.waitForTimeout(600);
    const s = await txt('#emp_sheet');
    return { ok: /Stands in: Ravi Nair/.test(s), saw: s.slice(0, 120) };
  });
  await w.step('E8', 'Asha -> Switch off -> it asks (she can no longer sign in) -> Switch off -> her line says Off, the count says 1 on · 2 off', async () => {
    await page.click('#emp_switch'); await page.waitForSelector('[data-testid="confirm-ok"]', { timeout: 5000 });
    const asked = await txt('[data-testid="confirm"]'); await page.click('[data-testid="confirm-ok"]'); await page.waitForTimeout(700);
    const tag = await txt('[data-testid="emp-state-p1"]'), cnt = await txt('[data-testid="emp-count"]');
    return { ok: /can no longer sign in/.test(asked) && /Off/.test(tag) && /1\s*on/.test(cnt) && /2\s*off/.test(cnt), saw: 'asked "' + asked.slice(0, 70) + '"; tag ' + tag + '; "' + cnt + '"' };
  });
  await closeSheet();
  await w.step('E9', 'Meena (off) -> Switch on -> no question asked (it is reversible) -> she is On and told where her code went', async () => {
    await page.click('[data-testid="emp-row-p3"]'); await page.waitForSelector('#emp_switch', { timeout: 6000 });
    await page.click('#emp_switch'); await page.waitForTimeout(700);
    const asked = await page.locator('[data-testid="confirm-ok"]').count(), out = await txt('[data-testid="emp-out"]'), tag = await txt('[data-testid="emp-state-p3"]');
    return { ok: asked === 0 && /went to m\*\*\*@/.test(out) && /On/.test(tag), saw: (asked ? 'it asked first; ' : 'no question; ') + '"' + out + '"; tag ' + tag };
  });
  await closeSheet();
  await w.step('E10', 'Ravi (a manager) -> Reset code is greyed WITH its sentence, and pressing it sends nothing', async () => {
    await page.click('[data-testid="emp-row-p2"]'); await page.waitForSelector('#emp_pin', { timeout: 6000 });
    const dis = await page.$eval('#emp_pin', (b) => b.disabled), why = await txt('[data-testid="emp_pin-why"]');
    await page.click('#emp_pin', { force: true, timeout: 2000 }).catch(() => {}); await page.waitForTimeout(300);
    return { ok: dis && /Only the owner/.test(why) && wrote(/actors\/p2\/pin/) === 0, saw: (dis ? 'greyed' : 'NOT greyed') + ': "' + why + '"; reset calls for Ravi: ' + wrote(/actors\/p2\/pin/) };
  });
  await closeSheet();
  await w.step('E11', 'Employees -> Add a person -> type a name -> a sign-in name is suggested and the way they sign in is shown', async () => {
    await page.click('#emp_add'); await page.waitForSelector('[data-testid="emp-add-name"]', { timeout: 6000 });
    await page.fill('[data-testid="emp-add-name"]', 'Kavya Rao'); await page.waitForTimeout(900);
    const key = await page.inputValue('[data-testid="emp-add-key"]'), note = await txt('[data-testid="emp-add-keynote"]');
    return { ok: /^kavya/.test(key) && /They sign in as/.test(note) && /4 to 12 letters or numbers/.test(await txt('[data-testid="emp-add-keyhint"]')), saw: 'suggested "' + key + '"; "' + note + '"' };
  });
  await w.step('E12', 'Add a person -> a sign-in name that is too short -> told in words, nothing sent', async () => {
    await page.fill('[data-testid="emp-add-key"]', 'kr'); await page.click('[data-testid="emp-add-go"]'); await page.waitForTimeout(300);
    const out = await txt('[data-testid="emp-out"]');
    return { ok: /4 to 12 letters or numbers/.test(out) && wrote(/POST \/api\/actors \{/) === 0, saw: '"' + out + '"; add calls: ' + wrote(/POST \/api\/actors \{/) };
  });
  await w.step('E13', 'Add a person -> a good sign-in name -> Add -> "Added" with the sign-in name and where the first code went, and the list has 4 people', async () => {
    await page.fill('[data-testid="emp-add-key"]', 'kavya04'); await page.click('[data-testid="emp-add-go"]'); await page.waitForSelector('[data-testid="emp-added"]', { timeout: 6000 });
    const id = await txt('[data-testid="emp-added-id"]'), code = await txt('[data-testid="emp-added-code"]'); const copyN = await page.locator('[data-testid="emp-copy"]').count(); await page.screenshot({ path: 'e2e/shots/smallfix-employee-added-laptop.png' }).catch(() => {}); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300); const fit390 = await page.evaluate(() => { const b = document.querySelector('[data-testid="emp-copy"]').getBoundingClientRect(); return b.right <= window.innerWidth && document.documentElement.scrollWidth <= document.documentElement.clientWidth; }); await page.screenshot({ path: 'e2e/shots/smallfix-employee-added-phone.png' }).catch(() => {}); await page.setViewportSize({ width: 1366, height: 800 });
    await page.click('[data-testid="emp-done"]'); await page.waitForTimeout(400);
    const n = await rows();
    return { ok: id === 'kavya04@walk-shop.br' && copyN === 1 && fit390 && /went to k\*\*\*@/.test(code) && n === 4 && wrote(/POST \/api\/actors \{/) === 1, saw: 'sign-in "' + id + '"; "' + code + '"; ' + n + ' rows; one add call' };
  });
  await w.step('E18', 'SEC2 · Asha -> E-mail -> type her address -> Save -> "Saved." and the sheet shows it (codes go there, never on screen)', async () => {
    await page.click('[data-testid="emp-row-p1"]'); await page.waitForSelector('#emp_email', { timeout: 6000 });
    await page.click('#emp_email'); await page.fill('[data-testid="emp-email-in"]', 'asha@walk.test'); await page.click('[data-testid="emp-email-go"]'); await page.waitForTimeout(600);
    const out = await txt('[data-testid="emp-out"]'), now = await txt('[data-testid="emp-email-now"]');
    await closeSheet();
    return { ok: /Saved/.test(out) && /asha@walk\.test/.test(now) && wrote(/PATCH \/api\/actors\/p1 \{"email":"asha@walk\.test"\}/) === 1, saw: '"' + out + '"; e-mail now "' + now + '"; ' + wrote(/PATCH \/api\/actors\/p1 \{"email"/) + ' e-mail call(s)' };
  });
  /* ── R112 · a worker with no e-mail: the owner is SHOWN the first code once ── */
  const openAsha = async () => { await open(); await page.click('[data-testid="emp-row-p1"]'); await page.waitForSelector('#emp_pin', { timeout: 6000 }); };
  const digitsOnScreen = () => page.evaluate((c) => document.body.innerText.replace(/\s+/g, '').includes(c), S.code);
  const stored = () => page.evaluate((c) => JSON.stringify([localStorage, sessionStorage]).replace(/\s+/g, '').includes(c), S.code);
  await w.step('R112a', 'R112 · owner -> Asha -> Reset code -> the code is shown big with her name and the time it works, read from expires_at; no Copy button', async () => {
    S.mode = 'show'; S.people[0].code_given = { by: 'Fixture Owner', at: TD.nowIso(), channel: 'screen' };
    await openAsha();
    const given = await txt('[data-testid="emp-code-given"]');
    await page.click('#emp_pin'); await confirmYes();
    const digits = (await txt('[data-testid="emp-code-digits"]')).replace(/\s/g, ''), say = await txt('[data-testid="emp-code-say"]');
    const grouped = /^\d{3} \d{3}$/.test(await txt('[data-testid="emp-code-digits"]'));
    const copy = await page.locator('#emp_sheet button:not([data-testid="emp-copy"])', { hasText: /copy/i }).count();
    await page.screenshot({ path: 'e2e/shots/walk-employees-r112.png' }).catch(() => {});
    const bad = [];   /* AA contrast + no clipping + no sideways scroll, light and dark, 1366 and 390 */
    for (const [wd, ht] of [[1366, 800], [390, 844]]) {
      await page.setViewportSize({ width: wd, height: ht });
      for (const th of ['cream', 'dark']) {
        await page.evaluate((k) => { if (window.CBAvatar) CBAvatar.applyTheme(k); }, th); await page.waitForTimeout(80);
        const low = (await page.evaluate(measure)).filter((x) => x.ratio < x.need);
        const clip = await page.$eval('[data-testid="emp-code-digits"]', (e) => e.scrollWidth > e.clientWidth + 1).catch(() => true);
        const hs = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (low.length || clip || hs) bad.push(wd + '/' + th);
      }
    }
    await page.setViewportSize({ width: 1366, height: 800 }); await page.evaluate(() => { if (window.CBAvatar) CBAvatar.applyTheme('cream'); });
    return { ok: !bad.length && grouped && digits === S.code && /Give this code to Asha Kumar\. It works for 30 minutes\./.test(say) && copy === 0 && /Code given by Fixture Owner at/.test(given), saw: 'digits ' + (digits === S.code ? 'match' : 'DIFFER') + '; "' + say + '"; copy buttons ' + copy + '; "' + given + '"; look ' + (bad.length ? 'FAIL ' + bad.join(',') : 'AA/unclipped, light+dark, 1366+390') };
  });
  await w.step('R112b', 'R112 · the code is never kept: closing the box removes the digits from the page, and nothing is in the browser store', async () => {
    const before = await digitsOnScreen(), kept = await stored();
    await closeSheet();
    const after = await digitsOnScreen(), boxes = await page.locator('[data-testid="emp-code-box"]').count();
    return { ok: before && !kept && !after && boxes === 0, saw: 'shown ' + before + '; stored ' + kept + '; after close: on page ' + after + ', boxes ' + boxes };
  });
  await w.step('R112c', 'R112 · an OLD api (no show_code) -> Reset code -> the sheet shows the api delivery_note, no box', async () => {
    S.mode = 'old'; await openAsha(); await page.click('#emp_pin'); await confirmYes();
    const out = await txt('[data-testid="emp-out"]'), boxes = await page.locator('[data-testid="emp-code-box"]').count();
    await closeSheet();
    return { ok: /No e-mail on file, so no code was sent/.test(out) && boxes === 0, saw: '"' + out.slice(0, 70) + '"; boxes ' + boxes };
  });
  await w.step('R112d', 'R112 · Add a person with no e-mail -> "Added" shows the big code with the time; Done removes it', async () => {
    S.mode = 'show'; await open(); await page.click('#emp_add'); await page.waitForSelector('[data-testid="emp-add-name"]', { timeout: 6000 });
    await page.fill('[data-testid="emp-add-name"]', 'Dev Shah'); await page.fill('[data-testid="emp-add-key"]', 'devshah04'); await page.click('[data-testid="emp-add-go"]'); await page.waitForSelector('[data-testid="emp-code-box"]', { timeout: 6000 });
    const digits = (await txt('[data-testid="emp-code-digits"]')).replace(/\s/g, ''), say = await txt('[data-testid="emp-code-say"]');
    await page.click('[data-testid="emp-done"]'); await page.waitForTimeout(300);
    const left = await digitsOnScreen();
    return { ok: digits === S.code && /Give this code to Dev Shah\. It works for 30 minutes/.test(say) && !left, saw: 'digits ' + (digits === S.code ? 'match' : 'DIFFER') + '; "' + say + '"; after Done on page: ' + left };
  });
  await w.step('R112e', 'R112 · too many codes (429) and not-ready (503) -> the api own sentence is shown, on Reset and on Add', async () => {
    S.mode = 'limit'; await openAsha(); await page.click('#emp_pin'); await confirmYes();
    const limit = await txt('[data-testid="emp-out"]'); await closeSheet();
    S.mode = 'notready'; await page.click('#emp_add'); await page.waitForSelector('[data-testid="emp-add-name"]', { timeout: 6000 });
    await page.fill('[data-testid="emp-add-name"]', 'Uma Rao'); await page.fill('[data-testid="emp-add-key"]', 'umarao04'); await page.click('[data-testid="emp-add-go"]'); await page.waitForTimeout(600);
    const notready = await txt('[data-testid="emp-out"]'); S.mode = 'mail'; await closeSheet();
    return { ok: /Five codes were made/.test(limit) && /cannot show a first code yet/.test(notready), saw: '429 "' + limit.slice(0, 50) + '"; 503 "' + notready.slice(0, 50) + '"' };
  });
  await w.step('R112f', 'R112 · a cashier login -> Reset code is greyed WITH the server sentence, and no code line is shown', async () => {
    S.people[0].may.reset_pin = { ok: false, why: 'Only the owner can give a code.' }; S.people[0].code_given = null;
    await openAsha();
    const dis = await page.$eval('#emp_pin', (b) => b.disabled), why = await txt('[data-testid="emp_pin-why"]'), given = await page.locator('[data-testid="emp-code-given"]').count();
    await closeSheet(); S.people[0].may.reset_pin = { ok: true };
    return { ok: dis && /Only the owner/.test(why) && given === 0, saw: (dis ? 'greyed' : 'NOT greyed') + ': "' + why + '"; code lines ' + given };
  });
  await w.step('E14', 'Employees (this login may not add) -> "Add a person" is shown greyed with the server\'s sentence', async () => {
    S.addRefused = true; await open();
    const dis = await page.$eval('#emp_add', (b) => b.disabled).catch(() => null), why = await txt('[data-testid="emp_add-why"]');
    S.addRefused = false;
    return { ok: dis === true && /Only the owner can add people/.test(why), saw: (dis ? 'greyed' : 'NOT greyed') + ': "' + why + '"' };
  });
  await w.step('E15', 'Employees (the server refuses the list) -> a plain sentence and Try again, never a raw error', async () => {
    S.listDenied = true; await open();
    const t = await txt('[data-testid="emp-fail"]'); S.listDenied = false;
    await page.click('[data-testid="emp-retry"]'); await page.waitForSelector('[data-testid="emp-bar"]', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(300);
    const back = await rows();
    return { ok: /This sign-in cannot open this/.test(t) && /Try again/.test(t) && back >= 3, saw: '"' + t.slice(0, 80) + '"; after Try again: ' + back + ' rows' };
  });
  await w.step('E17', 'CX6 · Employees -> payroll is SAID (one line), readable (AA) and unclipped in light and dark at 1366 and 390 px, no sideways scroll', async () => {
    const seen = [];
    for (const [wd, ht] of [[1366, 800], [390, 844]]) {
      await page.setViewportSize({ width: wd, height: ht }); await open();
      for (const th of ['cream', 'dark']) {
        await page.evaluate((k) => { if (window.CBAvatar) CBAvatar.applyTheme(k); }, th); await page.waitForTimeout(80);
        const line = await txt('[data-testid="emp-payroll"]');
        const box = await page.$eval('[data-testid="emp-payroll"]', (e) => ({ clip: e.scrollWidth > e.clientWidth + 1, right: e.getBoundingClientRect().right })).catch(() => null);
        const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        const all = (await page.evaluate(measure)).filter((x) => x.ratio < x.need); if (process.env.CX6_DEBUG) console.log(th, wd, JSON.stringify(all.slice(0, 8)));
        const bad = all.filter((x) => /payroll|Pay and/.test(x.html + x.text));
        seen.push({ wd, th, ok: /not done in ChitBridge/.test(line) && box && !box.clip && box.right <= wd + 1 && !hscroll && !bad.length, why: (box ? '' : 'no line ') + (hscroll ? 'h-scroll ' : '') + (bad.length ? 'contrast ' + bad[0].ratio : '') });
      }
    }
    await page.setViewportSize({ width: 1366, height: 800 }); await page.evaluate(() => { if (window.CBAvatar) CBAvatar.applyTheme('cream'); });
    return { ok: seen.every((x) => x.ok), saw: seen.map((x) => x.wd + '/' + x.th + ':' + (x.ok ? 'ok' : 'FAIL ' + x.why)).join(' · ') };
  });
  w.note('E16', 'Embedded form (?embed=1&view=add) and "who is on duty" (?view=onduty), opened from the till', 'they wait for a host page\'s session over postMessage - walked in the till pack (walk-bill), not here');
});
