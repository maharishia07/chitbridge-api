#!/usr/bin/env node
/* e2e/rail-thread.cjs — R02 T1: CBThread ON THE LAB CHIT — external vs internal vs auditor (reads, cannot reply).
 *
 * The lab chit: Ravi Stores (sender) → Lab Shop (receiver) · Cc Meena Traders; two lines; one open dispute d1 raised by Lab Shop
 * with Ravi (roster: Lab Shop · Ravi — NOT Meena). Four people open it in app.html:
 *   A  the shop's editor      both channels; a double press on Send → ONE POST; external · internal · a line's thread (line_id rides)
 *   B  the dispute room       as the editor: the room lists ONLY d1's rows; a send carries is_dispute + dispute_id, external
 *   C  a comment-only person  External is greyed with the engine's sentence; an internal note lands; a forced external is refused (403) and
 *                             said in the server's words — never a thrown error's text
 *   D  the auditor (viewer)   reads the thread; sees the sentence instead of a box; sends NOTHING
 *   E  Meena (a non-member)   the dispute message is NEVER listed to her — not in the thread, not in any room, not asked for
 * Invariants (R02): one composer in the web repo for POST /chits/:id/messages (e2e/rail-thread-guard.cjs, run beside this) ·
 * comment-only sends internal only · a dispute message is never listed to a non-member.
 *
 * Pattern: e2e/action-state.cjs — Playwright, a stand-in API answering INSIDE the page (the audience rule and the engine's refusals
 * as routes/chits.js :3661/:3821 and lib/rail.js apply them), a static server on a free OS port. Nothing reaches a real API. ONE
 * headless browser; one context per person. Run:  node e2e/rail-thread.cjs        (exit 1 on any failure)
 */
'use strict';
const { chromium } = require('@playwright/test');
const { serve } = require('./lib/serve.cjs');
const C = require('./lib/contract.cjs');
const J = C.json;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  XX  ' + m); } };
const HOLD = 500;
const settle = (ms) => new Promise((res) => setTimeout(res, ms || HOLD + 400));

/* ── who ── */
const WHO = {
  editor:    { entity: 'ent-lab',   name: 'Lab Shop',      level: 'editor' },
  commenter: { entity: 'ent-lab',   name: 'Kumar',         level: 'commenter', actor: true },
  auditor:   { entity: 'ent-lab',   name: 'Auditor',       level: 'viewer' },
  meena:     { entity: 'ent-meena', name: 'Meena Traders', level: 'editor' },
};
const SESSION = (w) => {
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const tok = b64({ alg: 'none' }) + '.' + b64({ identity_id: w.entity, identity_type: 'entity', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.x';
  return JSON.stringify({ token: tok, role: 'entity', name: w.name, entity: w.name, actorId: w.actor ? 'act-1' : null });
};
const PARTS = [{ entity_id: 'ent-ravi', display_name: 'Ravi Stores', role: 'sender' }, { entity_id: 'ent-lab', display_name: 'Lab Shop', role: 'receiver' }, { entity_id: 'ent-meena', display_name: 'Meena Traders', role: 'cc' }];
const ALL = PARTS.map((p) => p.entity_id), ROSTER = ['ent-lab', 'ent-ravi'];
const LINES = [{ line_id: 'l1', particulars: 'Rice 25 kg', quantity: 4, unit: 'bag', price: 1800, total: 7200 }, { line_id: 'l2', particulars: 'Oil 15 L', quantity: 2, unit: 'tin', price: 2400, total: 4800 }];

/* ── the stand-in: the store, the audience rule, the engine's refusals ── */
function standIn() {
  let n = 0;
  const S = { me: WHO.editor, writes: [], gets: [], msgs: [] };
  const add = (m, aud, at) => { S.msgs.push(Object.assign({ message_id: 'm' + (++n), created_at: at || new Date(Date.now() - (10 - n) * 60000).toISOString(), msg_type: 'info', is_dispute: false, dispute_id: null, line_id: null, attachments: [] }, m, { audience: aud })); return S.msgs[S.msgs.length - 1]; };
  add({ thread_type: 'external', message_text: 'Can you take delivery on Friday?', sender_entity_id: 'ent-ravi', sender_display_name: 'Ravi Stores' }, ALL);
  add({ thread_type: 'internal', message_text: 'Check the godown space before saying yes', sender_entity_id: 'ent-lab', sender_display_name: 'Lab Shop' }, ['ent-lab']);
  add({ thread_type: 'external', message_text: '[quality] Two bags were torn', sender_entity_id: 'ent-lab', sender_display_name: 'Lab Shop', is_dispute: true, dispute_id: 'd1' }, ROSTER);
  add({ thread_type: 'external', message_text: 'The rice is the 2025 crop', sender_entity_id: 'ent-ravi', sender_display_name: 'Ravi Stores', line_id: 'l1' }, ALL);
  S.actions = () => {
    const lvl = S.me.level, no = (w) => ({ ok: false, why: w });
    const ext = lvl === 'editor' ? { ok: true } : lvl === 'commenter' ? no('comment_only') : no('read_only');
    const int = lvl === 'viewer' ? no('read_only') : { ok: true };
    return { accept: ext, reject: ext, complete: ext, dispute: ext, assign: ext, amend: ext, message_external: ext, message_internal: int };
  };
  return S;
}
function chitAnswer(S) {
  const h = { chit_id: 'lab-chit', sender_entity_id: 'ent-ravi', sender_entity_display_name: 'Ravi Stores', all_recipients: PARTS, purpose: 'order', manual_subject: 'Lab order',
    auto_subject: 'Lab order', current_status: 'pending', created_at: '2026-10-01T05:00:00.000Z', summary_json: { money: null }, business_json: {}, direction: S.me.entity === 'ent-ravi' ? 'sent' : 'received', role: 'receiver' };
  return { header: h, detail: { line_items: LINES }, participants: PARTS, state_log: [], attachments: [], amendments: [], amendments_migrated: true, actions: S.actions(), lines_from: 'chit_line',
    live_set: LINES.map((l, i) => ({ index: i, line_id: l.line_id, live: l, original: l, history: [], removed: false })) };
}
async function route(S, r) {
  const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
  let body = {}; try { body = JSON.parse(q.postData() || '{}'); } catch (_) {}
  const me = S.me, inRoster = ROSTER.indexOf(me.entity) >= 0;
  if (m === 'GET') S.gets.push({ who: me.name, p, q: Object.fromEntries(u.searchParams) });
  /* the Ledger is OFF for the lab shop (routes/books.js: only /status answers while off) — the contract holds those answers */
  if (p === '/api/books/status') return J(r, 200, { migrated: true, enabled: false, walkin_grain: null });
  if (p.startsWith('/api/books')) return J(r, 404, { error: 'Not found' });
  if (p === '/api/chits/inbox' && m === 'GET') return J(r, 200, [{ chit_id: 'lab-chit', created_at: '2026-10-01T05:00:00.000Z', all_recipients: PARTS, sender_entity_display_name: 'Ravi Stores', purpose: 'order', manual_subject: 'Lab order',
    current_status: 'pending', open_dispute_count: inRoster ? 1 : 0, resolved_dispute_count: 0, message_count: S.msgs.filter((x) => x.audience.indexOf(me.entity) >= 0 && !x.is_dispute).length, summary_json: {}, role: 'receiver', direction: 'received' }]);
  if (p === '/api/chits/lab-chit' && m === 'GET') return J(r, 200, chitAnswer(S));
  if (p === '/api/chits/lab-chit/disputes' && m === 'GET') return J(r, 200, { disputes: inRoster ? [{ dispute_id: 'd1', chit_id: 'lab-chit', category: 'quality', status: 'open', reason: 'Two bags were torn on arrival', scope: 'targeted',
    raised_by_entity_id: 'ent-lab', raised_by_display_name: 'Lab Shop', participants: [{ entity_id: 'ent-ravi', display_name: 'Ravi Stores', role: 'party', status: 'open' }] }] : [] });
  if (p === '/api/chits/lab-chit/messages' && m === 'GET') {
    const tf = u.searchParams.get('thread_type') || 'all', disp = u.searchParams.get('dispute') === '1', line = u.searchParams.get('line_id');
    const rows = S.msgs.filter((x) => x.audience.indexOf(me.entity) >= 0)
      .filter((x) => tf === 'internal' ? (!x.is_dispute && x.thread_type === 'internal') : tf === 'external' ? ((!x.is_dispute && x.thread_type === 'external') || x.is_dispute) : true)
      .filter((x) => !disp || x.is_dispute).filter((x) => !line || x.line_id === line)
      .map((x) => { const o = Object.assign({}, x); delete o.audience; return o; });
    return J(r, 200, { messages: rows, count: rows.length });
  }
  if (p === '/api/chits/lab-chit/messages' && m === 'POST') {
    S.writes.push({ who: me.name, level: me.level, body });
    await new Promise((res) => setTimeout(res, HOLD));
    const ext = body.thread_type === 'external';
    if (me.level === 'viewer') return J(r, 403, { error: 'Not permitted', message: 'Your access is view-only. You can read this conversation but not post to it.', why: 'read_only', access_level: 'viewer' });
    if (me.level === 'commenter' && ext) return J(r, 403, { error: 'Not permitted', message: 'Your access is comment-only. You can reply internally, but not to the other party.', why: 'comment_only', access_level: 'commenter' });
    if (body.is_dispute && !inRoster) return J(r, 403, { error: 'Forbidden', message: 'Not a party to this dispute' });
    const aud = body.is_dispute ? ROSTER : ext ? ALL : [me.entity];
    const row = Object.assign({ message_id: 'm' + Date.now() + Math.floor(Math.random() * 1000), created_at: new Date().toISOString(), msg_type: body.msg_type || 'info', is_dispute: !!body.is_dispute, dispute_id: body.dispute_id || null, line_id: body.line_id || null,
      thread_type: body.thread_type, message_text: body.message_text, sender_entity_id: me.entity, sender_display_name: me.name, attachments: [], audience: aud });
    S.msgs.push(row);
    return J(r, 200, { message_id: row.message_id, thread_type: row.thread_type, message_text: row.message_text, sender_display_name: me.name, created_at: row.created_at });
  }
  if (m === 'GET') return J(r, 200, {});
  return J(r, 200, { ok: true });
}

(async () => {
  const S = standIn();
  const web = await serve(), b = await chromium.launch(), errs = [];
  const posts = (f) => S.writes.filter(f || (() => true));
  let ctx = null, p = null;
  async function open(who) {
    S.me = who;
    if (ctx) await ctx.close();
    ctx = await b.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await ctx.route('**/api/**', (r) => route(S, C.wrap(r)));
    await ctx.addInitScript((s) => { try { localStorage.setItem('cb_sess', s); } catch (_) {} window.__rail = []; document.addEventListener('cb:rail', (e) => window.__rail.push(e.detail)); }, SESSION(who));
    p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(who.name + ': ' + String(e.message)));
    p.on('dialog', (d) => { errs.push('a browser dialog opened: ' + d.type()); d.dismiss().catch(() => {}); });
    await p.goto(web.url('/app.html#/app'));
    await p.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
    await p.evaluate(() => openChit('lab-chit'));
    await p.waitForSelector('[data-testid="msg-tab"]', { timeout: 15000 });
    await p.waitForFunction(() => !(UI.detail && UI.detail._loading), null, { timeout: 15000 });
    await p.click('[data-testid="msg-tab"]');
    await p.waitForSelector('[data-testid="rt-host"] [data-testid="rt"]', { timeout: 10000 });
    await p.waitForFunction(() => !!document.querySelector('[data-testid="rt-host"] [data-testid="rt-count"], [data-testid="rt-host"] [data-testid="rt-empty"]'), null, { timeout: 10000 });
  }
  const rows = async (scope) => p.evaluate((s) => Array.from(document.querySelectorAll(s + ' [data-testid="rt-row"]')).map((x) => ({ id: x.getAttribute('data-id'), th: x.getAttribute('data-thread'), disp: x.getAttribute('data-dispute'), text: x.querySelector('.rt-b').textContent })), scope || '[data-testid="rt-host"]');
  const out = async (scope) => (await p.textContent((scope || '[data-testid="rt-host"]') + ' [data-testid="rt-out"]').catch(() => '')) || '';

  try {
    /* ── A · the editor: one composer, both channels, one press one write, threaded by line ── */
    await open(WHO.editor);
    ok(await p.evaluate(() => typeof CBThread === 'object' && typeof CBThread.mount === 'function' && typeof CBThread.send === 'function' && typeof CBThread.mountAll === 'function'), 'A · CBThread.mount / send / mountAll exist on the page');
    ok(await p.evaluate(() => typeof messagesTab === 'function' && /data-rt=/.test(messagesTab.toString()) && !/api\(["']sendMsg/.test(messagesTab.toString())), 'A · the Messages tab is a CBThread host, not a composer of its own');
    let r0 = await rows();
    ok(r0.length === 3 && r0.every((x) => !x.disp) && r0.some((x) => x.th === 'internal') && r0.some((x) => x.th === 'external'), 'A · the thread lists the three rows this copy holds — external, internal, the line\'s — and NO dispute row (' + r0.length + ')');
    ok(r0[0].id === 'm1' && r0[2].id === 'm4', 'A · a chat: oldest first, the newest at the bottom (W15-26)');
    ok(await p.evaluate(() => { const l = document.querySelector('[data-testid="rt-host"] .rt-list'), c = document.querySelector('[data-testid="rt-host"] [data-testid="rt-composer"]'); return !!l && !!c && l.getBoundingClientRect().bottom <= c.getBoundingClientRect().top + 1 && l.scrollTop + l.clientHeight >= l.scrollHeight - 2; }), 'A · the reply box sits under the list and the list opens scrolled to the newest');
    ok(await p.locator('[data-testid="rt-host"] [data-testid="msg-channel-internal"].on').count() === 1 && await p.locator('[data-testid="rt-host"] [data-testid="msg-channel-external"]:not(.off)').count() === 1, 'A · both channels offered; internal selected first for the shop');
    await p.click('[data-testid="rt-host"] [data-testid="msg-channel-external"]');
    ok(/Ravi Stores sees this/.test(await p.textContent('[data-testid="rt-host"] [data-testid="rt-aud"]')), 'A · the audience line names the other party on External');
    await p.fill('[data-testid="rt-host"] [data-testid="msg-body"]', 'Friday is fine — before noon');
    const n0 = posts().length;
    await p.dblclick('[data-testid="rt-host"] [data-testid="msg-send"]');
    const busy = await p.evaluate(() => { const x = document.querySelector('[data-testid="rt-host"] [data-testid="msg-send"]'); return x ? [x.disabled, x.getAttribute('aria-busy'), x.getAttribute('data-action-state')].join('/') : 'gone'; });
    ok(busy === 'true/true/busy', 'A · while the send is out: disabled + aria-busy + data-action-state=busy (' + busy + ')');
    await p.waitForFunction(() => /Sent/.test((document.querySelector('[data-testid="rt-host"] [data-testid="rt-out"]') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await settle();
    const ext = posts().slice(n0);
    ok(ext.length === 1 && ext[0].body.thread_type === 'external' && ext[0].body.message_text === 'Friday is fine — before noon' && !ext[0].body.line_id && !ext[0].body.is_dispute, 'A · double press → ONE POST {thread_type:external} (' + ext.length + ')');
    ok(/Sent — Ravi Stores notified/.test(await out()), 'A · the outcome is said under the button: "' + (await out()).trim() + '"');
    r0 = await rows();
    ok(r0.length === 4 && r0[3].text === 'Friday is fine — before noon' && /You/.test(await p.textContent('[data-testid="rt-host"] [data-testid="rt-row"]:last-of-type b')), 'A · the list repaints in place with the new row at the bottom, as "You", on the right');
    ok(await p.evaluate(() => window.__rail.length === 1 && window.__rail[0].module === 'thread' && window.__rail[0].chit_id === 'lab-chit' && !!window.__rail[0].result.message_id && CBThread.last && CBThread.last.message_id === window.__rail[0].result.message_id), 'A · cb:rail {module:thread, chit_id, result} fired once; CBThread.last holds the send result');
    ok(await p.evaluate(() => (document.querySelector('[data-testid="msg-body"]') || {}).value === ''), 'A · the box is empty after a send');
    /* internal, with the line chooser: the message is about line 1 */
    await p.click('[data-testid="rt-host"] [data-testid="msg-channel-internal"]');
    ok(/Team only/.test(await p.textContent('[data-testid="rt-host"] [data-testid="rt-aud"]')), 'A · the audience line says Team only on Internal');
    await p.selectOption('[data-testid="rt-host"] [data-testid="rt-line"]', 'l1');
    await p.fill('[data-testid="rt-host"] [data-testid="msg-body"]', 'Count the bags on this line');
    const n1 = posts().length;
    await p.click('[data-testid="rt-host"] [data-testid="msg-send"]');
    await settle();
    const int = posts().slice(n1);
    ok(int.length === 1 && int[0].body.thread_type === 'internal' && int[0].body.line_id === 'l1', 'A · an internal note about line 1 → ONE POST {thread_type:internal, line_id:l1}');
    r0 = await rows();
    ok(r0.length === 5 && /Note added — team only/.test(await out()), 'A · listed (5), and the outcome says "Note added — team only"');
    ok(await p.locator('[data-testid="rt-host"] [data-testid="rt-row"][data-id="m4"] .rt-tag.ln').count() === 1, 'A · a row about a line carries the line tag (threaded by line)');

    /* ── B · the dispute room, as the editor ── */
    await p.selectOption('.dispbanner select', 'd1');
    await p.waitForSelector('[data-testid="rt-disp"] [data-testid="rt"]', { timeout: 10000 });
    await p.waitForFunction(() => !!document.querySelector('[data-testid="rt-disp"] [data-testid="rt-count"], [data-testid="rt-disp"] [data-testid="rt-empty"]'), null, { timeout: 10000 });
    const d0 = await rows('[data-testid="rt-disp"]');
    ok(d0.length === 1 && d0[0].disp === 'd1' && d0[0].id === 'm3', 'B · the room lists ONLY this dispute\'s rows (' + d0.length + ')');
    ok(await p.locator('[data-testid="rt-disp"] [data-testid="msg-channel-internal"]').count() === 0 && /Dispute — only its members/.test(await p.textContent('[data-testid="rt-disp"] [data-testid="rt-aud"]')), 'B · the room has no channel toggle: external only, and the audience line says members only');
    await p.fill('[data-testid="rt-disp"] [data-testid="dispute-room-input"]', 'Photos of the torn bags are attached');
    const n2 = posts().length;
    await p.click('[data-testid="rt-disp"] [data-testid="dispute-room-send"]');
    await settle();
    const dp = posts().slice(n2);
    ok(dp.length === 1 && dp[0].body.is_dispute === true && dp[0].body.dispute_id === 'd1' && dp[0].body.thread_type === 'external', 'B · the room\'s send → ONE POST {is_dispute:true, dispute_id:d1, thread_type:external}');
    ok((await rows('[data-testid="rt-disp"]')).length === 2 && /Sent to the dispute/.test(await out('[data-testid="rt-disp"]')), 'B · listed in the room (2), outcome said there');
    ok((await rows()).length === 5, 'B · the general thread still shows no dispute row (5)');

    /* ── C · a comment-only person: internal only ── */
    await open(WHO.commenter);
    ok(await p.locator('[data-testid="rt-host"] [data-testid="msg-channel-external"].off[aria-disabled="true"]').count() === 1, 'C · External is greyed (aria-disabled) for comment-only');
    const whyC = await p.textContent('[data-testid="rt-host"] [data-testid="rt-why-external"]');
    ok(/comment-only/i.test(whyC) && /internally/i.test(whyC), 'C · with the engine\'s sentence: "' + whyC.trim() + '"');
    ok(await p.locator('[data-testid="rt-host"] [data-testid="msg-channel-internal"].on').count() === 1, 'C · Internal is selected');
    await p.click('[data-testid="rt-host"] [data-testid="msg-channel-external"]', { force: true });   /* aria-disabled: Playwright would wait for it; a person can still tap it */
    ok(await p.locator('[data-testid="rt-host"] [data-testid="msg-channel-internal"].on').count() === 1, 'C · pressing the greyed External does nothing');
    await p.fill('[data-testid="rt-host"] [data-testid="msg-body"]', 'Godown has room for 4 bags');
    const n3 = posts().length;
    await p.click('[data-testid="rt-host"] [data-testid="msg-send"]');
    await settle();
    ok(posts().slice(n3).length === 1 && posts()[n3].body.thread_type === 'internal', 'C · the note lands: ONE POST {thread_type:internal}');
    /* a forced external (a host calling CBThread.send) is refused by the server, and said in the server\'s words */
    const forced = await p.evaluate(() => CBThread.send({ chit_id: 'lab-chit', text: 'forced', thread_type: 'external' }));
    ok(forced && forced.ok === false && !forced.message_id, 'C · CBThread.send external → refused (no message_id)');
    ok(posts().filter((w) => w.who === 'Kumar' && w.body.thread_type === 'external').length === 1 && S.msgs.filter((x) => x.sender_display_name === 'Kumar' && x.thread_type === 'external').length === 0, 'C · the refused external was never stored — comment-only sends internal only');
    ok(await p.evaluate(() => { const x = document.querySelector('[data-testid="rt-host"] [data-testid="msg-channel-external"]'); return !!x && x.classList.contains('off'); }), 'C · External stays greyed after the refusal');

    /* ── D · the auditor: reads, cannot reply ── */
    await open(WHO.auditor);
    const nD = posts().length;
    const rD = await rows();
    ok(rD.length >= 4 && rD.every((x) => !x.disp), 'D · the auditor reads the thread (' + rD.length + ' rows, none a dispute row)');
    ok(await p.locator('[data-testid="rt-host"] [data-testid="msg-body"]').count() === 0 && await p.locator('[data-testid="rt-host"] [data-testid="msg-send"]').count() === 0, 'D · no box, no Send');
    const noD = await p.textContent('[data-testid="rt-host"] [data-testid="rt-no"]');
    ok(/view-only/i.test(noD), 'D · the sentence instead: "' + noD.trim() + '"');
    await settle(600);
    ok(posts().length === nD, 'D · the auditor sent nothing');

    /* ── E · Meena, a party to the chit but NOT to the dispute ── */
    await open(WHO.meena);
    const rE = await rows();
    ok(rE.length === 3 && rE.every((x) => !x.disp && x.th === 'external'), 'E · Meena sees the external rows only (' + rE.length + ') — no internal note, no dispute row');
    ok(await p.locator('.dispbanner').count() === 0 && await p.locator('[data-testid="rt-disp"]').count() === 0, 'E · no dispute room is offered to a non-member');
    ok(!(await p.evaluate(() => document.body.innerText)).includes('torn bags'), 'E · the dispute\'s words appear nowhere on her screen');
    ok(S.gets.filter((g) => g.who === 'Meena Traders' && /messages/.test(g.p) && g.q.dispute === '1').length === 0, 'E · nothing on her page ever asked for dispute rows');

    ok(errs.length === 0, 'no page error and no browser dialog the whole run' + (errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''));
    ok(...C.finish());
  } catch (e) {
    ok(false, 'the run threw: ' + (e && e.message));
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    await b.close(); web.close();
  }
  console.log('\nrail-thread: ' + pass + ' passed · ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
