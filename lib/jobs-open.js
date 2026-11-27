'use strict';
/**
 * CARD 01-rail-core-the-chit/assign
 * jobs-open.js — OPEN A JOB CHIT PER SUBJECT: the first consumer of the generic assign capability (plug `client`: a firm's client shops).
 *
 * OWNS      openJobs · eligibilityOf · refOf (the idempotency key) · SKIP (the skip codes and their sentences' keys)
 * CALLED BY routes/chits-jobs.js (POST /api/chits/jobs/open)
 * FLOW      the set (ids, or a filter resolved in one read) → ONE batched pair of reads (the agency edge and the live grant, through grants.verdictOf: the books' own test of live) → ONE read of the
 *           client_refs that exist → per remaining subject the EXISTING send path (lib/autoraise.sendAs, purpose general, business_json.job) → the auto door (lib/auto-assign, copy from the register) → the counts
 * WHY       The subject of an assignment is always carried by a chit copy. A client has none between the firm and itself, so a job chit is opened: purpose general (posts nothing, prices nothing), sender = the firm,
 *           \`to\` = the client; the firm's \`sent\` copy is the one that holds the assignment. It holds NO business rule of its own: sending, sealing, the status and the holder are the rail's.
 * IDEMPOTENT by the index that exists: client_ref = job:<plug>:<role>:<subject>:<period> against ux_chit_client_ref_per_entity; a repeat, a retry or a race opens nothing twice. NOT all-or-nothing, on purpose:
 * each send is its own transaction across two parties' copies. A partial run is finished by calling again.
 */
const grants = require('./books-grant');
const register = require('./assign-register');
const { isGrantParentSql } = require('./network-membership');
const { CLOSED_SQL } = require('./rail-actions');
const log = require('./logger');

const MAX_SUBJECTS = 200;
/** the skip codes (registered in docs/ERROR-CODES.md) */
const SKIP = Object.freeze({
  NOT_YOURS: ['JOB_CLIENT_NOT_YOURS', 'This business is not one of your clients, or the link between you has ended.'],
  NO_ROLE: ['JOB_ROLE_NOT_GRANTED', 'This client has not given you the access that job needs.'],
  UNREACHABLE: ['JOB_CLIENT_UNREACHABLE', 'This client cannot be reached on ChitBridge right now, so the job was not opened.']
});
const skipOf = (subject_id, kind) => ({ subject_id, code: SKIP[kind][0], reason: SKIP[kind][1] });

/** the idempotency key of one job: the natural key, never a header (a new role or period is a NEW job by design) */
const refOf = (plug, role, subject_id, period) => ['job', plug, role, String(subject_id).toLowerCase(), period].join(':');
/** the subject of a job chit's neutral line, in the shopkeeper's words (no "chit"): what the client's inbox shows */
const subjectLineOf = (role, period) => role.charAt(0).toUpperCase() + role.slice(1) + ' service, ' + period;

/** the set named by a filter, resolved in ONE read: the firm's clients with a live grant of this role (the practice list's population), optionally without an open job for this period */
async function resolveFilter(transaction, firm, plug, role, period, filter) {
  const found = await transaction.query(
    `SELECT DISTINCT g.grantor_entity::text AS id
       FROM books_access_grant g
      WHERE g.grantee_entity = $1::uuid AND g.preset = $2 AND ${grants.liveGrantSql('g')}
        AND ($3::text IS NULL OR (SELECT display_name FROM identities WHERE identity_id = g.grantor_entity) ILIKE '%' || $3 || '%')
        AND ($4::boolean IS NOT TRUE OR NOT EXISTS (
              SELECT 1 FROM chit_header ch JOIN chit_status cs ON cs.chit_id = ch.chit_id AND cs.entity_id = ch.entity_id AND cs.direction = 'sent' AND cs.deleted_at IS NULL
               WHERE ch.entity_id = $1::uuid AND ch.business_json ->> 'client_ref' = 'job:' || $5 || ':' || $2 || ':' || g.grantor_entity::text || ':' || $6
                 AND cs.current_status NOT IN (${CLOSED_SQL})))
      ORDER BY 1 LIMIT ${MAX_SUBJECTS + 1}`,
    [firm, role, filter.q || null, filter.without_job === true, plug, period]
  );
  return found.rows.map((row) => row.id);
}

/**
 * eligibilityOf(transaction, firm, role, ids) → Map(id → null | 'NOT_YOURS' | 'NO_ROLE'): TWO batched statements for the whole set (never one read per client).
 * Live = the books' own verdict (grants.verdictOf over the latest grant row of the pair, the edge read at this request). A client with no active agency edge, or none of this firm's, is NOT_YOURS (the same
 * answer for an unknown id and another shop's, S35); a client linked to the firm but with no live grant of the role is NO_ROLE.
 */
async function eligibilityOf(transaction, firm, role, ids) {
  const rows = await transaction.query(
    `SELECT DISTINCT ON (g.grantor_entity) g.grantor_entity::text AS member, g.preset, g.revoked_at, ${grants.stateColumnsSql('g')}
       FROM books_access_grant g WHERE g.grantee_entity = $1::uuid AND g.grantor_entity = ANY($2::uuid[]) AND g.preset = $3
      ORDER BY g.grantor_entity, g.granted_at DESC`,
    [firm, ids, role]
  );
  const edges = await transaction.query(`SELECT c.id::text AS member FROM unnest($2::uuid[]) AS c(id) WHERE ${isGrantParentSql('$1::text', 'c.id::text')}`, [firm, ids]);
  const linked = new Set(edges.rows.map((row) => row.member));
  const rowOf = new Map(rows.rows.map((row) => [row.member, row]));
  return new Map(
    ids.map((id) => {
      if (!linked.has(id)) return [id, 'NOT_YOURS'];
      const row = rowOf.get(id);
      return [id, row && grants.verdictOf(row, { method: 'GET', listed: true }) === 'allowed' ? null : 'NO_ROLE'];
    })
  );
}

/** the chit ids that already exist for these refs (ONE read), as Map(ref → chit_id) */
async function existingRefs(transaction, firm, refs) {
  const found = await transaction.query(`SELECT business_json ->> 'client_ref' AS ref, chit_id FROM chit_header WHERE entity_id = $1::uuid AND business_json ->> 'client_ref' = ANY($2::text[])`, [firm, refs]);
  return new Map(found.rows.map((row) => [row.ref, row.chit_id]));
}

/** one send through the EXISTING path (the shop's own loopback); → { chit_id, raced } or null when the client could not be reached */
async function sendOne(sender, firm, plug, role, period, subject_id) {
  const entry = register.entryOf(plug);
  const sent = await sender(firm, {
    recipients: [{ entity_id: subject_id, role: 'to' }],
    purpose: entry.opens.purpose,
    manual_subject: subjectLineOf(role, period),
    line_items: [],
    business_json: { job: { plug, role, period } },
    client_ref: refOf(plug, role, subject_id, period)
  });
  if (!sent || !sent.ok || !sent.body || !sent.body.chit_id) return null;
  return { chit_id: sent.body.chit_id, duplicate: sent.body.duplicate === true };
}

/** the subjects to open a job for (the ones named, or the filter's; each once, within the cap), who may not receive one, and which already have one open */
function prepareJobs(input) {
  const { firm, plug, role, period } = input;
  return grants.asEntity(firm, async (transaction) => {
    const ids = (input.subject_ids ? input.subject_ids.map((id) => String(id).toLowerCase()) : await resolveFilter(transaction, firm, plug, role, period, input.filter || {})).filter((id, at, all) => all.indexOf(id) === at);
    if (ids.length > MAX_SUBJECTS) throw Object.assign(new Error('Open at most ' + MAX_SUBJECTS + ' jobs at once.'), { status: 400, code: 'CHIT_TOO_MANY' });
    if (!ids.length) return { ids, eligible: new Map(), exist: new Map() };
    const eligible = await eligibilityOf(transaction, firm, role, ids);
    const exist = await existingRefs(transaction, firm, ids.map((id) => refOf(plug, role, id, period)));
    return { ids, eligible, exist };
  });
}

/** the auto door for a freshly opened job, best effort after the send (as the receiver's door is): true when a person took it; a failure leaves the job in Unassigned and is said */
async function assignBestEffort(autoAssign, firm, chit_id, plug) {
  try {
    return !!(await autoAssign(firm, chit_id, plug));
  } catch (e) {
    log.warn('jobs-open: the job was opened but not auto-assigned; it stays Unassigned', { chit_id, error: String((e && e.message) || e) });
    return false;
  }
}

/** one subject of the batch: skipped (not eligible · unreachable), already open, or opened now and offered to the auto door; counted into `out` */
async function openForSubject(batchRun, id, out) {
  const { sender, autoAssign, firm, plug, role, period, prepared } = batchRun;
  const refused = prepared.eligible.get(id);
  if (refused) {
    out.skipped.push(skipOf(id, refused));
    return;
  }
  const held = prepared.exist.get(refOf(plug, role, id, period));
  if (held) {
    out.existing++;
    out.jobs.push({ subject_id: id, chit_id: held, outcome: 'existing' });
    return;
  }
  const sent = await sendOne(sender, firm, plug, role, period, id);
  if (!sent) {
    out.skipped.push(skipOf(id, 'UNREACHABLE'));
    return;
  }
  out.jobs.push({ subject_id: id, chit_id: sent.chit_id, outcome: sent.duplicate ? 'existing' : 'opened' });
  if (sent.duplicate) {
    out.existing++;
    return;
  }
  out.opened++;
  if (await assignBestEffort(autoAssign, firm, sent.chit_id, plug)) out.assigned++;
}

/**
 * openJobs({ firm, plug, role, period, subject_ids | filter, sender?, autoAssign? }) → { opened, existing, assigned, skipped, jobs }  (or throws { status: 400, code: 'CHIT_TOO_MANY' })
 * `sender` and `autoAssign` are the two doors (default: lib/autoraise.sendAs and lib/auto-assign); tests stand in for them.
 */
async function openJobs(input) {
  const { firm, plug, role, period } = input;
  const sender = input.sender || require('./autoraise').sendAs;
  const autoAssign = input.autoAssign || require('./auto-assign').autoAssign;
  const prepared = await prepareJobs(input);
  const out = { opened: 0, existing: 0, assigned: 0, skipped: [], jobs: [] };
  const batchRun = { sender, autoAssign, firm, plug, role, period, prepared };
  for (const id of prepared.ids) await openForSubject(batchRun, id, out);
  return out;
}

module.exports = { openJobs, eligibilityOf, resolveFilter, existingRefs, refOf, subjectLineOf, SKIP, MAX_SUBJECTS };
