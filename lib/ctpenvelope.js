'use strict';
// @stage poc
// @stage-note CTP step 3 (docs/CTP-DESIGN.md §6, §8). Builds and opens the envelope that carries ONE copy to ONE
//             entity. No route sends one yet — lib/mint.deliver refuses a remote address because there is no
//             transport. Proven by tests/ctp-conformance.test.cjs, which is the whole point of writing it now.
// @stage-why  The conformance claim ("both transports produce identical rows") is only checkable if the envelope
//             exists. Building it before the wire is how the design gets tested for a day's work instead of a
//             deployment.
/**
 * ── ⭐⭐⭐ THE ENVELOPE — ONE COPY, ONE RECIPIENT, SEALED ─────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15: *"we are thinking of creating something like SMTP?"* — yes, and this is the message format.
 *
 * ── ⭐ THE CONFORMANCE RULE IS THE REASON THIS FILE IS SHAPED AS IT IS ──────────────────────────────────────────
 *
 * Athi: *"this can be a completely different new machinery or a part of an existing engine — THE BEHAVIOUR
 * SHOULD BE THE SAME."*
 *
 * So the envelope must carry a copy **losslessly**: `open(seal(copy))` has to deep-equal `copy`, exactly, or the
 * two transports write different rows and the day a world is lifted onto its own machine everything quietly
 * changes. That is not an aspiration — it is one assertion, and tests/ctp-conformance.test.cjs makes it.
 *
 * ⚠️ WHICH IS WHY THERE IS NO "TRANSFORM" STEP HERE. It is tempting to normalise a copy on the way out — drop a
 * null, reorder a key, coerce a date. Every one of those is a row that differs. The envelope WRAPS; it does not
 * tidy.
 *
 * ── ⚠️⚠️ WHAT NEVER CROSSES ─────────────────────────────────────────────────────────────────────────────────────
 *
 * ONE copy — the recipient's. Not the sender's, not a third party's. Per-copy replication is the product's
 * central promise and a protocol that bundles "all the copies, sort it out at the other end" would undo it in
 * one commit. §6 rule 1. [[reference-cb-core-principle]]
 *
 * ── ⚠️ AND THE BOUNDARY TRAVELS WITH IT ─────────────────────────────────────────────────────────────────────────
 *
 * b247 refuses a cross-population chit with a database trigger that can SEE BOTH ENTITIES. Across installations
 * it cannot — the remote party is not in this database. So the envelope carries `from.population` and the
 * receiver refuses a mismatch. Without that, a test world on one machine delivers into a live world on another
 * and nothing anywhere stops it. §7.
 */

const canon = require('./canon');

/** the fields that are sealed — everything that decides what gets written, and nothing that does not */
const SEALED_FIELDS = ['ctp', 'chit_id', 'from', 'to', 'header', 'copy', 'attachments'];

/**
 * Build an envelope for ONE copy.
 *
 * @param from  { installation_key, population, bridge_id, display_name }  the SENDING ENTITY and its world
 * @param to    { bridge_id }                                             exactly one recipient
 * @param chit  { chit_id, header, copy, attachments }
 * @returns the envelope, unsigned. Signing is `sign()` below, so a caller cannot forget which bytes were covered.
 */
function build(from, to, chit) {
  if (!from || !from.population) throw new Error('an envelope must carry the sender population — see §7');
  if (!to || !to.bridge_id) throw new Error('an envelope carries exactly one recipient');
  if (!chit || !chit.chit_id) throw new Error('an envelope must name its chit');
  if (!chit.copy) throw new Error('an envelope carries a copy');
  /* ⚠️ Array, not "maybe an array" — a caller passing one object would produce an envelope that opens to a
     different shape than it was given, which is exactly the conformance failure this file exists to avoid. */
  if (chit.attachments !== undefined && !Array.isArray(chit.attachments)) {
    throw new Error('attachments must be an array of references');
  }
  return {
    ctp: '1',
    chit_id: chit.chit_id,
    from: {
      installation_key: from.installation_key || null,
      population: from.population,
      bridge_id: from.bridge_id || null,
      display_name: from.display_name || null,
    },
    to: { bridge_id: to.bridge_id },
    header: chit.header || {},
    copy: chit.copy,
    /* ⚠️ BY REFERENCE, NEVER BY VALUE. Bytes in an envelope make it unbounded and duplicate storage that
       project-object-storage already solved. §6 rule 3. */
    attachments: chit.attachments || [],
  };
}

/**
 * The canonical bytes an envelope is signed over — one definition, used by both sign and verify.
 *
 * ── ⚠️⚠️ IT HASHES THE *WIRE* FORM, NOT THE IN-MEMORY ONE ───────────────────────────────────────────────────────
 *
 * Found by sending a real chit over a real socket, 2026-09-15: the receiver answered *"the seal does not match
 * the contents"* and it was right. `header.created_at` was a `Date` in the sender's memory and a STRING by the
 * time it arrived, because that is what JSON does to a Date. Two different values, two different hashes, and a
 * signature that could never verify.
 *
 * ⭐ THE RULE: a signature must cover exactly what the other end will see. Anything JSON alters on the way —
 * Date, undefined, BigInt, -0, a Map — must be altered BEFORE the digest is taken, not after. So the subject is
 * round-tripped through JSON first and both ends hash the identical thing by construction.
 *
 * ⚠️ AND IT COSTS A SERIALISATION, which is the correct price. The alternative — remembering to pass only
 * JSON-native values into every envelope, forever — is a rule nobody can keep and nothing can check.
 */
function digest(env) {
  const subject = {};
  for (const k of SEALED_FIELDS) subject[k] = env[k];
  return canon.hash(JSON.parse(JSON.stringify(subject)));
}

/**
 * Seal it. ⚠️ `signer` is injected rather than read from config: the key belongs to the installation and this
 * file must not decide where a private key lives. Returns a NEW object — the input is not mutated, because a
 * caller who signs twice must get the same answer rather than a nested one.
 */
function sign(env, signer) {
  const hash = digest(env);
  return Object.assign({}, env, {
    sealed: {
      alg: (signer && signer.alg) || 'none',
      hash,
      sig: signer && typeof signer.sign === 'function' ? signer.sign(hash) : null,
      at: new Date().toISOString(),
    },
  });
}

/**
 * Open an envelope: check it is intact, that it is addressed here, and that it may cross.
 *
 * @param env
 * @param ctx { population, verify(hash, sig, installation_key) -> boolean }
 * @returns {{ ok: boolean, why: string, copy?: object, header?: object, chit_id?: string }}
 *
 * ⚠️ IT NEVER THROWS. A malformed envelope from a stranger is an answer to give, not an exception to leak — and
 * a 500 on a protocol endpoint tells the sender to retry something that will never work.
 */
function open(env, ctx) {
  const no = (why) => ({ ok: false, why });
  if (!env || env.ctp !== '1') return no('not a CTP/1 envelope');
  if (!env.chit_id || !env.copy || !env.from || !env.to) return no('envelope is missing a required part');

  /**
   * ⚠️⚠️ THE BOUNDARY, BEFORE ANYTHING ELSE. `live` is a universally shared meaning — live is live on any
   * installation, and two live worlds trading is ordinary cross-border commerce. Every other code is a LOCAL
   * name: `test` here and `test` on a customer's engine are two unrelated sealed worlds that share a word, and
   * matching on the string would wire a stranger's sandbox to ours. §7.1.
   */
  const theirs = String(env.from.population || '');
  const mine = String((ctx && ctx.population) || '');
  if (!theirs || !mine) return no('population is missing — refused');
  if (theirs !== mine) return no('population ' + theirs + ' may not deliver into ' + mine);
  if (theirs !== 'live') {
    const paired = ctx && typeof ctx.pairedWith === 'function'
      && ctx.pairedWith(env.from.installation_key, theirs);
    if (!paired) {
      return no('“' + theirs + '” is a local name on both sides — a non-live world needs an explicit pairing');
    }
  }

  /* ⚠️ the signature covers the canonical form, so a re-ordered key cannot pass as the same message */
  if (ctx && typeof ctx.verify === 'function') {
    const hash = digest(env);
    if (!env.sealed || env.sealed.hash !== hash) return no('the seal does not match the contents');
    if (!ctx.verify(hash, env.sealed.sig, env.from.installation_key)) return no('signature did not verify');
  }

  return { ok: true, why: 'accepted', chit_id: env.chit_id, header: env.header, copy: env.copy,
           attachments: env.attachments || [] };
}

module.exports = { build, sign, open, digest, SEALED_FIELDS };
