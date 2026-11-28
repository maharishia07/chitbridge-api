'use strict';
/**
 * lib/connect-caps.js — how many asks to connect one business may make or receive, and how soon a refused ask may be repeated
 * OWNER     cb-network (the numbers are cb-security's rule: no harassment loop, no flood of 150 shops in one minute)
 * RISK      plain
 * OWNS      the caps of the FIRM ask (an `agency` edge): askVerdict(counts, limits, now) → null | { status, code, message } (pure) · askCounts(query, ids) (one statement) · refuseFirmAsk (the direction pin and the caps, one door)
 * CALLED BY src/services/network.js requestConnect (type agency only: a brand's invitations are not capped here) · tests/connect-caps.test.cjs
 * FLOW      the asker and the other business are resolved → askCounts reads five numbers in ONE statement → askVerdict says which cap (if any) is hit, in words → 429 with its code
 * CARD      04-network/connections-and-invitations
 *
 * THE NUMBERS (sized for the auditor who brings about 150 shops; each overridable from the environment; recorded in the PR):
 *   PENDING_BY_ASKER 200       asks of mine that nobody has answered yet (150 shops + a margin)
 *   ASKS_PER_ASKER_DAY 300     new asks I made in the last 24 h (150 shops asked twice over)
 *   PENDING_TO_TARGET 20       asks waiting at ONE business from anybody (a shop's inbox is never a wall of strangers)
 *   ASKS_PER_TARGET_DAY 10     new asks that reached ONE business in 24 h from anybody
 *   DECLINE_COOL_OFF_HOURS 1   after a Refuse the same asker waits before asking the same business again (a refused ask may be asked again, never in a loop)
 */
const { MS_PER_HOUR } = { MS_PER_HOUR: 3600 * 1000 };

const fromEnv = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const limitsNow = () => ({
  pendingByAsker: fromEnv('CONNECT_PENDING_BY_ASKER', 200),
  asksPerAskerDay: fromEnv('CONNECT_ASKS_PER_ASKER_DAY', 300),
  pendingToTarget: fromEnv('CONNECT_PENDING_TO_TARGET', 20),
  asksPerTargetDay: fromEnv('CONNECT_ASKS_PER_TARGET_DAY', 10),
  declineCoolOffHours: fromEnv('CONNECT_DECLINE_COOL_OFF_HOURS', 1)
});

const COUNTS_SQL = `
  SELECT (SELECT count(*) FROM cb_edge WHERE requested_by = $1 AND state = 'requested' AND type = 'agency')::int AS pending_by_asker,
         (SELECT count(*) FROM cb_edge WHERE requested_by = $1 AND type = 'agency' AND created_at > now() - interval '24 hours')::int AS asks_day,
         (SELECT count(*) FROM cb_edge WHERE (parent_id = $2 OR child_id = $2) AND requested_by IS DISTINCT FROM $2 AND state = 'requested' AND type = 'agency')::int AS pending_to_target,
         (SELECT count(*) FROM cb_edge WHERE (parent_id = $2 OR child_id = $2) AND requested_by IS DISTINCT FROM $2 AND type = 'agency' AND created_at > now() - interval '24 hours')::int AS asks_target_day,
         (SELECT max(decided_at) FROM cb_edge WHERE parent_id = $3 AND child_id = $4 AND type = 'agency' AND state = 'declined' AND requested_by = $1) AS last_decline`;

/** askCounts(query, { actorId, targetId, parentId, childId }) → the five numbers the caps read (one trip) */
async function askCounts(query, { actorId, targetId, parentId, childId }) {
  const { rows } = await query(COUNTS_SQL, [actorId, targetId, parentId, childId]);
  return rows[0];
}
const tooMany = (code, message) => ({ status: 429, code, message });

/** askVerdict(counts, limits, now) → null (go ahead) or the first cap hit, with its words; pure */
function askVerdict(counts, limits, now = new Date()) {
  if (counts.pending_by_asker >= limits.pendingByAsker) return tooMany('ASK_LIMIT', 'You have many requests waiting for an answer already. Wait for some to be answered, or cancel the ones you no longer need.');
  if (counts.asks_day >= limits.asksPerAskerDay) return tooMany('ASK_LIMIT', 'You have asked a lot of businesses today. Try again tomorrow.');
  if (counts.pending_to_target >= limits.pendingToTarget || counts.asks_target_day >= limits.asksPerTargetDay) return tooMany('ASK_LIMIT', 'That business has had several requests to connect lately. Try again later.');
  const declined = counts.last_decline ? new Date(counts.last_decline).getTime() : null;
  if (declined !== null && now.getTime() - declined < limits.declineCoolOffHours * MS_PER_HOUR) return tooMany('ASK_COOLING_OFF', 'That business refused your request a short while ago. Try again a little later.');
  return null;
}
const BACK_SQL = "SELECT 1 FROM cb_edge WHERE parent_id =  AND child_id =  AND type = 'agency' AND state IN ('requested','active','suspended') LIMIT 1";
/**
 * refuseFirmAsk(query, { actor, parent, child }, fail) — throws fail(status, message, code) when the firm ask may not be made: the firm is ALWAYS the parent, so a pair already connected the other way
 * round is refused (FIRM_DIRECTION: a shop made 'parent' would be labelled a firm in the other business's inbox), then the caps above (429)
 */
async function refuseFirmAsk(query, { actor, parent, child }, fail) {
  if ((await query(BACK_SQL, [child.id, parent.id])).rows.length) throw fail(409, 'These two businesses are already connected the other way round: the firm is always the one that looks after the books.', 'FIRM_DIRECTION');
  const targetId = String(actor.id) === String(parent.id) ? child.id : parent.id;
  const counts = await askCounts(query, { actorId: actor.id, targetId, parentId: parent.id, childId: child.id });
  const refusal = askVerdict(counts, limitsNow());
  if (refusal) throw fail(refusal.status, refusal.message, refusal.code);
}
module.exports = { askVerdict, askCounts, limitsNow, refuseFirmAsk };
