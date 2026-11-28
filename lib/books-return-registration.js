'use strict';
/**
 * CARD 14-accounting/tax-return
 * books-return-registration.js — GREY-AU (U-F-09): the answer of GET /returns for a shop that SAID it is not registered for the tax.
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      notRegisteredWhy · unregisteredAnswer · registrationDayOf · firstOwedDay · owedPeriods
 * CALLED BY lib/books-period.js taxReturn (registration read once, before the transaction, from country-setup.registrationOfShop — the ONE reader; 'unknown' is never read as 'no')
 * FLOW      registration 'unregistered' → the empty form + needs 'registration' + the sentence → the page greys Close with it; no boxes are drawn (ATO: only a GST-registered entity lodges GST on a BAS)
 */
/** the sentence: the pack's word for the tax and for its return (GST · BAS, VAT · VAT return), never typed here */
const notRegisteredWhy = (country, returnName) => 'This shop is not registered for ' + require('./tax-shelf').taxWordOf(country) + ', so there is no ' + (returnName || 'return') + ' to lodge.';
/** the return's own answer shape with nothing in it: no period, no boxes, nothing to pay (the same empty form a period table that cannot be built gives) */
function unregisteredAnswer(base, packId, returnsDef) {
  return Object.assign(base, { asked: {}, needs: 'registration', why: notRegisteredWhy(packId, returnsDef.short), periods: [], period: null, boxes: [], payable_minor: 0, refund_minor: 0, net_minor: 0, notes: [], cite: null, emirates: returnsDef.emirates || [], staggers: returnsDef.staggers || {} });
}
/**
 * registrationDayOf(handle, entity, booksHaveEntries) → 'YYYY-MM-DD' | null: the day the shop's GST registration began. The owner's own answer when it holds one (entity_governance.tax_registration.registered_on, ISO date; the setup step that writes it
 * is the settings area's, not built here); else, while the books hold no entry, the day the shop was created in the product (identities.created_at): a registered business lodges from then, even a nil return, and has nothing to lodge before it.
 */
async function registrationDayOf(handle, entity, booksHaveEntries) {
  const found = await handle.query(
    `SELECT g.tax_registration->>'registered_on' AS registered_on, to_char(i.created_at, 'YYYY-MM-DD') AS created
       FROM identities i LEFT JOIN entity_governance g ON g.entity_id = i.identity_id WHERE i.identity_id = $1`,
    [entity]
  );
  const row = (found.rows || [])[0] || {},
    iso = (v) => (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v || '')) ? String(v) : null);
  return iso(row.registered_on) || (booksHaveEntries ? null : iso(row.created)); /* created_at stands in ONLY while the books hold no entry: a shop that moved in with older entries is owed from them */
}
/**
 * firstOwedDay(booksStartDay, registrationDay) → the day before which no return period is owed: the LATER of the two that are known (a shop registered in July whose books start in November owes from November; entries before its registration day
 * cannot be a return's); one known day stands alone; none → null. The owner's registered_on wins over the books start only when later; created_at stands in only when the books hold no entry yet (the caller passes null then otherwise).
 */
function firstOwedDay(booksStartDay, registrationDay) {
  return [booksStartDay, registrationDay].filter(Boolean).sort().pop() || null;
}
/**
 * owedPeriods(handle, entity, table, booksStartDay) → { table, start }: the period table without the periods wholly BEFORE the registration day (not shown: nothing was owed then), and the day before which a period is not owed
 * (firstOwedDay: the later of the books start and the registration day). The period holding the registration day is the first one: a registered business lodges even a nil return, so with no entries yet it is due, never "overdue" before registration.
 * A table that would be emptied is kept whole (a screen always has a period to open).
 */
async function owedPeriods(handle, entity, table, booksStartDay) {
  const day = await registrationDayOf(handle, entity, !!booksStartDay),
    kept = day ? (table || []).filter((item) => String(item.end) >= day) : table;
  return { table: kept && kept.length ? kept : table, start: firstOwedDay(booksStartDay, day) };
}
module.exports = { notRegisteredWhy, unregisteredAnswer, registrationDayOf, firstOwedDay, owedPeriods };
