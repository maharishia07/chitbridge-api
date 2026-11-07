'use strict';
/*
 * OWNS      the ONE sentence a shopkeeper reads when a part of the product waits for a database update (a 503 "not migrated").
 * CALLED BY lib/books-contract · books-assets · books-recurring · books · assist-contract · channels · stores · profile · cost · forms · capture · amend · assign ·
 *           deliverline · folder-rules · policy · retention · raida · bell-contract · catalogue-contract · products-contract · crm-* · definitions-contract · schemas-contract ·
 *           supplies-contract · party-fields · privacy · fx-rates · move-in · routes/books · identity-docs · service · chits (every "not migrated" answer).
 * FLOW      waiting('Channels', true, 'Nothing was changed.') → "Channels arrive after the next update. Nothing was changed."
 * CARD      28-platform-and-operations/api-standard
 */
/**
 * lib/not-migrated.js — API-STANDARD S8a (plain words). A migration id (b123, b295 ...) is for the log and the operator, never for the person: it must not
 * reach `detail`, `hint`, `error` or `message`. The pattern is docs/ERROR-CODES.md COUNTRY_SETUP_NOT_MIGRATED ("... arrives after the next update. Selling
 * and the rail work meanwhile."). Keep the id in a comment, the log line or an internal field; say WHAT waits, and what is TRUE meanwhile, here, in one voice.
 *
 * ⭐ THE `meanwhile` SENTENCE IS REQUIRED (laptop2, 7 Nov 2026): there is no default "everything else works". Each site says what is true for it — where money or a
 * legal duty waits, what cannot happen yet and what to do instead.
 */

/** what = the thing that waits, as a noun phrase ("The asset register", never "Saving …"); many = it is plural ("Channels arrive"); meanwhile = what is true meanwhile (required) */
function waiting(what, many, meanwhile) {
  if (!what || !meanwhile) throw new Error('waiting(what, many, meanwhile): say what waits AND what is true meanwhile');
  return what + (many ? ' arrive' : ' arrives') + ' after the next update. ' + meanwhile;
}

module.exports = { waiting };
