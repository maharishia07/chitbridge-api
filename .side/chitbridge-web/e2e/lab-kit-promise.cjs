/* lab-kit-promise.cjs - ONE PROMISE SENTENCE (Offer Lab v2 PR-a0)
 *
 * The text a lab shows before a commit and the text the confirm popup shows must be the same words, because both come from CBLabKit.promise.
 * For each act (make live, only for a group, approve, go live, pause, resume, retire, delete) this opens the REAL askPromise popup on the real page
 * and checks: the popup body equals CBLabKit.promise(...).text, its title and button are the act's, and it names the offer, what it reaches with the count,
 * for whom and from when. The sheet's draft line comes from the same function. Nothing reaches a server. Run: node e2e/lab-kit-promise.cjs */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
let bad = 0;
const say = (label, ok, detail) => { console.log('  ' + String(label).padEnd(40) + '· ' + detail + '  ' + (ok ? 'OK' : (bad++, 'FAILED'))); };

/* the acts and what each must say: title, button, for whom, from when (written here, not read back from the kit) */
const ACTS = [
  { label: 'Make live', kind: 'live', title: 'Make this offer live?', ok: 'Make live', who: 'every customer', from: 'now, on the very next bill' },
  { label: 'Only for a group', kind: 'group', title: 'Make this offer live for a group?', ok: 'Make live for them', who: 'Regulars', from: 'now, on the very next bill', patch: { customer_group: 'group:Regulars' } },
  { label: 'Approve', kind: 'approve', title: 'Approve this offer?', ok: 'Approve', who: 'nobody yet', from: 'not live. Going live is the next step' },
  { label: 'Go live', kind: 'golive', title: 'Go live with this offer?', ok: 'Go live', who: 'every customer', from: 'now, on the very next bill' },
  { label: 'Pause', kind: 'pause', title: 'Pause this offer?', ok: 'Pause', who: 'nobody while it is paused', from: 'now' },
  { label: 'Resume', kind: 'resume', title: 'Resume this offer?', ok: 'Resume', who: 'every customer', from: 'now, on the very next bill' },
  { label: 'Retire', kind: 'retire', title: 'Retire this offer?', ok: 'Retire', who: 'nobody from now on', from: 'now' },
  { label: 'Delete', kind: 'delete', title: 'Delete this offer?', ok: 'Delete', who: 'nobody', from: 'now' }
];
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'text/plain' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, res));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/offer-lab-next.html');
  await page.waitForTimeout(300);

  for (const act of ACTS) {
    const seen = await page.evaluate((a) => {
      const item = { id: 'x1', title: 'Spend and save', detail: '10% off', snap: { goal: 'spend', spendAt: 50000 } };
      askPromise(item, a.kind, a.patch || null, function () {});
      const body = document.querySelector('[data-testid="lk-confirm-text"]');
      const shown = CBLabKit.promise(promiseParts(item, a.kind, a.patch || null));
      const popup = { text: body.innerText, title: document.querySelector('.lk-pop header b').textContent, ok: document.querySelector('[data-testid="lk-confirm-ok"]').textContent, on: document.querySelector('[data-testid="promise-on"]').textContent };
      document.querySelector('[data-testid="lk-confirm-cancel"]').click();
      return { popup, shown };
    }, act);
    const same = squash(seen.popup.text) === squash(seen.shown.text);
    say(act.label + ': text before saving = popup', same, same ? 'identical' : 'popup "' + squash(seen.popup.text) + '" vs "' + squash(seen.shown.text) + '"');
    const says = [seen.popup.title === act.title, seen.popup.ok === act.ok, /Spend and save/.test(seen.popup.text), /every bill of/.test(seen.popup.on), squash(seen.popup.text).includes('For: ' + act.who), squash(seen.popup.text).includes('From: ' + act.from)];
    say(act.label + ': title, button, what, on what, whom, when', says.every(Boolean), says.join(','));
  }

  /* v2: the right-hand pane (an open saved offer) says exactly what the popup of its next step says */
  for (const status of ['draft', 'approved', 'live', 'paused']) {
    const seen = await page.evaluate((st) => {
      const item = { id: 'p1', title: 'Spend and save', detail: '₹50 back', status: st, n: '—', k: 'saved', snap: { goal: 'spend', spendAt: 500 } };
      SAVED = [item]; openOffer('p1');
      const pane = document.querySelector('[data-testid="promise-text"]').innerText;
      askPromise(item, NEXT_ACT[st], null, function () {});
      const popup = document.querySelector('[data-testid="lk-confirm-text"]').innerText;
      document.querySelector('[data-testid="lk-confirm-cancel"]').click();
      return { pane, popup };
    }, status);
    say('a ' + status + ' offer: the pane text = the popup text', squash(seen.pane) === squash(seen.popup) && seen.pane.length > 40, squash(seen.pane).slice(0, 80));
  }
  /* a group offer: Go live and Resume keep the group, so the pane and the popup both NAME it (never "every customer") */
  for (const [status, words] of [['approved', /For: Wholesale .*only/], ['paused', /For: Wholesale .*only/], ['live', /it is for Wholesale .*only/], ['draft', /it was only for Wholesale/]]) {
    const seen = await page.evaluate((st) => {
      const item = { id: 'g1', title: 'Spend and save', detail: '₹50 back', status: st, group: 'group:Wholesale', groupName: 'Wholesale', n: '—', k: 'saved', snap: { goal: 'spend', spendAt: 500 } };
      SAVED = [item]; openOffer('g1');
      const pane = document.querySelector('[data-testid="promise-text"]').innerText;
      askPromise(item, NEXT_ACT[st], null, function () {});
      const popup = document.querySelector('[data-testid="lk-confirm-text"]').innerText;
      document.querySelector('[data-testid="lk-confirm-cancel"]').click();
      return { pane, popup };
    }, status);
    say('a ' + status + ' group offer: pane = popup and names the group', squash(seen.pane) === squash(seen.popup) && words.test(squash(seen.pane)) , squash(seen.pane).slice(0, 110));
  }
  /* ── margin effect (Athi 22 Oct): one sentence line, from totals(), in the pane and the popup alike ── */
  const SETUP = (costs) => {
    P = [['a', 100, costs[0]], ['b', 200, costs[1]], ['c', 50, costs[2]], ['d', 80, costs[3]]].map(([id, price, cost]) => ({ id, name: 'Item ' + id, cat: 'c1', price, cost, modifiers: [] }));
    CATS = [{ id: 'c1', name: 'Things' }];
    COST_ACCESS = { can_see_costs: true, is_owner: true, loaded: true };
  };
  const BASE = { scope: 'item', itemIds: ['a', 'b', 'c', 'd'], belowAct: 'exclude', round: '0' };
  /* shown beside the pane and the popup of one saved offer (kind = the act the pane promises next) */
  const SEE = (snapIn, status, group, costs, canSee) => page.evaluate(([snapArg, st, grp, cs, can]) => {
    SETUP_FN(cs); COST_ACCESS.can_see_costs = can;
    const item = { id: 'm1', title: 'Offer', detail: 'x', status: st, group: grp || undefined, groupName: grp ? 'Wholesale' : undefined, n: '—', k: 'saved', snap: snapArg };
    SAVED = [item]; openOffer('m1');
    const pane = (document.querySelector('[data-testid="promise-text"]') || {}).innerText || '';
    askPromise(item, NEXT_ACT[st], null, function () {});
    const popup = document.querySelector('[data-testid="lk-confirm-text"]').innerText;
    const popupMargin = (document.querySelector('[data-testid="promise-margin"]') || {}).textContent || '';
    document.querySelector('[data-testid="lk-confirm-cancel"]').click();
    return { pane, popup, popupMargin, direct: marginSentence(snapArg, NEXT_ACT[st]), tot: marginTotals(snapArg) };
  }, [snapIn, status, group, costs, canSee]);
  await page.evaluate("window.SETUP_FN = " + SETUP.toString());
  const FULL = [60, 120, 30, 40];
  const KINDS = [
    ['percent', { goal: 'percent', pctOff: 20 }, 'Margin on these items: 42% → 27% (as if one of each, at today\'s costs).'],
    ['rupees off', { goal: 'amount', rsOff: 10 }, 'Margin on these items: 42% → 36% (as if one of each, at today\'s costs).'],
    ['tiers (top step)', { goal: 'qty', tiers: [[2, 5], [5, 10]] }, 'Margin on these items: 42% → 35% (as if one of each, at today\'s costs).']
  ];
  for (const [label, kindSnap, words] of KINDS) {
    const seen = await SEE(Object.assign({}, BASE, kindSnap), 'draft', '', FULL, true);
    const same = squash(seen.pane) === squash(seen.popup);
    say(label + ': margin line, pane = popup', same && squash(seen.popup).includes(words) && seen.popupMargin === words, seen.popupMargin || squash(seen.popup).slice(0, 90));
    const t = seen.tot;
    say(label + ': the figure is totals()', seen.popupMargin.includes(t.marginBefore + '% → ' + t.marginAfter + '%') && t.blind === 0, t.marginBefore + ' -> ' + t.marginAfter);
  }
  const lost = await SEE(Object.assign({}, BASE, { goal: 'percent', pctOff: 20 }), 'draft', '', [60, 120, null, null], true);
  say('2 of 4 costs missing: the count, no figure', lost.popupMargin === 'Margin not shown: cost price missing for 2 of 4 items.' && !/Margin on/.test(lost.popup) && squash(lost.pane) === squash(lost.popup) && !/%/.test(lost.popupMargin), lost.popupMargin);
  const paused = await SEE(Object.assign({}, BASE, { goal: 'percent', pctOff: 20 }), 'paused', 'group:Wholesale', FULL, true);
  say('a paused group offer: margin, group, pane = popup', squash(paused.pane) === squash(paused.popup) && /Margin on these items: 42% → 27%/.test(paused.popup) && /For: Wholesale .*only/.test(squash(paused.popup)), squash(paused.popup).slice(0, 120));
  for (const costs of [FULL, [60, 120, null, null]]) {
    const blind = await SEE(Object.assign({}, BASE, { goal: 'percent', pctOff: 20 }), 'draft', '', costs, false);
    say('cost-blind' + (costs[2] === null ? ' (costs missing)' : '') + ': no margin, no count, in the pane or the popup', !/[Mm]argin|cost price/.test(blind.pane + blind.popup) && squash(blind.pane) === squash(blind.popup), squash(blind.popup).slice(0, 70));
  }
  const NONE = [
    ['free same', { goal: 'free', freeShape: 'same', itemId: 'a', freeCounts: [2, 3, 5], freeChosen: 0 }],
    ['cheapest', { goal: 'free', freeShape: 'cheapest', catId: 'c1', cheapN: 3 }],
    ['pair', { goal: 'free', freeShape: 'pair', pairA: 'a', pairB: 'b' }],
    ['bundle', { goal: 'bundle', bunA: 'a', bunB: 'b', bunPrice: 250 }],
    ['gift', { goal: 'free', freeShape: 'anything', giftId: 'a' }],
    ['spend', { goal: 'spend', spendAt: 500, spendVal: 50 }],
    ['ship', { goal: 'ship', shipAt: 500 }],
    ['band', { goal: 'band', bandLo: 10, bandHi: 900 }]
  ];
  for (const [label, kindSnap] of NONE) {
    const seen = await SEE(Object.assign({}, BASE, kindSnap), 'draft', '', FULL, true);
    say(label + ': no margin line yet', !/[Mm]argin/.test(seen.popup + seen.pane) && squash(seen.pane) === squash(seen.popup), squash(seen.popup).slice(0, 60));
  }
  const quiet = await page.evaluate(() => {
    SETUP_FN([60, 120, 30, 40]);
    const item = { id: 'q1', title: 'Offer', detail: 'x', snap: { scope: 'item', itemIds: ['a', 'b', 'c', 'd'], belowAct: 'exclude', round: '0', goal: 'percent', pctOff: 20 } };
    return ['approve', 'pause', 'retire', 'delete'].map((k) => k + ':' + CBLabKit.promise(promiseParts(item, k, null)).text.includes('Margin')).join();
  });
  say('approve, pause, retire, delete: no margin line', !/true/.test(quiet), quiet);
  const form = await page.evaluate(() => {
    SETUP_FN([60, 120, 30, 40]);
    Object.assign(S, { goal: 'percent', scope: 'item', itemIds: ['a', 'b', 'c', 'd'], pctOff: 20, belowAct: 'exclude', round: '0', step: 2 });
    TYPE_PICKED = true; SAVED = []; render();
    const shown = { title: 'A percentage off', detail: '20% off' };
    return { line: draftPromise(shown), pane: ((document.querySelector('[data-testid="promise-text"]') || {}).innerText || '') };
  });
  say('the sheet draft line carries the margin', /Margin on these items: 42% → 27%/.test(form.line), form.line.slice(-120));
  say('the open form pane carries it too', form.pane === '' || /Margin on these items: 42% → 27%/.test(form.pane), squash(form.pane).slice(0, 80) || '(pane hidden at this width)');
  const grouped = await page.evaluate(() => {
    const by = CBLabKit.groupBy([{ s: 'b' }, { s: 'a' }, { s: 'b' }, { s: 'z' }], (x) => x.s, ['a', 'b', 'c']);
    return Object.keys(by).join() + '|' + Object.values(by).map((v) => v.length).join();
  });
  say('groupBy keeps the given order, empty groups and extra keys', grouped === 'a,b,c,z|1,2,0,1', grouped);

  const draft = await page.evaluate(() => {
    const shown = { title: 'A percentage off', detail: '10% off' };
    S.scope = 'item'; S.itemIds = ['masala']; render();
    return { line: draftPromise(shown), kit: CBLabKit.promise(Object.assign(promiseParts({ title: shown.title, detail: shown.detail, snap: snapshot() }, 'draft'), { note: takenOffNote().trim() })).text };
  });
  say('the draft line is the kit sentence', draft.line === draft.kit && /^Saves a draft: A percentage off · 10% off, on /.test(draft.line) && /Nothing is live until you make it live\./.test(draft.line), '"' + draft.line + '"');
  say('no page error', errors.length === 0, errors.join(' | ') || 'none');
  await browser.close();
  srv.close();
  console.log(bad ? '\n' + bad + ' check(s) failed' : '\nall promise checks passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
