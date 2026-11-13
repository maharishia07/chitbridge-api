/**
 * tests/con-55-zoho-refresh.test.cjs — CON-55 · the Zoho adapter renews its own access token (refresh_token), BEFORE any live Zoho test.
 * OWNS      the proof that tools/tally-connector/adapters/zoho.js renews (a) before the first call when the token is older than 50 minutes, (b) once on a 401, (c) never when fresh.
 * CALLED BY scripts/guards.cjs (P2 PROOF pass 2026-11-14)
 * FLOW      stub fetch (the token endpoint + the items endpoint) → real adapter.readProducts() → what each call carried
 * CARD      23-connectors-and-integrations
 * Hand-computed: token 51 min old → 1 token call, then the items call carries the NEW token; token 10 min old → 0 token calls; a 401 on the items call → 1 token call, retry with the new token, a second 401 → refused (no loop).
 */
'use strict';
const path = require('path');
const { ok, done } = require('./lib/cat-proof-kit.cjs');
const zohoAdapter = require(path.join(__dirname, '..', 'tools', 'tally-connector', 'adapters', 'zoho.js'));

const realFetch = global.fetch;
const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
/** a stub Zoho: the token endpoint hands out tok1, tok2 …; the items endpoint accepts only the tokens in `good` */
function world(good, itemsStatusOverride) {
  const log = { tokenCalls: [], itemCalls: [] };
  let n = 0;
  global.fetch = async (url, opt) => {
    url = String(url);
    if (url.includes('/oauth/v2/token')) {
      log.tokenCalls.push({ url, body: String(opt.body) });
      n++;
      return json(200, { access_token: 'tok' + n });
    }
    const auth = (opt.headers || {}).Authorization;
    log.itemCalls.push(auth);
    if (itemsStatusOverride === 401 || !good.includes(String(auth).replace('Zoho-oauthtoken ', ''))) return json(401, { message: 'invalid token' });
    return json(200, { items: [{ name: 'Tea', sku: 'T1', rate: 50 }], page_context: { has_more_page: false } });
  };
  return log;
}
const cfg = (over) => ({ zoho: Object.assign({ base: 'https://www.zohoapis.in', org: '99', token: 'old', token_at: Date.now() - 51 * 60 * 1000, client_id: 'cid', client_secret: 'sec', refresh_token: 'rt' }, over || {}) });

(async () => {
  console.log('\nCON-55 · Zoho refresh_token renewal');
  let log = world(['tok1']);
  let items = await zohoAdapter(cfg()).readProducts();
  ok('a 51-minute-old token is renewed BEFORE the first call: exactly 1 token call', log.tokenCalls.length === 1, JSON.stringify(log.tokenCalls));
  ok('the token call is the refresh_token grant to accounts.zoho.in with the client id', /grant_type=refresh_token/.test(log.tokenCalls[0].body) && /client_id=cid/.test(log.tokenCalls[0].body) && /refresh_token=rt/.test(log.tokenCalls[0].body) && /accounts\.zoho\.in\/oauth\/v2\/token/.test(log.tokenCalls[0].url));
  ok('the items call carried the NEW token, not the old one', log.itemCalls.length === 1 && log.itemCalls[0] === 'Zoho-oauthtoken tok1', JSON.stringify(log.itemCalls));
  ok('the product came through (Tea at 50)', items.length === 1 && items[0].name === 'Tea' && items[0].price === 50);

  log = world(['old']);
  await zohoAdapter(cfg({ token_at: Date.now() - 10 * 60 * 1000 })).readProducts();
  ok('a 10-minute-old token is NOT renewed: 0 token calls, the pasted token used', log.tokenCalls.length === 0 && log.itemCalls[0] === 'Zoho-oauthtoken old', JSON.stringify(log));

  log = world(['tok1']);
  await zohoAdapter(cfg({ token_at: Date.now() - 10 * 60 * 1000 })).readProducts();
  ok('a 401 renews ONCE and the call is retried with the new token (2 items calls, 1 token call)', log.tokenCalls.length === 1 && log.itemCalls.length === 2 && log.itemCalls[1] === 'Zoho-oauthtoken tok1', JSON.stringify(log));

  log = world([], 401);
  let refused = null;
  try { await zohoAdapter(cfg({ token_at: Date.now() - 10 * 60 * 1000 })).readProducts(); } catch (e) { refused = e; }
  ok('a second 401 is refused, not looped (1 renewal, 2 items calls)', !!refused && /Zoho 401/.test(refused.message) && log.tokenCalls.length === 1 && log.itemCalls.length === 2, JSON.stringify(log));

  log = world(['old']);
  await zohoAdapter(cfg({ refresh_token: '', token_at: 0 })).readProducts();
  ok('without a refresh token it behaves as before: the pasted token, no token call', log.tokenCalls.length === 0 && log.itemCalls[0] === 'Zoho-oauthtoken old');

  global.fetch = realFetch;
  done();
})();
