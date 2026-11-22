/**
 * books-locked-wait.js — A LATE ITEM IN A LOCKED MONTH WAITS FOR THE OWNER (Athi, 22 Nov 2026, DECISIONS item 4: AW-F-02 + AM-F-05, one rule).
 * OWNER     cb-accounting
 * RISK      money
 * OWNS      heldIfLocked (is this day in a locked month, and where would the books put it) · wordsOf (the one sentence) · BANK_JOB (the parked sign-off's job name)
 * CALLED BY lib/books-hooks.js (postDay: the till's day close) · routes/books.js (POST /bank/statements: a late bank sign-off) · lib/books-hooks.js retryOutbox (the owner's press)
 * FLOW      a day close / a sign-off dated in a locked month ──▶ heldIfLocked ──▶ it WAITS on the ONE Waiting list (books_outbox, event.waiting 'locked') with wordsOf ──▶ the owner opens the month,
 *           or presses POST /outbox/retry { forward: true } (owner only) ──▶ it posts into the first open month, doc_date kept (the writer's own rule, never a second one)
 * CARD      14-accounting/books-period
 * The till is never refused after the fact: the day close is stored and waits. The other doors (receipt, payment, keyed bill, journal) still refuse a locked month with 409; that is their rule, not this one's.
 * No tax section is named in the words: the GST section for reporting it in a later return is not cited yet (DECISIONS 22 Nov, item 4).
 */
'use strict';
const books = require('./books');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BANK_JOB = 'bank_statement';
const monthOf = (iso) => MONTHS[Number(String(iso || '').slice(5, 7)) - 1] || null;

/** the one sentence a locked-month item waits with: "April is locked; open it, or post this into May." */
function wordsOf(dayIso, postsIso) {
  const locked = monthOf(dayIso);
  const into = monthOf(postsIso);
  return locked && into ? locked + ' is locked; open it, or post this into ' + into + '.' : null;
}

/**
 * heldIfLocked(db, entity, setting, dayIso) → null (the day's month is open, or the read cannot say: the writer's own lock still holds), else { why, day, posts_on }.
 * A read: the writer's own postingDateFor (readOnly), so the month rule lives in one place. `db` null → its own transaction.
 */
async function heldIfLocked(db, entity, setting, dayIso) {
  try {
    const run = async (handle) => books.postingDateFor(handle, entity, dayIso, books.packOf(setting), false, false, setting, true);
    const when = await (db ? run(db) : require('../db').withEntity(entity, run));
    if (!when || !when.moved) return null;
    const first = books.ledgerStart(setting, books.packOf(setting));
    if (first && dayIso < first) return null; /* before the ledger began is not a lock: the writer's own rule moves it, as before */
    const why = wordsOf(dayIso, when.date);
    return why ? { why, day: dayIso, posts_on: when.date } : null;
  } catch (e) {
    return null; /* every month from that day on is locked, or a read failed: the normal path refuses or posts in its own words */
  }
}

/**
 * holdDay: the till's day close in a locked month is stored on the Waiting list and answers queued (never refused); on a retry it only answers queued again. null = the month is open, go on and post.
 * `park` is books-hooks.park (passed in: books-hooks requires this file).
 */
async function holdDay(entity, setting, shopDay, sourceRef, waitingJob, options, park) {
  const held = await heldIfLocked(null, entity, setting, shopDay);
  if (!held) return null;
  if (!options.retry) await park(entity, Object.assign({ waiting: 'locked' }, waitingJob), held.why, null, sourceRef);
  return { queued: true, wait: 'locked', why: held.why };
}

/**
 * parkStatement(handle, entity, account, body, who) → the Waiting row's words. The late bank sign-off is stored whole on the ONE Waiting list (insert in the caller's transaction, so a failure is never silent);
 * the owner's press posts it (postStatement). `who` = { by, acting } as the session stamped them.
 */
async function parkStatement(handle, entity, account, body, who, held) {
  const key = 'bank-statement:' + account.code + ':' + String(body.file_hash || '').slice(0, 64) + ':' + body.period_to;
  const event = { job: BANK_JOB, waiting: 'locked', todo: 'record', body, by: who.by || null, acting: who.acting || null, day: held.day };
  await require('./books-store').queue(handle, entity, { source_ref: key, event, why: held.why });
  return held.why;
}

/** the owner's press (or the retry after the month was opened) on a parked sign-off → { ok } | { queued, wait, why }; a refusal throws and the row keeps its words */
async function postStatement(entity, job, forward) {
  const bank = require('./bank-rec-log');
  return require('../db').withEntity(entity, async (handle) => {
    const setting = await books.settingOf(handle, entity);
    const body = job.body || {};
    if (!forward) {
      const held = await heldIfLocked(handle, entity, setting, body.period_to);
      if (held) return { queued: true, wait: 'locked', why: held.why };
    }
    const account = bank.accountIn(await require('./books-store').accounts(handle, entity), body.account);
    if (!account) throw new Error('That bank account was not found.');
    await bank.appendStatement(handle, entity, account, String(books.packOf(setting).currency || '').toUpperCase(), body, job.by, job.acting);
    return { ok: true };
  });
}

module.exports = { heldIfLocked, holdDay, wordsOf, parkStatement, postStatement, BANK_JOB };
