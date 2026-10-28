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
 *
 * ── THE ANSWERS (API-1 slice 1d) ── every refusal is a Problem (lib/problem.js) that keeps the keys a peer reads — `accepted`
 * and `why` (deliver), `ok` and `why` (query) — word for word (docs/contracts/api-legacy.json). The contract and those old
 * bodies live in lib/ctp-contract.js; tests/api-problem-ctp.test.cjs replays every answer on both mounts.
 *
 * FLOW  envelope ──▶ schema ──▶ peer we deal with ──▶ key on its domain ──▶ recipient here ──▶ crossing rule ──▶ open ──▶ mint.deliver
 * CARD  05-ctp-and-cross-installation/deliver-query-across-domains
 */

const express = require('express');
const log = require('../lib/logger');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { query } = require('../db');
const envelope = require('../lib/ctpenvelope');
const keys = require('../lib/ctpkeys');
const directory = require('../lib/ctpdirectory');
const addressBook = require('../lib/ctpaddress'); /* peerByKey — the ONE "do we deal with this installation?" */
const mint = require('../lib/mint');
const { problem } = require('../lib/problem');
const { safeErr } = require('../lib/respond');
const { schemaValidate } = require('../middleware/validate'); // S9: the body is checked against the door's own schema
/* the contract (each door's OpenAPI operation) and the answers these doors gave before the standard — lib/ctp-contract.js */
const contract = require('../lib/ctp-contract');
const { MANIFEST_OPERATION, DELIVER_OPERATION, QUERY_OPERATION, ENVELOPE_REFUSAL, QUERY_REFUSAL, MANIFEST_FAILED, STORE_FAILED, QUERY_FAILED } = contract;
/** refusalTo(req, res, flag) → refuse({ status, code, why }): a Problem that keeps the keys a peer reads — `<flag>: false` and `why`, word for word */
const refusalTo = (req, res, flag) => ({ why, ...spec }) => problem(req, res, Object.assign(spec, { detail: why, legacy: { [flag]: false, why } }));

/* ⚠️ its own limiter. This door is open to the internet and is not covered by the session limiters. */
const ctpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many envelopes', message: 'Slow down and retry.' }
});

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
  let me = null,
    pops = [];
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
      [process.env.INSTALLATION_KEY || 'platform-0']
    );
    me = r.rows[0] || null;
  } catch (e) {
    log.fellBack('ctp manifest: the read failed — answered with nothing', e);
    me = null;
  }
  try {
    /* ⚠️ only `live` by default. Publishing every sandbox code would tell the world what we are testing and
       invite a stranger to guess a pairing. */
    const p = await query(`SELECT code FROM ops.population WHERE is_live`);
    pops = p.rows.map((x) => x.code);
  } catch (e) {
    log.fellBack('ctp manifest: the read failed — answered with none', e);
    pops = [];
  }

  return {
    ctp: '1',
    installation_key: me ? me.installation_key : process.env.INSTALLATION_KEY || 'platform-0',
    label: me ? me.label : null,
    region: me ? me.region : null,
    endpoint: (me && me.ctp_endpoint) || null,
    accepts_populations: pops,
    public_key: k.public_key,
    /* ⚠️ said out loud. An installation that cannot sign is one whose envelopes nobody should accept, and a
       peer deserves to learn that from the manifest rather than from a failed delivery. */
    can_sign: k.can_sign,
    note: k.can_sign ? undefined : k.why
  };
}

router.get('/.well-known/ctp.json', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=900');
    res.json(await manifest());
  } catch (e) {
    safeErr(e, { id: req.id, path: req.path });
    res.set('Cache-Control', 'no-store'); /* a peer must not keep a failure for 15 minutes */
    return problem(req, res, { status: 500, code: 'CTP_MANIFEST_UNAVAILABLE', detail: MANIFEST_FAILED.error, legacy: MANIFEST_FAILED });
  }
});

/**
 * RAIL-138 (b) — WHOSE SENDER IS THIS? The door runs the write as the sender the envelope names (the trust shift below), so the
 * name must be one the signing installation may use. A sender with a row HERE must be stamped to that installation
 * (ops.f_installation_of, the same definer ctpaddress.resolve asks); a business of THIS installation, or of a third one, is
 * refused, or a signed peer could write a chit into our books as one of our own shops. A sender with no row here is a party
 * of theirs, named without existing here (chit_header.sender_entity_id has no foreign key for exactly that). An unreadable
 * answer refuses: a boundary rule that cannot be read never resolves to allowed. → { id } when it may, else { refusal }.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function senderOf(opened, copy, installationKey) {
  const id = copy.sender_entity_id || (opened.header && opened.header.sender_entity_id);
  const refusal = await senderRefusal(id, installationKey);
  return refusal ? { refusal } : { id };
}
async function senderRefusal(senderId, installationKey) {
  if (!senderId) return { status: 400, code: 'CTP_NO_SENDER', why: 'the copy does not say who sent it' };
  if (!UUID_RE.test(String(senderId))) return { status: 400, code: 'CTP_SENDER_NOT_AN_ID', why: 'the copy names its sender by something that is not an id' };
  try {
    const here = await query('SELECT 1 FROM identities WHERE identity_id = $1', [senderId]);
    if (!here.rows.length) return null;
    const home = await query('SELECT ops.f_installation_of($1) AS installation_key', [senderId]);
    if (home.rows[0] && home.rows[0].installation_key === installationKey) return null;
  } catch (e) {
    log.fellBack('ctp POST /deliver: the sender check could not be read — refused', e);
    return { status: 503, code: 'CTP_SENDER_UNCHECKABLE', why: 'this installation cannot check whose business the sender is — refusing' };
  }
  return { status: 403, code: 'CTP_SENDER_NOT_THEIRS', why: 'the sender named is not a business of the installation that signed this envelope' };
}

/* ── ② THE RECEIVING DOOR ───────────────────────────────────────────────────────────────────────────────────── */
router.post('/deliver', ctpLimiter, schemaValidate(DELIVER_OPERATION, ENVELOPE_REFUSAL), async (req, res) => {
  const env = req.body; /* a CTP/1 envelope: the schema refused anything else, in the old words */
  const refuse = refusalTo(req, res, 'accepted');

  try {

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
    if (!toBridge0) return refuse({ status: 400, code: 'CTP_NO_RECIPIENT', why: 'the envelope does not name a recipient' });

    /* ── who is this claiming to be, and do we know them? */
    const ik = String((env.from || {}).installation_key || '');
    if (!ik) return refuse({ status: 400, code: 'CTP_NO_INSTALLATION', why: 'the envelope does not say which installation sent it' });
    /**
     * ⚠️⚠️ "IS HE A MEMBER OF ME" — Athi's phrase, and lib/ctpaddress peerByKey is the line that answers it, for both
     * doors (T2-SPLIT lifted the copy /query carried). Discovery is open; DELIVERY IS NOT.
     */
    const member = await addressBook.peerByKey(ik, 'a local copy must not arrive over the wire');
    if (!member.peer && member.status === 409) return refuse({ status: 409, code: 'CTP_PEER_HOSTED_HERE', why: member.why });
    if (!member.peer) return refuse({ status: 403, code: 'CTP_PEER_REFUSED', why: member.why });
    const peer = member.peer;

    /**
     * ── ⭐⭐ THE SENDER'S GOVERNANCE, RESOLVED FROM ITS INSTALLATION — an annotation, never a gate ──────────────
     *
     * Athi, 2026-09-16: *"verify the constitution matrix… bring it to the same place, so it works for CTP."*
     *
     * The peer row we just read carries `vertical_key`, and that is the whole rule (b254's stamp trigger):
     * installation → vertical → constitution. So the sender's constitution, region and currency are resolvable
     * HERE, from `from.installation_key`, with no entity row for them in this database. Before this the only
     * resolver was entity-keyed and would have answered `base @ platform-0` for any foreign party — silently.
     *
     * ⚠️ IT DOES NOT DECIDE WHETHER TO ACCEPT. Which constitution governs a cross-border chit is CTP-DESIGN §9's
     * open decision, not this file's; the answer rides back on the response so the fact is visible while the
     * decision is still Athi's. A resolver that cannot read the row says `fallback: true` rather than nothing.
     */
    let senderGov = null;
    try {
      senderGov = await require('../lib/govresolve').resolveInstallationGovernance(ik);
    } catch (e) {
      log.fellBack('ctp POST /deliver: the helper failed — answered with nothing', e);
      senderGov = null;
    }

    /* ── the signature, against the key on THEIR domain. Never one they sent us. */
    const pk = await directory.publicKeyFor(peer.domain, ik);
    if (!pk.ok) return refuse({ status: 403, code: 'CTP_PEER_KEY_UNREADABLE', why: 'could not read the sender’s manifest: ' + pk.why });

    /* ── is the recipient here, and which world are they in? */
    const toBridge = toBridge0;
    const r = await query(
      `SELECT identity_id, coalesce(population,'live') AS population FROM identities
        WHERE bridge_id = $1 AND identity_type = 'entity' AND coalesce(status,'active') = 'active'`,
      [toBridge]
    );
    const to = r.rows[0];
    if (!to) return refuse({ status: 404, code: 'CTP_RECIPIENT_NOT_HERE', why: 'no active business here with bridge id ' + toBridge });

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
      return refuse({ status: 503, code: 'CTP_CROSSING_UNCHECKABLE', why: 'this installation cannot check whether that crossing is permitted — refusing' });
    }
    if (!mayCross) {
      return refuse({ status: 409, code: 'CTP_CROSSING_REFUSED', why: contract.crossingRefused(to.population, ik) });
    }

    const opened = envelope.open(env, {
      /* ⭐ the RECIPIENT's world is the subject, and the pairing question has already been answered above by
         the database, so `pairedWith` simply reports it rather than deciding it a second time. */
      population: to.population,
      pairedWith: () => mayCross,
      verify: (hash, sig) => keys.verifyWith(pk.public_key, hash, sig)
    });
    if (!opened.ok) return refuse({ status: 409, code: 'CTP_ENVELOPE_REFUSED', why: opened.why });

    /**
     * ── ⚠️ THE COPY IS WRITTEN AS THE RECIPIENT'S, WITH THE ENTITY WE RESOLVED — never the entity_id the
     * envelope carried. A sender naming somebody else's entity_id is the one way this door could write into a
     * third party's books, and the envelope's `to` is a BRIDGE ID precisely so that the id is ours to resolve.
     */
    /**
     * ── ⭐⭐ THE INDICATOR: THIS COPY ARRIVED FROM ANOTHER INSTALLATION ────────────────────────────────────────
     *
     * Athi, 2026-09-16: *"put some indicator so we know the difference."* And the deeper question with it —
     * *"how does the chit know this request is from another domain? does it need to know?"*
     *
     * ⭐ IT DOES NOT NEED TO, AND THAT IS THE ELEGANCE. Past this door, mint.deliver writes a cross-installation
     * copy byte-for-byte the way it writes a local one — the sender is named by bridge_id, true whether they are
     * next door or across the world. The chit machinery is domain-blind on purpose; if it had to branch on
     * origin, every downstream reader would too.
     *
     * ⚠️ BUT A PERSON WANTS TO KNOW, so the fact is RECORDED, not acted on. `ctp_arrival` is stamped into the
     * recipient copy's business_json (jsonb, already carried): which installation, its domain, when. A screen can
     * show "arrived from mx.chitandbridge.com"; nothing in the delivery path reads it or behaves differently.
     * A marker, not a switch.
     */
    const arrivalStamp = {
      via_ctp: true,
      from_installation: ik,
      from_domain: peer.domain,
      sender_bridge_id: (env.from && env.from.bridge_id) || null,
      at: new Date().toISOString()
    };
    const copy = Object.assign({}, opened.copy, {
      entity_id: to.identity_id,
      business_json: Object.assign({}, opened.copy.business_json || {}, { ctp_arrival: arrivalStamp })
    });

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
    const sender = await senderOf(opened, copy, ik); /* named, an id, and one the signing installation may name (RAIL-138 b) */
    if (sender.refusal) return refuse(sender.refusal);
    await mint.deliver(sender.id, opened.chit_id, [copy], { is_draft: false, arrived: true });

    res.json({
      accepted: true,
      chit_id: opened.chit_id,
      to: toBridge,
      /* ⭐ the sender's governance as WE resolved it from their installation — visible, and never the reason a
         copy was accepted or refused (see the note beside senderGov above, and CTP-DESIGN §6.1) */
      sender_governance: senderGov
        ? {
            constitution: senderGov.constitution,
            region: senderGov.basics && senderGov.basics.region,
            currency: senderGov.basics && senderGov.basics.currency,
            resolved_from: senderGov.resolved_from,
            fallback: senderGov.fallback
          }
        : null
    });
  } catch (e) {
    /* ⚠️ a 500 tells a sender to retry something that may never work — so it is reserved for OUR faults, and it
       says which side failed, never why (before slice 1d `code` carried the database's own error code to the peer). */
    safeErr(e, { id: req.id, path: req.path });
    return problem(req, res, { status: 500, code: 'CTP_STORE_FAILED', detail: STORE_FAILED.why, legacy: STORE_FAILED });
  }
});

/* ── ④ A QUESTION FROM A PEER — the READ verb ───────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-16: *"catalogue pull I guess. currently, within the platform, we are just pulling the catalogue
 * based on the store id, the store is not pushing the catalogue; the same resolves in cross platform also."*
 *
 *   POST /api/ctp/query   { ctp:'1', kind:'query', from, to, ask:{ want:'resolve'|'catalogue', … }, nonce, at, sealed }
 *
 * ⚠️ THE SAME DOOR-KEEPING AS deliver, IN THE SAME ORDER: is the asker an installation we deal with (b257 row,
 * remote, active, with a domain) → verify the signature against the key on THEIR domain → then, and only then,
 * answer. ⚠️ The population rule is NOT applied to a read: b247 bounds who may TRANSACT, and a public catalogue
 * is public to the whole web already. What pairing buys is that a stranger installation gets nothing.
 *
 * ⭐ AND THE ANSWER IS THE SAME FUNCTION AN ANONYMOUS VISITOR GETS. `publicViewFor(entity, false)` from
 * routes/catalogue.js — one view, two doors — so a cross-installation pull can never show more than
 * /shop.html?s=<store> would. `resolve` answers only for a BUSINESS (entity or network store): an employee, a
 * customer or a minted party is refused by name, because none of them is a thing another installation may address.
 */
router.post('/query', ctpLimiter, schemaValidate(QUERY_OPERATION, QUERY_REFUSAL), async (req, res) => {
  const refuse = refusalTo(req, res, 'ok');
  try {
    const q = req.body; /* a CTP/1 query: the schema refused anything else, in the old words */
    const ctpquery = require('../lib/ctpquery');

    const ik = String((q.from || {}).installation_key || '');
    if (!ik) return refuse({ status: 400, code: 'CTP_NO_INSTALLATION', why: 'the question does not say which installation is asking' });
    /* the same door-keeping as deliver — the ONE peer lookup (lib/ctpaddress peerByKey) */
    const member = await addressBook.peerByKey(ik, 'ask locally');
    if (!member.peer && member.status === 409) return refuse({ status: 409, code: 'CTP_PEER_HOSTED_HERE', why: member.why });
    if (!member.peer) return refuse({ status: 403, code: 'CTP_PEER_REFUSED', why: member.why });
    const peer = member.peer;

    const pk = await directory.publicKeyFor(peer.domain, ik);
    if (!pk.ok) return refuse({ status: 403, code: 'CTP_PEER_KEY_UNREADABLE', why: 'could not read the asker’s manifest: ' + pk.why });
    const opened = ctpquery.open(q, {
      verify: (hash, sig, who) => who === ik && keys.verifyWith(pk.public_key, hash, sig)
    });
    if (!opened.ok) return refuse({ status: 403, code: 'CTP_QUERY_REFUSED', why: opened.why });

    const ask = opened.ask;
    const cat = require('./catalogue');

    if (ask.want === 'resolve') {
      /* ⭐ the grammar decides what MAY be resolved before the database is asked anything */
      const c = require('../lib/resolveuserid').classify(ask.handle);
      if (c.kind !== 'entity' && c.kind !== 'network_node' && c.kind !== 'bridge_id') {
        return res.json({ ok: true, found: false, why: '"' + ask.handle + '" is not a business — only a business can be addressed across installations' });
      }
      const ent = await cat.resolveEntity(c.kind === 'bridge_id' ? c.bridge_id : c.handle);
      if (!ent) return res.json({ ok: true, found: false, why: 'no business here called ' + ask.handle });
      const me = await manifest();
      /* ⚠️ the address is BUILT by lib/ctpaddress, never spelled here — tests/namespace fails any second "@" join */
      return res.json({
        ok: true,
        found: true,
        bridge_id: ent.bridge_id,
        display_name: ent.display_name,
        user_id: ent.user_id,
        address: require('../lib/ctpaddress').format(ent.bridge_id, me.domain),
        installation_key: me.installation_key
      });
    }

    if (ask.want === 'catalogue') {
      const ent = await cat.resolveEntity(ask.bridge_id);
      if (!ent) return res.json({ ok: true, found: false, why: 'no business here with bridge id ' + ask.bridge_id });
      /* ⚠️ neither asOwner nor viewer — a peer installation is never the owner and is not a signed-in customer.
         The RAW view, then the SAME trim a storefront visitor gets: one view, one response, two doors. */
      const view = await cat.publicViewFor(ent, {});
      if (!view || !view.available) return res.json({ ok: true, found: false, why: ent.display_name + ' has no public catalogue' });
      return res.json(Object.assign({ ok: true, found: true, bridge_id: ent.bridge_id }, cat.publicResponseFor(view, false)));
    }
    return refuse({ status: 400, code: 'CTP_UNKNOWN_QUESTION', why: 'not a question this installation answers' });
  } catch (e) {
    safeErr(e, { id: req.id, path: req.path }); /* fail closed: which side failed, never why (QUERY_FAILED) */
    return problem(req, res, { status: 500, code: 'CTP_QUERY_FAILED', detail: QUERY_FAILED.why, legacy: QUERY_FAILED });
  }
});

/* the contract, one operation per door on each of its two mounts (server.js: '/' for the manifest, '/api/ctp' for the doors) */
router.openapi = {
  paths: {
    '/.well-known/ctp.json': { get: MANIFEST_OPERATION },
    '/api/ctp/.well-known/ctp.json': { get: MANIFEST_OPERATION },
    '/deliver': { post: DELIVER_OPERATION },
    '/api/ctp/deliver': { post: DELIVER_OPERATION },
    '/query': { post: QUERY_OPERATION },
    '/api/ctp/query': { post: QUERY_OPERATION }
  }
};

module.exports = router;
module.exports.manifest = manifest;
