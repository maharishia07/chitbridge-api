'use strict';
/*
 * OWNS      column 16 of the API register, resource_cap (OWASP API4:2023 unrestricted resource consumption): the three static claims about one route, kept as pure functions over text and numbers.
 * CALLED BY tools/api-reported.cjs (resourceCapColumn) · tests/resource-cap.test.cjs · tools/resource-cap-live.cjs
 * FLOW      a route's declared query schema + its handler call tree + the limiters in its stack ──▶ causesOf() ──▶ [] (holds) or the named causes (fails)
 * CARD      28-platform-and-operations/api-standard
 *
 * Reuses, never copies: lib/bounds.js (B.limit, LIMIT_MAX, PAGE_MAX: the one page-size bound) · lib/page-limit.js (limitOf / pageArgs: the one runtime clamp) · lib/rate-limit.js (the one limiter, now carrying its name).
 *   list_cap      a LIST read (a GET that takes or answers limit / page) holds when its limit is capped: the declared query `limit` has a `maximum` no higher than LIMIT_MAX (the B.limit bound), or the handler
 *                 reads it through page-limit (limitOf / pageArgs, a server-side max). A hand clamp (Math.min on req.query.limit) is NOT a cap here: it is a second cap helper, so it reads `adhoc_clamp`.
 *   named_limiter every route sits behind a NAMED limiter with a finite max, the global one (`api-global`) or its own.
 *   own_limit     a WRITE that sends mail, SMS, a WhatsApp or calls the AI has a limiter of its own (not the global) whose max is below the global's.
 */
const { LIMIT_MAX } = require('./bounds');

const CAUSES = ['no_list_cap', 'adhoc_clamp', 'no_named_limiter', 'unnamed_limiter', 'no_own_limit', 'own_limit_not_tighter'];

/** a handler that reaches out: an e-mail, an SMS or OTP delivery, a WhatsApp, or a model call (lib/notify, lib/whatsapp-out, lib/ai) */
const OUTBOUND = /\b(?:sendOtp|sendOtpEmail|sendOtpSms|sendEmail|sendSupportAlert|invokeSkill|draftDocument|notifyChitStatus)\s*\(|require\(\s*['"]\.\.\/lib\/(?:whatsapp-out|ai)['"]\s*\)|\bwhatsappOut\.notify\s*\(/;
const sendsOutbound = (text) => OUTBOUND.test(text || '');

/** reads a size or a page off the query (a LIST read) */
const READS_PAGING = /\bquery\.(?:limit|page)\b|\b(?:limitOf|pageArgs|pageOut)\s*\(/;
/** the one runtime clamp */
const THROUGH_PAGE_LIMIT = /\b(?:limitOf|pageArgs)\s*\(/;
/** the second-helper habit this column refuses to count: Math.min on the query's limit */
const HAND_CLAMP = /Math\.(?:min|max)\([^;]*query\.limit|query\.limit[^;]*Math\.(?:min|max)/;

/** the declared bound of the query's limit, or null when none is declared (urlSchema from middleware/validate.js urlSchemaOf) */
const declaredLimit = (urlSchema) => {
  const properties = (urlSchema && urlSchema.properties) || {};
  const fragment = properties.limit || properties.per_page || null;
  return fragment ? { max: typeof fragment.maximum === 'number' ? fragment.maximum : null } : null;
};

/** does the route read or declare paging (so is a list read) */
const isListRead = ({ method, urlSchema, text }) => method === 'GET' && (!!declaredLimit(urlSchema) || !!(urlSchema && urlSchema.properties && urlSchema.properties.page) || READS_PAGING.test(text || ''));

/** list_cap: [] when the limit is capped through bounds or page-limit, else the cause */
function listCapProblems({ method, urlSchema, text }) {
  if (!isListRead({ method, urlSchema, text })) return [];
  const declared = declaredLimit(urlSchema);
  if (declared && declared.max !== null && declared.max <= LIMIT_MAX) return [];
  if (THROUGH_PAGE_LIMIT.test(text || '')) return [];
  return [HAND_CLAMP.test(text || '') ? 'adhoc_clamp' : 'no_list_cap'];
}

/** the limiter facts of a route: `limiters` = [{ name, max, own }] for every limiter in front of it (global: own false) */
function limiterProblems({ method, limiters, text, globalMax }) {
  const out = [];
  const named = limiters.filter((item) => item.name && Number.isFinite(item.max));
  if (!limiters.length) out.push('no_named_limiter');
  else if (!named.length) out.push('unnamed_limiter');
  if (method !== 'GET' && method !== 'HEAD' && sendsOutbound(text)) {
    const own = named.filter((item) => item.own);
    if (!own.length) out.push('no_own_limit');
    else if (!own.some((item) => item.max < globalMax)) out.push('own_limit_not_tighter');
  }
  return out;
}

/** every cause for one route (empty = the column holds) */
const causesOf = (facts) => listCapProblems(facts).concat(limiterProblems(facts));

module.exports = { CAUSES, LIMIT_MAX, sendsOutbound, isListRead, declaredLimit, listCapProblems, limiterProblems, causesOf, HAND_CLAMP, OUTBOUND };
