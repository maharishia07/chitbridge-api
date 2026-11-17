/* till-subscription.cjs — A RECURRING COMMITMENT, SOLD, THEN TRACKED VISIT BY VISIT
 *
 * ⚠️⚠️⚠️ [HELD, 2026-09-26] Athi, after seeing this live: "remove the subscription now, it has to be tied
 * with the customer, otherwise how you would know. keep it as one of the asset but not to be showcased...
 * when we bring the customer then we can include it here, otherwise, tidy this with the backend app as part
 * of customer link. not here." "Customer" here was always a free-text name, not a real customer record, so
 * there was nowhere for "your AMC is due" to actually reach anyone — right call. The mechanism this test
 * proves is UNCHANGED and stays correct; only menuSubscriptionSummary() now returns '' instead of the two
 * buttons, so the door out of the till menu is closed until a real customer link exists. See BACKLOG.md for
 * where that link is expected to live (routes/relationships.js / lib/customer-groups.js).
 *
 * Athi: "scope the subscription/AMC feature and let's build it." Following the same shape as expenses (his
 * own framing, reused deliberately): "it can be anything like Gpay... or cash or card, need to know what the
 * expense is and the mode of payment and amount... we are not classifying... assuming if we are bringing the
 * real ledger, then it has to be recorded against the same."
 *
 * ⚠️⚠️ UNLIKE AN EXPENSE, A SUBSCRIPTION/AMC IS A SALE — real money taken the moment someone signs up. This
 * test proves that distinction lands correctly in rollup.js's shared totals(): counted as an ordinary sale,
 * not excluded like a return or an expense, with no code change needed there (tests/rollup.test.js already
 * proves the engine's own behaviour; this proves till.html's local subscription row is SHAPED to trigger it).
 *
 * Fulfillment (each delivery, each AMC visit) is tracked LOCALLY on this counter in v1 — see
 * chitOfSubscription()'s own comment in till.html for why a second chit per occurrence was rejected. This
 * test proves that tracking: mark done, undo, progress against a fixed count, "ongoing" with no fixed count,
 * and the overdue computation, all done lazily with no cron (there is none in this product).
 *
 * Run: node e2e/till-subscription.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(62) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1280, height: 880 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  await p.evaluate((api) => {
    CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
    ls.set(tillGivenKey(), 'C1');
    WHO = { id: 'w1', name: 'Bala', kind: 'coassist', since: new Date().toISOString() };
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', pay: [{ id: 'cash', label: 'Cash' }, { id: 'card', label: 'Card' }, { id: 'upi', label: 'UPI' }] },
                 at: new Date().toISOString(), items: [], offers: [] };
    window.sure = async () => true;   /* the confirmation itself is proven elsewhere; this test drives the form */
  }, base);

  console.log('\n── ⚠️⚠️⚠️ [HELD, 2026-09-26] NOT SHOWCASED IN THE TILL MENU — see menuSubscriptionSummary()’s own note ' + '─'.repeat(0));
  console.log('   Athi: "remove the subscription now, it has to be tied with the customer, otherwise how you ' + '─'.repeat(0));
  console.log('   would know... keep it as one of the asset but not to be showcased." Everything below still ' + '─'.repeat(0));
  console.log('   proves the MECHANISM works — only the menu door is closed until a real customer link exists. ' + '─'.repeat(0));
  const gate = await p.evaluate(() => ({
    canIssue: subCanIssue(),
    menuHasBoth: (function(){ if (!menuIsOpen('moremoney')) menuSection('moremoney'); paintMenu();
      var h = document.getElementById('tillmenu').innerHTML;
      return { newBtn: /till-open-subscription"/.test(h), listBtn: /till-open-subscription-list/.test(h) }; })(),
  }));
  say('subCanIssue() is still true — the mechanism itself is untouched', gate.canIssue, 'confirmed');
  say('but "🔁 New subscription/AMC" is NOT in the menu — held, deliberately', gate.menuHasBoth.newBtn === false, gate.menuHasBoth.newBtn ? 'still showing — regression' : 'correctly hidden');
  say('and neither is "📋 My subscriptions & AMCs"', gate.menuHasBoth.listBtn === false, gate.menuHasBoth.listBtn ? 'still showing — regression' : 'correctly hidden');

  console.log('\n── signing someone up for a FIXED-COUNT AMC (4 visits), through the real dialog ' + '─'.repeat(0));
  const signedUp = await p.evaluate(async () => {
    let call = null;
    var real = HOST.subscription.bind(HOST);
    HOST.subscription = function(s){ call = s; return real(s); };
    subOpen();
    var dlgOpenBefore = document.getElementById('subdlg').open;
    subWhat('AC service contract'); subCustomer('Priya'); subAmountSet('3000'); subOcc('4'); subCadence('90'); subHow('UPI');
    var goLabel = document.getElementById('subgo').textContent;
    await subIssue();
    var dlgOpenAfter = document.getElementById('subdlg').open;
    var bills = await HOST.bills();
    var mine = bills.filter(function(x){ return x.kind === 'subscription'; });
    return { dlgOpenBefore: dlgOpenBefore, goLabel: goLabel, dlgOpenAfter: dlgOpenAfter, call: call, saved: mine[0] || null };
  });
  say('the dialog actually opened', signedUp.dlgOpenBefore === true, 'confirmed');
  say('the button names the amount once there is one', /^Sign up.*3,000/.test(signedUp.goLabel), signedUp.goLabel);
  say('HOST.subscription() carries what/customer/occurrences/cadence/mode',
    signedUp.call && signedUp.call.what === 'AC service contract' && signedUp.call.customer.name === 'Priya'
    && signedUp.call.occurrencesTotal === 4 && signedUp.call.cadenceDays === 90 && signedUp.call.mode === 'UPI',
    JSON.stringify(signedUp.call));
  say('⚠️⚠️ UNLIKE AN EXPENSE, THIS CARRIES `payments` — it is a real sale, not money out',
    signedUp.call && Array.isArray(signedUp.call.payments) && signedUp.call.payments[0].how === 'UPI' && signedUp.call.payments[0].amount === 3000,
    JSON.stringify(signedUp.call && signedUp.call.payments));
  say('the dialog closes on success', signedUp.dlgOpenAfter === false, 'confirmed');
  say('it was written to the local bills store, tagged S — its own series',
    signedUp.saved && /^S\//.test(String(signedUp.saved.no)), signedUp.saved && signedUp.saved.no);
  say('purpose:\'subscription\' is what reaches the server',
    signedUp.saved && signedUp.saved.chitBody && signedUp.saved.chitBody.purpose === 'subscription',
    signedUp.saved && signedUp.saved.chitBody && signedUp.saved.chitBody.purpose);
  say('billed_at is set — [REV-02]’s alreadyBilled() must skip live-offers for this chit too',
    signedUp.saved && !!signedUp.saved.chitBody.business_json.billed_at, 'confirmed');
  say('the chit carries a real line — 4 visits at ₹3000, not an empty shell',
    signedUp.saved && signedUp.saved.chitBody.line_items[0].quantity === 4 && signedUp.saved.chitBody.line_items[0].total === 3000,
    JSON.stringify(signedUp.saved && signedUp.saved.chitBody.line_items));

  console.log('\n── an ONGOING subscription (no fixed count) is a different, honest shape, not a data gap ' + '─'.repeat(0));
  const ongoing = await p.evaluate(async () => {
    subOpen();
    subWhat('Milk delivery'); subCustomer('Ravi'); subAmountSet('900'); subOcc(''); subCadence('1'); subHow('Cash');
    await subIssue();
    var bills = await HOST.bills();
    var mine = bills.filter(function(x){ return x.kind === 'subscription' && x.what === 'Milk delivery'; })[0];
    return { occurrencesTotal: mine && mine.occurrencesTotal, cadenceDays: mine && mine.cadenceDays, no: mine && mine.no };
  });
  say('occurrencesTotal is null — "ongoing", never guessed or zeroed', ongoing.occurrencesTotal === null, JSON.stringify(ongoing.occurrencesTotal));
  say('cadence still recorded — daily', ongoing.cadenceDays === 1, ongoing.cadenceDays);

  console.log('\n── a refused sign-up leaves the sheet open, nothing lost ' + '─'.repeat(0));
  const refused = await p.evaluate(async () => {
    HOST.subscription = async () => ({ ok: false, why: 'the counter could not write it' });
    subOpen(); subWhat('Newspaper'); subAmountSet('500'); subCadence('30');
    await subIssue();
    return { open: document.getElementById('subdlg').open, what: SUB_WHAT, amount: SUB_AMOUNT };
  });
  say('the dialog stays open on a refusal', refused.open === true, 'confirmed');
  say('nothing typed is lost', refused.what === 'Newspaper' && refused.amount === '500', JSON.stringify(refused));
  await p.evaluate(() => { subClose(); HOST.subscription = HOST.subscription; });

  console.log('\n── FULFILLMENT — tracked locally on this counter, lazily, with no cron anywhere ' + '─'.repeat(0));
  const fulfilled = await p.evaluate(async () => {
    // restore a real subscription() for a clean fixture, and give it a known "no" to track against
    HOST.subscription = async function(s){
      var no = 'S/C1/26-27/9999';
      return { ok: true, bill: Object.assign({ no: no, chitBody: {} }, s) };
    };
    var before = subDoneCount({ no: 'S/C1/26-27/9999' });
    subMarkDone('S/C1/26-27/9999');
    subMarkDone('S/C1/26-27/9999');
    var afterTwo = subDoneCount({ no: 'S/C1/26-27/9999' });
    subUndoLast('S/C1/26-27/9999');
    var afterUndo = subDoneCount({ no: 'S/C1/26-27/9999' });
    var fourVisit = { no: 'S/C1/26-27/9999', occurrencesTotal: 1, cadenceDays: 90, startsAt: new Date().toISOString() };
    var isDoneAtOne = subIsDone(fourVisit);
    return { before: before, afterTwo: afterTwo, afterUndo: afterUndo, isDoneAtOne: isDoneAtOne };
  });
  say('starts at zero', fulfilled.before === 0, 'confirmed');
  say('marking done twice really adds two', fulfilled.afterTwo === 2, 'confirmed');
  say('undo removes exactly the last one, not all of them', fulfilled.afterUndo === 1, 'confirmed');
  say('subIsDone() is true once done ≥ occurrencesTotal', fulfilled.isDoneAtOne === true, 'confirmed');

  console.log('\n── OVERDUE — computed lazily on read, exactly like lib/schedule.js’s own pattern ' + '─'.repeat(0));
  const overdue = await p.evaluate(() => {
    var startedLongAgo = { no: 'S/old', cadenceDays: 1, startsAt: new Date(Date.now() - 5 * 86400000).toISOString() };
    var startedJustNow = { no: 'S/new', cadenceDays: 1, startsAt: new Date().toISOString() };
    var doneSubscription = { no: 'S/finished', occurrencesTotal: 1, cadenceDays: 90, startsAt: new Date(Date.now() - 200 * 86400000).toISOString() };
    subMarkDone('S/finished');
    return {
      oldOneIsOverdue: subIsOverdue(startedLongAgo),
      newOneIsNotOverdue: subIsOverdue(startedJustNow),
      finishedOneIsNeverOverdue: subIsOverdue(doneSubscription),
    };
  });
  say('a daily subscription with nothing logged in 5 days reads overdue', overdue.oldOneIsOverdue === true, 'confirmed');
  say('one that just started is not overdue yet', overdue.newOneIsNotOverdue === false, 'confirmed');
  say('a FINISHED subscription is never "overdue", however long ago its last visit was', overdue.finishedOneIsNeverOverdue === false, 'confirmed');

  console.log('\n── the list screen shows real progress, real due-dates, and says plainly what v1 does not do yet ' + '─'.repeat(0));
  const list = await p.evaluate(async (amcNo) => {
    /* mark the REAL AMC (not the synthetic S/…/9999 fixture above) done once, so "1 of 4" is a true progress
     * figure and the undo button — only drawn once something exists to undo — genuinely appears */
    subMarkDone(amcNo);
    await subListOpen();
    var html = document.getElementById('sublistbody').innerHTML;
    return {
      open: document.getElementById('sublistdlg').open,
      hasAC: /AC service contract/.test(html), hasMilk: /Milk delivery/.test(html),
      hasProgress: /1 of 4 done/.test(html), hasOngoing: /done .{1,3} ongoing/.test(html),
      hasMarkButton: /till-sub-mark-/.test(html), hasUndoButton: /till-sub-undo-/.test(html),
      hasLocalNote: /tracked on THIS counter only for now/.test(html),
    };
  }, signedUp.saved.no);
  say('the list opens', list.open === true, 'confirmed');
  say('the fixed-count AMC is listed, with real progress (1 of 4, from the earlier mark)', list.hasAC && list.hasProgress, 'found');
  say('the ongoing milk subscription is listed too, worded as ongoing not a broken count', list.hasMilk && list.hasOngoing, 'found');
  say('a way to mark today done, and to undo it, on each row', list.hasMarkButton && list.hasUndoButton, 'found');
  say('the v1 limitation is stated plainly, not hidden', list.hasLocalNote, 'found');

  console.log('\n── AND IT COUNTS AS A REAL SALE — rollup.js’s shared engine, no special-casing needed ' + '─'.repeat(0));
  const rollupCheck = await p.evaluate(() => {
    var rows = [
      { no: 'S/1', kind: 'subscription', at: new Date().toISOString(), total: 3000, payments: [{ how: 'UPI', amount: 3000 }] },
      { no: 'C1/1', at: new Date().toISOString(), total: 500, payments: [{ how: 'Cash', amount: 500 }] },
    ];
    var t = CBRollup.totals(rows);
    return { count: t.count, gross: t.gross, by: t.by, returns: t.returns, expenses: t.expenses };
  });
  say('a subscription sign-up counts as a sale made (2 bills, not 1)', rollupCheck.count === 2, 'count=' + rollupCheck.count);
  say('its money is in gross, added to the day’s takings', rollupCheck.gross === 3500, 'gross=' + rollupCheck.gross);
  say('it banks under the tender it was actually paid in — UPI, not folded into Cash', rollupCheck.by.UPI === 3000 && rollupCheck.by.Cash === 500, JSON.stringify(rollupCheck.by));
  say('it is not miscounted as a return or an expense', rollupCheck.returns === 0 && rollupCheck.expenses === 0, 'confirmed');

  console.log('\nconsole/page errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  if (errs.length) bad++;
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\na subscription/AMC is sold like a sale and tracked visit by visit, honestly, with no cron anywhere');
  process.exit(bad ? 1 : 0);
})();
