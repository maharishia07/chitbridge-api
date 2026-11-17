/* e2e/crm-l16-ux.cjs — the L16 CRM UX walk of crm.cjs, kept apart so that file stays under the size ceiling.
 * OWNS      the timeline in the document's words · one Receive · Receive opens filled · Remind tells the truth · no sideways scroll, at 1366 and 390 (L16-1 to L16-4)
 * CALLED BY e2e/crm.cjs (l16Ux(env), env = { ok, fs, path, standIn, crmApi, open, recReady, text })
 * FLOW      for each viewport: a stand-in party with a ledger entry → the record → the timeline row, the single Receive, keyboard Receive, Remind to a party with no channel
 */
'use strict';
async function l16Ux(env) {
  const { ok, fs, path, standIn, crmApi, open, recReady, text } = env;
  const SH = path.join('C:/dev/shots/l16-crm-ux'); try { fs.mkdirSync(SH, { recursive: true }); } catch (_) {}
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const w = vp.width, S = standIn();
    S.list.forEach((q) => { if (q.party_no === 'P-0002') Object.assign(q, { roles: ['customer'], phone: null, email: null, on_chitbridge: false, kind: 'local', why_not: 'local' }); });
    const record = crmApi.record(S.list, 'pid-0002', S.fx.records['pid-0002'], []);
    const now = Date.now(), timeline = { party_id: 'pid-0002', next_before: null, migrated: true, total: 1, page: 1, limit: 100, entries: [
      { kind: 'ledger', at: new Date(now - 3600e3).toISOString(), ref: 'HP-INV-2', ledger_kind: 'bill', source: null, amount_minor: 275000, currency: 'INR', doc_date: '2026-10-08' }] };
    S.live = { record, timeline };
    const { ctx, p } = await open(S, { hash: '#/party/P-0002', viewport: vp }); await recReady(p); await p.waitForTimeout(600);
    const tl = await text(p, '[data-testid="crm-record"]');
    ok(/Invoice HP-INV-2/.test(tl) && !/Bill · Today/.test(tl) && /0?8 Oct 2026|Oct 8, 2026|8 Oct 2026/.test(tl), 'L16-1 @' + w + ': the timeline row says "Invoice HP-INV-2" with the document date 8 Oct 2026, not "Bill · Today"');
    ok(/entered/i.test(tl), 'L16-1 @' + w + ': the day it was entered is the smaller fact');
    ok(await p.locator('[data-testid="crm-act-pay"]').count() === 0 && await p.locator('[data-testid="crm-next-pay"]').count() === 1, 'L16-2 @' + w + ': Receive appears ONCE (the amount owed); the action row has none');
    ok(await p.locator('[data-testid="crm-act-addcontact"]').count() === 0 && await p.locator('[data-testid="crm-next-add"]').count() === 1, 'L16-2 @' + w + ': "Add phone or e-mail" appears once (the Next band)');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'L16 @' + w + ': no sideways page scroll');
    await p.screenshot({ path: path.join(SH, 'party-' + w + '.png') }).catch(() => {});
    await p.route('**/api/books/payments/preview', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currency: 'INR', party: { name: 'Chola Auto Care' }, proposal: [{ against_ref: 'ch-1', bill_no: 'HP-INV-2', due_date: '2026-10-08', open_minor: 1245000, due_minor: 1245000, apply_minor: 1245000 }], warnings: [] }) }));
    /* keyboard only: focus the Receive button and press Enter */
    await p.focus('[data-testid="crm-next-pay"]'); await p.keyboard.press('Enter'); await p.waitForSelector('[data-testid="pay_title"]', { timeout: 8000 }); await p.waitForTimeout(900);
    const amt = await p.inputValue('#pay_amt'), mode = await p.inputValue('#pay_mode');
    ok(/12,?450.00/.test(amt) && mode === 'bank', 'L16-3 @' + w + ': Receive opens filled - amount ' + amt + ' (the dues figure, carried), How = ' + mode);
    ok(await p.locator('[data-testid="pay_bills"] table').count() === 1, 'L16-3 @' + w + ': the bills table is visible at once');
    await p.screenshot({ path: path.join(SH, 'receive-' + w + '.png') }).catch(() => {});
    await p.getByRole('button', { name: 'Cancel' }).first().click(); await p.waitForSelector('[data-testid="pay_title"]', { state: 'detached', timeout: 5000 }).catch(() => {});
    /* the Dues / Collections Remind (bkRemind - a message on the oldest bill); the party page's own Remind files a follow-up */
    await p.evaluate(() => { bkRemind('pid-0002', null); }); await p.waitForSelector('[data-testid="remind_title"]', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(900);
    const ph = await p.getAttribute('[data-testid="msg-body"]', 'placeholder').catch(() => '') || '';
    ok(/no phone or e-mail/i.test(ph) && !/sees this/.test(ph), 'L16-4 @' + w + ': Remind to a party with no channel says "' + ph + '"');
    await p.screenshot({ path: path.join(SH, 'remind-' + w + '.png') }).catch(() => {});
    await ctx.close();
  }
}
module.exports = { l16Ux };
