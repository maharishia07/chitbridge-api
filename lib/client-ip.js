/**
 * lib/client-ip.js — THE one reading of the caller's address (M8, VERIFY-GF-MONEY-SECURITY). Trusted-proxy rule: the address is the RIGHTMOST hop we do not trust,
 * counted from the right by the platform's proxy count — Express does exactly that with `app.set('trust proxy', n)` (server.js) and hands it over as `req.ip`.
 * The left-most X-Forwarded-For element is whatever the caller typed, so it is NEVER read here (it fed signup_context.ip, the consent evidence, and signin_events.ip).
 * clientIp(req) -> a plain address, or '' when none can be read.
 *
 * OWNER     cb-security
 * OWNS      the one reading of the caller's address (clientIp); nothing else reads a forwarded header
 * CALLED BY routes that stamp consent or sign-in evidence (signup_context.ip, signin_events.ip)
 * FLOW      req.ip (Express trust proxy) or the socket address → shape check → the address, or '' (fails closed: a bad shape is no address)
 * CARD      18-identity-sign-in-and-access/sign-in
 * RISK      personal-data · security
 */
'use strict';
function clientIp(req) {
  const ip = String((req && req.ip) || (req && req.socket && req.socket.remoteAddress) || '').trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : '';
}
module.exports = { clientIp };
