#!/usr/bin/env node
/**
 * e2e/walk-short-delivery.cjs — R106 (OPS-60): A SHORT DELIVERY FROM A LOCAL SUPPLIER, WALKED (web PR 2 of 3; api #425 is the server half).
 * Library cases BIL002 (Accounts › Unpaid bills › Supplier bill › Accept) and BKS011 (Accounts › Unpaid bills); walk rows R106 · R106a (WALK-2026-10-24.md);
 * the local path TSK006b. A FRESH short-delivery receive (never the walk's SG-1021 ₹2,910, which is the R58 bill): Sri Ganesh Provisions' paper bill SG-1022
 * says ₹2,940, the counter counted goods worth ₹2,690 — ₹250 short. The server (books-hooks shortfallOf) puts the three figures on the Waiting row as DATA.
 *
 *   S1  Accounts › To do › the Waiting list: the row offers "Accept at ₹2,690" and "Reject", painted from waiting[].short (the gap is in the server's sentence) — never the sentence
 *   S2  Accept at the count ASKS FIRST, naming the supplier, the bill and the COUNTED ₹; Cancel sends nothing
 *   S3  Yes → the chit's own step (PUT /status accepted) ONCE; the row leaves; the outcome says what was noted
 *   S4  the bill's sheet: its Accept asks the same question at ₹2,690 — never their ₹2,940 (the figure the server posts)
 *   S5  the row's Reject opens the sheet's one Reject door (the reason question)
 *   P1  CB Finance › Payables: the bill's row carries the server's note "₹250 short against their ₹2,940"; Hold this bill · Note a difference
 *   P2  Hold asks first (supplier · ₹, a note); Yes → POST /parties/:id/dispute { against_ref, side supplier, disputed true, note }; the server's word is said
 *   P3  the held bill: the supplier row stays (Held ₹2,690), its held list reads the pay sheet's open-bills reader; "Held — in dispute with you" · Release
 *   P4  Release asks first; Yes → disputed false; "Released — payable again"
 *   P5  Note a difference → the ONE ＋ Entry door at kind debit_note, the supplier and the bill filled, one item line to type
 *   P6  the typed line (toor dal · 10 · ₹10 · 5 %) → the server's preview (its lines, balanced) → Save ASKS FIRST naming the ₹ and the supplier
 *   P7  Yes → POST /events { event debit_note, supplier, against_ref, reason rate, lines as typed, client_ref } once; Saved; Payables reads again
 *   R1–R4 screen rules (BRIEF-RULES 13): light and dark, 1366 and 390 — the Payables row opened with its doors
 * Every /api/books answer is held to the API contract (e2e/fixtures/web-api.contract.json). Fixture shop; nothing reaches a server.
 *
 *   NODE_PATH=$PWD/e2e/node_modules node e2e/walk-short-delivery.cjs        headless
 *   node e2e/walk-short-delivery.cjs --show                                  headed, captions, a results page
 */
'use strict';
const W = require('./lib/walk.cjs');
const C = require('./lib/contract.cjs');
const books = require('./lib/books-api.cjs');
const crmApi = require('./lib/crm-api.cjs');
const { rule13 } = require('./lib/rule13.cjs');
const J = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const TODAY = W.TODAY;
const PID = 'ps', PNO = 'P-00001', WHO = 'Sri Ganesh Provisions', CHIT = 'sg2', BILL = 'SG-1022';
const THEIRS = 294000, OURS = 269000, SHORT = 25000;
const SENTENCE = 'Their bill SG-1022 says ₹2,940, the goods counted come to ₹2,690 — ₹250 apart. Accept it at ₹2,690 (₹250 short, noted), or reject it.';
const NOTE = '₹250 short against their ₹2,940';
const HELD = 'Held — in dispute with you', RELEASED = 'Released — payable again';

/* ── the stand-in's world ── */
function waiting(S) {
  return S.accepted ? [] : [books.waitingRow({ id: 7, chit_id: CHIT, ref: 'chit:' + CHIT, reason: SENTENCE, tries: 0, since: TODAY + 'T04:00:00.000Z', job: 'chit', todo: 'accept',
    short: { theirs_minor: THEIRS, ours_minor: OURS, short_minor: SHORT }, source: { chit_id: CHIT, ref: null, kind: 'chit', counter: 'C1', by: null } })];
}
/* the chit read as the server answers it for MY counter receipt of their paper bill (doc bill_received, their_bill no + total; books_wait = the open waiting row) */
function chitRead(S) {
  const wait = S.accepted ? null : { todo: 'accept', name: null, why: SENTENCE, candidates: [] };
  return { doc: 'bill_received',
    header: { chit_id: CHIT, purpose: 'receipt', current_status: S.accepted ? 'accepted' : 'pending', created_at: TODAY + 'T03:30:00.000Z',
      all_recipients: [{ role: 'sender', display_name: 'Fixture Shop', entity_id: 'ent-walk' }, { role: 'receiver', display_name: 'Fixture Shop', entity_id: 'ent-walk' }],
      summary_json: { total_value: 2940, currency_code: 'INR' },
      business_json: { doc: 'receipt', doc_no: 'G/C1/26-27/0002', till: { id: 'C1' }, party: { name: WHO, party_id: PID }, their_bill: { no: BILL, total: 2940 } },
      state_log: S.accepted ? [{ action: 'bill_step', mine: true, code: 'B-2100', step: 'accepted', at: TODAY + 'T05:00:00.000Z', action_by_display_name: 'Fixture Owner' }] : [] },
    detail: { line_items: [{ particulars: 'Rice 25 kg', quantity: 20, price: 50, total: 1000, gst_rate: 0 }, { particulars: 'Toor dal', quantity: 10, price: 150, total: 1500, gst_rate: 5 }] },
    books_wait: wait, actions: { accept: { ok: true }, reject: { ok: true, needs: ['reason'] } } };
}
const bill = (o) => Object.assign({ ref: CHIT, date: TODAY, due_date: W.dayPlus(30), open_minor: OURS, age_days: 0, bucket: '0_30', overdue: false, msme_day45: null, msme_days_left: null, msme_risk: false, msme_words: null, note: NOTE, early: null }, o);
function dues(S) {
  const held = !!S.held;
  const payable = { total_minor: held ? 0 : OURS, buckets: { '0_30': held ? 0 : OURS, '31_45': 0, '46_60': 0, '60_plus': 0 }, msme: false, msme_risk: false, msme_words: null, pay_by: held ? null : W.dayPlus(30), group: 'later',
    terms: { credit_days: 30, early: null }, early: null, bills: held ? [] : [bill({})] };
  const plain = books.dues([{ party_no: PNO, name: WHO, party_id: PID, side: 'supplier', balance_minor: -OURS, oldest_due: W.dayPlus(30), disputed_minor: held ? -OURS : 0, buckets: { lt_1y: -OURS } }], { asOf: TODAY });
  plain.parties = plain.parties.map((r) => Object.assign(r, { credit_limit_minor: null, credit_limit_from: null, over_limit: false, last_remind: null, payable }));
  plain.payables = { total_minor: payable.total_minor };
  return plain;
}
const OPEN_BILLS = (S) => [{ against_ref: CHIT, bill_no: BILL, due_date: W.dayPlus(30), open_minor: OURS, disputed: !!S.held }];
const EVENTS = books.eventsAnswer({
  events: [{ kind: 'debit_note', words: 'Note a difference', icon: 'receipt-minus', band: 'bought', voucher: 'Debit note', ledger_group: 'purchases', bill: false,
    fields: [{ key: 'supplier', kind: 'pick', pick: 'supplier', required: true }, { key: 'against_ref', kind: 'text', required: true },
      { key: 'reason', kind: 'pick', pick: 'debit_reason', options: ['rate', 'returned', 'other'], required: false }, { key: 'lines', kind: 'lines', required: true },
      { key: 'date', kind: 'date', required: true, default: 'today' }, { key: 'narration', kind: 'narration', required: false }] }],
  picks: { debit_reason: ['rate', 'returned', 'other'] } });
/* POST /preview for the typed line (toor dal · 10 × ₹10 · 5 %): the server's journal — Dr the supplier ₹105 · Cr purchase returns ₹100 · Cr input tax ₹5 */
const PREVIEW = { ok: true, kind: 'debit_note', voucher: { series: 'MJ', type: 'Debit note' }, date: TODAY,
  lines: [{ code: '2100', ledger: WHO, dr_minor: 10500, cr_minor: 0, type: 'personal', rule: 'Dr the receiver' },
    { code: '4150', ledger: 'Purchase returns', dr_minor: 0, cr_minor: 10000, type: 'real', rule: 'Cr what goes out' },
    { code: '1470', ledger: 'Input tax', dr_minor: 0, cr_minor: 500, type: 'real', rule: 'Cr what goes out' }],
  balanced: true, totals: { dr_minor: 10500, cr_minor: 10500 }, credit: null, bill: null, flags: [], refusals: [], code: null, duplicate: null };

W.run('short-delivery', async (w) => {
  const { page, ctx, base } = w;
  const S = { accepted: false, held: false, statusCalls: [], disputeCalls: [], events: [], previews: [], healthReads: 0, previewReads: 0, unanswered: [] };
  await ctx.route('**/api/**', async (r0) => {
    const r = C.wrap(r0);
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
    let b = null; try { b = JSON.parse(q.postData() || 'null'); } catch (_) { b = null; }
    let x;
    if (p === '/api/books/status') return J(r, 200, { migrated: true, enabled: true, walkin_grain: 'day' });
    if (p === '/api/books/health') { S.healthReads++; return J(r, 200, books.health({ last_check: { ok: true }, waiting: waiting(S) })); }
    if (p === '/api/books/todo') return J(r, 200, S.accepted ? [] : [books.todoRow({ kind: 'bills_to_accept', count: 1, words: '1 supplier bill is waiting for you to confirm the goods. Confirm them and they post.', action: { label: 'Open the bills', screen: 'waiting' } })]);
    if (p === '/api/books/dues') return J(r, 200, dues(S));
    if (p === '/api/books/payments/preview' && m === 'POST') { S.previewReads++; S.previews.push(b); return J(r, 200, books.payPreview(OPEN_BILLS(S), b, WHO, { on_rail: false })); }
    if ((x = p.match(/^\/api\/books\/parties\/([^/]+)\/dispute$/)) && m === 'POST') {
      S.disputeCalls.push({ id: x[1], body: b }); S.held = b.disputed !== false;
      return J(r, 200, { ok: true, entry_id: 'e-hold-' + S.disputeCalls.length, entry_no: 'MJ/26-27/000' + S.disputeCalls.length, posting_date: TODAY, doc_date: TODAY, moved: false, lines: 0, items: 1, note: null, status: S.held ? 'disputed' : 'undisputed', words: S.held ? HELD : RELEASED, against_ref: b.against_ref });
    }
    if (p === '/api/books/events' && m === 'GET') return J(r, 200, EVENTS);
    if (p === '/api/books/accounts') return J(r, 200, { accounts: [] });
    if (p === '/api/books/preview' && m === 'POST') { S.previews.push(b); return J(r, 200, PREVIEW); }
    if (p === '/api/books/events' && m === 'POST') { S.events.push(b); return J(r, 200, Object.assign(books.posted({ entry_no: 'MJ/26-27/0009', lines: 3, items: 1 }), { kind: 'debit_note' })); }
    if (p.match(/^\/api\/chits\/[^/]+\/messages$/) && m === 'GET') return J(r, 200, { messages: [], total: 0, page: 1, limit: 50 });
    if ((x = p.match(/^\/api\/chits\/([^/]+)$/)) && m === 'GET') return x[1] === CHIT ? J(r, 200, chitRead(S)) : J(r, 404, { error: 'no chit' });
    if ((x = p.match(/^\/api\/chits\/([^/]+)\/status$/)) && m === 'PUT') { S.statusCalls.push({ id: x[1], body: b }); if (b && b.status === 'accepted') S.accepted = true; return J(r, 200, { ok: true, new_status: b.status }); }
    if (p === '/api/folders' && m === 'GET') return J(r, 200, { folders: [] });
    if (p === '/api/notifications') return J(r, 200, { notifications: [], unread: 0 });
    if (p === '/api/events/ticket') return J(r, 200, { ok: true });
    if (p === '/api/entities/header') return J(r, 200, { display_name: 'Fixture Shop', country_code: 'IN' });
    if (p === '/api/entities/me') return J(r, 200, { entity: { display_name: 'Fixture Shop', currency_code: 'INR', country_code: 'IN' } });
    if (p === '/api/facts/rail') return J(r, 200, crmApi.railFacts({ suppliers: 1, customers: 0, in: 0, out: 0, stuck: 0 }));
    if (m === 'GET') { S.unanswered.push(m + ' ' + p); return J(r, 200, {}); }
    S.unanswered.push(m + ' ' + p); return J(r, 200, { ok: true });
  });
  await ctx.addInitScript((s) => { try { localStorage.setItem('cb_api_base', location.origin); localStorage.setItem('cb_sess', s); } catch (_) {} }, W.session('Fixture Owner', 'Fixture Shop'));

  const txt = (sel) => page.locator(sel).first().innerText().then((s) => s.replace(/\s+/g, ' ').trim()).catch(() => '');
  const confirmText = async () => { await page.waitForSelector('#cb_confirm[open], dialog[open] [data-testid="confirm-ok"]', { timeout: 6000 }).catch(() => {}); return txt('#cb_confirm'); };
  const yes = async () => { await page.click('#cb_confirm [data-testid="confirm-ok"]'); await page.waitForTimeout(500); };
  const cancel = async () => { await page.click('#cb_confirm [data-testid="confirm-cancel"]'); await page.waitForTimeout(300); };
  const money = (n) => '₹' + n.toLocaleString('en-IN');
  const openWaiting = async () => {
    await page.goto('about:blank'); await page.goto(base + '/accounts.html#todo');
    await page.waitForSelector('[data-testid="todo-go-bills_to_accept"], [data-testid="todo-none"]', { timeout: 20000 }).catch(() => {});
    await page.click('[data-testid="todo-go-bills_to_accept"]').catch(() => {});
    await page.waitForSelector('[data-testid="waiting-list"]', { timeout: 10000 }).catch(() => {});
    await page.waitForSelector('[data-testid="wait-accept-short-0"]', { timeout: 10000 }).catch(() => {}); /* the row's chit read lands, then the Step cell paints */
    await page.waitForTimeout(300);
  };

  /* ── Accounts: the Waiting row ── */
  await openWaiting();
  await w.step('S1', 'Accounts › To do › Waiting: the row for SG-1022 offers "Accept at ₹2,690" and "Reject" — from waiting[].short, with the server\'s sentence', async () => {
    const row = await txt('[data-testid="wait-0"]'), acc = await txt('[data-testid="wait-accept-short-0"]'), rej = await page.locator('[data-testid="wait-reject-short-0"]').count();
    const okAcc = /^Accept at ₹\s?2,690(\.00)?$/.test(acc);
    return { ok: okAcc && rej === 1 && row.indexOf(WHO) >= 0 && row.indexOf(BILL) >= 0 && row.indexOf('₹250 apart') >= 0, saw: 'button "' + acc + '"; Reject ' + rej + '; row "' + row.slice(0, 140) + '"' };
  });
  await w.step('S2', 'Accept at the count ASKS FIRST: "Accept bill SG-1022 at ₹2,690?" — the gap, their figure and the supplier in the body; Cancel sends nothing', async () => {
    await page.click('[data-testid="wait-accept-short-0"]');
    const t = await confirmText();
    const okT = /Accept bill SG-1022 at ₹\s?2,690(\.00)?\?/.test(t) && /₹\s?250(\.00)? short against their ₹\s?2,940(\.00)? — noted on the bill\. You will owe Sri Ganesh Provisions ₹\s?2,690(\.00)?\./.test(t) && /Accept at ₹\s?2,690/.test(t);
    await cancel();
    return { ok: okT && S.statusCalls.length === 0, saw: '"' + t.slice(0, 200) + '"; status writes ' + S.statusCalls.length };
  });
  await w.step('S3', 'Yes → PUT /api/chits/sg2/status { status: accepted } ONCE; the row leaves the list; the outcome says "Accepted at ₹2,690 — ₹250 short against their ₹2,940, noted on the bill"', async () => {
    const h0 = S.healthReads;
    await page.click('[data-testid="wait-accept-short-0"]'); await confirmText(); await yes(); await page.waitForTimeout(600);
    const out = await txt('[data-testid="wait_out"]'), left = await page.locator('[data-testid="wait-0"]').count();
    const one = S.statusCalls.length === 1 && S.statusCalls[0].id === CHIT && S.statusCalls[0].body.status === 'accepted';
    return { ok: one && left === 0 && /Accepted at ₹\s?2,690/.test(out) && /₹\s?250(\.00)? short against their ₹\s?2,940/.test(out) && S.healthReads > h0, saw: 'status calls ' + JSON.stringify(S.statusCalls) + '; rows left ' + left + '; "' + out + '"; health read again ' + (S.healthReads > h0) };
  });
  S.accepted = false; S.statusCalls = [];
  await openWaiting();
  await w.step('S4', 'the bill\'s sheet (BIL002): its Accept asks the SAME question at the counted ₹2,690 — never their ₹2,940; Cancel writes nothing', async () => {
    await page.click('[data-testid="wait-0"] [data-b], [data-testid="wait-0"]', { position: { x: 20, y: 10 } }).catch(() => {});
    await page.waitForSelector('#chitsheet[open] [data-testid="cs-act-accept"]', { timeout: 8000 }).catch(() => {});
    await page.click('#chitsheet [data-testid="cs-act-accept"]');
    const t = await confirmText();
    const okT = /at ₹\s?2,690(\.00)?\?/.test(t) && !/for ₹\s?2,940/.test(t) && /₹\s?250(\.00)? short against their ₹\s?2,940/.test(t);
    await cancel();
    return { ok: okT && S.statusCalls.length === 0, saw: '"' + t.slice(0, 160) + '"; writes ' + S.statusCalls.length };
  });
  await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(300);
  await w.step('S5', 'the row\'s Reject opens the sheet\'s one Reject door: the reason question, nothing sent', async () => {
    await page.click('[data-testid="wait-reject-short-0"]');
    await page.waitForSelector('#chitsheet[open] #cs_reason', { timeout: 8000 }).catch(() => {});
    const ask = await page.locator('#chitsheet[open] #cs_reason').count();
    return { ok: ask === 1 && S.statusCalls.length === 0, saw: 'reason field ' + ask + '; writes ' + S.statusCalls.length };
  });
  await page.keyboard.press('Escape').catch(() => {});

  /* ── CB Finance › Payables ── */
  const openPay = async () => { await page.goto('about:blank'); await page.goto(base + '/finance.html#/payables'); await page.waitForSelector('[data-testid="fp-row-' + PID + '"]', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(400); };
  /* open the supplier's row once (a row already open stays open — a second click would fold it) */
  const openRow = async () => { if (!(await page.locator('[data-testid="fp-next-' + PID + '"]').count())) await page.click('[data-testid="fp-row-' + PID + '"]'); await page.waitForSelector('[data-testid="fp-next-' + PID + '"]', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(400); };
  await openPay(); await openRow();
  await w.step('P1', 'Payables › Sri Ganesh Provisions › the bill: the server\'s note "₹250 short against their ₹2,940" under it; Hold this bill · Note a difference', async () => {
    const t = await txt('[data-testid="fp-next-' + PID + '"]'), hold = await page.locator('[data-testid="fp-hold-' + CHIT + '"]').count(), note = await page.locator('[data-testid="fp-note-' + CHIT + '"]').count();
    return { ok: t.indexOf(NOTE) >= 0 && /2,690/.test(t) && hold === 1 && note === 1 && S.disputeCalls.length === 0, saw: '"' + t.slice(0, 160) + '"; Hold ' + hold + '; Note ' + note };
  });
  await w.step('P2', 'Hold this bill ASKS FIRST ("Hold ₹2,690 from P-00001 · Sri Ganesh Provisions?", a note typed); Yes → POST /parties/ps/dispute { against_ref sg2, side supplier, disputed true, note }; the server\'s word "Held — in dispute with you" is said', async () => {
    await page.click('[data-testid="fp-hold-' + CHIT + '"]');
    const t = await confirmText();
    const okT = /Hold ₹\s?2,690(\.00)? from .*Sri Ganesh Provisions\?/.test(t) && /until you release it/.test(t);
    await page.fill('#cb_confirm [data-testid="fp-hold-note"]', '5 kg rice short, holding');
    await yes(); await page.waitForTimeout(600);
    const c = S.disputeCalls[0], out = await txt('[data-testid="fp-out"]');
    const sent = c && c.id === PID && c.body.against_ref === CHIT && c.body.side === 'supplier' && c.body.disputed === true && c.body.note === '5 kg rice short, holding';
    return { ok: okT && S.disputeCalls.length === 1 && sent && out === HELD, saw: '"' + t.slice(0, 120) + '"; sent ' + JSON.stringify(c) + '; said "' + out + '"' };
  });
  await w.step('P3', 'the held bill: the supplier row stays with "Held ₹2,690" (the server\'s disputed_minor), opens to the held list read from the pay sheet\'s open-bills reader: SG-1022 · ₹2,690 · "Held — in dispute with you" · Release', async () => {
    await page.waitForSelector('[data-testid="fp-row-' + PID + '"]', { timeout: 6000 }).catch(() => {});
    const row = await txt('[data-testid="fp-row-' + PID + '"]');
    await openRow(); await page.waitForSelector('[data-testid="fp-release-' + CHIT + '"]', { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(200);
    const held = await txt('[data-testid="fp-held-' + PID + '"]'), rel = await page.locator('[data-testid="fp-release-' + CHIT + '"]').count(), pv = S.previews.filter((b) => b && b.party_id === PID)[0];
    return { ok: /Held ₹\s?2,690/.test(row) && held.indexOf(BILL) >= 0 && held.indexOf(HELD) >= 0 && /2,690/.test(held) && rel === 1 && pv && pv.direction === 'out' && pv.allocate === 'none', saw: 'row "' + row.slice(0, 100) + '"; held "' + held.slice(0, 120) + '"; Release ' + rel + '; preview asked ' + JSON.stringify(pv && { d: pv.direction, a: pv.allocate }) };
  });
  await w.step('P4', 'Release ASKS FIRST ("Release ₹2,690 from …? It is payable again."); Yes → disputed false; "Released — payable again"; the bill is back with its note', async () => {
    await page.click('[data-testid="fp-release-' + CHIT + '"]');
    const t = await confirmText();
    const okT = /Release ₹\s?2,690(\.00)? from .*Sri Ganesh Provisions\?/.test(t) && /payable again/.test(t);
    await yes(); await page.waitForTimeout(600);
    const c = S.disputeCalls[1], out = await txt('[data-testid="fp-out"]');
    await openRow();
    const back = await page.locator('[data-testid="fp-hold-' + CHIT + '"]').count();
    return { ok: okT && c && c.body.disputed === false && c.body.against_ref === CHIT && out === RELEASED && back === 1, saw: '"' + t.slice(0, 100) + '"; sent ' + JSON.stringify(c && c.body) + '; said "' + out + '"; Hold back ' + back };
  });
  await w.step('P5', 'Note a difference → the ONE ＋ Entry door at the same words: the supplier and the bill filled from the row, the reason "rate", one item line to type', async () => {
    await page.click('[data-testid="fp-note-' + CHIT + '"]');
    await page.waitForSelector('#entrysheet[open] [data-testid="en-item-name-0"]', { timeout: 8000 }).catch(() => {});
    const title = await txt('#entrysheet [data-testid="en-title"]'), sup = await page.locator('#entrysheet [data-testid="en-f-supplier"]').inputValue().catch(() => ''), reason = await page.locator('#entrysheet [data-testid="en-f-reason"]').inputValue().catch(() => ''), line = await page.locator('#entrysheet [data-testid="en-item-0"]').count();
    return { ok: /Note a difference/.test(title) && sup === PID && reason === 'rate' && line === 1 && S.events.length === 0, saw: 'title "' + title + '"; supplier ' + sup + '; reason ' + reason + '; lines ' + line };
  });
  await w.step('P6', 'the line typed (Toor dal · 10 · 10 · 5) → Next → the bill sg2 already named → Next → the SERVER\'s preview (Dr Sri Ganesh ₹105 · Cr purchase returns ₹100 · Cr input tax ₹5, balanced) → Save ASKS FIRST: "Note ₹105 against the bill? … What you owe Sri Ganesh Provisions falls by ₹105."', async () => {
    await page.fill('#entrysheet [data-testid="en-item-name-0"]', 'Toor dal: billed ₹150, agreed ₹140');
    await page.fill('#entrysheet [data-testid="en-item-qty-0"]', '10');
    await page.fill('#entrysheet [data-testid="en-item-unit_price-0"]', '10');
    await page.fill('#entrysheet [data-testid="en-item-gst_rate-0"]', '5');
    await page.click('#entrysheet [data-testid="en-next"]'); await page.waitForTimeout(300);
    const ref = await page.locator('#entrysheet [data-testid="en-f-against_ref"]').inputValue().catch(() => '');
    await page.click('#entrysheet [data-testid="en-next"]');
    await page.waitForSelector('#entrysheet [data-testid="en-balanced"]', { timeout: 8000 }).catch(() => {});
    const pv = await txt('#entrysheet #en_body'), sentPv = S.previews.filter((b) => b && b.event === 'debit_note').slice(-1)[0];
    await page.click('#entrysheet [data-testid="en-save"]');
    const t = await confirmText();
    const okAsk = /Note ₹\s?105(\.00)? against the bill\?/.test(t) && /What you owe .*Sri Ganesh Provisions falls by ₹\s?105/.test(t);
    const okPv = /Both sides match/.test(pv) && /105/.test(pv) && sentPv && sentPv.lines && sentPv.lines.length === 1 && sentPv.lines[0].qty === 10 && sentPv.lines[0].unit_price === 10 && sentPv.lines[0].gst_rate === 5 && sentPv.supplier === PID && sentPv.against_ref === CHIT;
    return { ok: ref === CHIT && okPv && okAsk && S.events.length === 0, saw: 'bill ' + ref + '; preview "' + pv.slice(0, 80) + '"; sent ' + JSON.stringify(sentPv && sentPv.lines) + '; ask "' + t.slice(0, 120) + '"' };
  });
  await w.step('P7', 'Yes → POST /api/books/events { event debit_note, supplier, against_ref, reason rate, lines as typed, client_ref } ONCE; "Saved"; Payables reads again', async () => {
    const d0 = S.previews.length;
    await yes(); await page.waitForSelector('#entrysheet [data-testid="en-saved"]', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
    const e = S.events[0] || {}, saved = await txt('#entrysheet [data-testid="en-saved"]');
    const okE = S.events.length === 1 && e.event === 'debit_note' && e.supplier === PID && e.against_ref === CHIT && e.reason === 'rate' && typeof e.client_ref === 'string' && e.client_ref.length > 4 && JSON.stringify(e.lines) === JSON.stringify([{ name: 'Toor dal: billed ₹150, agreed ₹140', qty: 10, unit_price: 10, gst_rate: 5 }]);
    return { ok: okE && /Saved/.test(saved), saw: 'events ' + S.events.length + ' ' + JSON.stringify({ event: e.event, supplier: e.supplier, against_ref: e.against_ref, reason: e.reason, lines: e.lines, client_ref: !!e.client_ref }) + '; "' + saved + '"; previews since ' + (S.previews.length - d0) };
  });
  await page.click('#entrysheet [data-testid="en-done"]').catch(() => {});

  /* ── BRIEF-RULES 13: light and dark, 1366 and 390 — the Payables row opened with its doors ── */
  let k = 1;
  for (const theme of ['cream', 'dark']) {
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 860 }); await openPay(); await page.evaluate((t) => CBAvatar.applyTheme(t), theme).catch(() => {}); await page.waitForTimeout(200); await openRow();
      await rule13(w, 'R' + (k++), 'Payables row opened (Hold · Note a difference) · ' + (theme === 'cream' ? 'light' : 'dark') + ' · ' + width + 'px', 'screen');
    }
  }
  const [cOk, cMsg] = C.finish();
  await w.step('C', 'every answer the stand-in served for a route in the API contract has the API\'s keys (M43); no route went unanswered', async () => ({ ok: cOk && S.unanswered.length === 0, saw: cMsg + (S.unanswered.length ? '; unanswered ' + S.unanswered.slice(0, 5).join(' | ') : '') }));
});
