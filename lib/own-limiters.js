'use strict';
/**
 * @stage tested
 * CARD 28-platform-and-operations/api-standard
 * own-limiters.js — the doors that send mail, SMS, WhatsApp or call the model, each with a limiter of its OWN (register column 16, resource_cap, OWASP API4:2023), split out of server.js so that file does not grow (rule: split, don't raise).
 *
 * OWNS      mount(app, { rateLimit, intFromEnv }) — the own limiters: ai-draft, reissue-code, erp-test, the chit status write, the firm invitation, the firm ask
 * CALLED BY server.js (once, after the assist limiter and before the chits router)
 * FLOW      app.use(path, rateLimit(named, keyed by caller via lib/limiter-key, SEC-79)) — one login cannot spend another's allowance
 *
 * Tighter than api-global (500 / 15 min); sized like api-assist-ai (40) and the sign-in ask (30). Each is overridable from the environment.
 */
const { callerKey } = require('./limiter-key');

function mount(app, { rateLimit, intFromEnv }) {
  const limiterOpts = (envName, fallback, message) => ({ windowMs: 15 * 60 * 1000, max: intFromEnv(envName, fallback), legacyHeaders: false, keyGenerator: callerKey, message: { error: 'Too many requests', message } });
  app.use('/api/governance/ai-draft', rateLimit({ name: 'api-governance-ai-draft', standardHeaders: true, ...limiterOpts('AI_DRAFT_RATE_LIMIT_MAX', 40, 'Too many drafting requests — please try again shortly.') }));
  app.use('/api/connectors/reissue-code', rateLimit({ name: 'api-connector-reissue-code', standardHeaders: true, ...limiterOpts('REISSUE_CODE_RATE_LIMIT_MAX', 10, 'Too many codes asked for — please try again in a few minutes.') }));
  app.use('/api/connectors/:actorId/erp-test', rateLimit({ name: 'api-connector-erp-test', standardHeaders: true, ...limiterOpts('ERP_TEST_RATE_LIMIT_MAX', 30, 'Too many test runs — please try again shortly.') }));
  /* the chit status write tells the other side (mail, WhatsApp): its own bucket per login, counted for the PUT only (300 / 15 min per login; a busy counter stays well inside it) */
  app.use('/api/chits/:chit_id/status', rateLimit({ name: 'api-chit-status', standardHeaders: true, skip: (req) => req.method !== 'PUT', ...limiterOpts('CHIT_STATUS_RATE_LIMIT_MAX', 300, 'Too many status changes in a short time — please try again shortly.') }));
  /* the firm door sends mail and asks other businesses: its own bucket per login (cb-security sizing, PR firm-connect-1138: an invitation 10 / 15 min; an ask 60 / 15 min, so a firm can bring its 150 shops in a sitting and no loop can flood them; the DB caps in lib/connect-caps bind the day) */
  app.use('/api/network/firm-invites', rateLimit({ name: 'api-network-firm-invites', standardHeaders: true, ...limiterOpts('FIRM_INVITE_RATE_LIMIT_MAX', 10, 'Too many invitations in a short time — please try again shortly.') }));
  app.use('/api/network/connections', rateLimit({ name: 'api-network-connection-asks', standardHeaders: true, skip: (req) => req.method !== 'POST' || !['', '/'].includes(req.path), ...limiterOpts('CONNECTION_ASK_RATE_LIMIT_MAX', 60, 'Too many requests to connect in a short time — please try again shortly.') }));
}

module.exports = { mount };
