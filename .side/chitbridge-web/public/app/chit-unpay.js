/**
 * public/app/chit-unpay.js — Clear payment on a chit: the question, then the one write
 *
 * OWNS      chitUnpayPay · chitUnpayCode · chitUnpayRefusal · chitUnpayWords · chitUnpayForget · chitUnpay (moved out of app.html, 2026-11-17, size ratchet; behaviour unchanged)
 * CALLED BY public/app.html (script tag before the page script; the chit sheet's Clear payment control calls chitUnpay); lifted by e2e/l15-confirm-money-actions.test.cjs
 * FLOW      chitUnpay(id) → chitUnpayRefusal (no amount or currency on the row: say so, write nothing) → CBAction.ask (amount with its currency, method, reference) → api chitUnpay → the row forgets its payment
 * CARD      01-rail-core-the-chit/chit-sheet
 *
 * Plain script: top-level functions are globals, like the page script they came from; they read the page's api · tx · esc · UI · toast · fmtMoney · openChit at call time.
 */
/** what the Clear-payment confirm shows: the amount with its currency, the method and the reference (nothing is invented when the row does not carry them) */
function chitUnpayPay(row) {
  const bj = (row && (row.business_json || (row.header && row.header.business_json))) || {};
  return bj.payment || {};
}
/** the chit's own currency code, '' when the row states none (never the shop's: money is a value type) */
function chitUnpayCode(row) {
  return (row && (row.currency || (row.summary_json && row.summary_json.currency_code) || (row.header && row.header.currency_code))) || '';
}
/** why a payment is NOT cleared, in words, or '' when the confirm can show amount AND currency */
function chitUnpayRefusal(row) {
  if (!row) return tx('This chit is not on screen any more, so its payment was not cleared. Reopen it and try again.');
  const amount = chitUnpayPay(row).amount;
  if (!chitUnpayCode(row) || amount == null || amount === '' || !isFinite(Number(amount))) return tx('This chit does not carry the amount and currency of its payment, so it was not cleared. Reopen it and try again.');
  return '';
}
function chitUnpayWords(row) {
  const pay = chitUnpayPay(row);
  const code = chitUnpayCode(row);
  return (
    '<div>' + esc(tx('This clears the recorded payment. The log keeps both entries.')) + '</div>' +
    '<div style="margin-top:8px"><b data-testid="unpay-amount">' + esc(fmtMoney(pay.amount, code)) + '</b> · <span data-testid="unpay-method">' +
    esc(String(pay.method || '—').toUpperCase()) + '</span>' + (pay.ref ? ' · <span data-testid="unpay-ref">' + esc(pay.ref) + '</span>' : '') + '</div>'
  );
}
/** the on-screen row forgets its payment, so the cell repaints unpaid before the reload lands */
function chitUnpayForget(row) {
  if (!row) return;
  if (row.business_json) delete row.business_json.payment;
  if (row.header && row.header.business_json) delete row.header.business_json.payment;
}
/** Clear payment: refuse in words when the row cannot show amount and currency, ask, then write once and let the row forget its payment */
async function chitUnpay(id) {
  const row = UI.rows && UI.rows.find((x) => x.id === id);
  const refusal = chitUnpayRefusal(row);
  if (refusal) return toast(refusal, true);
  if (!(await CBAction.ask({ title: tx('Clear this payment?'), body: chitUnpayWords(row), yes: tx('Clear payment') }))) return;
  try {
    await api('chitUnpay', { params: { id } });
    toast(tx('Payment cleared'));
    chitUnpayForget(row);
    if (typeof openChit === 'function') openChit(id, true);
  } catch (e) {
    toast((e && e.message) || tx('Could not clear'), true);
  }
}
