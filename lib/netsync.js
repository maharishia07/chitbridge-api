'use strict';
// OWNS      the network's PULLS: a member fetches its certificate and the signed directory from the pinned master; the master reads each member's registry_change by sequence;
//           a certified member asks the master where a bridge id lives and VERIFIES the hint at the far domain.
// CALLED BY tools/network-sync.cjs (run by cron every minute in SIT) · tests/network-sync.test.cjs
// FLOW      member: ask master `certificate` → check against the pinned key → store · ask `directory` → check the seal → revoked list + peer rows
//           master: for each member → ask `registry_changes` after the cursor → upsert registry_entry → move the cursor → compare the count (a gap → one full resync)
//           locate: ask master `locate` → for each hint, ask THAT domain `resolve` → keep only what the far installation itself confirms
// CARD      28-platform-and-operations/network-control-panel
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
const net = require('./netmember');
const ctpquery = require('./ctpquery');

const failed = (why) => ({ ok: false, why });

/** a question to the pinned master, signed with this installation's own key (the master reads it against our manifest) */
async function askMaster(pin, ask) {
  return ctpquery.ask({ domain: pin.domain }, ask, {});
}

/** keep the certificate the master sent, after proving it is for US, signed by the PINNED key, and in date */
async function takeCertificate(pin, body) {
  if (!body.found) return failed(body.why || 'the master has no certificate for this installation');
  const self = (await query(`SELECT domain FROM installation WHERE installation_key = $1 AND hosted_locally`, [net.ownKey()])).rows[0];
  const verdict = netcert.check(body.membership, {
    pin,
    who: { installation_key: net.ownKey(), domain: self && self.domain, public_key: keys.status().public_key },
    revoked: await net.revokedSet()
  });
  if (!verdict.ok) return failed('the master’s certificate is refused here: ' + verdict.why);
  const c = verdict.cert;
  await query(
    `INSERT INTO membership_certificate (serial, installation_key, cert, signature, not_before, not_after, status) VALUES ($1, $2, $3, $4, $5, $6, 'active') ON CONFLICT (serial) DO NOTHING`,
    [c.serial, c.installation_key, c, body.membership.sealed.sig, c.not_before, c.not_after]
  );
  return { ok: true, serial: c.serial, not_after: c.not_after };
}

/** replace the revoked list and the network peer rows with what the signed directory says (peers the master dropped are deactivated; hand-made peers are left alone) */
async function takeDirectory(pin, body) {
  if (!body.found || !body.directory) return failed(body.why || 'the master sent no directory');
  const sealed = netcert.unseal(body.directory, body.sealed, pin.public_key);
  if (!sealed.ok) return failed('the master’s directory is refused here: ' + sealed.why);
  const d = body.directory;
  if (d.for !== net.ownKey()) return failed('the directory was written for ' + d.for + ', not for this installation');
  await query('DELETE FROM network_revoked WHERE serial <> ALL($1::text[])', [d.revoked]);
  await query(`INSERT INTO network_revoked (serial, reason) SELECT s, 'master list' FROM unnest($1::text[]) AS s ON CONFLICT (serial) DO NOTHING`, [d.revoked]);
  for (const p of d.peers) await upsertPeer(p);
  await query(`UPDATE installation SET active = false WHERE purpose = 'network' AND NOT hosted_locally AND active AND installation_key <> ALL($1::text[])`, [d.peers.map((p) => p.installation_key)]);
  return { ok: true, revoked: d.revoked.length, peers: d.peers.map((p) => p.installation_key) };
}

/** a peer the master introduced: a REMOTE installation row (never touches a row hosted here, nor the pinned master's row) */
async function upsertPeer(p) {
  await query(
    `INSERT INTO installation (installation_key, label, purpose, cloud_provider, domain, vertical_key, hosted_locally, ctp_endpoint, country)
     VALUES ($1, $2, 'network', 'oracle', $3, 'base', false, $4, $5)
     ON CONFLICT (installation_key) DO UPDATE SET domain = EXCLUDED.domain, ctp_endpoint = EXCLUDED.ctp_endpoint, active = true, country = coalesce(EXCLUDED.country, installation.country)
     WHERE NOT installation.hosted_locally AND installation.purpose IN ('network', 'sit-peer')`,
    [p.installation_key, p.label || p.installation_key, p.domain, p.endpoint, p.country || null]
  );
}

/** a member's whole pull: its certificate, then the directory. Each part reports on its own, so one failure does not hide the other. */
async function pullMember() {
  const role = await net.roleOf();
  const pin = role.role === 'member' ? net.pinned(role) : null;
  if (!pin) return failed('this installation is not a network member with a pinned master');
  const out = { ok: true, master: pin.installation_key };
  const cert = await askMaster(pin, { want: 'certificate' });
  out.certificate = cert.ok ? await takeCertificate(pin, cert) : failed(cert.why);
  const dir = await askMaster(pin, { want: 'directory' });
  out.directory = dir.ok ? await takeDirectory(pin, dir) : failed(dir.why);
  out.ok = out.certificate.ok && out.directory.ok;
  return out;
}

/* ── the master reads a member ─────────────────────────────────────────────────────────────────────────── */

async function cursorOf(ik) {
  const r = await query('SELECT last_seq FROM registry_cursor WHERE installation_key = $1', [ik]);
  return r.rows[0] ? Number(r.rows[0].last_seq) : 0;
}

async function applyChanges(ik, changes) {
  for (const c of changes) {
    await query(
      `INSERT INTO registry_entry (installation_key, bridge_id, entity_type, population, status) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (installation_key, bridge_id) DO UPDATE SET entity_type = EXCLUDED.entity_type, population = EXCLUDED.population, status = EXCLUDED.status, seen_at = now()`,
      [ik, c.bridge_id, c.entity_type, c.population, c.status]
    );
  }
}

async function noteCursor(ik, seq, entities, error) {
  await query(
    `INSERT INTO registry_cursor (installation_key, last_seq, entities, pulled_at, last_error) VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (installation_key) DO UPDATE SET last_seq = EXCLUDED.last_seq, entities = EXCLUDED.entities, pulled_at = now(), last_error = EXCLUDED.last_error`,
    [ik, seq, entities, error || null]
  );
}

/** read one member from its cursor. A count that disagrees with ours means a gap: forget what we hold for it and read again from 0, once. */
async function pullOne(row, again) {
  const asker = { signer: keys.signer('network'), from: { installation_key: net.ownKey(), population: 'live' } };
  const after = again ? 0 : await cursorOf(row.installation_key);
  /* the member is asked at ITS registered row (key + endpoint), never "whoever answers this domain now": a domain can change hands (SIT run 4) */
  const at = { installation_key: row.installation_key, endpoint: row.ctp_endpoint, domain: row.domain };
  const got = await ctpquery.ask({ domain: row.domain }, { want: 'registry_changes', after, limit: 500 }, Object.assign({ resolvePeer: async () => at }, asker));
  if (!got.ok) {
    await noteCursor(row.installation_key, after, null, got.why);
    return { installation_key: row.installation_key, ok: false, why: got.why };
  }
  await applyChanges(row.installation_key, got.changes);
  const last = got.changes.length ? got.changes[got.changes.length - 1].seq : after;
  const held = (await query('SELECT count(*)::int AS n FROM registry_entry WHERE installation_key = $1', [row.installation_key])).rows[0].n;
  await noteCursor(row.installation_key, last, got.entities, null);
  if (got.changes.length && last < got.last_seq) return pullOne(row, false); /* more to read */
  if (held !== got.entities && !again) {
    await query('DELETE FROM registry_entry WHERE installation_key = $1', [row.installation_key]);
    log.warn('netsync.resync', { installation_key: row.installation_key, held, member_says: got.entities });
    return Object.assign(await pullOne(row, true), { resynced: true });
  }
  return { installation_key: row.installation_key, ok: held === got.entities, entities: held, last_seq: last, why: held === got.entities ? undefined : 'the count still differs after a full read: ours ' + held + ', theirs ' + got.entities };
}

/** the master's pull of every registered member (ids and counts only) */
async function pullMaster() {
  const role = await net.roleOf();
  if (role.role !== 'master') return failed('this installation is not a network master');
  const rows = (await query(`SELECT installation_key, domain, ctp_endpoint FROM installation WHERE NOT hosted_locally AND active AND network_role = 'member' ORDER BY installation_key`)).rows;
  const members = [];
  for (const row of rows) members.push(await pullOne(row, false));
  return { ok: members.every((m) => m.ok), members };
}

/* ── locate: a hint from the master, verified where the business lives ────────────────────────────────── */

/** → { ok, found, verified:[{ installation_key, domain, bridge_id, address, display_name }], rejected:[{ installation_key, why }] } */
async function locate(bridge_id) {
  const role = await net.roleOf();
  const pin = role.role === 'member' ? net.pinned(role) : null;
  if (!pin) return failed('this installation is not a network member with a pinned master');
  const hints = await askMaster(pin, { want: 'locate', bridge_id });
  if (!hints.ok) return failed(hints.why);
  const verified = [];
  const rejected = [];
  for (const h of hints.hints || []) {
    const far = await ctpquery.ask({ domain: h.domain, bridge_id }, { want: 'resolve', handle: bridge_id }, {});
    if (far.ok && far.found && far.installation_key === h.installation_key) verified.push({ installation_key: h.installation_key, domain: h.domain, bridge_id: far.bridge_id, address: far.address, display_name: far.display_name });
    else rejected.push({ installation_key: h.installation_key, why: (far && far.why) || 'the far installation does not confirm it' });
  }
  return { ok: true, found: verified.length > 0, verified, rejected };
}

module.exports = { pullMember, pullMaster, locate, takeCertificate, takeDirectory, pullOne };
