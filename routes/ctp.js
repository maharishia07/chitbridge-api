'use strict';
/**
 * ── ⭐⭐⭐ THE TWO DOORS OF CTP ───────────────────────────────────────────────────────────────────────────────────
 *
 *   GET  /.well-known/ctp.json   who this installation is — public, cacheable, signed-over by nothing
 *   POST /api/ctp/deliver        one envelope, one copy, one recipient
 *
 * docs/CTP-DESIGN.md §5.1, §6, §7, §8.1.
 *
 * ── ⚠️⚠️ THE RECEIVING DOOR IS UNAUTHENTICATED AND THAT IS CORRECT ──────────────────────────────────────────────
 *
 * There is no session to present: the caller is another INSTALLATION, not a person. What stands in for auth is
 * the signature, checked against the public key published on the sender's own domain. So the order of checks
 * matters more than usual, and it is: cheapest and most refusing first.
 *
 *   1. is it a CTP/1 envelope at all              — a malformed body costs nothing to reject
 *   2. does the POPULATION match                  — §7, the boundary, BEFORE any lookup that costs a round trip
 *   3. do we know this installation               — it must be in `installation`, marked remote, with a domain
 *   4. does the signature verify                  — against the key on THEIR domain, not one they sent us
 *   5. is the recipient here, and are they real
 *   6. only then: write the copy
 *
 * ⚠️ AND IT NEVER 500s ON A BAD MESSAGE. A protocol endpoint that answers 500 tells the sender to retry
 * something that will never work. Malformed is 400, refused is 409, unknown sender is 403.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { query } = require('../db');
const envelope = require('../lib/ctpenvelope');
const keys = require('../lib/ctpkeys');
const directory = require('../lib/ctpdirectory');
const mint = require('../lib/mint');

/* ⚠️ its own limiter. This door is open to the internet and is not covered by the session limiters. */
const ctpLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many envelopes', message: 'Slow down and retry.' } });

/* ── ① WHO WE ARE ───────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * ⭐ PUBLISHED ON OUR OWN DOMAIN, which is the whole of the discovery design: nobody runs the namespace, every
 * installation answers for itself, and a peer needs no permission from us to find us.
 *
 * ⚠️ IT STATES WHICH POPULATIONS WE WILL ACCEPT, so a peer can be refused at the door rather than after the
 * bytes have crossed a border. `live` is always listed when a live world exists; a non-live world appears only
 * where a pairing has been declared, because a population code is a LOCAL name (§7.1).
 */
async function manifest() {
  const k = keys.status();
  let me = null, pops = [];
  try {
    /**
     * ⚠️ WHO I AM IS CONFIGURATION, NOT A FLAG ABOUT OTHERS. This filtered on `hosted_locally = true` and so
     * could answer for a different installation than INSTALLATION_KEY names — `hosted_locally` records whether
     * an installation's rows live in THIS database, which is a statement each deployment makes about its peers.
     * My own identity comes from my own configuration, and the row only decorates it.
     */
    const r = await query(
      `SELECT installation_key, label, region, domain, ctp_endpoint
         FROM installation WHERE active
         ORDER BY (installation_key = $1) DESC, hosted_locally DESC, installation_key LIMIT 1`,
      [process.env.INSTALLATION_KEY || 'platform-0']);
    me = r.rows[0] || null;
  } catch (_) { me = null; }
  try {
    /* ⚠️ only `live` by default. Publishing every sandbox code would tell the world what we are testing and
       invite a stranger to guess a pairing. */
    const p = await query(`SELECT code FROM ops.population WHERE is_live`);
    pops = p.rows.map((x) => x.code);
  } catch (_) { pops = []; }

  return {
    ctp: '1',
    installation_key: me ? me.installation_key : (process.env.INSTALLATION_KEY || 'platform-0'),
    label: me ? me.label : null,
    region: me ? me.region : null,
    endpoint: (me && me.ctp_endpoint) || null,
    accepts_populations: pops,
    public_key: k.public_key,
    /* ⚠️ said out loud. An installation that cannot sign is one whose envelopes nobody should accept, and a
       peer deserves to learn that from the manifest rather than from a failed delivery. */
    can_sign: k.can_sign,
    note: k.can_sign ? undefined : k.why,
  };
}

router.get('/.well-known/ctp.json', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=900');
    res.json(await manifest());
  } catch (e) {
    console.error('ctp manifest:', e.message);
    res.status(500).json({ error: 'manifest unavailable' });
  }
});

/* ── ② THE RECEIVING DOOR ───────────────────────────────────────────────────────────────────────────────────── */
router.post('/deliver', ctpLimiter, async (req, res) => {
  const env = req.body;
  const no = (code, why, extra) => res.status(code).json(Object.assign({ accepted: false, why }, extra || {}));

  try {
    if (!env || env.ctp !== '1') return no(400, 'not a CTP/1 envelope');

    /**
     * ── ⚠️⚠️ THE BOUNDARY IS ABOUT THE TWO PARTIES, NOT ABOUT THIS INSTALLATION ─────────────────────────────
     *
     * This asked `SELECT code FROM ops.population WHERE is_live` and treated the answer as "the world this
     * installation is". There is no such thing: b254/b255 settled that ONE POPULATION SPANS MANY INSTALLATIONS
     * (live already spans India and Mexico) and one installation hosts many worlds. Built on that idea the door
     * refused everything that was not live — which the loopback proof discovered by being refused.
     *
     * ⭐ The right question is the one b247 asks when both rows are in one database: do the SENDER and the
     * RECIPIENT share a world? So the recipient is resolved first, and their population is the subject.
     */
    const toBridge0 = String((env.to || {}).bridge_id || '');
    if (!toBridge0) return no(400, 'the envelope does not name a recipient');

    /* ── who is this claiming to be, and do we know them? */
    const ik = String((env.from || {}).installation_key || '');
    if (!ik) return no(400, 'the envelope does not say which installation sent it');
    let peer = null;
    try {
      const r = await query(
        `SELECT installation_key, domain, hosted_locally, active FROM installation WHERE installation_key = $1`,
        [ik]);
      peer = r.rows[0] || null;
    } catch (_) { peer = null; }
    /**
     * ⚠️⚠️ "IS HE A MEMBER OF ME" — Athi's phrase, and this is the line that answers it. Discovery is open;
     * DELIVERY IS NOT. A stranger can read our manifest and still be refused here, because being findable and
     * being dealt with are different things.
     */
    if (!peer || !peer.active) return no(403, 'installation ' + ik + ' is not one we deal with');
    if (peer.hosted_locally) {
      return no(409, 'installation ' + ik + ' is hosted here — a local copy must not arrive over the wire');
    }
    if (!peer.domain) return no(403, 'no domain recorded for ' + ik + ', so its key cannot be found');

    /* ── the signature, against the key on THEIR domain. Never one they sent us. */
    const pk = await directory.publicKeyFor(peer.domain, ik);
    if (!pk.ok) return no(403, 'could not read the sender’s manifest: ' + pk.why);

    /* ── is the recipient here, and which world are they in? */
    const toBridge = toBridge0;
    const r = await query(
      `SELECT identity_id, coalesce(population,'live') AS population FROM identities
        WHERE bridge_id = $1 AND identity_type = 'entity' AND coalesce(status,'active') = 'active'`,
      [toBridge]);
    const to = r.rows[0];
    if (!to) return no(404, 'no active business here with bridge id ' + toBridge);

    /**
     * ⚠️⚠️ AND THE PAIRING — §7.1. `live` is a universally shared meaning, so live↔live passes on the name
     * alone. Every other code is LOCAL: `test` here and `test` on a customer's engine are two unrelated sealed
     * worlds sharing a word, and matching on the string would wire a stranger's sandbox to ours. So a non-live
     * world must NAME the installations it accepts (b258, ops.population.ctp_peers) — default-deny.
     */
    let mayCross = false;
    try {
      const m = await query('SELECT ops.f_ctp_may_deliver($1, $2) AS ok', [to.population, ik]);
      mayCross = m.rows[0] && m.rows[0].ok === true;
    } catch (e) {
      /* ⚠️ b258 not run → REFUSE. This is the one place in the product where "fail open" would be wrong: an
         unreadable rule about a boundary must never resolve to "allowed". [[feedback-silence-is-the-bug]] */
      return no(503, 'this installation cannot check whether that crossing is permitted — refusing');
    }
    if (!mayCross) {
      return no(409, to.population === 'live'
        ? 'refused'
        : '“' + to.population + '” is a local name on both sides — it must name ' + ik + ' as a peer first');
    }

    const opened = envelope.open(env, {
      /* ⭐ the RECIPIENT's world is the subject, and the pairing question has already been answered above by
         the database, so `pairedWith` simply reports it rather than deciding it a second time. */
      population: to.population,
      pairedWith: () => mayCross,
      verify: (hash, sig) => keys.verifyWith(pk.public_key, hash, sig),
    });
    if (!opened.ok) return no(409, opened.why);

    /**
     * ── ⚠️ THE COPY IS WRITTEN AS THE RECIPIENT'S, WITH THE ENTITY WE RESOLVED — never the entity_id the
     * envelope carried. A sender naming somebody else's entity_id is the one way this door could write into a
     * third party's books, and the envelope's `to` is a BRIDGE ID precisely so that the id is ours to resolve.
     */
    const copy = Object.assign({}, opened.copy, { entity_id: to.identity_id });

    /**
     * ⚠️⚠️ `arrived: true`, AND IT IS LOAD-BEARING. Without it this call re-resolves the recipient's address,
     * finds the installation marked remote, builds a fresh envelope and posts it back to this very endpoint —
     * a loop that ran six times in under a second before the transport timed out. ARRIVAL IS NOT A ROUTING
     * DECISION: an accepted envelope is written here or refused here, and CTP does not forward.
     *
     * ⚠️ Idempotent by chit_id: a retried envelope must not duplicate. chit_deliver is upsert-shaped per copy
     * and the natural key is (chit_id, entity_id, direction).
     */
    /**
     * ── ⚠️⚠️ THE CONTEXT IS THE *SENDER*, AND THAT IS THE WHOLE TRUST SHIFT ─────────────────────────────────
     *
     * `chit_deliver` refuses any copy whose `sender_entity_id` differs from the calling tenant — *"a tenant can
     * only deliver chits it sends"*. Right for local delivery, and exactly wrong here: a receiving installation
     * legitimately writes a copy of a chit it did NOT send. Calling as the recipient earned:
     *
     *     P0001 chit_deliver: copy sender <a> <> caller <b> (a tenant can only deliver chits it sends)
     *
     * ⭐ LOCALLY, PROVENANCE IS PROVED BY TENANCY. ACROSS A WIRE IT IS PROVED BY SIGNATURE — verified three
     * steps above, against a key fetched from the sender's own domain. So the context is set to the sender the
     * envelope names, because by then we have cryptographic grounds to say it is them.
     *
     * ⚠️ AND IT IS SAFE ONLY BECAUSE OF WHAT CAME BEFORE IT: the recipient was re-resolved from a BRIDGE ID and
     * `copy.entity_id` overwritten with our own answer, so a peer cannot name a third party's entity id and have
     * a row written into their books. The sender id it supplies is attributable to a signature; the recipient id
     * is never theirs to choose. `chit_header.sender_entity_id` has no foreign key precisely so that a
     * counterparty on another machine can be named without existing here.
     */
    const senderCtx = copy.sender_entity_id || (opened.header && opened.header.sender_entity_id);
    if (!senderCtx) return no(400, 'the copy does not say who sent it');
    await mint.deliver(senderCtx, opened.chit_id, [copy], { is_draft: false, arrived: true });

    res.json({ accepted: true, chit_id: opened.chit_id, to: toBridge });
  } catch (e) {
    /* ⚠️ a 500 tells a sender to retry something that may never work — so it is reserved for OUR faults, and it
       says which. */
    console.error('ctp deliver:', e.code || '', e.message);
    res.status(500).json({ accepted: false, why: 'this installation failed to store it', code: e.code || null });
  }
});

module.exports = router;
module.exports.manifest = manifest;
