'use strict';
// OWNS      the control panel's ANSWER: the installations around the master as the page reads them (counts, status in words, last pull, last seen, the actions as data). Read-only; it shapes rows, it dials no one.
// CALLED BY routes/netpanel.js (GET /api/network/installations) · tests/network-panel.test.cjs
// FLOW      lib/netmember.listMembers (the ONE reader, the CLI's too) ──▶ shapeRow per installation (status from the CERTIFICATE, never installation.active) ──▶ { counts, installations }
// CARD      28-platform-and-operations/network-control-panel
/**
 * ⭐ THE PAGE NEVER DIALS ANYONE. `version` and `last_seen` were written by the master's own pull (lib/netsync.noteSeen); this file only reads what is recorded and says when it is old.
 *
 * ⭐ STATUS COMES FROM THE CERTIFICATE (membership_certificate.status and its date), because installation.active is one boolean for suspended, revoked and retired alike.
 * The words are the Stripe-Connect kind: Active · Expiring soon · Lapsed · Paused · Cut off · No certificate.
 *
 * ⭐ ACTIONS ARE DATA. This slice acts on nothing: each action says `may: false` and the command that does it today, so the page can show the button disabled with the reason.
 * When a later slice lets the panel act, only `may` and `why` change here; the page does not.
 */

const EXPIRING_DAYS = 10; /* a 30-day certificate renews at day 20 (DESIGN-NETWORK-CONTROL-PANEL.md), so ten days left means a renewal is late */
const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_WORDS = {
  master: 'Master',
  active: 'Active',
  expiring: 'Expiring soon',
  lapsed: 'Lapsed',
  paused: 'Paused',
  cut_off: 'Cut off',
  uncertified: 'No certificate'
};
const LISTED_WORDS = { true: 'listed', false: 'unlisted', null: 'not recorded' };

/** the status code of one installation, from its newest certificate */
function statusOf(row, now) {
  if (row.hosted_locally) return 'master';
  if (!row.certificate_status) return 'uncertified';
  if (row.certificate_status === 'revoked') return 'cut_off';
  if (row.certificate_status === 'suspended') return 'paused';
  const left = new Date(row.certificate_not_after).getTime() - now;
  if (left <= 0) return 'lapsed';
  return left < EXPIRING_DAYS * DAY_MS ? 'expiring' : 'active';
}

/** suspend / reinstate / revoke as the server's data: not allowed from the panel yet, with the command that does it */
function actionsOf(row) {
  if (row.hosted_locally) return {};
  const todo = (verb) => ({ may: false, why: 'node tools/network-cert.cjs ' + verb + ' ' + row.installation_key });
  return { suspend: todo('suspend'), reinstate: todo('reinstate'), revoke: todo('revoke') };
}

const isoTime = (value) => (value ? new Date(value).toISOString() : null);

/** true / false / null: only a recorded boolean counts; anything else is "not recorded" */
const recordedListed = (value) => (value === true || value === false ? value : null);

/** the recorded side of one row: what the master last pulled and last saw (the master's own row is this process, not a record) */
function seenOf(row, now, self) {
  if (!row.hosted_locally) return { version: row.version || null, last_seen: isoTime(row.last_seen), seen_error: row.seen_error || null, last_pull: { at: isoTime(row.pulled_at), error: row.pull_error || null } };
  return { version: (self && self.version) || null, last_seen: new Date(now).toISOString(), seen_error: null, last_pull: null };
}

/** one installation as the page reads it. `self` = { version } for the master's row (it is not asked, it is this process). */
function shapeRow(row, now, self) {
  const status = statusOf(row, now);
  const listed = recordedListed(row.listed);
  return Object.assign(
    {
      key: row.installation_key,
      domain: row.domain || null,
      country: row.country || null,
      role: row.network_role,
      status,
      status_label: STATUS_WORDS[status],
      certificate: row.hosted_locally ? null : { status: row.certificate_status || null, expires: isoTime(row.certificate_not_after) },
      listed,
      listed_label: LISTED_WORDS[listed],
      entities_held: row.entities,
      entities_claimed: row.entities_claimed === undefined ? null : row.entities_claimed,
      actions: actionsOf(row)
    },
    seenOf(row, now, self)
  );
}

const tally = (list, pick) => list.reduce((counts, item) => Object.assign(counts, { [pick(item)]: (counts[pick(item)] || 0) + 1 }), {});

/** rows from netmember.listMembers → { counts: { total, by_role, by_status }, installations } */
function answer(rows, now, self) {
  const installations = rows.map((row) => shapeRow(row, now, self));
  return {
    counts: { total: installations.length, by_role: tally(installations, (installation) => installation.role), by_status: tally(installations, (installation) => installation.status) },
    installations
  };
}

module.exports = { answer, shapeRow, statusOf, actionsOf, STATUS_WORDS, EXPIRING_DAYS };
