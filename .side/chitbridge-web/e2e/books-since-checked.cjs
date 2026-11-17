'use strict';
// @type: system
/**
 * e2e/books-since-checked.cjs - AUDITOR RANK 10 in a REAL browser against the REAL api and a REAL Postgres: "changed since my last check".
 * Controls under test: the toggle (bv-since, NET005-B08) and Mark as checked (bv-mark-checked, NET005-B09) on the client's Day book (public/app/books-grant-view.js),
 * and the Home link "N since I checked" / "N since access began" (practice-changed-<client>, HOM001-B05) on the practice list (public/app/books-practice.js).
 *
 * OWNS      the story, hand-computed: firm P has two auditor seats, A and B (access commenter, whole entity). Client M is a switched-on AU shop that grants P an auditor view.
 *           1  the client posts one entry E1 after the grant -> Home shows A "1 since access began" and B the same, each equal to the api's own count (GET /api/books-grants/practice).
 *           2  A clicks that link -> the Day book opens with the toggle pressed and lists exactly E1 (and "1 entry posted since ..."); the toggle goes off and on again.
 *           3  A presses Mark as checked and confirms -> the toast, the list is empty, Home shows no link for A (count 0).
 *           4  the client posts E2 -> Home shows A "1 since I checked" (no longer "access began"); the link opens the Day book on exactly E2, not E1.
 *           5  the colleague B did not mark: B's Home still counts from the start of the grant (E1 + E2 and what earlier runs added), A's mark did not touch it; B's api count equals B's page.
 *           6  at 390x844 the since bar, its line, the button and the Home link fit with no sideways scroll.
 * MOCKED    nothing. The sign-in is the api's own login path on a LOCAL api (lib/signin-code.cjs: the fixed local code, never printed); tokens stay in memory.
 * SEED      through the api's own doors (the same ones the app uses): firm register + country setup, two actors, the network edge (POST /network/connections + approve), the client's grant
 *           (POST /books-grants, auditor), the client's entries (POST /books/events, the owner's Entry door). Safe to run again: later runs count from where earlier ones left off.
 * RUN       on a SIT box inside the Playwright image sharing the network of a throwaway Postgres + api (see the run line in the PR):
 *           NODE_PATH=/pw/node_modules node /web/e2e/books-since-checked.cjs     Env: API (http://localhost:3000), CLIENT (q17shopau), FIRM (q17practice; a user id is 8-20 letters or digits), OUT (/out), PORT (3997)
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require('playwright');
const { signinCode } = require('./lib/signin-code.cjs');

const API = process.env.API || 'http://localhost:3000', CLIENT = process.env.CLIENT || 'q17shopau', FIRM = process.env.FIRM || 'q17practice', OUT = process.env.OUT || '/out', PORT = Number(process.env.PORT || 3997);
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const RUN = Date.now().toString(36).slice(-5);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log('      ' + m);

async function j(p, token, o) {
  o = o || {};
  const r = await fetch(API + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}, o.headers || {}), body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, b: await r.json().catch(() => ({})) };
}
const OTP = () => signinCode('owner', API);
async function ownerIn(handle, name) {
  const email = handle + '@test.example';
  let ask = await j('/api/entities/register', null, { body: { email, display_name: name, user_id: handle } });
  if (ask.status >= 300) ask = await j('/api/entities/register', null, { body: { email, mode: 'login' } }); /* already made: the ordinary sign-in */
  let v = await j('/api/entities/verify', null, { body: { email, otp: OTP() } });
  if (!v.b.token) throw new Error('sign-in refused for ' + handle + ' ask ' + ask.status + ' ' + JSON.stringify(ask.b).slice(0, 160) + ' verify ' + v.status + ' ' + JSON.stringify(v.b).slice(0, 160));
  const e = v.b.entity || v.b.identity || {};
  return { token: v.b.token, id: String(e.identity_id || (v.b.identity && v.b.identity.identity_id)), bridge: e.bridge_id, name: e.display_name || name };
}
async function actorIn(key, firmToken) {
  let r = await j('/api/actors/login', null, { body: { username: key + '@' + FIRM, otp: OTP() } });
  if (!r.b.token) { /* a later run: the seat's code is re-minted by the firm's owner (the api's own door), as the app does for a forgotten code */
    const list = await j('/api/actors', firmToken), me = (list.b.actors || list.b.items || list.b.rows || []).find((x) => x.actor_key === key);
    if (me) { const re = await j('/api/actors/' + me.identity_id + '/otp', firmToken, { body: {} }); r = await j('/api/actors/login', null, { body: { username: key + '@' + FIRM, otp: (re.b && re.b.dev_otp) || OTP() } }); }
  }
  if (!r.b.token) throw new Error('actor sign-in refused for ' + key + ' ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 120));
  const x = r.b;
  return { token: x.token, sess: { token: x.token, role: x.role || 'actor', name: x.name || key, entity: x.entity, bridgeId: x.bridgeId, duty: x.duty, shop: 'open' } };
}
/** the api's own count for a seat on a client (the practice list), the figure the Home link must show */
async function apiChanged(token, clientId) {
  const r = await j('/api/books-grants/practice', token);
  const row = (r.b.clients || []).find((c) => String(c.entity_id) === String(clientId));
  return row ? row.changed || null : undefined;
}
async function apiSince(token, clientId) {
  const r = await j('/api/books/daybook?since=mine', token, { headers: { 'X-Books-For': clientId } });
  return r.b;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  /* ── seed, through the api's doors ── */
  const owner = await ownerIn(CLIENT, 'Client ' + CLIENT);
  const firm = await ownerIn(FIRM, 'Q17 Practice - demo');
  const cs = await j('/api/governance/country-setup', firm.token);
  if (!cs.b.done) await j('/api/governance/country-setup', firm.token, { method: 'PUT', body: { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: 'Australia/Sydney', tax: { registered: false }, source: { country: 'q17', currency: 'q17', fy_start_month: 'q17', tax: 'q17' } } });
  for (const [key, name] of [['aud1', 'Auditor A'], ['aud2', 'Auditor B']]) {
    const a = await j('/api/actors', firm.token, { body: { display_name: name, actor_key: key, access_level: 'commenter', whole_entity: true } });
    say('actor ' + key + ': ' + a.status + (a.status >= 300 && a.status !== 409 ? ' ' + JSON.stringify(a.b).slice(0, 120) : ''));
  }
  const list = await j('/api/actors', firm.token);
  for (const x of (list.b.actors || list.b.items || list.b.rows || [])) if (/^aud[12]$/.test(x.actor_key || '')) await j('/api/actors/' + x.identity_id, firm.token, { method: 'PATCH', body: { can_see_costs: true } });
  const edge = await j('/api/network/connections', firm.token, { body: { childBridgeId: owner.bridge, type: 'agency' } });
  const edgeId = edge.b && (edge.b.id || (edge.b.edge && edge.b.edge.id));
  if (edgeId) await j('/api/network/connections/' + edgeId + '/approve', owner.token, { body: {} });
  say('edge ' + edge.status + (edgeId ? ' approved' : ''));
  const grant = await j('/api/books-grants', owner.token, { body: { grantee: firm.id, preset: 'auditor', purpose: 'audit of the books', expires_at: '2027-12-31', can_see_costs: true, consent: true } });
  say('grant ' + grant.status + (grant.status >= 300 && grant.status !== 409 ? ' ' + JSON.stringify(grant.b).slice(0, 160) : ''));
  ok(grant.status === 201 || grant.status === 409, 'the client has given the firm an auditor view (' + grant.status + ')');
  const A = await actorIn('aud1', firm.token), B = await actorIn('aud2', firm.token);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  async function post(label, amount) {
    const r = await j('/api/books/events', owner.token, { body: { event: 'expense', class: 'rent', amount, paid_from: 'cash', date: today, client_ref: 'q17-' + label + '-' + RUN } });
    if (r.status >= 300) throw new Error('entry ' + label + ' refused ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    return { no: String((r.b.entry && r.b.entry.entry_no) || r.b.entry_no || ''), id: (r.b.entry && r.b.entry.entry_id) || r.b.entry_id, amount };
  }

  /* ── the browser ── */
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '');
    const f = (!rel || rel === 'index.html') ? path.join(ROOT, 'index.html') : path.join(PUB, rel);
    if (((!f.startsWith(PUB)) && f !== path.join(ROOT, 'index.html')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(PORT, '0.0.0.0', r));
  const base = 'http://localhost:' + PORT, browser = await chromium.launch(), bad = [];
  async function seat(who, vp) {
    const ctx = await browser.newContext({ viewport: vp || { width: 1366, height: 768 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block', isMobile: !!vp && vp.width < 500, hasTouch: !!vp && vp.width < 500 });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript((s) => { try { if (!localStorage.getItem('cb_seeded')) { localStorage.setItem('cb_seeded', '1'); localStorage.setItem('cb_sess', JSON.stringify(s)); } } catch (_) {} }, who.sess);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => bad.push('THROW ' + e.message.slice(0, 160)));
    page.on('response', async (r) => { if (r.url().includes('practice/baseline')) say('POST practice/baseline -> ' + r.status() + ' ' + (await r.text().catch(() => '')).slice(0, 240)); if (/\/api\//.test(r.url()) && r.status() >= 400 && !/events\/stream/.test(r.url())) bad.push(r.status() + ' ' + new URL(r.url()).pathname); });
    return { ctx, page };
  }
  /** Home: the practice list row of the client; returns its changed-link (or null) */
  async function home(page) {
    await page.goto(base + '/');
    await page.waitForSelector('[data-testid="practice-band"]', { timeout: 25000 });
    const link = page.locator('[data-testid="practice-changed-' + owner.id + '"]');
    if (!(await link.count())) { const tab = page.locator('[data-testid="practice-band-on_us"]'); if (await tab.count()) { await tab.click(); await sleep(700); } }
    await sleep(600);
    const l = page.locator('[data-testid="practice-changed-' + owner.id + '"]');
    return (await l.count()) ? { text: (await l.first().innerText()).replace(/\s+/g, ' ').trim(), href: await l.first().getAttribute('href'), code: await l.first().getAttribute('data-cbsid'), loc: l.first() } : null;
  }
  const wordsOf = (c) => (c ? c.n + ' ' + (c.never ? 'since access began' : 'since I checked') : null);
  const sinceState = (page) => page.evaluate(() => {
    const t = (s) => { const n = document.querySelector(s); return n ? n.innerText.replace(/\s+/g, ' ').trim() : null; };
    const tg = document.querySelector('[data-testid="bv-since"]'), mk = document.querySelector('[data-testid="bv-mark-checked"]');
    return { toggle: tg ? { pressed: tg.getAttribute('aria-pressed'), code: tg.getAttribute('data-cbsid'), text: tg.innerText.trim() } : null, mark: mk ? { code: mk.getAttribute('data-cbsid'), text: mk.innerText.trim() } : null, line: t('[data-testid="bv-since-line"]'), list: t('#bv_list') || '', sw: document.documentElement.scrollWidth, vw: window.innerWidth };
  });
  const noScroll = (s) => s.sw <= s.vw;

  /* 1 the client posts E1 */
  const E1 = await post('e1', 71.23);
  say('E1 posted: ' + E1.no);
  const apiA1 = await apiChanged(A.token, owner.id), apiB1 = await apiChanged(B.token, owner.id);
  ok(!!apiA1 && apiA1.n >= 1 && !!apiB1 && apiB1.n >= 1, 'the api counts the new entry for both seats: A ' + JSON.stringify(apiA1) + ', B ' + JSON.stringify(apiB1));
  const sa = await seat(A);
  let h = await home(sa.page);
  ok(!!h && h.text === wordsOf(apiA1) && h.code === 'HOM001-B05', 'A Home link "' + (h && h.text) + '" = the api\'s own count "' + wordsOf(apiA1) + '", wearing HOM001-B05');
  await sa.page.screenshot({ path: OUT + '/since-1-home-A.png' });

  /* 2 the link opens the Day book on the changed entries; the toggle. DOORS: the auditor (a commenter seat) first keeps a private bookmark on E1 through the real api, so the page's POST /api/flags/query has something to draw */
  const kept = await j('/api/flags', A.token, { body: { kind: 'bookmark', visibility: 'me', subject_kind: 'posting', subject_entity: owner.id, items: [{ id: E1.id, label: 'Entry ' + E1.no }] } });
  ok(kept.status === 201, 'the auditor (commenter seat) keeps a private bookmark on E1: POST /api/flags 201 (was 403 at the hat gate) ' + kept.status);
  await h.loc.click();
  await sa.page.waitForSelector('[data-testid="bv-since"]', { timeout: 25000 });
  await sleep(1200);
  let s = await sinceState(sa.page);
  const truthA = await apiSince(A.token, owner.id);
  ok(s.toggle && s.toggle.pressed === 'true' && s.toggle.code === 'NET005-B08', 'the link lands on the Day book with the toggle pressed, wearing NET005-B08 (' + JSON.stringify(s.toggle) + ')');
  ok(truthA.total === apiA1.n && s.line && s.line.startsWith(truthA.total + ' ' + (truthA.total === 1 ? 'entry' : 'entries') + ' posted since'), 'the since line says what the api counts: "' + s.line + '" (api total ' + truthA.total + ')');
  ok(s.list.includes(E1.no) && truthA.entries.every((e) => s.list.includes(e.entry_no)), 'the list holds E1 (' + E1.no + ') and every entry the api listed (' + truthA.entries.length + ')');
  ok(!!s.mark && s.mark.code === 'NET005-B09', 'Mark as checked is offered, wearing NET005-B09');
  const chip = await sa.page.waitForSelector('button.fl.fl-on[data-fl="' + E1.id + '"]', { timeout: 15000 }).then(() => true, () => false);
  ok(chip, 'the auditor own bookmark chip DRAWS on E1 in the Day book (POST /api/flags/query answered 200 for the commenter seat)');
  await sa.page.screenshot({ path: OUT + '/since-2-daybook-A-since.png' });
  await sa.page.click('[data-testid="bv-since"]'); await sleep(1000);
  s = await sinceState(sa.page);
  ok(s.toggle.pressed === 'false' && !s.mark && !s.line, 'toggle off: back to the period, no since line, no Mark as checked');
  await sa.page.click('[data-testid="bv-since"]'); await sleep(1200);
  s = await sinceState(sa.page);
  ok(s.toggle.pressed === 'true' && s.list.includes(E1.no) && !!s.mark, 'toggle on again: the changed entries and Mark as checked are back');

  /* 3 Mark as checked (it asks first) */
  await sa.page.click('[data-testid="bv-mark-checked"]');
  await sa.page.waitForSelector('dialog[data-testid="confirm"][open]', { timeout: 10000 });
  const ask = (await sa.page.locator('dialog[data-testid="confirm"]').innerText()).replace(/\s+/g, ' ');
  ok(/as checked\?/.test(ask) && /will stop counting as changed/.test(ask), 'it asks first, naming what stops counting: "' + ask.slice(0, 120) + '"');
  await sa.page.click('[data-testid="confirm-ok"]');
  await sleep(1800);
  s = await sinceState(sa.page);
  const afterMark = await apiSince(A.token, owner.id), changedAfter = await apiChanged(A.token, owner.id);
  ok(afterMark.total === 0 && !s.mark && /^0 entries posted since/.test(s.line || ''), 'after confirming: the api says 0 and the page says "' + s.line + '", no Mark as checked');
  ok(!changedAfter || changedAfter.n === 0, 'the api practice count for A is 0 (' + JSON.stringify(changedAfter) + ')');
  h = await home(sa.page);
  ok(h === null, 'A Home: no changed link while the count is 0');
  await sa.page.screenshot({ path: OUT + '/since-3-home-A-after-mark.png' });

  /* 4 a new entry posts */
  const E2 = await post('e2', 83.47);
  say('E2 posted: ' + E2.no);
  const apiA2 = await apiChanged(A.token, owner.id), apiB2 = await apiChanged(B.token, owner.id);
  ok(!!apiA2 && apiA2.n === 1 && apiA2.never === false, 'the api: A has 1 since the check (never = false) ' + JSON.stringify(apiA2));
  h = await home(sa.page);
  ok(!!h && h.text === '1 since I checked' && h.code === 'HOM001-B05', 'A Home shows "1 since I checked" (got "' + (h && h.text) + '")');
  await sa.page.screenshot({ path: OUT + '/since-4-home-A-1-since-checked.png' });
  await h.loc.click();
  await sa.page.waitForSelector('[data-testid="bv-since"]', { timeout: 25000 });
  await sleep(1200);
  s = await sinceState(sa.page);
  ok(s.toggle.pressed === 'true' && s.list.includes(E2.no) && !s.list.includes(E1.no), 'the toggle lists exactly E2 (' + E2.no + '), not E1 (' + E1.no + ')');
  ok(/^1 entry posted since/.test(s.line || '') && !!s.mark, 'the line says "' + s.line + '" and Mark as checked is back');
  await sa.page.screenshot({ path: OUT + '/since-5-daybook-A-exactly-E2.png' });
  /* 6 fit at 390 for the same seat (a phone) */
  await sa.ctx.close();
  const sp = await seat(A, { width: 390, height: 844 });
  const hp = await home(sp.page);
  ok(!!hp && hp.text === '1 since I checked' && noScroll(await sinceState(sp.page)), '390x844 Home: the link "' + (hp && hp.text) + '" shows and the page does not scroll sideways');
  await sp.page.screenshot({ path: OUT + '/since-6-home-A-390.png' });
  await hp.loc.click();
  await sp.page.waitForSelector('[data-testid="bv-since"]', { timeout: 25000 }); await sleep(1200);
  const s390 = await sinceState(sp.page);
  const rects = await sp.page.evaluate(() => ['[data-testid="bv-since-bar"]', '[data-testid="bv-since"]', '[data-testid="bv-mark-checked"]', '[data-testid="bv-since-line"]'].map((q) => { const n = document.querySelector(q); if (!n) return null; const r = n.getBoundingClientRect(); return { q, right: Math.round(r.right), left: Math.round(r.left) }; }));
  ok(noScroll(s390) && rects.every((r) => r && r.right <= 390 && r.left >= 0), '390x844 Day book: bar, toggle, line and Mark as checked inside the screen, no sideways scroll ' + JSON.stringify(rects.map((r) => r && r.right)));
  await sp.page.screenshot({ path: OUT + '/since-7-daybook-A-390.png' });
  await sp.ctx.close();

  /* 5 the colleague is unaffected */
  const sb = await seat(B);
  const hb = await home(sb.page);
  ok(!!hb && hb.text === wordsOf(apiB2) && apiB2.never === true && apiB2.n >= 2, 'B Home "' + (hb && hb.text) + '" = the api\'s count for B "' + wordsOf(apiB2) + '": still from the start of the grant, A\'s check did not move it');
  ok(apiB2.n === apiB1.n + 1, 'B\'s count grew by exactly the one new entry (' + apiB1.n + ' -> ' + apiB2.n + '), not reset by A');
  await hb.loc.click();
  await sb.page.waitForSelector('[data-testid="bv-since"]', { timeout: 25000 }); await sleep(1200);
  const sbs = await sinceState(sb.page);
  ok(sbs.list.includes(E1.no) && sbs.list.includes(E2.no) && /since your access began|since .*access began|posted since/.test(sbs.line || ''), 'B\'s Day book lists E1 and E2 together: "' + sbs.line + '"');
  await sb.page.screenshot({ path: OUT + '/since-8-daybook-B-both.png' });
  await sb.ctx.close();
  await browser.close(); srv.close();
  /* DOORS: /api/flags/query is a hat-gate door now; a 403 there is a failure like any other */
  ok(bad.length === 0, 'no page error and no api status >= 400' + (bad.length ? ' ' + bad.slice(0, 4).join(' | ') : ''));
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FATAL ' + (e.stack || e).toString().slice(0, 700)); process.exit(1); });
