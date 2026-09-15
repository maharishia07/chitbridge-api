'use strict';
// @stage poc
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
const keys = require('./ctpkeys');

const TIMEOUT_MS = 10000;

/**
 * Send one envelope.
 *
 * @returns {Promise<{accepted:boolean, status:?number, why:string, chit_id:?string}>}
 *          ⚠️ `accepted` is true ONLY for a 2xx that says so. Never for "it went out".
 */
async function send(endpoint, env) {
  if (!endpoint) return { accepted: false, status: null, why: 'no endpoint for that installation', chit_id: null };

  const signed = envelope.sign(env, keys.signer());
  /**
   * ⚠️ AN UNSIGNED ENVELOPE IS NOT SENT. A receiver that checks signatures would refuse it, and one that does
   * not should never have been trusted — so posting it would only produce a confusing failure somewhere else.
   * Refusing here names the real problem: this installation has no identity.
   */
  if (!signed.sealed || !signed.sealed.sig) {
    return { accepted: false, status: null, chit_id: env.chit_id,
             why: 'this installation cannot sign (' + keys.status().why + ') — nothing was sent' };
  }

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
      signal: ctl.signal,
      redirect: 'error',            /* ⚠️ a redirected POST is a different endpoint than the one we verified */
    });
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    const accepted = res.ok && !!(body && body.accepted === true);
    return {
      accepted,
      status: res.status,
      chit_id: env.chit_id,
      /* ⚠️ the far end's own words when it gave any — a local guess about why a stranger refused is worse
         than quoting them. */
      why: accepted ? 'accepted'
         : ((body && body.why) || ('the far installation answered ' + res.status)),
    };
  } catch (e) {
    return { accepted: false, status: null, chit_id: env.chit_id,
             why: 'could not reach ' + endpoint + ': ' + (e.name === 'AbortError' ? 'timed out' : e.message) };
  } finally { clearTimeout(t); }
}

module.exports = { send, TIMEOUT_MS };
