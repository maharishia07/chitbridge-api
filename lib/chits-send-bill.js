'use strict';
/**
 * lib/chits-send-bill.js — THE SEND STEPS THAT READ A COUNTER BILL'S OWN FIGURES AND NAMES, moved out of routes/chits.js (read1129chits)
 * OWNER     cb-rail
 * RISK      money and tax: a bill number that is not a number, a tax split for a shop that may not charge tax, tenders that do not add up to the total and a goods-in that cannot move stock are refused in words BEFORE anything is written
 * FLOW      sendState from the send route ──▶ the step reads it ──▶ a refusal in the one error shape, or nothing (the send goes on) · after the commit: the receiver and the named customer join the party list
 * OWNS      billNumberStep (sendBillNumber) · checkCounterInvoice · taxNotChargeableRefusal · incompleteInvoiceRefusal · creditReasonStep · sendTenderSum · sendReceiptLines · addReceiverToCustomerList · addNamedCounterCustomer
 * CALLED BY routes/chits.js (SEND_STEPS, sendIssued, sendCustomers) · tests/route-modules-1129.test.cjs
 * CARD      rail/chits-send
 */
const cbLog = require('./logger');
const docnumber = require('./docnumber');
const taxCopy = require('./tax-copy');
const taxLines = require('./tax-lines');
const receiptLines = require('./receipt-lines');
const { withEntity } = require('../db');
const { problem } = require('./problem');
const { said, codeOfStatus } = require('./chits-contract');

const isJsonObject = (value) => !!value && typeof value === 'object';

/** a till bill that names a bill_no (even an empty one): the only chit this step judges */
const carriesBillNumber = (business) => isJsonObject(business) && isJsonObject(business.till) && Object.prototype.hasOwnProperty.call(business, 'bill_no');
/** the one number rule let it through: it is valid, or the country's rule is not verified and the number is not empty (recorded in number_check, not refused) */
const numberAccepted = (verdict, sent) => verdict.ok || (!verdict.verified && !!String(sent).trim());
/**
 * ⭐ F-F-04 / F-F-05 (WALK F, 1128): THE BILL NUMBER A COUNTER BILL CARRIES IS REFUSED, IN WORDS, WHEN IT CANNOT BE A NUMBER — before anything is written.
 * An EMPTY business_json.bill_no on a till bill used to return 200 and then exist NOWHERE (the books read a counter bill by "till && bill_no"): the sale vanished from the day book,
 * the waiting list and GSTR with no word said. It is refused instead (the counter keeps the bill and says why; nothing is lost on the server's side because nothing was taken).
 * A number past the country's limit or with a character its rule does not allow (India, CGST Rules r.46: at most 16 characters, letters, digits, / and -) is refused the same way, by the ONE
 * rule (docnumber.check) — but ONLY where the country's rule has been checked (verified): an unstudied country's loose default is not law, so there it stays recorded in number_check as before.
 * ⚠ This reverses the older "recorded, never refused" for the bill_no field of a bill sent NOW; client_ref (an ERP's own key) is still only recorded, above. Drafts are never stopped.
 */
const billNumberStep = (countryOfEntity) => async function sendBillNumber(sendState, req, res) {
  const { sender_id, is_draft } = sendState;
  const business = req.body && req.body.business_json;
  if (is_draft || !carriesBillNumber(business)) return;
  const sent = business.bill_no;
  if (typeof sent !== 'string' && typeof sent !== 'number') return problem(req, res, { status: 400, ...said(billNoBody('A counter bill needs its bill number as text.'), 'CHIT_BAD_REQUEST') });
  const verdict = docnumber.check(String(sent), await countryOfEntity(sender_id));
  if (numberAccepted(verdict, sent)) return;
  res.locals.code = 'BILL_NO_BAD';
  return problem(req, res, { status: 422, ...said(billNoBody(verdict.reason + ' The bill was not taken — number it again and send it.'), codeOfStatus(422)) });
};
const billNoBody = (message) => ({ error: 'Bill number refused', code: 'BILL_NO_BAD', field: 'business_json.bill_no', message });

/** the chit as the tax copy reads it: the sender and each receiver that is on the rail, and the bill's own moment */
function counterBillChit(sendState) {
  const { sender_id, purpose, line_items, business_json, currency_code, receiverDetails } = sendState;
  const onRail = receiverDetails.filter((item) => item.entity_id).map((item) => ({ entity_id: item.entity_id, role: item.all_role || 'receiver' }));
  return { chit_id: null, sender_entity_id: sender_id, purpose, business_json, line_items, currency_code, all_recipients: [{ entity_id: sender_id, role: 'sender' }].concat(onRail), sent_at: business_json.billed_at || null };
}
/** the engine's check named a difference: say so on the bill and in the log, keep the issued invoice */
function nameTaxDifference(entry, business_json, sender_id) {
  if (!entry || !entry.tax_check || entry.tax_check.ok) return;
  business_json.tax_check = { at: new Date().toISOString(), differences: entry.tax_check.differences, kept: 'issued' };
  require('../lib/logger').warn('tax.check-differs', { entity_id: sender_id, bill_no: business_json.bill_no, says: entry.tax_check.says });
}
/** a counter bill's invoice was computed at the counter: the server checks it and names a difference on the chit, never replacing it */
async function checkCounterInvoice(sendState) {
  const { sender_id, business_json } = sendState;
  let refusal = null;
  try {
    const entry = await taxCopy.entryFor(counterBillChit(sendState), sender_id);
    refusal = taxNotChargeableRefusal(entry, business_json);
    nameTaxDifference(entry, business_json, sender_id);
  } catch (e) {
    cbLog.fellBack('chits: the helper failed — carried on without it', e); /* the check never stops a bill — the stored invoice stands either way */
  }
  return refusal;
}
/**
 * ⭐ F-F-10 (WALK F, 1128): THE SERVER NEVER TRUSTS A CLIENT-SENT TAX SPLIT FOR A SHOP THAT MAY NOT CHARGE TAX. A composition-scheme shop (India: no tax collected from the buyer,
 * no tax invoice) and a shop that is not registered (AU: GST is charged only by a business registered for it) cannot issue an invoice that carries tax; before this the
 * counter's invoice with CGST 5.00 + SGST 5.00 was posted to Output CGST / SGST. The seller's registration is the ONE reader's (the seller party's RegType, from country-setup.registrationOfShop),
 * the tax of the invoice is the one reader's (tax-lines.heads) — nothing is worked out here. A shop whose registration is not known keeps the older "name it, never stop" path.
 * Refused 422 TAX_NOT_CHARGEABLE before anything is written; the counter must issue a bill of supply with no tax.
 */
const NO_TAX_REGISTRATIONS = ['composition', 'unregistered'];
function taxNotChargeableRefusal(entry, business_json) {
  const regType = entry && entry.seller && entry.seller.RegType;
  if (NO_TAX_REGISTRATIONS.indexOf(regType) < 0) return null;
  const charged = taxLines.heads(business_json && business_json.invoice).tax;
  if (!(charged > 0)) return null;
  const words = regType === 'composition' ? 'A shop under the composition scheme cannot charge tax or issue a tax invoice' : 'A shop that is not registered for tax cannot charge tax';
  return { error: 'Tax not chargeable', code: 'TAX_NOT_CHARGEABLE', field: 'business_json.invoice', registration: regType, message: words + ' — this bill carries ' + charged.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' of tax. Issue it as a bill of supply with no tax and send it again.' };
}

/**
 * ⭐ AR-F-01 (walk AR, 22 Nov 2026): AN INVOICE CARRIES A COMPLETE MONEY BLOCK OR IS REFUSED IN WORDS. A rail invoice sent with a partial business_json.invoice (only TranDtls) was accepted with
 * no total, posted nothing on either book, and a credit note against it then posted. "Complete" is the test the money block is mapped from (ValDtls.TotInvVal, routes/chits.js hasInvoiceTotal).
 * Billing documents only (invoice · credit note · debit note); a draft is not issued. → a refusal in the one error shape, or null.
 */
const ISSUED_PURPOSES = ['invoice', 'credit_note', 'debit_note'];
function incompleteInvoiceRefusal(sendState) {
  const { purpose, is_draft, business_json } = sendState;
  const carried = business_json && business_json.invoice;
  if (is_draft || ISSUED_PURPOSES.indexOf(String(purpose)) < 0 || !isJsonObject(carried)) return null;
  if (require('./counter-bill').pickOf({ business_json: { invoice: carried } }).total !== null) return null; /* the ONE reader of an invoice total (a number, never a text) */
  return { error: 'Invoice has no total', code: 'INVOICE_INCOMPLETE', field: 'business_json.invoice', message: 'This ' + String(purpose).replace('_', ' ') + ' carries part of its money block but no total, so it was not sent and nothing posts. Send it with its complete money block, or send the lines and the server prices them.' };
}

/**
 * ⭐ AR-F-02 (walk AR, 22 Nov 2026): A CREDIT NOTE SAYS WHY WHEN THE SELLER'S PACK ASKS FOR A REASON. The pack's own document rule decides (creditNote.must carries "a brief explanation of the circumstances", reg-ae
 * (f), ER Art. 60(1)(f) as the pack cites it; not independently cited in walks/CITE-1129) — no country is named here, a pack whose list has no such line (or a country with no pack) is not asked.
 * The reason is ONE short word or phrase, business_json.reason_words (docs/FIELDS.md). A counter's own return (counterBill) is another door and is not judged here. A draft is not issued.
 */
const reasonRequiredBy = (pack) => !!(pack && !pack.fallback && !pack.unknown && pack.creditNote && Array.isArray(pack.creditNote.must) && pack.creditNote.must.some((line) => /explanation|reason/i.test(String(line))));
const creditReasonStep = (countryOfEntity) => async function sendCreditReason(sendState, req, res) {
  const { sender_id, purpose, is_draft, counterBill, business_json } = sendState;
  if (is_draft || counterBill || String(purpose) !== 'credit_note') return;
  const country = await countryOfEntity(sender_id);
  if (!country || !reasonRequiredBy(require('./regulation').lookup(country))) return;
  const reason = business_json && typeof business_json.reason_words === 'string' ? business_json.reason_words.trim() : '';
  if (reason) return;
  res.locals.code = 'CREDIT_NOTE_REASON_MISSING';
  return problem(req, res, { status: 422, ...said({ error: 'Credit note needs a reason', code: 'CREDIT_NOTE_REASON_MISSING', field: 'business_json.reason_words', message: 'A credit note here must say why it is issued (for example "goods returned" or "price corrected"). Add a short reason and send it again.' }, codeOfStatus(422)) });
};

/**
 * ⭐ P-F-01 (walk P, 21 Nov) — THE TENDERS OF A BILL ADD UP TO ITS TOTAL: a counter bill whose payment parts (plus the cash rounding it took) are not the invoice total
 * is refused 422 TENDER_SUM_MISMATCH in words (lib/tender-sum, minor units, fail closed). A draft: nothing. An OFFLINE REPLAY of a printed sale is accepted and said
 * (tender_gap on the chit), never wedged in the till queue. Its own step, outside any try, because a refusal must reach the counter.
 */
async function sendTenderSum(sendState, req, res) {
  const { business_json, currency_code, is_draft } = sendState;
  if (is_draft || !business_json || !business_json.payment) return;
  const refusal = require('../lib/tender-sum').verdictOf({ business_json, currency: currency_code }, Date.now());
  if (!refusal) return;
  if (refusal.accepted) {
    business_json.tender_gap = { code: refusal.code, accepted: refusal.accepted, why: refusal.why, expected_minor: refusal.expected_minor, tendered_minor: refusal.tendered_minor };
    return;
  }
  res.locals.code = refusal.code;
  return problem(req, res, {
    status: 422,
    ...said({ error: 'Payments do not add up', code: refusal.code, field: 'business_json.payment.parts', message: refusal.why, expected_minor: refusal.expected_minor, tendered_minor: refusal.tendered_minor }, 'CHIT_BAD_REQUEST')
  });
}

/**
 * WALK-D D-F-01..05: a goods-in that cannot move stock (no quantity, none or a negative cost, a quantity past the ceiling, a ghost product, a batch-kept item with no lot, an expired lot, a date that is not YYYY-MM-DD)
 * is refused 400 in words, under the one error shape - never answered "sent" with the stock unmoved. The tests are lib/receipt-lines (pure, then one catalogue read).
 */
async function sendReceiptLines(sendState, req, res) {
  const chit = { purpose: sendState.purpose, is_draft: sendState.is_draft, business_json: sendState.business_json, line_items: sendState.line_items };
  const found = receiptLines.refusalOf(chit) || (await receiptLines.dateRefusal(chit, sendState.sender_id, withEntity)) || (await receiptLines.catalogueRefusal(chit, sendState.sender_id, withEntity));
  if (!found) return;
  res.locals.code = found.code;
  return problem(req, res, { status: found.status, ...said({ error: 'A line could not be received', code: found.code, message: found.message, line: found.line, field: found.field }, 'CHIT_BAD_REQUEST') });
}

/**
 * OPS-121 · SELLING MORE THAN THE SHELF SHOWS: with the shop's switch on `block`, an online sale whose line would take on-hand below zero is refused 409 STOCK_SHORT in words before anything is stored (lib/stock-oversell);
 * the default (allow) and an offline replay are never refused - the sale posts and the figure below zero is the flag. The check is the one pre-send read; it fails open (a read that cannot be made never stops a sale).
 */
async function sendOversell(sendState, req, res) {
  const chit = { purpose: sendState.purpose, is_draft: sendState.is_draft, business_json: sendState.business_json, line_items: sendState.line_items };
  let found = null;
  try {
    found = await require('./stock-oversell').refusalOf(sendState.sender_id, chit, { withEntity });
  } catch (e) {
    cbLog.fellBack('chits send: the stock check could not be read - the sale goes through unchecked', e);
  }
  if (!found) return;
  res.locals.code = found.code;
  return problem(req, res, { status: found.status, ...said({ error: 'Not enough on the shelf', code: found.code, message: found.message, line: found.line, items: found.items }, 'CHIT_BAD_REQUEST') });
}

/** the sender's customer list gains (or counts again) this receiver — unless the receiver is one of its suppliers; a failure is logged, never raised */
async function addReceiverToCustomerList(sender_id, receiver) {
  try {
    await withEntity(sender_id, async (db) => {
      const isSupplier = await db.query(
            `SELECT 1 FROM supplier_list
            WHERE owner_entity_id = $1 AND supplier_entity_id = $2`,
        [sender_id, receiver.entity_id]
      );
      if (isSupplier.rows.length === 0) {
        await db.query(
              `INSERT INTO customer_list
               (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
             VALUES ($1, $2, 'entity', 'transaction', 1, NOW())
             ON CONFLICT (owner_entity_id, customer_identity_id)
             DO UPDATE SET txn_count = customer_list.txn_count + 1, last_txn_at = NOW()`,
          [sender_id, receiver.entity_id]
        );
      }
    });
  } catch (e) {
    cbLog.fellBack('chits send: the customer was not added to the party list — the chit is sent without it', e);
  }
}
/** the customer a counter bill names (a local one: not on the rail, a real name, not the default "Customer"), or null */
function namedCustomerOf(business) {
  const cust = isJsonObject(business) && isJsonObject(business.customer) ? business.customer : null;
  const name = cust ? String(cust.name || '').trim() : '';
  return cust && !cust.entity_id && name && name !== 'Customer' ? cust : null;
}
/** what local-identity.addCustomer is given: the name, the phone when it could be read, the e-mail and the tax number the bill named */
function localPersonOf(cust, phoneRead) {
  const phone = phoneRead.bad ? null : phoneRead.phone;
  return { name: String(cust.name).trim(), phone, email: cust.email || null, gstin: cust.gstin || null, via: 'transaction', number: false };
}
/**
 * ⭐ WALK I I-F-07 · addNamedCounterCustomer(owner, business_json) — the customer a counter bill names becomes (or counts again as) a local party: lib/local-identity.addCustomer, the ONE way
 * a local customer is made (name, phone, tax number, email), on the shop's own transaction. A bill with no name (the default "Customer"), a rail customer (entity_id) or an unreadable
 * phone adds nothing here. A customer already on the list is counted again (txn_count, last_txn_at), never doubled. A failure is logged, never raised: the chit is already sent.
 */
async function addNamedCounterCustomer(owner, business) {
  const cust = namedCustomerOf(business);
  if (!cust) return null;
  try {
    const li = require('../lib/local-identity');
    const person = localPersonOf(cust, li.phoneOf(cust.phone));
    return await withEntity(owner, async (db) => {
      const added = await li.addCustomer(db, owner, person);
      const local = added && (added.local || null);
      if (local && local.identity_id)
        await db.query(
          `UPDATE customer_list SET txn_count = COALESCE(txn_count, 0) + 1, last_txn_at = NOW() WHERE owner_entity_id = $1 AND customer_identity_id = $2`,
          [owner, local.identity_id]
        );
      return added;
    });
  } catch (e) {
    cbLog.fellBack('chits send: the named customer was not added to the party list — the chit is sent without it', e);
    return null;
  }
}

module.exports = { billNumberStep, checkCounterInvoice, taxNotChargeableRefusal, incompleteInvoiceRefusal, creditReasonStep, reasonRequiredBy, sendTenderSum, sendReceiptLines, sendOversell, addReceiverToCustomerList, addNamedCounterCustomer };
