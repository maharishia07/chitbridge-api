/* fixture — an api test: it requires a lib function and fires a route the way the api's tests do: call('POST', '/api/…') */
'use strict';
const { post } = require('../lib/pay');
async function call(method, p) { return { method, p }; }
(async () => {
  await post({ amount_minor: 100 }, (n) => n);
  await call('POST', '/api/books/payments');
})();
