'use strict';
// @stage poc
// OWNS send (one signed envelope to one peer) · CALLED BY lib/mint.js
// FLOW endpoint → safe-url guard (https + public address only) → sign → POST → honest receipt      CARD 01-rail-core-the-chit/ctp-outbound-guard
// @stage-note CTP step 5 (docs/CTP-DESIGN.md §5.2, §9.5). Sends one envelope to one installation. Reachable only
//             when an installation is hosted_locally = false, which none is — so on every deployment today this
//             file is loaded and never called.
// @stage-why  It is the second transport. The first (a local write) has always existed; this one exists so that
//             deliver() can choose between them by ADDRESS rather than by a branch in every caller.
/**
 * ── ⭐⭐⭐ THE SECOND TRANSPORT ───────────────────────────────────────────────────────────────────────────────────
 *
 * ── ⚠️⚠️ THE RECEIPT IS THE WHOLE DIFFICULTY ────────────────────────────────────────────────────────────────────
 *
 * docs/CTP-DESIGN.md §9.5, and it is the same rule that had to be fixed twice already in this codebase — once
 * when a support ticket reported the folder it MEANT to use, and once when `assigned: true` meant "somebody was
 * routed" rather than "somebody was assigned":
 *
 *     THE SENDER'S COPY MUST NOT SAY *delivered* UNTIL THE REMOTE HAS *ACCEPTED*.
 *
 * A queued envelope is not a delivered chit. An envelope that got a 500 is not a delivered chit. Only a 2xx with
 * `accepted: true` is, and this function returns exactly that distinction rather than flattening it into a
 * boolean the caller will read optimistically. [[feedback-attach-shows-outcome]]
 *
 * ── ⚠️ WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────────────────────
 *
 * It does not RETRY and it does not QUEUE. Both are real requirements and both belong to a durable store with a
 * schedule, which this deployment does not have — there is no cron anywhere in the product. Pretending to retry
 * in memory would lose envelopes on the next deploy and would do it silently, which is worse than refusing.
 * `send()` answers once, honestly, and `deliver()` refuses the whole delivery on a failure so nothing is written
 * half-way. [[feedback-silence-is-the-bug]]
 */

const envelope = require('./ctpenvelope');
const log = require('./logger');
const keys = require('./ctpkeys');
const safeUrl = require('./safe-url');

const TIMEOUT_MS = 10000;

/**
 * sealedOrNull(env) — the envelope signed, or null when its contents cannot be canonicalised (RAIL-141 c).
 * ⚠️ sign ran before the try below, so a deep or BigInt copy threw straight into mint.deliver instead of answering in
 * send's one shape. Logged here: it is our own copy, so it is a fault of ours, not of the far end.
 */
function sealedOrNull(env) {
  try {
    return envelope.sign(env, keys.signer());
  } catch (e) {
    log.fellBack('ctptransport send: the copy could not be sealed — nothing sent', e);
    return null;
  }
}

/** how long to wait for the far end: TIMEOUT_MS, or longer when the caller says so (RAIL-106: an event whose far side pulls a file, kind attachment) */
const timeoutOf = (opts) => (opts && opts.timeout) || TIMEOUT_MS;

/** the far end's JSON answer, or null when it sent none (said in our log) */
async function bodyOf(res) {
  try {
    return await res.json();
  } catch (e) {
    log.fellBack('ctptransport send: failed — answered with nothing', e);
    return null;
  }
}

/**
 * Send one envelope.
 *
 * @returns {Promise<{accepted:boolean, status:?number, why:string, chit_id:?string}>}
 *          ⚠️ `accepted` is true ONLY for a 2xx that says so. Never for "it went out".
 */
async function send(endpoint, env, opts) {
  if (!endpoint) return { accepted: false, status: null, why: 'no endpoint for that installation', chit_id: null };

  const signed = sealedOrNull(env);
  if (!signed) return { accepted: false, status: null, chit_id: env.chit_id, why: 'this copy cannot be sealed as one message — nothing was sent' };
  /**
   * ⚠️ AN UNSIGNED ENVELOPE IS NOT SENT. A receiver that checks signatures would refuse it, and one that does
   * not should never have been trusted — so posting it would only produce a confusing failure somewhere else.
   * Refusing here names the real problem: this installation has no identity.
   */
  if (!signed.sealed || !signed.sealed.sig) {
    /* RAIL-141 (g): the key module's sentence names a variable and quotes the parser — for our log, not the shopkeeper */
    log.fellBack('ctptransport send: cannot sign — ' + keys.status().why, null);
    return { accepted: false, status: null, chit_id: env.chit_id, why: 'this installation cannot sign yet — nothing was sent' };
  }

  const safe = await safeUrl.assertPublicHttps(endpoint);
  if (!safe.ok) return { accepted: false, status: null, chit_id: env.chit_id, why: safe.why };

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutOf(opts));
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
      signal: ctl.signal,
      redirect: 'error' /* ⚠️ a redirected POST is a different endpoint than the one we verified */
    });
    return farAnswer(res, await bodyOf(res), env.chit_id);
  } catch (e) {
    log.fellBack('ctptransport send: could not reach ' + endpoint, e); /* RAIL-142 (h): the url and the error stay here */
    const sentence = e.name === 'AbortError' ? 'the far installation did not answer in time — nothing was sent' : 'the far installation could not be reached — nothing was sent';
    return { accepted: false, status: null, chit_id: env.chit_id, why: sentence };
  } finally {
    clearTimeout(t);
  }
}

/**
 * What the far end said, in a fixed sentence. ⚠️ A local guess about why a stranger refused is worse than quoting them,
 * so their words are still quoted — RAIL-142 (h) · Q19: in far_why (text only, capped), never inside our sentence,
 * which reaches the shopkeeper (it was any JSON type and any length, straight into why).
 */
function farAnswer(res, body, chitId) {
  const accepted = res.ok && !!(body && body.accepted === true);
  if (accepted) return { accepted, status: res.status, chit_id: chitId, why: 'accepted' };
  const farWhy = body && typeof body.why === 'string' ? body.why.slice(0, 300) : null;
  const sentence = body ? 'the far installation refused this chit' : 'the far installation did not give an answer we can read';
  return { accepted, status: res.status, chit_id: chitId, why: sentence, far_why: farWhy };
}

module.exports = { send, TIMEOUT_MS };
