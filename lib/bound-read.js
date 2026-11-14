'use strict';
/**
 * CARD 18-identity-sign-in-and-access/row-level-security-and-shop-scoped-data
 * lib/bound-read.js — read or write an identities row UNDER ITS OWN BINDING, for a caller that is handed its `execute` (SEC-185, step B; migration b860).
 * owns: boundRead, boundEach · called by: lib/identity-auth.js, lib/otp.js, lib/person-session.js, routes/signin.js, middleware/auth.js
 * FLOW  caller hands its `execute` → boundRead(execute, id, sql, params) → ONE statement under that id's binding (real query) or the plain statement (stub / bound handle)
 * WHY   identities is row-secured: a row opens under app.current_entity = its own id (or its shop's). The real db `query` carries .as (db/index.js queryAs: ONE statement, ONE trip,
 *       bound to the id) and .asEach (the same statement once per id, still one trip). Any other `execute` (a unit test's recording stub, a transaction handle that is already bound) is
 *       called as it always was: plain SQL, same text, same params, so the stubs of the sign-in tests keep seeing what they always saw.
 */
/** one statement bound to `id` */
const boundRead = (execute, id, text, params) => (execute && execute.as ? execute.as(id, text, params) : execute(text, params));
/** the statement once per id, each under its own binding; `paramsOf(id)` its values, `whole` the values of the single statement a plain `execute` is given */
const boundEach = (execute, ids, text, paramsOf, whole) => (execute && execute.asEach ? execute.asEach(ids, text, paramsOf) : execute(text, whole));
module.exports = { boundRead, boundEach };
