/* fixture — a lib function that writes a table and reads another, through a withEntity-style callback */
'use strict';
const db = { query() {} };
async function post(body, round) {
  const amount = round(body.amount_minor);
  await db.query('INSERT INTO books_payment (amount_minor) VALUES ($1)', [amount]);
  const prev = await db.query('SELECT 1 FROM chit_header WHERE chit_id = $1', [body.chit_id]);
  return { amount, prev };
}
function unusedHelper() { return 1; }
module.exports = { post };
