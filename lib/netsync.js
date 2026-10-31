'use strict';
// @stage tested
// OWNS      the network's PULLS: a member fetches its certificate and the signed directory from the pinned master; the master reads each member's registry_change by sequence;
//           a certified member asks the master where a bridge id lives and VERIFIES the hint at the far domain.
// CALLED BY tools/network-sync.cjs (run by cron every minute in SIT) · tests/network-sync.test.cjs
// FLOW      member: ask master `certificate` → check against the pinned key → store · ask `directory` → check the seal → revoked list + peer rows
//           master: for each member → ask `registry_changes` after the cursor → upsert registry_entry → move the cursor → compare the count (a gap → one full resync)
//           locate: ask master `locate` → for each hint, ask THAT domain `resolve` → keep only what the far installation itself confirms
// CARD      28-platform-and-operations/network-control-panel
// @stage tested
// @stage-why run by cron through tools/network-sync.cjs, not by a route; tests/network-sync.test.cjs covers it.
/**
 * ⭐ PULL, NOT PUSH. The member's outbox (registry_change) is written in the entity's own transaction, so a master that is away loses nothing; it just reads later. A SEQUENCE NUMBER,
 * never a timestamp, is the cursor, so a clock cannot lose a change. Applying a change twice is harmless (upsert).
 *
 * ⚠️ Nothing here is trusted because of WHERE it came from. A certificate and the directory are checked against the pinned master key; a hint from `locate` is only a hint and is
 * confirmed by the named installation on its own domain; a pull of changes is answered only to the pinned master (lib/netmember.queryGate).
 */
const { query } = require('../db');
const log = require('./logger');
const keys = require('./ctpkeys');
const netcert = require('./netcert');
const netmember = require('./netmember');
const ctpquery = require('./ctpquery');

const failed = (sentence) => ({ ok: false, why: sentence });

/** a question to the pinned master, signed with this installation's own key (the master reads it against our manifest) */
async function askMaster(pinnedMaster, question) {
  return ctpquery.ask({ domain: pinnedMaster.domain }, question, {});
}

/** keep the certificate the master sent, after proving it is for US, signed by the PINNED key, and in date */
async function takeCertificate(pinnedMaster, body) {
  if (!body.found) return failed(body.why || 'the master has no certificate for this installation');
  const self = (await query(`SELECT domain FROM installation WHERE installation_key = $1 AND hosted_locally`, [netmember.ownKey()])).rows[0];
  const verdict = netcert.check(body.membership, {
    pin: pinnedMaster,
    who: { installation_key: netmember.ownKey(), domain: self && self.domain, public_key: keys.status().public_key },
    revoked: await netmember.revokedSet()
  });
  if (!verdict.ok) return failed('the master’s certificate is refused here: ' + verdict.why);
  const certificate = verdict.cert;
  await query(
    `INSERT INTO membership_certificate (serial, installation_key, cert, signature, not_before, not_after, status) VALUES ($1, $2, $3, $4, $5, $6, 'active') ON CONFLICT (serial) DO NOTHING`,
    [certificate.serial, certificate.installation_key, certificate, body.membership.sealed.sig, certificate.not_before, certificate.not_after]
  );
  return { ok: true, serial: certificate.serial, not_after: certificate.not_after };
}

/** replace the revoked list and the network peer rows with what the signed directory says (peers the master dropped are deactivated; hand-made peers are left alone) */
async function takeDirectory(pinnedMaster, body) {
  if (!body.found || !body.directory) return failed(body.why || 'the master sent no directory');
  const sealed = netcert.unseal(body.directory, body.sealed, pinnedMaster.public_key);
  if (!sealed.ok) return failed('the master’s directory is refused here: ' + sealed.why);
  const directory = body.directory;
  if (directory.for !== netmember.ownKey()) return failed('the directory was written for ' + directory.for + ', not for this installation');
  await query('DELETE FROM network_revoked WHERE serial <> ALL($1::text[])', [directory.revoked]);
  await query(`INSERT INTO network_revoked (serial, reason) SELECT s, 'master list' FROM unnest($1::text[]) AS s ON CONFLICT (serial) DO NOTHING`, [directory.revoked]);
  for (const peer of directory.peers) await upsertPeer(peer);
  await query(`UPDATE installation SET active = false WHERE purpose = 'network' AND NOT hosted_locally AND active AND installation_key <> ALL($1::text[])`, [directory.peers.map((peer) => peer.installation_key)]);
  return { ok: true, revoked: directory.revoked.length, peers: directory.peers.map((peer) => peer.installation_key) };
}

/** a peer the master introduced: a REMOTE installation row (never touches a row hosted here, nor the pinned master's row) */
async function upsertPeer(peer) {
  await query(
    `INSERT INTO installation (installation_key, label, purpose, cloud_provider, domain, vertical_key, hosted_locally, ctp_endpoint, country)
     VALUES ($1, $2, 'network', 'oracle', $3, 'base', false, $4, $5)
     ON CONFLICT (installation_key) DO UPDATE SET domain = EXCLUDED.domain, ctp_endpoint = EXCLUDED.ctp_endpoint, active = true, country = coalesce(EXCLUDED.country, installation.country)
     WHERE NOT installation.hosted_locally AND installation.purpose IN ('network', 'sit-peer')`,
    [peer.installation_key, peer.label || peer.installation_key, peer.domain, peer.endpoint, peer.country || null]
  );
}

/** a member's whole pull: its certificate, then the directory. Each part reports on its own, so one failure does not hide the other. */
async function pullMember() {
  const role = await netmember.roleOf();
  const pinnedMaster = role.role === 'member' ? netmember.pinned(role) : null;
  if (!pinnedMaster) return failed('this installation is not a network member with a pinned master');
  const out = { ok: true, master: pinnedMaster.installation_key };
  const cert = await askMaster(pinnedMaster, { want: 'certificate' });
  out.certificate = cert.ok ? await takeCertificate(pinnedMaster, cert) : failed(cert.why);
  const dir = await askMaster(pinnedMaster, { want: 'directory' });
  out.directory = dir.ok ? await takeDirectory(pinnedMaster, dir) : failed(dir.why);
  out.ok = out.certificate.ok && out.directory.ok;
  return out;
}

/* ── the master reads a member ─────────────────────────────────────────────────────────────────────────── */

async function cursorOf(memberKey) {
  const cursor = await query('SELECT last_seq FROM registry_cursor WHERE installation_key = $1', [memberKey]);
  return cursor.rows[0] ? Number(cursor.rows[0].last_seq) : 0;
}

async function applyChanges(memberKey, changes) {
  for (const change of changes) {
    await query(
      `INSERT INTO registry_entry (installation_key, bridge_id, entity_type, population, status) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (installation_key, bridge_id) DO UPDATE SET entity_type = EXCLUDED.entity_type, population = EXCLUDED.population, status = EXCLUDED.status, seen_at = now()`,
      [memberKey, change.bridge_id, change.entity_type, change.population, change.status]
    );
  }
}

async function noteCursor(memberKey, lastSeq, entities, error) {
  await query(
    `INSERT INTO registry_cursor (installation_key, last_seq, entities, pulled_at, last_error) VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (installation_key) DO UPDATE SET last_seq = EXCLUDED.last_seq, entities = EXCLUDED.entities, pulled_at = now(), last_error = EXCLUDED.last_error`,
    [memberKey, lastSeq, entities, error || null]
  );
}

/** read one member from its cursor. A count that disagrees with ours means a gap: forget what we hold for it and read again from 0, once. */
async function pullOne(row, again) {
  const asker = { signer: keys.signer('network'), from: { installation_key: netmember.ownKey(), population: 'live' } };
  const after = again ? 0 : await cursorOf(row.installation_key);
  /* the member is asked at ITS registered row (key + endpoint), never "whoever answers this domain now": a domain can change hands (SIT run 4) */
  const at = { installation_key: row.installation_key, endpoint: row.ctp_endpoint, domain: row.domain };
  const answered = await ctpquery.ask({ domain: row.domain }, { want: 'registry_changes', after, limit: 500 }, Object.assign({ resolvePeer: async () => at }, asker));
  if (!answered.ok) {
    await noteCursor(row.installation_key, after, null, answered.why);
    return { installation_key: row.installation_key, ok: false, why: answered.why };
  }
  await applyChanges(row.installation_key, answered.changes);
  const last = answered.changes.length ? answered.changes[answered.changes.length - 1].seq : after;
  const held = (await query('SELECT count(*)::int AS n FROM registry_entry WHERE installation_key = $1', [row.installation_key])).rows[0].n;
  await noteCursor(row.installation_key, last, answered.entities, null);
  if (answered.changes.length && last < answered.last_seq) return pullOne(row, false); /* more to read */
  if (held !== answered.entities && !again) {
    await query('DELETE FROM registry_entry WHERE installation_key = $1', [row.installation_key]);
    log.warn('netsync.resync', { installation_key: row.installation_key, held, member_says: answered.entities });
    return Object.assign(await pullOne(row, true), { resynced: true });
  }
  return { installation_key: row.installation_key, ok: held === answered.entities, entities: held, last_seq: last, why: held === answered.entities ? undefined : 'the count still differs after a full read: ours ' + held + ', theirs ' + answered.entities };
}

/** the master's pull of every registered member (ids and counts only) */
async function pullMaster() {
  const role = await netmember.roleOf();
  if (role.role !== 'master') return failed('this installation is not a network master');
  const rows = (await query(`SELECT installation_key, domain, ctp_endpoint FROM installation WHERE NOT hosted_locally AND active AND network_role = 'member' ORDER BY installation_key`)).rows;
  const members = [];
  for (const row of rows) members.push(await pullOne(row, false));
  return { ok: members.every((member) => member.ok), members };
}

/* ── locate: a hint from the master, verified where the business lives ────────────────────────────────── */

/** one hint from the master, asked at the far domain itself → { verified: { installation_key, domain, bridge_id, address, display_name } } | { rejected: { installation_key, why } } */
async function confirmHint(hint, bridge_id) {
  const farAnswer = await ctpquery.ask({ domain: hint.domain, bridge_id }, { want: 'resolve', handle: bridge_id }, {});
  if (farAnswer.ok && farAnswer.found && farAnswer.installation_key === hint.installation_key) {
    return { verified: { installation_key: hint.installation_key, domain: hint.domain, bridge_id: farAnswer.bridge_id, address: farAnswer.address, display_name: farAnswer.display_name } };
  }
  return { rejected: { installation_key: hint.installation_key, why: (farAnswer && farAnswer.why) || 'the far installation does not confirm it' } };
}

/** → { ok, found, verified:[{ installation_key, domain, bridge_id, address, display_name }], rejected:[{ installation_key, why }] } */
async function locate(bridge_id) {
  const role = await netmember.roleOf();
  const pinnedMaster = role.role === 'member' ? netmember.pinned(role) : null;
  if (!pinnedMaster) return failed('this installation is not a network member with a pinned master');
  const hints = await askMaster(pinnedMaster, { want: 'locate', bridge_id });
  if (!hints.ok) return failed(hints.why);
  const verified = [];
  const rejected = [];
  for (const hint of hints.hints || []) {
    const checked = await confirmHint(hint, bridge_id);
    if (checked.verified) verified.push(checked.verified);
    else rejected.push(checked.rejected);
  }
  return { ok: true, found: verified.length > 0, verified, rejected };
}

module.exports = { pullMember, pullMaster, locate, takeCertificate, takeDirectory, pullOne };
