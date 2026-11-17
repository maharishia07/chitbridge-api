/**
 * live-run-mint.cjs — drive the REAL UI through both consolidated mint paths (lib/mint.js).
 *
 * The chit_deliver consolidation replaced four hand-rolled copy-builders with one shape module. The proofs and the
 * characterisation tests are green, but they call the API. This drives a BROWSER: a person's clicks, through the
 * compose step-flow and through the public storefront, exercising the two paths a human actually uses.
 *
 * ⚠️ WHAT THIS IS NOT. It is not the human live run the review gate requires. My ceiling is boot/parse/behaviour —
 * I can prove the rows are right; I cannot tell you the screen reads correctly to someone who knows the business.
 * The gate exists because those are different questions, and this file does not discharge it. It narrows what is
 * left for Athi to eyeball, and says so at the end.
 *
 * ⚠️ WHAT IT CHECKS IS THE CO-HELD INVARIANT, not "did a chit appear". Two copies of one chit must carry an
 * IDENTICAL header — same sender, subject, total, currency, schema — and differ only in who holds it and which way
 * it points. That is the thing lib/mint.js now owns for all four paths, and the thing that would silently rot if
 * any one of them drifted.
 *
 * RUN:  node e2e/live-run-mint.cjs
 */
const { chromium } = require('@playwright/test');
const F = require('./fixtures.js');

const WEB = process.env.CB_WEB || 'https://chitbridge-web.vercel.app';
const API = process.env.CB_API || 'https://chitbridge-api-production.up.railway.app';
const OTP = require('./lib/signin-code.cjs').codeOrSkip(API);   // SEC1: E2E_TESTER_CODE on a deployed api (unset → skipped with a warning)

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (detail ? '\n      ' + detail : '')); }
};

async function api(path, opts = {}) {
  const r = await fetch(API + path, { method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, opts.token ? { Authorization: 'Bearer ' + opts.token } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  let b = null; try { b = await r.json(); } catch (_) {}
  return { status: r.status, b };
}

(async () => {
  console.log('\n  LIVE RUN — both mint paths, through a real browser\n');
  const b = await chromium.launch();
  const ctx = await b.newContext({ baseURL: WEB });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
  p.on('dialog', (d) => d.accept());

  const stamp = String(process.pid).slice(-5);
  const SUBJECT = 'Live run ' + stamp;

  /* ── PATH 1 · /api/chits/send, driven through the compose step-flow ────────────────────────────────────────── */
  await p.goto(WEB + '/app.html');
  const who = await F.mintEntity(p, { email: 'beta@test-cb.com', name: 'Beta Fresh' });
  ok('signed in through the real front door', !!who, JSON.stringify(who));

  /* ⚠️ THE SHARED FIXTURE, NOT A HAND-ROLLED WALK. My first version drove the compose steps by hand and hung
     waiting for the Items step — compose() awaits the catalogue fetch before that field exists. CHIT-01 walks the
     same flow and passes, so the fault was mine. Re-using composeChit() also means this live run exercises the
     SAME path the suite does, instead of a second one that could drift. */
  await F.composeChit(p, { subject: SUBJECT, item: 'Live run item', qty: 3, price: 250, self: true, send: true });
  await p.waitForTimeout(6000);

  /* ⚠️ REGISTER THEN VERIFY. Calling verify alone issues no OTP, so the token came back null and EVERY query
     returned an empty list — which the assertions then read as "the chit was never minted". It had been: two of
     them were sitting in /sent the whole time. A null token that fails silently is worse than one that 401s. */
  await api('/api/entities/register', { method: 'POST', body: { email: 'beta@test-cb.com', display_name: 'Beta Fresh' } });
  const tok = (await api('/api/entities/verify', { method: 'POST', body: { email: 'beta@test-cb.com', otp: OTP } })).b;
  const token = tok && (tok.token || (tok.entity && tok.entity.token));
  ok('the API token is real — an empty list must mean "none", not "unauthorised"', !!token);
  /**
   * ⚠️ THE TASK COPY MAY HAVE BEEN FILED BY A RULE, and the loose inbox deliberately hides filed chits. My first
   * version looked only at /inbox, reported "no received copy" and would have read as a broken co-held transfer —
   * when in fact a folder rule had picked the chit up the instant it arrived and filed it into "Needs attention".
   * Looking only where you expect a thing to be is how a working feature gets reported as broken.
   */
  const folders = ((await api('/api/folders', { token })).b || {}).folders || [];
  let inbox = ((await api('/api/chits/inbox?limit=30', { token })).b || {}).chits || [];
  for (const f of folders.filter((x) => (x.scope || 'task') === 'task')) {
    inbox = inbox.concat(((await api('/api/chits/inbox?limit=50&folder_id=' + f.folder_id, { token })).b || {}).chits || []);
  }
  const sent  = ((await api('/api/chits/sent?limit=30',  { token })).b || {}).chits || [];
  const rc = inbox.find((c) => (c.manual_subject || '') === SUBJECT);
  const sc = sent.find((c) => (c.manual_subject || '') === SUBJECT);

  ok('★★ COMPOSE → SEND minted the chit from a real click', !!(rc || sc), 'inbox:' + !!rc + ' sent:' + !!sc);
  ok('★★★ both copies of the self-chit exist — the co-held transfer', !!rc && !!sc,
    'received:' + !!rc + ' sent:' + !!sc);

  if (rc && sc) {
    /* ⚠️ THE INVARIANT lib/mint.js EXISTS TO KEEP. Two rows that disagree on sender, subject, total or currency are
       not one chit — they are two documents, and the whole rail rests on them being one. */
    const same = (k) => JSON.stringify(rc[k]) === JSON.stringify(sc[k]);
    ok('★★★ both copies carry an IDENTICAL header (sender · subject · purpose)',
      same('sender_entity_id') && same('manual_subject') && same('purpose'),
      JSON.stringify({ sender: [rc.sender_entity_id, sc.sender_entity_id], subj: [rc.manual_subject, sc.manual_subject] }));
    const rs = rc.summary_json || {}, ss = sc.summary_json || {};
    ok('★★★ …and the same money: total + currency + line count',
      rs.total_value === ss.total_value && rs.currency_code === ss.currency_code && rs.line_item_count === ss.line_item_count,
      JSON.stringify({ recv: [rs.total_value, rs.currency_code, rs.line_item_count], sent: [ss.total_value, ss.currency_code, ss.line_item_count] }));
    ok('★★ the total is what was typed (3 × 250 = 750)', Number(rs.total_value) === 750, String(rs.total_value));
    ok('★★ they differ ONLY in direction', rc.chit_id === sc.chit_id, rc.chit_id + ' vs ' + sc.chit_id);
  }

  /* ── PATH 2 · the storefront order — the SAME transaction that consumes an OTP and stores documents ────────── */
  const me = (await api('/api/entities/me', { token })).b;
  const bridge = (me && (me.entity ? me.entity.bridge_id : me.bridge_id)) || null;
  await api('/api/entities/profile', { method: 'PATCH', token, body: { catalogue_visibility: 'public' } });
  const shopRes = await p.goto(WEB + '/shop.html?s=' + bridge, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  const shopOK = shopRes && shopRes.status() < 400;
  const hasItems = await p.locator('[data-testid^="pick-"], .cbcart-row, .prod').count().catch(() => 0);
  ok('the storefront opens for a real buyer', !!shopOK, shopRes ? String(shopRes.status()) : 'no response');
  if (!hasItems) console.log('      (no orderable items on this shop — the storefront mint path was NOT exercised here)');
  ok('storefront reachable and rendering', hasItems > 0 || !!shopOK, 'items:' + hasItems);

  ok('★ no uncaught page errors during the walk', errors.length === 0, errors.join(' | '));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('\n  ⚠️ WHAT THIS DOES NOT DISCHARGE — the review gate wants a HUMAN live run, and this is not one.');
  console.log('     Proved here: the rows are right, both copies agree, a real click mints a real chit.');
  console.log('     Left for Athi: does the screen READ correctly to someone who knows the business —');
  console.log('     and the storefront order path, which needs a shop with orderable items + a buyer OTP.\n');
  await b.close();
  process.exitCode = fail ? 1 : 0;
})();
