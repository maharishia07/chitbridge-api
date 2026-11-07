'use strict';
/*
 * OWNS      the ONE sentence a shopkeeper reads when a part of the product waits for a database update (a 503 "not migrated").
 * CALLED BY lib/books-contract · books-assets · books-recurring · books · assist-contract · channels · stores · profile · cost · forms · capture · amend · assign ·
 *           deliverline · folder-rules · policy · retention · raida · bell-contract · catalogue-contract · products-contract · crm-* · definitions-contract · schemas-contract ·
 *           supplies-contract · schedule · party-fields · routes/identity-docs · routes/service · routes/chits (every "not migrated" answer).
 * FLOW      waiting('Channels', true) → "Channels arrive after the next update. Everything else works meanwhile."
 * CARD      28-platform-and-operations/api-standard
 */
/**
 * lib/not-migrated.js — API-STANDARD S8a (plain words). A migration id (b123, b295 ...) is for the log and the operator, never for the person: it must not
 * reach `detail`, `hint`, `error` or `message`. The pattern is docs/ERROR-CODES.md COUNTRY_SETUP_NOT_MIGRATED ("... arrives after the next update. Selling
 * and the rail work meanwhile."). Keep the id in a comment, the log line or an internal field; say WHAT waits, here, in one voice.
 */
const MEANWHILE = 'Everything else works meanwhile.';

/** what = the thing that waits ("The asset register"); many = it is plural ("Channels arrive"); meanwhile = what still works, when it is more exact than the default */
function waiting(what, many, meanwhile) {
  return what + (many ? ' arrive' : ' arrives') + ' after the next update. ' + (meanwhile || MEANWHILE);
}

module.exports = { waiting, MEANWHILE };
