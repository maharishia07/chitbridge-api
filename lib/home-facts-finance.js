'use strict';
/**
 * lib/home-facts-finance.js — the Home Finance card: cheques in hand that want a step, and what customers owe and the shop owes in all.
 * OWNS      financeCard (read in one transaction, then said in lines) · financeRead · chequeLines (no route, no state)
 * CALLED BY lib/home-facts.js (the `finance` card of GET /api/facts/:card), which passes its own small helpers as `helpers`
 * FLOW      financeRead (setting · terms · cheques · the two control accounts, ONE withEntity) -> chequeLines (due · next · in hand) -> { lines, figures, state }
 * CARD      28-platform-and-operations/home-facts
 * The SAME rows and the SAME engine read GET /api/books/cheques answers (books-store.cheques -> receivables.pdcReminders, the shop's switch from its stored terms).
 * A shop whose ledger is off, or not provisioned, gets no lines. Money is never formatted here: a line says `{money}` and carries { amount, currency }.
 */
const books = require('./books');
const booksStore = require('./books-store');
const booksEngines = require('./books-engines');
const financeTerms = require('./finance-terms');
const shopClock = require('./shop-clock');
const { fromMinor } = require('./books-cashflow'); /* minor -> the pack's major unit (the one rounder); the page words the symbol */

/** the shop's money facts, read inside one transaction: { settings, rows, remind, shopDay, toCollect, toPay } (settings null/off = the ledger is off) */
async function financeRead(entity, helpers) {
  const facts = { settings: null, rows: [], remind: null, shopDay: null, toCollect: 0, toPay: 0, posted: false };
  /* the b298 probe failing is not a reason to lose the card: the switch reads as "never set" (on, 7 days) and the miss is logged */
  const migrated = await financeTerms.migrated().catch((failure) => {
    require('./logger').warn('facts/finance: terms probe failed, reminder read as unset', { err: failure && failure.message });
    return false;
  });
  await helpers.withEntity(entity, async (handle) => {
    facts.settings = await books.settingOf(handle, entity);
    if (!facts.settings || !facts.settings.enabled) return;
    facts.remind = financeTerms.pdcRemind(migrated ? await financeTerms.shopTerms(handle, entity) : {});
    facts.shopDay = shopClock.today(facts.settings);
    facts.rows = await booksStore.cheques(handle, entity, false, 200);
    facts.posted = await booksStore.hasPostings(handle, entity); /* E-F-03: books in use (postings) is not "not started" even with no cheque and no dues */
    const accounts = (await booksStore.accounts(handle, entity)) || [],
      debtors = accounts.find((account) => account.role === 'debtors'),
      creditors = accounts.find((account) => account.role === 'creditors');
    if (debtors) facts.toCollect = await booksStore.accountNet(handle, entity, debtors.account_id); /* the customers' control account: one aggregate, the figure Collections totals */
    /* E5 (Fable walk 2026-11-17: "Not started" over A$9,284 overdue to pay): what the shop owes is the suppliers' control account, the other half of the
       same dues answer (/dues side=supplier totals the per-supplier balances this account holds); a credit balance, so + here is what is owed */
    if (creditors) facts.toPay = -(await booksStore.accountNet(handle, entity, creditors.account_id));
  });
  return facts;
}

/** the cheques in hand as the reminder engine reads them: { dueList, late, next, held } */
function chequeStates(facts) {
  const list = facts.rows.filter((item) => item.direction === 'in');
  const pdcList =
    booksEngines.receivables().pdcReminders(
      list.map((item) => ({
        id: String(item.payment_id),
        amount: Number(item.amount_minor),
        cheque: { no: item.cheque_no || null, date: booksEngines.ymd(item.cheque_date), status: item.status || 'received' }
      })),
      facts.shopDay,
      { on: true, lead_days: facts.remind.lead_days }
    ) || [];
  const dueList = pdcList.filter((item) => item.state !== 'not_yet');
  return {
    dueList,
    late: dueList.filter((item) => item.state === 'overdue_for_deposit'),
    next: pdcList.filter((item) => item.state === 'not_yet').sort((first, second) => String(first.date).localeCompare(String(second.date)))[0] || null,
    held: list.filter((item) => (item.status || 'received') !== 'cleared' && (item.status || 'received') !== 'bounced')
  };
}

/** the cheque line: cheques to deposit (with the overdue ones said), else the next post-dated one, else how many are in hand */
function chequeLine(states, currency, helpers) {
  const { dueList, late, next, held } = states;
  if (dueList.length)
    return {
      text: helpers.plural(dueList.length, 'cheque') + ' to deposit · {money}' + (late.length ? ' · ' + late.length + ' overdue' : ''),
      value: dueList.length,
      tone: 'dn',
      money: { amount: fromMinor(dueList.reduce((total, item) => total + helpers.toNumber(item.amount), 0), currency), currency: currency }
    };
  if (next) return { text: 'Next cheque {date} · {money}', value: 1, at: next.date, money: { amount: fromMinor(helpers.toNumber(next.amount), currency), currency: currency } };
  return { text: held.length ? helpers.plural(held.length, 'cheque') + ' in hand' : 'No cheque waiting', value: held.length };
}

/** the card's lines: the cheque line, what customers owe and the shop owes (after a cheque that wants a deposit), and the reminder switch when it is off */
function chequeLines(facts, states, currency, helpers) {
  const { toCollect, toPay, remind } = facts;
  const lines = [chequeLine(states, currency, helpers)];
  const afterCheque = states.dueList.length ? 1 : 0;
  /* l16 home-fix: what customers owe is the Finance card's first fact (it said "Not started" over A$3,575 to collect); after a cheque that wants a deposit, before "no cheque waiting" */
  if (toCollect > 0) lines.splice(afterCheque, 0, { text: 'To collect {money}', value: toCollect, money: { amount: fromMinor(toCollect, currency), currency: currency } });
  if (toPay > 0) lines.splice(afterCheque, 0, { text: 'To pay {money}', value: toPay, money: { amount: fromMinor(toPay, currency), currency: currency } });
  /* the switch, for the card's words only when the owner turned it off: the reminders above are still COUNTED (the card never hides a figure) */
  if (remind && !remind.on) lines.push({ text: 'Cheque reminders off', value: 0 });
  return lines;
}

/** the Finance card: { lines, figures, state } for ctx.entity, or the ledger-off / not-provisioned answer */
async function financeCard(ctx, helpers) {
  /* AF-F-03: cheques, dues and what the shop owes are the books' money: a seat the books' own gate refuses (routes/books gates.mayReadMoney: cashier, viewer, a bookkeeper without the hat) gets the card greyed
     with the books' own sentence and NO figure (no route call = an internal read with no seat) */
  if (ctx.req && !(await require('../routes/books').gates.mayReadMoney(ctx.req))) {
    const say = require('./books-readers').READ_MONEY_WORDS;
    return { lines: [{ text: say, value: 0 }], figures: {}, state: 'not_started', may: { ok: false, why: 'books_money', say } };
  }
  let facts;
  try {
    facts = await financeRead(ctx.entity, helpers);
  } catch (failure) {
    if (helpers.notProvisioned(failure)) return helpers.notStarted('the ledger is not provisioned');
    throw failure;
  }
  if (!facts.settings || !facts.settings.enabled) return helpers.notStarted('the ledger is off');
  const states = chequeStates(facts);
  const { toCollect, toPay, remind, shopDay, rows } = facts;
  return {
    lines: chequeLines(facts, states, books.curOf(facts.settings), helpers),
    figures: {
      as_of: shopDay,
      to_deposit: states.dueList.length,
      late: states.late.length,
      in_hand: states.held.length,
      remind_on: remind ? remind.on : null,
      to_collect_minor: toCollect > 0 ? toCollect : null,
      to_pay_minor: toPay > 0 ? toPay : null
    },
    state: helpers.neverUsed(rows.length, toCollect > 0, toPay > 0, facts.posted)
  };
}

module.exports = { financeCard, financeRead, chequeLines };
