'use strict';
// lib/mint.js — the SHAPE of a chit, in one place. Four call sites built it independently.
// OWNS      the shape of a chit (header, copies) and deliver(): address every copy, send the remote ones, then ONE chit_deliver
//           (addressing across installations: card 05-ctp-and-cross-installation/where-an-installation-runs)
// FLOW      caller → summary · header · lines · party (the shape) → deliver(): ctpaddress.resolveAll → [ctptransport.send] remote first, all or a refusal → chit_deliver (local) → autoFile
// CARD      01-rail-core-the-chit/send-mint-a-chit
// CALLED BY lib/raiseticket.js, routes/catalogue.js, routes/chits.js, routes/connectors.js, routes/ctp.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
//
// ── ⚠️ WHAT THIS IS, AND DELIBERATELY IS NOT ────────────────────────────────────────────────────────────────────
// It is NOT a `mintChit()` that owns sending. Four paths mint chits and their POLICY is genuinely different:
//   · /api/chits/send   — recipient resolution, caps, trace edges, copy_policy, retention, freeze-at-send, drafts
//   · emitSignalChit    — no line items, Task-only by nature, auto-files into a folder afterwards
//   · deliverEdge       — a co-held 2-party network edge, currency resolved by the governance layer
//   · storefront order  — consumes the customer's OTP and stores documents in the SAME transaction
// A single function serving all four would need a dozen flags, and a helper with a dozen flags is worse than four
// copies: it hides the differences instead of removing them.
//
// What IS identical in all four is the SHAPE — the summary skeleton, the header key-set, what a copy is, and the
// delivery call. That is what lives here. Each path keeps its own policy and composes these.
//
// ── ⚠️ WHY IT MATTERS MORE THAN TIDINESS ────────────────────────────────────────────────────────────────────────
// Duplication in this codebase has twice absorbed a security fix (lib/otp.js, lib/bridgeid.js): a reviewer found a
// real flaw, the fix was correct, and it reached one call site of several. The same risk lives here in a worse
// place — a key added to summary_json in one path and not the others means two copies of ONE chit disagree about
// what that chit is, which is exactly the dispute the rail exists to prevent.
const { withEntity } = require('../db');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

/**
 * summary(fields) — the summary_json skeleton every path starts from.
 *
 * ⚠️ THE DEFAULTS ARE THE CONTRACT. Every path wrote these seven keys by hand with the same values; one omission
 * and a chit's summary silently lacks a field that readers (lists, sorting, kyb's trade-value sum) expect.
 * `total_value: null` means NOT APPLICABLE and is not the same as 0 — deliverEdge carried a hard-coded 0 for
 * network orders that had real line items, which made them read as worth nothing.
 */
function summary(f = {}) {
  const s = {
    line_item_count: f.line_item_count || 0,
    total_value: f.total_value === undefined ? 0 : f.total_value,
    currency_code: f.currency_code || null /* T2-NATDEF: the sender's stated money (routes/chits reads it), never INR by name */,
    priority_external: f.priority_external || 'normal',
    purpose: f.purpose || 'order',
    is_promotion: !!f.is_promotion,
    /* the offers applied at send — line and cart scope — the record beside the lines (lib/offers-live, 2026-09-06) */
    ...(Array.isArray(f.offers) && f.offers.length ? { offers: f.offers } : {}),
    forwarded_from: f.forwarded_from === undefined ? null : f.forwarded_from
  };
  // Riders — present ONLY when declared, exactly as each path already does it (copy_policy, trace, retention,
  // governed, clearances, commercial, via). Spreading an absent rider would add `key: undefined`, which JSON.stringify
  // drops silently on the way in and readers then cannot tell "absent" from "null".
  /**
   * ⚠️⚠️ THE LIST IS THE GATE, AND IT DROPS IN SILENCE. `detail_design` was passed in from the send path and
   * never appeared in a single chit, because a rider not named here is discarded without a word — which is
   * exactly what this whitelist is for, and exactly why forgetting it costs a debugging session. Anything new
   * that must survive into summary_json is added HERE, not spread in by the caller.
   */
  for (const k of [
    'copy_policy',
    'trace',
    'retention',
    'governed',
    'clearances',
    'commercial',
    'via',
    'detail_design',
    'money',
    /* ⚠️ 2026-09-14 — and it happened AGAIN, to the paragraph above. lib/raiseticket stamps `routed_by` (which
       desk answered, which population, which rung decided it, and why) so a ticket can explain itself after the
       routing table has moved on. It was passed, it was never stored, and nothing said so. See the guard in
       tests/mint-riders.test.cjs, which now fails the build instead of leaving this to be noticed. */
    'routed_by',
    /* RAIL-LAB-SRV1 (2026-10-14): `lab: true` — a chit the sender DECLARED a lab chit (business_json.lab, the is_promotion path);
       present only on a lab chit, so every co-held copy says what it is and no list can mistake it for trade. */
    'lab'
  ]) {
    if (f[k] !== undefined && f[k] !== null) s[k] = f[k];
  }
  return s;
}

/**
 * header(x) — the key-set shared by every copy of one chit.
 *
 * ⚠️ EVERY COPY OF A CHIT MUST CARRY THE SAME HEADER. That is the co-held record: two parties holding rows that
 * disagree on sender, subject, total or currency is not a chit, it is two documents. Building it once per chit and
 * spreading it into each copy is what makes that structural rather than a thing to remember.
 */
function header(x) {
  return {
    sender_entity_id: x.sender_entity_id,
    sender_entity_bridge_id: x.sender_entity_bridge_id,
    sender_entity_display_name: x.sender_entity_display_name,
    all_recipients: x.all_recipients,
    purpose: x.purpose,
    auto_subject: x.auto_subject,
    manual_subject: x.manual_subject === undefined ? null : x.manual_subject,
    summary_json: x.summary_json,
    schema_version: x.schema_version === undefined ? null : x.schema_version,
    schema_id: x.schema_id === undefined ? null : x.schema_id,
    created_by_actor_id: x.created_by_actor_id === undefined ? null : x.created_by_actor_id,
    detail_type: x.detail_type === undefined ? x.purpose : x.detail_type,
    line_item_count: x.line_item_count === undefined ? (x.summary_json && x.summary_json.line_item_count) || 0 : x.line_item_count,
    total_value: x.total_value === undefined ? x.summary_json && x.summary_json.total_value : x.total_value,
    currency_code: x.currency_code === undefined ? (x.summary_json && x.summary_json.currency_code) || null : x.currency_code,
    /* ⭐ Y1b: the moment the copy is stamped with — the SHOP CLOCK's (routes/chits.js `now`), carried to chit_deliver, which
       honours it once migrations/b300 has run and stamps NOW() as before until then. Absent → the function's own NOW(). */
    ...(x.created_at ? { sent_at: isoOf(x.sent_at || x.created_at), created_at: isoOf(x.created_at) } : {})
  };
}
const isoOf = (date) => (date instanceof Date ? date.toISOString() : String(date));

/**
 * ⭐ lines(items) — stamp every line with a STABLE IDENTITY and an EXPLICIT ORDER.
 *
 * Athi, 2026-08-12: *"the problem i faced earlier was, the one you selected comes as the last record in the line
 * item."*
 *
 * ── ⚠️ WHY A LINE NEEDED AN ID ──────────────────────────────────────────────────────────────────────────────────
 * `chit_detail.line_items` is ONE jsonb array per copy, so until now a line's only identity was its ARRAY INDEX.
 * b138 amendments key on that index. Insert or reorder a single line and every amendment silently re-points at a
 * different item — a corrected quantity would attach itself to somebody else's product, and the chit would look
 * perfectly normal. Nothing would ever flag it.
 *
 * ── ⚠️ AND WHY IT NEEDED A seq ──────────────────────────────────────────────────────────────────────────────────
 * "The one you selected comes last" is what array order looks like when nothing declares the order. Position was
 * implicit — whatever order the array happened to be built in, through a map, a filter, a merge. `seq` makes it a
 * stated fact, so a renderer sorts rather than trusts.
 *
 * GAPPED BY 10 (10, 20, 30…) so a line can later be inserted BETWEEN two others without renumbering the rest.
 * Renumbering would be safe for amendments now — they key on line_id, not position — but it would still churn
 * every row for one insertion.
 *
 * ⚠️ IDEMPOTENT. A line that already carries a line_id keeps it. Re-stamping on a forward, a draft resume or a
 * fork would mint new ids for the same lines and orphan every amendment pointing at the old ones.
 */
function lines(items) {
  if (!Array.isArray(items)) return items;
  return items.map((li, index) =>
    Object.assign({}, li, {
      line_id: li.line_id || uuidv4(),
      seq: Number.isFinite(Number(li.seq)) ? Number(li.seq) : (index + 1) * 10
    })
  );
}

/**
 * order(items) — read them back in the order they were stated.
 * ⚠️ line_id IS THE TIEBREAK, and it is not decoration: two lines sharing a seq would otherwise come back in
 * whatever order the array or the driver felt like, which is the same non-determinism in a new coat.
 */
function order(items) {
  if (!Array.isArray(items)) return items;
  return items.slice().sort((first, second) => {
    const d = (Number(first && first.seq) || 0) - (Number(second && second.seq) || 0);
    return d !== 0 ? d : String((first && first.line_id) || '').localeCompare(String((second && second.line_id) || ''));
  });
}

/**
 * party(hdr, p) — one entity's copy of the chit.
 *
 * `direction` ('sent' | 'received') and `role` ('Act' | 'Info' | 'For') are what make the two rows different; the
 * header is what makes them the same chit. Extra per-copy keys (line_items, business_json, payload_delivered) are
 * passed through untouched, because they legitimately differ per path.
 */
function party(hdr, p) {
  const c = Object.assign({}, hdr, {
    entity_id: p.entity_id,
    direction: p.direction,
    role: p.role || 'Act',
    current_status: p.current_status,
    priority_flag: p.priority_flag || 'normal'
  });
  if (p.business_json !== undefined) c.business_json = p.business_json;
  if (p.line_items !== undefined) c.line_items = p.line_items;
  if (p.payload_delivered !== undefined) c.payload_delivered = p.payload_delivered;
  if (p.log !== undefined) c.log = p.log;
  for (const k of Object.keys(p)) {
    if (['entity_id', 'direction', 'role', 'current_status', 'priority_flag', 'business_json', 'line_items', 'payload_delivered', 'log'].indexOf(k) < 0)
      c[k] = p[k];
  }
  return c;
}

/**
 * deliver(sender_entity_id, chit_id, copies, opts) — the ONE delivery call.
 *
 * ⚠️ `opts.client` EXISTS BECAUSE ONE PATH GENUINELY NEEDS IT. The storefront order consumes the customer's OTP and
 * stores their documents in the SAME transaction as the chit — writing the documents afterwards forced a choice
 * between "200 with documents_stored:false" (a chit asserting evidence nobody holds) and "500 on a submission that
 * already committed". Passing the open client keeps that atomic instead of forcing a second connection.
 *
 * ⚠️ AND IT RUNS AS THE SENDER. chit_deliver is a SECURITY DEFINER fn, and withEntity(sender) is its isolation gate:
 * every copy carries the same sender, and the sender is the caller. Running it as anyone else is how a cross-tenant
 * write would look.
 */
async function deliver(sender_entity_id, chit_id, copies, opts = {}) {
  /**
   * ── ⭐⭐⭐ THE ADDRESS SEAM — CTP step 2 (docs/CTP-DESIGN.md §11) ──────────────────────────────────────────────
   *
   * Every copy is addressed before it is written. Today every address answers `local` and the line below this
   * block is the same call it has always been — that is the point of doing it now rather than later:
   *
   *   ⭐ ONE deliver(), TWO TRANSPORTS, chosen by the ADDRESS — never an `if (remote)` sprinkled through the
   *     callers. The design note is explicit that the alternative is two delivery semantics that drift, and the
   *     drift is invisible until somebody lifts a world onto its own machine and everything quietly changes.
   *
   *   ⚠️ AND IT COSTS NOTHING WHILE NOTHING IS REMOTE. Athi asked directly — *"does it look for each
   *     transfer?"* — and lib/ctpaddress answers one memoised question ("is ANY installation hosted
   *     elsewhere?"). While that is no, every address is local by construction and not one per-entity query is
   *     issued. One Map lookup per delivery.
   *
   * ⚠️⚠️ A REMOTE ADDRESS IS REFUSED, NOT DROPPED. There is no transport yet. Writing the local copies and
   * saying nothing about the ones that could not be written would be a chit that half-exists and a sender told
   * it was delivered — the exact failure the support receipts were fixed for, at protocol scale.
   * [[feedback-silence-is-the-bug]]
   */
  /**
   * ⚠️⚠️ `opts.arrived` — A COPY THAT HAS ALREADY CROSSED IS LOCAL BY DEFINITION.
   *
   * Found by sending a real chit over a real socket, 2026-09-15: routes/ctp.js received an envelope, called
   * this, and the address resolver said the recipient was REMOTE — because on the sending side's view of the
   * world that installation is hosted elsewhere. So it built a new envelope and posted it to itself. Again. The
   * log shows six round trips in under a second before the transport timed out.
   *
   * ⭐ ARRIVAL IS NOT A ROUTING DECISION. An envelope that has been accepted is written here or refused here;
   * there is no third option, and CTP does not forward. The receiving door says so with this flag rather than
   * calling a lower-level write, so there is still exactly ONE delivery path — which is the whole reason the
   * address seam was put inside deliver() in the first place.
   */
  let addressed = null;
  if (!opts.arrived) {
    try {
      addressed = await require('./ctpaddress').resolveAll((copies || []).map((item) => item.entity_id));
    } catch (e) {
      logger.fellBack('mint: the helper failed — answered with nothing', e);
      addressed = null;
    } /* unreadable topology → behave exactly as before the seam existed */
  }

  const away = awayCopies(copies, addressed); /* RAIL-142 (a): an unresolved copy refuses the chit, before any write */
  const local = addressed ? (copies || []).filter((item) => !away.includes(item)) : copies; /* exactly as before the split */

  /**
   * ── ⚠️⚠️ THE REMOTE COPIES GO FIRST, AND ALL OF THEM, OR NOTHING IS WRITTEN ──────────────────────────────────
   *
   * Order is the whole of the correctness here. If the local copies were written first and a remote one then
   * failed, the chit would half-exist: the sender holding a copy that says delivered, the recipient holding
   * nothing, and no record anywhere that the two disagree. That is the receipt-reports-the-intention fault at
   * protocol scale, and this codebase has already paid for it twice at feature scale.
   *
   * ⚠️ `opts.is_draft` never crosses. A draft is somebody's unfinished thought and it belongs to the entity
   * composing it; sending one to another installation would publish a thing that has not been sent.
   */
  if (away.length && !opts.is_draft) {
    await sendAway(sender_entity_id, chit_id, copies, away, addressed); /* ⚠️ before ANY local write: all or none */
  } else if (away.length && opts.is_draft) {
    throw refusal('CTP_DRAFT', 'Draft stays here', 'A draft is not sent anywhere, and ' + away.length + ' of its copies belong to another installation.');
  }

  const sql = 'SELECT chit_deliver($1,$2,$3::jsonb)';
  const args = [chit_id, !!opts.is_draft, JSON.stringify(local)];
  const out = opts.client ? await opts.client.query(sql, args) : await withEntity(sender_entity_id, (c) => c.query(sql, args));
  if (!opts.is_draft) autoFile(chit_id, local);
  return out;
}

/** awayCopies(copies, addressed) — the copies another installation holds, after refusing any copy that could not be placed */
function awayCopies(copies, addressed) {
  if (!addressed) return [];
  refuseUnresolved(addressed);
  return (copies || []).filter((item) => {
    const address = addressed.get(String(item.entity_id));
    return address && address.local === false;
  });
}

/**
 * refuseUnresolved(addressed) — throws CTP_UNRESOLVABLE (503) when any copy's installation could not be read.
 * ⚠️ RAIL-142 (a): lib/ctpaddress answers resolved:false only when some installation IS remote, so a copy it could not
 * place may belong to one. Writing it here would hand a remote party's chit to this database and tell the sender it
 * was delivered. All or none, as the remote branch below: nothing is written.
 */
function refuseUnresolved(addressed) {
  if (!addressed) return;
  const unresolved = [...addressed.values()].filter((item) => item.resolved === false).length;
  if (!unresolved) return;
  const e = new Error('where ' + unresolved + ' of this chit\'s parties is hosted could not be read just now. Nothing was written — try again.');
  e.code = 'CTP_UNRESOLVABLE';
  e.status = 503;
  throw e;
}
/**
 * Send every remote copy, one signed envelope each (CTP step 5). The first that is not accepted throws farEndFailure, so the caller writes nothing local.
 * ⚠️ With TWO or more remote installations the earlier ones have already accepted when a later one fails: that is the open line RAIL-103 (delivered_first says who).
 */
async function sendAway(sender_entity_id, chit_id, copies, away, addressed) {
  const transport = require('./ctptransport');
  const envelope = require('./ctpenvelope');
  const from = await senderAddress(sender_entity_id);
  const sent = [];
  for (const copy of away) {
    const place = addressed.get(String(copy.entity_id));
    /* a business on an installation we no longer deal with (suspended or retired): refused in words before anything is written, never kept here (SIT run 4) */
    if (place.inactive) {
      const recipient = await recipientRow(copy.entity_id);
      const e = new Error(
        'Not sent: ' + (recipient.display_name || recipient.bridge_id || 'this business') + ' is on ' + place.installation_key +
          ', which this installation does not deal with now (suspended or retired). Nothing was sent and nothing was saved here.'
      );
      Object.assign(e, { code: 'CTP_PEER_INACTIVE', farEnd: true, status: 409, detail: { installation_key: place.installation_key, delivered_first: sent } });
      throw e;
    }
    /* RAIL-98: a send copy carries no bridge_id, so the envelope threw "exactly one recipient" and no chit ever crossed.
       The recipient's own identities row is the one source of the id (the same row sendLookupRecipient read). */
    const recipient = await recipientRow(copy.entity_id);
    const to = { bridge_id: copy.bridge_id || (place && place.bridge_id) || recipient.bridge_id };
    const env = envelope.build(from, to, { chit_id, header: headerOf(copies), copy, attachments: copy.attachments || [] });
    const receipt = await transport.send(place.endpoint, env);
    if (!receipt.accepted) {
      const failure = farEndFailure(place, receipt, sent, Object.assign({}, recipient, copy));
      refusedCrossing(failure, chit_id, place, receipt, sent); /* the log line, before ANY local write — all or none */
      throw failure;
    }
    sent.push(place.installation_key);
  }
}

/** the recipient's bridge id and name, from its identities row (RAIL-98; the name is for the refusal's words) — nulls when there is no such row */
async function recipientRow(entity_id) {
  const { query } = require('../db');
  const found = await query(`SELECT bridge_id, display_name FROM identities WHERE identity_id = $1`, [entity_id]);
  return found.rows[0] || { bridge_id: null, display_name: null };
}

/**
 * RAIL-99: a copy the far installation did not accept, as a refusal a person can read (lib/knownerr.farEnd reads it).
 * WHO: the recipient's name from our own row (and the installation when nobody answered). WHY: logged, never said (Q19: the far end's words are not echoed).
 * Two kinds, because they ask for different things: the far end ANSWERED no (CTP_REFUSED, 409: fix the chit or the address) and
 * nothing answered or it failed (CTP_UNREACHABLE, 502: try again later). A queue is deliberately not built (lib/ctptransport.js).
 */
function farEndFailure(place, receipt, sent, copy) {
  const answered = Number.isInteger(receipt.status) && receipt.status >= 400 && receipt.status < 500;
  /* sit/run6 (RAIL-99 x RAIL-129 + Q19): the far end's own why goes to the log (refusedCrossing), never into the sentence; a refusal is RAIL-129's
     refused 409 (lib/knownerr thrownRefusal), naming the business from OUR own row; nobody answering stays RAIL-99's 502, in our own transport's words (lib/ctptransport) */
  if (answered) {
    const forWhom = copy && copy.display_name ? ' for ' + copy.display_name : '';
    return Object.assign(refusal('CTP_REFUSED', 'Not delivered', 'Another installation did not take its copy of this chit' + forWhom + '. Nothing was written.'), { farEnd: true, detail: { delivered_first: sent } });
  }
  const whom = place.installation_key + (copy && copy.display_name ? ' (' + copy.display_name + ')' : '');
  const failure = new Error('Could not deliver to ' + whom + ': ' + receipt.why + '. Nothing was sent and nothing was saved here, so send it again when they are reachable.');
  failure.code = 'CTP_UNREACHABLE';
  failure.farEnd = true;
  failure.status = 502;
  failure.detail = { installation_key: place.installation_key, status: receipt.status, delivered_first: sent };
  return failure;
}

/** the shared header every copy of one chit carries — the envelope needs it, and it must not be re-derived */
/**
 * ⚠️⚠️ THE NAMES ARE THE ONES `header()` PRODUCES AND `chit_deliver` READS — every one of them, checked against
 * both. The first version guessed `sender_bridge_id` / `sender_display_name`; the real columns are
 * `sender_entity_bridge_id` / `sender_entity_display_name`, so the envelope silently carried neither and the
 * far end answered `23502 null value in column "sender_entity_bridge_id"`.
 *
 * ⭐ A LIST THAT IS MISSING A FIELD IS A COPY THAT ARRIVES DIFFERENT. This is the conformance rule again, in the
 * least glamorous place it appears: a typo here is not a crash, it is a row that quietly lacks a column.
 */
/** RAIL-129 — a refusal deliver() throws ON PURPOSE: refused + 409 + a named code + words, which lib/knownerr thrownRefusal answers as
 *  a 409 a person can read (never the generic 500 "Send failed"). */
function refusal(code, title, sentence) {
  return Object.assign(new Error(sentence), { code, title, refused: true, status: 409 });
}

/** a copy another installation did not take: fills in e.detail and logs. Its own `why` goes to the log and never into the sentence (Q19: a value from outside is
 *  never echoed to a person). The code and the sentence stay at the throw in deliver(), where the rule is decided. */
function refusedCrossing(e, chit_id, address, answer, sent) {
  e.detail = Object.assign({ installation_key: address.installation_key, status: answer.status, delivered_first: sent }, e.detail || {}); /* farEndFailure's why and status stay */
  logger.warn('mint: a copy was refused by another installation — nothing was written', { chit_id, ...e.detail, why: answer.why });
}

function headerOf(copies) {
  const c = (copies && copies[0]) || {};
  const h = {};
  for (const k of [
    'sender_entity_id',
    'sender_entity_bridge_id',
    'sender_entity_display_name',
    'all_recipients',
    'purpose',
    'auto_subject',
    'manual_subject',
    'summary_json',
    'schema_version',
    'schema_id',
    'created_by_actor_id',
    'detail_type',
    'line_item_count',
    'total_value',
    'currency_code'
  ]) {
    if (c[k] !== undefined) h[k] = c[k];
  }
  return h;
}

/**
 * Who this installation says it is, for the envelope's `from`.
 * ⚠️ The POPULATION is the load-bearing field — §7. Read from the sender, not from configuration, because the
 * boundary is a fact about the entity and not about the deployment.
 */
async function senderAddress(sender_entity_id) {
  const { query } = require('../db');
  let population = 'live',
    bridge_id = null,
    display_name = null;
  try {
    const r = await query(
      `SELECT coalesce(population,'live') AS population, bridge_id, display_name
         FROM identities WHERE identity_id = $1`,
      [sender_entity_id]
    );
    if (r.rows[0]) ({ population, bridge_id, display_name } = r.rows[0]);
  } catch (e) {
    logger.fellBack('mint senderAddress: the read failed — carried on without it', e); /* fall through to the safe default below */
  }
  return {
    installation_key: process.env.INSTALLATION_KEY || 'platform-0',
    population,
    bridge_id,
    display_name
  };
}

/**
 * autoFile — run each RECEIVER's folder rules against their new copy (b132).
 *
 * ⚠️ ONE HOOK, BECAUSE THERE IS NOW ONE DELIVERY. A week ago this would have needed four call sites and would have
 * diverged at the first one somebody forgot. The consolidation is what makes a rule engine cheap here.
 *
 * ⚠️ AFTER THE WRITE, NEVER INSIDE IT. Filing runs in the RECEIVER's tenant context, not the sender's — putting it
 * in the sender's transaction would be a cross-tenant write wearing a convenience. It is also deliberately not
 * awaited: a rules failure must never fail a delivery. A chit that arrives unfiled is an annoyance; a chit that
 * fails to arrive is a lost obligation.
 *
 * ⚠️ RECEIVED COPIES ONLY. A sender's own copy is not "arriving" anywhere, and filing it would put your own sent
 * chits into folders you built for inbound work.
 */
function autoFile(chit_id, copies) {
  setImmediate(async () => {
    try {
      const rules = require('./folder-rules');
      for (const c of copies || []) {
        if (c.direction !== 'received') continue;
        await rules.fileArrival(c.entity_id, {
          chit_id,
          manual_subject: c.manual_subject,
          auto_subject: c.auto_subject,
          counterparty_name: c.sender_entity_display_name,
          sender_entity_display_name: c.sender_entity_display_name,
          purpose: c.purpose,
          direction: 'received',
          current_status: c.current_status,
          summary_json: c.summary_json,
          value: c.total_value,
          read_at: null,
          open_disputes: 0,
          created_at: new Date().toISOString()
        });
      }
    } catch (e) {
      logger.fellBack('mint autoFile: the helper failed — carried on without it', e); /* best-effort by design — see above */
    }
  });
}

/**
 * page(asked) — WHICH DETAIL PAGE THIS CHIT IS MADE WITH, stamped once at mint (N03, decisions M-D6/M-D7).
 *
 * Grammar `<kind>.<vertical>.<face>@<major.minor>`. The registry is data/pages.json, a byte copy of the web's
 * public/app/pages.json (the master — the page scripts live there); tests/page-name.test.cjs holds the copy to it.
 *   · nothing asked        → the base page (`chit.base.detail@1.0`)
 *   · a registered name    → that name at its newest registered version
 *   · name@version         → exactly that row, if it is registered
 *   · anything else        → { ok: false, code: 'PAGE_UNKNOWN' } — a reserved name with no page yet included.
 * ⚠️ MINT ONLY. Opening never refuses: the app shows an unknown name or version on the base page with a note.
 * ⚠️ NEVER CHANGED AFTER SEND. No route writes business_json.page after this; every later business_json write is a
 * merge-patch of its own key (tests/page-name.test.cjs scans for one that is not).
 */
const PAGES = require('../data/pages.json');
const versionref = require('./versionref'); /* the ONE parser of thing@version — widened to major.minor for this */
const PAGE_RE = new RegExp(PAGES.grammar);
function page(asked) {
  if (asked === undefined || asked === null || asked === '') return { ok: true, page: PAGES.base };
  const no = (why) => ({ ok: false, code: 'PAGE_UNKNOWN', message: why });
  if (typeof asked !== 'string') return no('business_json.page must be a page name, like ' + PAGES.base);
  const ref = versionref.parse(asked); /* null for a bare name — or for a version that is not major.minor */
  if (!ref && asked.indexOf(versionref.SEP) >= 0) return no(asked + ' is not a page name (' + PAGES.base + ' is)');
  const name = ref ? ref.key : asked;
  const rows = PAGES.pages.filter((item) => item.name === name);
  if (!rows.length)
    return no((PAGES.reserved || []).indexOf(name) >= 0 ? name + ' is reserved — no page is built for it yet' : 'No detail page is called ' + name);
  const named = (r) => versionref.format(r.name, r.version);
  if (!ref) {
    const n = (text) => text.split('.').map(Number);
    return { ok: true, page: named(rows.slice().sort((x, y) => n(y.version)[0] - n(x.version)[0] || n(y.version)[1] - n(x.version)[1])[0]) };
  }
  if (!PAGE_RE.test(asked)) return no(asked + ' is not a page name (' + PAGES.base + ' is)');
  if (!rows.some((item) => named(item) === asked)) return no(asked + ' is not installed — ' + rows.map(named).join(', ') + ' is');
  return { ok: true, page: asked };
}

module.exports = { summary, header, party, deliver, lines, order, page, senderAddress }; /* senderAddress: lib/ctpreturn.js addresses its events as the same sender */
