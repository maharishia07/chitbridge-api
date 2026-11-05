'use strict';
// OWNS      what this installation is in the network (standalone | member | master), who it pinned as master, the door's membership verdict, the master's answers
//           to a member's questions, and the operator's issue / suspend / reinstate / register of a member.
// CALLED BY routes/ctp.js (the query and deliver doors, the manifest) · lib/netsync.js · tools/network-cert.cjs
// FLOW      door: sender known (peerByKey) → signature (their own key) → membership (here, against the PINNED master key) → the rest of the door as before
//           pull:  the master asks a member `registry_changes` (verified against the pinned key) · a member asks the master `certificate` and `directory`
// CARD      28-platform-and-operations/network-control-panel
/**
 * ⭐ DATA, NOT SEPARATE CODE. One build everywhere; `installation.network_role` (default standalone) says what this deployment is. A STANDALONE installation behaves exactly
 * as before this file existed: `doorVerdict` answers ok without looking at anything else. A MASTER also needs the network root key (CB_NETWORK_ROOT_KEY): the key is the
 * capability, the row is the label (a row alone could not issue anything, and "no master pinned = I am the master" would make every copy a master).
 *
 * ⭐ PINNED, NEVER FETCHED BLIND. A member's `CB_MASTER_DOMAIN`, `CB_MASTER_INSTALLATION` and `CB_MASTER_KEY` are written at install. Everything the master signs (a certificate, the
 * directory) and every question only the master may ask is checked against that key, never against a key read from a domain.
 *
 * ⚠️ THE MASTER IS NOT IN THE CHIT PATH. The door reads the sender's manifest (which carries its certificate) and the revoked list this installation already holds; it never
 * calls the master. Master down → trading on valid certificates goes on.
 *
 * ⚠️ IDS AND COUNTS ONLY. `registry_changes` carries bridge ids, kind, world and status. No handle, name, contact or money ever leaves a member (DPDP / AU APP 8 / GDPR).
 */
const { query } = require('../db');
const log = require('./logger');
const keys = require('./ctpkeys');
const netcert = require('./netcert');
const schema = require('./schema');

const ROLE_TTL_MS = 60 * 1000;
/* asked by the master only, verified against the pinned key, answered by a member */
const MASTER_ASKS = ['registry_changes'];
/* answered by the master only */
const MEMBER_ASKS = ['certificate', 'directory', 'locate'];
/* a lapsed member must still be able to ask these: it is how it renews and learns the list (the master is trusted by pinned key, not by a certificate) */
const OPEN_TO_ANY_PEER = ['certificate', 'directory'];

let roleMemo = null; /* { at, value } */
const ownKey = () => process.env.INSTALLATION_KEY || 'platform-0';

/** this installation's role: { role, keyed } — `role` from its own installation row (a pre-b790 database answers standalone), `keyed` = holds the network root key */
async function roleOf() {
  if (roleMemo && Date.now() - roleMemo.at < ROLE_TTL_MS) return roleMemo.value;
  let role = 'standalone';
  try {
    const ownRow = await query(`SELECT to_jsonb(i) ->> 'network_role' AS network_role FROM installation i WHERE i.installation_key = $1 AND i.hosted_locally`, [ownKey()]);
    role = (ownRow.rows[0] && ownRow.rows[0].network_role) || 'standalone';
  } catch (e) {
    log.fellBack('netmember roleOf: the read failed — answered standalone', e);
  }
  const keyed = keys.status('network').can_sign;
  roleMemo = { at: Date.now(), value: { role: role === 'master' && !keyed ? 'standalone' : role, keyed, row: role } };
  return roleMemo.value;
}

/** who this installation pinned as its master: { installation_key, domain, public_key } | null. A master pins itself. */
function pinned(role) {
  if (role && role.role === 'master') {
    return { installation_key: ownKey(), domain: null, public_key: keys.status('network').public_key };
  }
  const domain = String(process.env.CB_MASTER_DOMAIN || '').trim().toLowerCase();
  const installation_key = String(process.env.CB_MASTER_INSTALLATION || '').trim();
  const public_key = String(process.env.CB_MASTER_KEY || '').replace(/\\n/g, '\n').trim();
  return domain && installation_key && public_key ? { installation_key, domain, public_key } : null;
}

const refusal = (status, code, sentence) => ({ ok: false, status, code, why: sentence });

/** the revoked serials this installation holds (the master's own list, or the last signed list a member pulled) */
async function revokedSet() {
  if (!(await schema.hasTable('network_revoked'))) return new Set();
  const revoked = await query('SELECT serial FROM network_revoked');
  return new Set(revoked.rows.map((x) => x.serial));
}

/** one membership judgement for a sender: from the manifest we hold, or (once, rate-limited) a fresh read so a renewed certificate is seen at once */
async function judge(pinnedMaster, sender, manifest) {
  return netcert.check(manifest && manifest.membership, { pin: pinnedMaster, who: { installation_key: sender.installation_key, domain: sender.domain, public_key: manifest && manifest.public_key }, revoked: await revokedSet() });
}

const HEALABLE = ['CTP_NO_MEMBERSHIP', 'CTP_MEMBERSHIP_LAPSED', 'CTP_MEMBERSHIP_MISMATCH', 'CTP_MEMBERSHIP_NOT_YET'];

/** after a fresh read: the newer judgement wins, unless it only says "no certificate" where the first read found one and said why it fails (a lapse is more useful than a silence) */
function laterVerdict(first, fresh) {
  return fresh.ok || fresh.code !== 'CTP_NO_MEMBERSHIP' || first.code === 'CTP_NO_MEMBERSHIP' ? fresh : first;
}

/**
 * doorVerdict(ik, peer, manifest) → { ok:true } | { ok:false, status:403, code, why }.
 * Standalone: ok (nothing changes today). Otherwise the sender must be the pinned master or hold a valid certificate signed by the pinned key.
 */
async function doorVerdict(senderKey, peer, manifest) {
  const role = await roleOf();
  if (role.role === 'standalone') return { ok: true };
  const pinnedMaster = pinned(role);
  if (!pinnedMaster) return refusal(403, 'CTP_NO_MASTER_PINNED', 'this installation is a network member but has no master pinned (CB_MASTER_KEY), so it cannot check anyone’s membership and refuses');
  if (senderKey === pinnedMaster.installation_key) return { ok: true }; /* the master is trusted by the pinned key, not by a certificate */
  const sender = { installation_key: senderKey, domain: peer.domain };
  let verdict = await judge(pinnedMaster, sender, manifest);
  if (!verdict.ok && HEALABLE.includes(verdict.code)) {
    const again = await require('./ctpdirectory').manifestFor(peer.domain, { fresh: true });
    if (again.ok && again.manifest !== manifest) verdict = laterVerdict(verdict, await judge(pinnedMaster, sender, again.manifest));
  }
  return verdict.ok ? { ok: true, cert: verdict.cert } : refusal(403, verdict.code, verdict.why);
}

/**
 * queryGate(want, ik) → { pinnedKey } | { refuse } | {}.
 *  · a master-only question (registry_changes) must come from the pinned master and is verified with the PINNED key, not the key on its domain
 *  · a question only the master answers is refused anywhere else, in words
 *  · {} → the usual door (their own key from their own manifest)
 */
async function queryGate(want, askerKey) {
  const role = await roleOf();
  if (MASTER_ASKS.includes(want)) {
    const pinnedMaster = role.role === 'standalone' ? null : pinned(role);
    if (!pinnedMaster || askerKey !== pinnedMaster.installation_key || !pinnedMaster.public_key) return { refuse: refusal(403, 'CTP_NOT_MASTER', 'only this installation’s network master may ask that') };
    return { pinnedKey: role.role === 'master' ? null : pinnedMaster.public_key, master: true };
  }
  if (MEMBER_ASKS.includes(want) && role.role !== 'master') return { refuse: refusal(403, 'CTP_NOT_A_MASTER', 'this installation is not a network master, so it does not answer that') };
  return {};
}

/** which questions need the asker to hold a valid certificate (everything a peer may ask except renewing and the directory) */
const needsMembership = (want) => !OPEN_TO_ANY_PEER.includes(want) && !MASTER_ASKS.includes(want);

/* ── what a member publishes ───────────────────────────────────────────────────────────────────────────── */

/** the newest certificate this installation holds for itself, as published in its manifest (`membership`), or null. A lapsed one is still published: the receiving door says it lapsed, which beats saying it holds none. */
async function ownMembership() {
  if (!(await schema.hasTable('membership_certificate'))) return null;
  const newest = await query(
    `SELECT cert, signature FROM membership_certificate WHERE installation_key = $1 AND status = 'active' ORDER BY not_after DESC LIMIT 1`,
    [ownKey()]
  );
  const row = newest.rows[0];
  if (!row) return null;
  return { cert: row.cert, sealed: { alg: 'ed25519', hash: require('./canon').hash(row.cert), sig: row.signature } };
}

/** the fingerprint a master publishes of its network key, so a joining installation can compare it with what it was told */
function networkFingerprint() {
  const networkKey = keys.status('network');
  return networkKey.can_sign ? netcert.fingerprint(networkKey.public_key) : null;
}

/* ── the master's answers ──────────────────────────────────────────────────────────────────────────────── */

/** the newest usable certificate for the asking installation, or why there is none (suspended / revoked / lapsed / never issued) */
async function answerCertificate(askerKey) {
  const certificates = await query(`SELECT cert, signature, status, not_after FROM membership_certificate WHERE installation_key = $1 ORDER BY issued_at DESC LIMIT 5`, [askerKey]);
  const live = certificates.rows.find((x) => x.status === 'active' && new Date(x.not_after) > new Date());
  if (live) return { ok: true, found: true, membership: { cert: live.cert, sealed: { alg: 'ed25519', hash: require('./canon').hash(live.cert), sig: live.signature } } };
  const held = certificates.rows[0];
  const reason = !held ? 'no certificate has been issued to ' + askerKey : held.status !== 'active' ? 'the certificate of ' + askerKey + ' is ' + held.status : 'the certificate of ' + askerKey + ' lapsed and has not been renewed';
  return { ok: true, found: false, why: reason };
}

/** members the master lists as peers: certified (active, unexpired) installations other than the asker — the default talk policy is "every certified member" */
async function certifiedPeers(askerKey) {
  const peers = await query(
    `SELECT i.installation_key, i.domain, i.ctp_endpoint, i.country, i.label
       FROM installation i
      WHERE NOT i.hosted_locally AND i.active AND i.installation_key <> $1
        AND EXISTS (SELECT 1 FROM membership_certificate c WHERE c.installation_key = i.installation_key AND c.status = 'active' AND c.not_after > now())
      ORDER BY i.installation_key`,
    [askerKey]
  );
  return peers.rows;
}

/** the signed directory: the peers this member may talk to and the serials that no longer count. One seal, checked against the pinned key. */
async function answerDirectory(askerKey) {
  const directory = {
    v: 1,
    at: new Date().toISOString(),
    for: askerKey,
    revoked: Array.from(await revokedSet()).sort(),
    peers: (await certifiedPeers(askerKey)).map((peer) => ({ installation_key: peer.installation_key, domain: peer.domain, endpoint: peer.ctp_endpoint, country: peer.country, label: peer.label }))
  };
  return { ok: true, found: true, directory, sealed: netcert.seal(directory) };
}

/** where does this bridge id live? A LIST of hints (a bridge id is unique inside one database only), nothing else. The caller verifies each at its own domain. */
async function answerLocate(bridge_id) {
  const hints = await query(
    `SELECT e.installation_key, i.domain FROM registry_entry e JOIN installation i ON i.installation_key = e.installation_key
      WHERE e.bridge_id = $1 AND coalesce(e.status, 'active') <> 'closed' AND i.active ORDER BY (e.status = 'active') DESC, e.installation_key LIMIT 10`,
    [String(bridge_id)]
  );
  return { ok: true, found: hints.rows.length > 0, hints: hints.rows.map((x) => ({ installation_key: x.installation_key, domain: x.domain })), why: hints.rows.length ? undefined : 'the network registry holds no business with that id' };
}

/* ── a member's answer to the master ───────────────────────────────────────────────────────────────────── */

/** the outbox after `after`: ids, kind, world, status. `entities` is how many businesses the outbox has ever named, so the master can notice a gap. */
async function answerChanges(after, limit) {
  const changes = await query('SELECT seq, bridge_id, entity_type, population, status, change FROM registry_change WHERE seq > $1 ORDER BY seq LIMIT $2', [after, limit]);
  const counts = await query('SELECT count(DISTINCT bridge_id)::int AS entities, coalesce(max(seq), 0)::bigint AS last_seq FROM registry_change');
  return { ok: true, found: true, changes: changes.rows.map((x) => Object.assign({}, x, { seq: Number(x.seq) })), entities: counts.rows[0].entities, last_seq: Number(counts.rows[0].last_seq) };
}

/** one dispatcher for the door: the answer to a network question (`ik` = the asker, already verified) */
async function answer(question, askerKey) {
  if (question.want === 'registry_changes') return answerChanges(question.after || 0, question.limit || 500);
  if (question.want === 'certificate') return answerCertificate(askerKey);
  if (question.want === 'directory') return answerDirectory(askerKey);
  if (question.want === 'locate') return answerLocate(question.bridge_id);
  return { ok: false, why: 'not a question this installation answers' };
}

/* ── the operator's verbs (tools/network-cert.cjs) ─────────────────────────────────────────────────────── */

/** the next root handle for a scope: cb<scope><nn>-root, nn from 01 (00 is the master's own). The master allocates, so two creates cannot collide. */
async function nextRootHandle(scope) {
  const slug = String(scope || '').toLowerCase();
  if (!/^[a-z]{2,6}$/.test(slug)) throw new Error('a scope is a country code or a short slug of 2 to 6 letters');
  const handles = await query(`SELECT root_handle FROM installation WHERE root_handle ~ $1`, ['^cb' + slug + '[0-9]{2}-root$']);
  const taken = handles.rows.map((x) => Number(x.root_handle.slice(2 + slug.length, 4 + slug.length)));
  const next = taken.length ? Math.max.apply(null, taken) + 1 : 1;
  if (next > 99) throw new Error('scope ' + slug + ' has no free number left');
  return 'cb' + slug + String(next).padStart(2, '0') + '-root';
}

/** add (or update) a member's row on the master: remote, with the endpoint that takes envelopes. The row is the member registry (no second table). */
async function registerMember(member) {
  const endpoint = 'https://' + member.domain + '/api/ctp/deliver';
  await query(
    `INSERT INTO installation (installation_key, label, purpose, cloud_provider, region, domain, vertical_key, hosted_locally, ctp_endpoint, country, network_role, root_handle, root_bridge_id)
     VALUES ($1, $2, 'network', $3, $4::text, $5, 'base', false, $6, $4::text, 'member', $7, $8)
     ON CONFLICT (installation_key) DO UPDATE SET domain = EXCLUDED.domain, ctp_endpoint = EXCLUDED.ctp_endpoint, active = true, hosted_locally = false, network_role = 'member',
       label = coalesce(EXCLUDED.label, installation.label), country = coalesce(EXCLUDED.country, installation.country), region = coalesce(EXCLUDED.region, installation.region),
       root_handle = coalesce(EXCLUDED.root_handle, installation.root_handle), root_bridge_id = coalesce(EXCLUDED.root_bridge_id, installation.root_bridge_id)
     WHERE NOT installation.hosted_locally`,
    [member.installation_key, member.label || member.installation_key, member.cloud || 'oracle', member.country || null, member.domain, endpoint, member.root_handle || null, member.root_bridge_id || null]
  );
  return { installation_key: member.installation_key, domain: member.domain, endpoint };
}

/** the member's published key, read from ITS OWN manifest (the only place a key is trusted from) */
async function memberManifest(row) {
  const fetched = await require('./ctpdirectory').manifestFor(row.domain, { fresh: true });
  if (!fetched.ok) throw new Error('could not read ' + row.domain + ': ' + fetched.why);
  if (fetched.manifest.installation_key !== row.installation_key) throw new Error(row.domain + ' says it is ' + fetched.manifest.installation_key + ', not ' + row.installation_key);
  return fetched.manifest;
}

/** issue a certificate to a registered member. life_ms defaults to 30 days; SIT passes 10 minutes. */
async function issueTo(installation_key, opts) {
  const memberRow = await query('SELECT installation_key, domain, hosted_locally FROM installation WHERE installation_key = $1 AND active', [installation_key]);
  const row = memberRow.rows[0];
  if (!row || row.hosted_locally) throw new Error(installation_key + ' is not a registered member (register it first)');
  const manifest = await memberManifest(row);
  const issued = netcert.issue({ installation_key, domain: row.domain, public_key: manifest.public_key, accepts_populations: manifest.accepts_populations, life_ms: opts && opts.life_ms, issued_by: ownKey() });
  await query(
    `INSERT INTO membership_certificate (serial, installation_key, cert, signature, not_before, not_after, status) VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
    [issued.cert.serial, installation_key, issued.cert, issued.sealed.sig, issued.cert.not_before, issued.cert.not_after]
  );
  return issued.cert;
}

/** suspend (certificates stay on file but no longer count; reinstate undoes it) or revoke (permanent). Writes the status AND the revoked list in one place. */
async function setStanding(installation_key, standing, reason) {
  const status = standing === 'revoked' ? 'revoked' : standing === 'suspended' ? 'suspended' : 'active';
  const updated = await query(`UPDATE membership_certificate SET status = $2, note = $3 WHERE installation_key = $1 AND status <> 'revoked' RETURNING serial`, [installation_key, status, reason || null]);
  const serials = updated.rows.map((x) => x.serial);
  if (status === 'active') await query('DELETE FROM network_revoked WHERE serial = ANY($1)', [serials]);
  else await query(`INSERT INTO network_revoked (serial, reason) SELECT s, $2 FROM unnest($1::text[]) AS s ON CONFLICT (serial) DO UPDATE SET reason = EXCLUDED.reason`, [serials, reason || status]);
  /* revoked is for good: the master stops dealing with it (no more pulls, its domain free for whoever holds it next; SIT run 4). Its mirrored ids stay as history. */
  if (status === 'revoked') await query(`UPDATE installation SET active = false WHERE installation_key = $1 AND NOT hosted_locally`, [installation_key]);
  return { installation_key, status, serials };
}

/** forget the memo (tests, and after an operator verb) */
function _reset() {
  roleMemo = null;
}

module.exports = {
  roleOf, pinned, doorVerdict, queryGate, needsMembership, ownMembership, networkFingerprint, answer, nextRootHandle, registerMember, issueTo, setStanding,
  revokedSet, ownKey, judge, _reset, MASTER_ASKS, MEMBER_ASKS, OPEN_TO_ANY_PEER
};
