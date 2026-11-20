/**
 * middleware/no-store-signed-in.js — GOR-09: an answer to a signed-in call is never kept by a browser or a shared cache (OWASP ASVS V8.3 / API8).
 * OWNER     cb-security
 * RISK      access
 * OWNS      the Cache-Control: no-store header on every /api call that carries a login or an api key
 * CALLED BY server.js (app.use('/api', …), before the routes, so a route's own explicit header still wins)
 * FLOW      request with Authorization or x-api-key ──▶ Cache-Control: no-store ──▶ next()
 * CARD      security/sign-in-and-sessions
 */
'use strict';
module.exports = (req, res, next) => {
  if (req.headers.authorization || req.headers['x-api-key']) res.setHeader('Cache-Control', 'no-store');
  next();
};
