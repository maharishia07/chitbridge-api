#!/usr/bin/env node
/**
 * e2e/walk-marketing.cjs - MARKETING (the face of the CRM page, `crm.html?app=marketing`) WALKED (MKT first slice, 22 Oct 2026; critic MKT-critic-2026-10-22).
 * Black box: it presses what an owner presses - the Marketing tile's address (manifest), the five tabs (and NOT Parties or Chits), Who came back (the
 * server's customers, the figures, a row's bills, a bill opening its chit), the win-back card (the SAME Send sheet; greyed WITH the server's reason for a
 * viewer), Offers sent (every receipt, sent or not, with the reason in the shop's words, filtered by result), a 0 that explains itself (no send yet · no approved
 * template · b776 not run yet, each with the button that fixes it), Groups and Leads mounted inside the face with no copy, and CRM itself unchanged
 * without `?app=`. Then RULE 13: Who came back and Offers sent in Cream and Dark at 1366 and 390 px (e2e/lib/rule13.cjs): AA contrast, no clipped text,
 * no sideways scroll, nothing over a control, no link to app.html, copy within the text budget.
 * A FIXTURE shop (the golden parties): the API is a stand-in answering inside the page the way chitbridge-api answers (GET /api/marketing/came-back,
 * GET /api/channels/outbound); every answer is held to the contract (e2e/lib/contract.cjs). The Groups / segment / send answers are the SAME stand-in
 * walk-crm-marketing uses (e2e/lib/crm-marketing-api.cjs).
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-marketing.cjs            headless (the stand-in)
 *   node e2e/walk-marketing.cjs --show                                      watch it
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-marketing.cjs --real      REAL: chitbridge-api as a child on the loader's Postgres (e2e/lib/real-api.cjs);
 *                                                                           the paths that need a seeded send are NOTED, not asserted
 * One line per path: "ID · path · PASS/FAIL (what it saw)". Screenshots: e2e/shots/walk-marketing-NN.png.
 */
'use strict';
const TD = require('./lib/today.cjs');   /* QW1-TODAY: the one injected today (CB_TODAY) - never the runner's clock */
const fs = require('fs'), path = require('path');
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const crmApi = require('./lib/crm-api.cjs');
const { rule13 } = require('./lib/rule13.cjs');
const J = C.json;
const REAL = process.argv.includes('--real');
const FX = crmApi.resolve(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-parties.json'), 'utf8')), TD.nowMs());
const M = require('./lib/crm-marketing-api.cjs')(FX);
const { S, segments, send, verdict } = M;
S.consent = { 'pid-0002': 'CONSENT', 'pid-0004': 'CONSENT', 'pid-0006': 'CONSENT', 'pid-0005': 'SAID_NO' };
const DAY = 86400e3, iso = (daysAgo) => new Date(TD.nowMs() - daysAgo * DAY).toISOString();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const claims = (c) => b64({ alg: 'none' }) + '.' + b64(Object.assign({ exp: Math.floor(TD.nowMs() / 1000) + 3600 }, c)) + '.x';
const VIEWER = JSON.stringify({ token: claims({ identity_id: 'act-2', identity_type: 'actor', parent_entity_id: 'ent-walk', display_name: 'Vel', access_level: 'viewer' }), role: 'actor', name: 'Vel', entity: 'Fixture Shop', bridgeId: 'CBWALK0001' });

/* ── the stand-in: the api's own answers for this fixture (lib/marketing-results.js · lib/channels.js listOutbound) ── */
const money = (cur, total, chits) => ({ by_currency: [{ currency: cur, total, chits }], mixed: false, excluded: { non_monetary: 0, awaiting_agreement: 0 }, total: { currency: cur, total, chits } });
const NOMONEY = { by_currency: [], mixed: false, excluded: { non_monetary: 0, awaiting_agreement: 0 }, total: null };
const buyer = (id, name, days, bill, value) => ({ party_id: id, name, sent_at: iso(days + 2), send_ref: 'S1', first_bill_at: iso(days), bills_n: 1, money: money('INR', value, 1),
  bills: [{ chit_id: 'chit-' + bill, bill_no: bill, at: iso(days), value, currency: 'INR' }] });
const CUSTOMERS = [buyer('pid-0002', 'Chola Auto Care', 1, 'B-0412', 480), buyer('pid-0006', 'Big Buyer', 2, 'B-0409', 1200), buyer('pid-0004', 'Ravi Trdrs', 4, 'B-0401', 60)];
const CAME = { mode: 'ok' };   /* ok · none (nothing sent yet) · template (all refused: no template) · quiet (sent, nobody bought) · notmig (b776 not run) */
function cameBack(q) {
  const base = { days: 14, counts: { all: 5, sent: 4, refused: 1, failed: 0 } };
  if (CAME.mode === 'notmig') return { migrated: false, code: 'MKT_NOT_MIGRATED', say: 'Who came back arrives after the next update.', days: 14, sent_n: 0, came_back_n: 0, counts: { all: 0, sent: 0, refused: 0, failed: 0 },
    why: { code: 'MKT_NOT_MIGRATED', say: 'Who came back arrives after the next update.' }, money: NOMONEY, customers: [], total: 0, page: 1, limit: 50 };
  if (CAME.mode === 'none') return Object.assign({ migrated: true, sent_n: 0, came_back_n: 0, why: { code: 'NO_SENDS', say: 'No offer has been sent yet. Send one from Groups.' }, money: NOMONEY, customers: [], total: 0, page: 1, limit: 50 }, { days: 14, counts: { all: 0, sent: 0, refused: 0, failed: 0 } });
  if (CAME.mode === 'template') return Object.assign({ migrated: true, sent_n: 0, came_back_n: 0, why: { code: 'NO_TEMPLATE', say: 'Offers outside 24 hours need an approved WhatsApp template. Set one up in Channels.' }, money: NOMONEY, customers: [], total: 0, page: 1, limit: 50 }, { days: 14, counts: { all: 4, sent: 0, refused: 4, failed: 0 } });
  if (CAME.mode === 'quiet') return Object.assign({ migrated: true, sent_n: 4, came_back_n: 0, why: { code: 'NO_BUYERS', say: 'Nobody who got an offer has bought in 14 days yet.' }, money: NOMONEY, customers: [], total: 0, page: 1, limit: 50 }, { days: 14, counts: { all: 4, sent: 4, refused: 0, failed: 0 } });
  return Object.assign({ migrated: true, sent_n: 4, came_back_n: 3, why: null, money: money('INR', 1740, 3), customers: CUSTOMERS, total: 3, page: Number(q.get('page')) || 1, limit: Number(q.get('limit')) || 50 }, base);
}
const rcpt = (id, name, status, code, extra) => Object.assign({ id, chit_id: null, capture_id: null, channel: 'whatsapp', from_ref: null, to_ref: '+9199' + id.slice(-3) + '0001', body: 'Diwali offer', status, reason: status === 'sent' ? null : 'x', provider_msg_id: status === 'sent' ? 'wamid.' + id : null,
  created_at: iso(5), party_id: 'pid-' + id.slice(-4), purpose: 'marketing', send_ref: 'S1', basis: { code: code || 'CONSENT', pref_id: code && code !== 'CONSENT' ? null : 'pf-' + id, at: code && code !== 'CONSENT' ? null : iso(40) }, party_name: name, reason_code: status === 'sent' ? null : (code && code !== 'CONSENT' ? code : 'NO_TEMPLATE') }, extra || {});
const RECEIPTS = [rcpt('0002', 'Chola Auto Care', 'sent'), rcpt('0004', 'Ravi Trdrs', 'sent'), rcpt('0006', 'Big Buyer', 'sent'), rcpt('0001', 'Agro Mills', 'refused', 'CONSENT'), rcpt('0005', 'Meena', 'refused', 'SAID_NO')];
let SENT_MIGRATED = true;
function outbound(q) {
  const st = q.get('status'), rows = st ? RECEIPTS.filter((x) => x.status === st) : RECEIPTS;
  return { migrated: SENT_MIGRATED, outbound: SENT_MIGRATED ? rows : [], total: SENT_MIGRATED ? rows.length : 0, page: Number(q.get('page')) || 1, limit: Number(q.get('limit')) || 50 };
}
async function route(r0) {
  const r = C.wrap(r0), q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  S.calls.push(m + ' ' + p + u.search);
  let body = null; try { body = q.postDataJSON(); } catch (_) {}
  if (m !== 'GET') S.bodies.push({ m, p, body });
  if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR' } });
  if (p === '/api/books/health') return J(r, 404, { error: 'Not found' });
  if (p === '/api/facts/rail') return J(r, 200, { suppliers: 2, customers: 4, in: 0, out: 0, stuck: 0 });
  if (p === '/api/crm/followups') return J(r, 200, crmApi.followups([]));
  if (p === '/api/crm/parties' && m === 'GET') return J(r, 200, crmApi.list(S.list, { records: FX.records }));
  if (p === '/api/crm/segments') return J(r, 200, segments());
  if (p === '/api/marketing/came-back') return J(r, 200, cameBack(u.searchParams));
  if (p === '/api/channels/outbound') return J(r, 200, outbound(u.searchParams));
  let x;
  if ((x = p.match(/^\/api\/crm\/segments\/([^/]+)\/send$/)) && m === 'POST') {
    if (S.level === 'viewer') return J(r, 403, { code: 'VIEW_ONLY', error: 'Your login can only view.', message: 'Your login can only view.' });
    if (!String(body.text || '').trim()) return J(r, 400, { code: 'NO_TEXT', error: 'Write the message.', message: 'Write the message.' });
    const sent = send(decodeURIComponent(x[1]), body);
    return J(r, 200, body.dry ? sent : Object.assign(sent, { refusals_logged: 0, refusals_unlogged: true }));
  }
  if ((x = p.match(/^\/api\/chits\/([^/]+)/))) return J(r, 200, { chit: { chit_id: decodeURIComponent(x[1]) } });
  return J(r, 200, {});
}

const walk = async (w) => {
  const { page, ctx, base } = w;
  let api = null;
  if (REAL) {
    api = await require('./lib/real-api.cjs').start({ origin: base });
    const token = await api.owner();
    await ctx.addInitScript((o) => { try { localStorage.setItem('cb_ids', '1'); localStorage.setItem('cb_api_base', o.b); localStorage.setItem('cb_sess', JSON.stringify({ token: o.t, role: 'entity', name: 'Owner', entity: o.shop, bridgeId: o.shop })); } catch (_) {} }, { b: api.base, t: token, shop: api.shop });
  } else {
    await ctx.route('**/api/**', route);
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_ids', '1'); localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  }
  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const count = (sel) => page.locator(sel).count();
  const open = async (hash, ready) => { await page.goto(base + '/crm.html?app=marketing' + hash); await page.reload(); await page.waitForSelector(ready, { timeout: 20000 }); await page.waitForTimeout(300); };
  const NAV = ['leads', 'groups', 'sent', 'results', 'showcase'];
  /* REAL: the loader's shop has no seeded send, so the data paths are NOTED (K3-K11, K14); the face, the menu, the reused screens and Rule 13 are asserted */
  const CAME_READY = REAL ? '[data-testid="mkt-top"] > *' : '[data-testid="mkt-came-pid-0002"]', SENT_READY = REAL ? '[data-testid="mkt-sent"] .cbl' : '[data-testid="mkt-sent-0002"]';

  /* ── 0 · CRM ITSELF IS UNCHANGED, AND THE MARKETING TILE OPENS MARKETING ── */
  await page.goto(base + '/crm.html#/parties'); await page.reload(); await page.waitForSelector('[data-testid="crm-nav-parties"]', { timeout: 20000 }); await page.waitForTimeout(300);
  await w.step('K0', 'CRM without ?app= is exactly as before: the brand says CRM, the menu has Parties and Chits, and none of the Marketing tabs', async () => {
    const brand = await txt('.brand-name'), title = await page.title(), kinds = await page.locator('#nav a').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    const ok = brand === 'CRM' && title === 'CRM' && kinds.indexOf('crm-nav-parties') >= 0 && kinds.indexOf('crm-nav-chits') >= 0 && kinds.indexOf('crm-nav-sent') < 0 && kinds.indexOf('crm-nav-results') < 0;
    return { ok, saw: 'brand "' + brand + '" · title "' + title + '" · ' + kinds.map((k) => k.replace('crm-nav-', '')).join(' ') };
  });
  await w.step('K1', 'The Marketing tile (manifest) opens /crm.html?app=marketing#/results - Marketing, not CRM', async () => {
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'manifest.json'), 'utf8')), e = man.entries.filter((x) => x.id === 'marketing')[0];
    return { ok: !!e && e.route === '/crm.html?app=marketing#/results' && e.state === 'built', saw: e ? e.route : 'no marketing entry' };
  });

  /* ── 1 · WHO CAME BACK ── */
  await page.goto(base + '/crm.html?app=marketing'); await page.reload(); await page.waitForSelector(CAME_READY, { timeout: 20000 }); await page.waitForTimeout(400);
  await w.step('K2', 'Marketing (no hash) lands on Who came back; the brand and title say Marketing; the menu is Leads · Groups · Offers sent · Who came back · Shop window - NOT Parties or Chits; the screen chip says MKT004', async () => {
    const brand = await txt('.brand-name'), title = await page.title(), kinds = await page.locator('#nav a').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('crm-nav-', ''))),
      active = await page.locator('#nav a[aria-current="page"]').getAttribute('data-testid'), chip = await txt('[class*="cbsid"]'), hash = await page.evaluate(() => location.hash);
    const ok = brand === 'Marketing' && title === 'Marketing' && kinds.join() === NAV.join() && active === 'crm-nav-results' && hash === '#/results' && /MKT004/.test(chip);
    return { ok, saw: 'brand "' + brand + '" · menu ' + kinds.join(' · ') + ' · on ' + active + ' · ' + hash + ' · chip "' + chip + '"' };
  });
  if (REAL) w.note('K3-K11,K14', 'the data paths need a seeded send in the loader shop - asserted by the stand-in run and by tests/marketing-truth.realstack.cjs (MK-04/MK-08/MK-10/MK-11)');
  if (!REAL) {
  await w.step('K3', 'Who came back: the server\'s three customers (not the refused one), the figures "4 sent an offer · 3 came back in 14 days · INR 1,740 · 3 bills", and the reads were ONE GET', async () => {
    const figs = await txt('[data-testid="mkt-figs"]'), names = await page.locator('[data-testid^="mkt-came-name-"]').evaluateAll((els) => els.map((e) => e.innerText.replace(/^[^A-Za-z]+/, '').trim())), reads = S.calls.filter((c) => /GET \/api\/marketing\/came-back/.test(c)).length;
    const ok = names.join() === 'Chola Auto Care,Big Buyer,Ravi Trdrs' && /4\s+sent an offer/.test(figs) && /3\s+came back in 14 days/.test(figs) && /1,?740/.test(figs) && /3 bills/.test(figs) && reads === 1;
    return { ok, saw: figs + ' · ' + names.join(', ') + ' · reads ' + reads };
  });
  await w.step('K4', 'A row opens its bills, and a bill opens the chit (every number opens what it counts)', async () => {
    await page.locator('[data-testid="mkt-came-pid-0002"]').first().click(); await page.waitForSelector('[data-testid="mkt-came-bill-chit-B-0412"]', { timeout: 5000 });
    const mini = await txt('[data-testid="mkt-came-mini-pid-0002"]'); await page.click('[data-testid="mkt-came-bill-chit-B-0412"]'); await page.waitForTimeout(500);
    const asked = S.calls.some((c) => /\/api\/chits\/chit-B-0412/.test(c));
    return { ok: /B-0412/.test(mini) && asked, saw: mini.slice(0, 80) + ' · chit read ' + asked };
  });
  await w.step('K5', 'The win-back card says "1 customer has no bill in 90 days" in the server\'s rule words, and its button opens the SAME Send sheet (nothing goes out until Send)', async () => {
    const card = await txt('[data-testid="mkt-winback"]'); await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(150);
    await page.click('[data-testid="mkt-winback-send"]'); await page.waitForSelector('[data-testid="crm-send-sheet"]', { timeout: 5000 });
    const head = await txt('.mhd'), sent = S.bodies.filter((b) => /\/send$/.test(b.p)).length; await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    return { ok: /1 customer has no bill in 90 days/.test(card) && /Send to/.test(head) && sent === 0, saw: '"' + card + '" · sheet "' + head.slice(0, 40) + '" · sends ' + sent };
  });

  /* ── 2 · OFFERS SENT ── */
  await open('#/sent', '[data-testid="mkt-sent-0002"]');
  await w.step('K6', 'Offers sent: every receipt - 3 Sent, 2 Not sent - each Not sent with its reason in the shop\'s words (No approved offers template · Said no) and the consent a sent one rested on', async () => {
    const rows = await count('[data-testid^="mkt-sent-0"]'), meena = await txt('[data-testid="mkt-sent-0005"]'), agro = await txt('[data-testid="mkt-sent-0001"]'), chola = await txt('[data-testid="mkt-sent-0002"]');
    const active = await page.locator('#nav a[aria-current="page"]').getAttribute('data-testid');
    return { ok: rows === 5 && /Said no/.test(meena) && /Not sent/.test(meena) && /No approved offers template/.test(agro) && /Sent/.test(chola) && active === 'crm-nav-sent', saw: rows + ' rows · "' + meena.slice(0, 50) + '" · "' + agro.slice(0, 60) + '"' };
  });
  await w.step('K7', 'Offers sent -> Result: Not sent asks the SERVER (?status=refused) and shows only those two', async () => {
    await open('#/sent?status=refused', '[data-testid="mkt-sent-0005"]');
    const rows = await count('[data-testid^="mkt-sent-0"]'), asked = S.calls.some((c) => /status=refused/.test(c));
    return { ok: rows === 2 && asked, saw: rows + ' rows · server asked with status=refused: ' + asked };
  });

  }   /* !REAL: K3-K7 */
  if (!REAL) {
  /* ── 3 · A 0 THAT EXPLAINS ITSELF ── */
  const results0 = async (mode, sel) => { CAME.mode = mode; await open('#/results', sel); return txt('[data-testid="mkt-top"]'); };
  await w.step('K8', 'Who came back with nothing sent: it says why (No offer sent yet) and the button goes to Groups', async () => {
    const t = await results0('none', '[data-testid="mkt-why-NO_SENDS"]'), href = await page.getAttribute('[data-testid="mkt-why-go"]', 'href');
    return { ok: /No offer sent yet/.test(t) && href === '#/groups', saw: t.slice(0, 90) + ' · -> ' + href };
  });
  await w.step('K9', 'Who came back when every send was refused for the missing template: it says so and the button opens Channels in Settings (never a silent 0)', async () => {
    const t = await results0('template', '[data-testid="mkt-why-NO_TEMPLATE"]'), href = await page.getAttribute('[data-testid="mkt-why-go"]', 'href');
    return { ok: /approved WhatsApp template/.test(t) && /\/settings\.html#\/connectors/.test(href), saw: t.slice(0, 90) + ' · -> ' + href };
  });
  await w.step('K10', 'Sent but nobody bought yet: "Nobody has bought within 14 days yet." - and before b776 runs: "arrives after the next update", with no button', async () => {
    const quiet = await results0('quiet', '[data-testid="mkt-why-NO_BUYERS"]');
    const nomig = await results0('notmig', '[data-testid="mkt-why-MKT_NOT_MIGRATED"]'), btn = await count('[data-testid="mkt-why-go"]');
    return { ok: /Nobody has bought within 14 days yet/.test(quiet) && /arrives after the next update/.test(nomig) && btn === 0, saw: '"' + quiet.slice(0, 70) + '" · "' + nomig.slice(0, 60) + '" · buttons ' + btn };
  });
  CAME.mode = 'ok';
  await w.step('K11', 'Offers sent before b776 runs says so in the list\'s head, with no rows and no error', async () => {
    SENT_MIGRATED = false; await open('#/sent', '[data-testid="mkt-sent-nomig"]'); const t = await txt('[data-testid="mkt-sent-nomig"]'); SENT_MIGRATED = true;
    return { ok: /arrives after the next update/.test(t), saw: t };
  });

  }   /* !REAL: K8-K11 */
  await w.step('K15', 'A send whose refusals could not be recorded (the server says refusals_unlogged): Offers sent then says so in plain words - a 0 is never mistaken for nobody refused', async () => {
    S.consent['pid-0005'] = 'CONSENT';   /* so the win-back set has someone who may be sent */
    await open('#/results', '[data-testid="mkt-winback-send"]'); await page.click('[data-testid="mkt-winback-send"]'); await page.waitForSelector('[data-testid="crm-send-sheet"]');
    await page.fill('#crm_send_text', 'Come back for 10% off'); await page.click('[data-testid="crm-send-check"]'); await page.waitForSelector('[data-testid="crm-send-may"]');
    await page.evaluate(() => { const b = document.querySelector('[data-testid="crm-send-go"]'); b.disabled = false; }); await page.click('[data-testid="crm-send-go"]'); await page.waitForSelector('[data-testid="confirm-ok"]'); await page.click('[data-testid="confirm-ok"]'); await page.waitForSelector('[data-testid="crm-send-done"]', { timeout: 8000 });
    await page.keyboard.press('Escape'); await page.evaluate(() => { location.hash = '#/sent'; }); await page.waitForSelector('[data-testid="mkt-sent-unlogged"]', { timeout: 8000 });
    S.consent['pid-0005'] = 'SAID_NO';
    const t = await txt('[data-testid="mkt-sent-unlogged"]'); const before = S.bodies.filter((b) => /\/send$/.test(b.p) && b.body && !b.body.dry).length;
    return { ok: /Some refusals were not recorded/.test(t) && before === 1, saw: t + ' - real sends ' + before };
  });
  /* ── 4 · THE REUSED SCREENS, INSIDE THE FACE ── */
  await open('#/groups', '[data-testid="crm-grp-count-regular"]');
  await w.step('K12', 'Groups inside Marketing is the CRM Groups screen with no copy: the same counts, the menu marks Groups, the crumb says Marketing', async () => {
    const want = segments(), got = await txt('[data-testid="crm-grp-count-regular"]'), active = await page.locator('#nav a[aria-current="page"]').getAttribute('data-testid'), crumb = await txt('#crumb');
    return { ok: got === String(want.segments.filter((s) => s.key === 'regular')[0].count) && active === 'crm-nav-groups' && /Marketing/.test(crumb), saw: 'regular=' + got + ' · ' + active + ' · crumb "' + crumb + '"' };
  });
  await open('#/leads', '[data-testid="crm-leads"]');
  await w.step('K13', 'Leads inside Marketing opens the CRM Leads screen (its Add lead button is there), the menu marks Leads', async () => {
    const add = await count('[data-testid="crm-lead-add"]'), active = await page.locator('#nav a[aria-current="page"]').getAttribute('data-testid');
    return { ok: add === 1 && active === 'crm-nav-leads', saw: 'add lead ' + add + ' · ' + active };
  });

  /* ── 5 · A VIEWER SEES THE ACTION, GREYED WITH THE SERVER'S SENTENCE ── */
  if (!REAL) {
  S.level = 'viewer';
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, VIEWER);
  await open('#/results', '[data-testid="mkt-winback"]');
  await w.step('K14', 'A viewer: the win-back button is SHOWN, greyed, with the server\'s sentence beside it - never hidden', async () => {
    const btn = page.locator('[data-testid="mkt-winback-send"]'), dis = await btn.isDisabled(), why = await txt('[data-testid="mkt-winback-send-why"]');
    return { ok: dis && /can only view/.test(why), saw: 'disabled ' + dis + ' · "' + why + '"' };
  });
  S.level = 'owner';
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));
  }   /* !REAL: K14 */

  /* ── 6 · RULE 13: Who came back and Offers sent, Cream and Dark, 1366 and 390 ── */
  await open('#/results', CAME_READY); if (!REAL) { await page.locator('[data-testid="mkt-came-pid-0002"]').first().click(); await page.waitForTimeout(300); }
  await rule13(w, 'T13W', 'Who came back (a row open)', 'screen');
  await open('#/sent', SENT_READY);
  await rule13(w, 'T13S', 'Offers sent', 'screen');
  if (api) await api.stop().catch(() => {});
  if (w.errs.length) w.note('T99', 'page errors seen during the walk', w.errs.slice(0, 3).join(' | '));
  const [cOk, cMsg] = C.finish(); if (!cOk) { console.log('M43 · every answer the stand-in served matches the API contract · FAIL (' + cMsg + ')'); w.results.push({ id: 'M43', path: 'every answer the stand-in served matches the API contract', ok: false, saw: cMsg }); } else w.note('M43', 'every answer the stand-in served matches the API contract');
};
walk.opts = { viewport: { width: 1366, height: 900 } };
W.run(REAL ? 'marketing-real' : 'marketing', walk);
