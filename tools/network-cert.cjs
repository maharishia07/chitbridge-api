#!/usr/bin/env node
/**
 * tools/network-cert.cjs — the network master's operator verbs (no screen yet). Run INSIDE the api container of the master:
 *   docker compose exec -T api node tools/network-cert.cjs <verb> …
 *
 *   show                                     what this installation is: its role, whether it holds the network key, the key's fingerprint (public)
 *   fingerprint                              the master's network public key (PEM) and its fingerprint: what a joining installation pins and compares
 *   next-handle <scope>                      the next free root handle for a scope (in, au, ae … or a 2-6 letter slug): cb<scope><nn>-root
 *   register <key> <domain> [--country AU] [--root-handle cbau01-root] [--root-bridge CB…]   add a member's row (remote, with its endpoint)
 *   issue <key> [--minutes N]                issue a certificate (default 30 days; SIT uses 10 minutes to prove a lapse)
 *   suspend <key> [--reason words]           its certificates stop counting at the next pull; its own shops and data are untouched
 *   reinstate <key>                          the opposite of suspend (a revoked one stays revoked)
 *   revoke <key> [--reason words]            permanent
 *   list                                     members, their certificate state and how many businesses the registry holds (ids and counts only)
 *
 * ⚠️ Prints no secret: the private network key never leaves the environment; a fingerprint and a public key are public by design.
 * OWNS: nothing (a thin caller of lib/netmember.js and lib/netcert.js). CALLED BY: the operator; deploy/sit/spin.sh.
 * FLOW: argv verb → VERBS[verb] (lib/netmember: roleOf · nextRootHandle · registerMember · issueTo · setStanding; lib/netcert.fingerprint) → one JSON answer on stdout, exit 0;
 *       an unknown verb → the usage line, exit 2; a refused or failed verb → its words on stderr, exit 1. Tested by tests/network-tools.test.cjs.
 * CARD 28-platform-and-operations/network-control-panel
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const netmember = require(path.join(API, 'lib', 'netmember'));
const netcert = require(path.join(API, 'lib', 'netcert'));
const keys = require(path.join(API, 'lib', 'ctpkeys'));
const { query } = require(path.join(API, 'db'));

const flag = (args, name) => {
  const at = args.indexOf('--' + name);
  return at >= 0 ? args[at + 1] : undefined;
};
const need = (value, what) => {
  if (!value) throw new Error('missing ' + what);
  return value;
};

async function listMembers() {
  const members = await query(
    `SELECT i.installation_key, i.domain, i.country, i.network_role, i.root_handle, i.active,
            (SELECT count(*)::int FROM registry_entry e WHERE e.installation_key = i.installation_key) AS entities,
            (SELECT c.status || ' to ' || c.not_after::text FROM membership_certificate c WHERE c.installation_key = i.installation_key ORDER BY c.issued_at DESC LIMIT 1) AS certificate,
            (SELECT k.last_seq FROM registry_cursor k WHERE k.installation_key = i.installation_key) AS pulled_to
       FROM installation i WHERE NOT i.hosted_locally ORDER BY i.installation_key`
  );
  return members.rows;
}

const VERBS = {
  async show() {
    const role = await netmember.roleOf();
    const networkKey = keys.status('network');
    return { installation_key: netmember.ownKey(), role: role.role, row_says: role.row, holds_network_key: networkKey.can_sign, network_fingerprint: netmember.networkFingerprint(), why: networkKey.why };
  },
  async fingerprint() {
    const networkKey = keys.status('network');
    if (!networkKey.can_sign) throw new Error('this installation holds no network root key: ' + networkKey.why);
    return { public_key: networkKey.public_key, fingerprint: netcert.fingerprint(networkKey.public_key) };
  },
  async 'next-handle'(args) {
    return { handle: await netmember.nextRootHandle(need(args[0], 'a scope')) };
  },
  async register(args) {
    return netmember.registerMember({
      installation_key: need(args[0], 'the installation key'),
      domain: need(args[1], 'the domain'),
      country: flag(args, 'country'),
      label: flag(args, 'label'),
      root_handle: flag(args, 'root-handle'),
      root_bridge_id: flag(args, 'root-bridge')
    });
  },
  async issue(args) {
    const minutes = Number(flag(args, 'minutes'));
    const cert = await netmember.issueTo(need(args[0], 'the installation key'), { life_ms: minutes > 0 ? minutes * 60 * 1000 : undefined });
    return { serial: cert.serial, installation_key: cert.installation_key, not_before: cert.not_before, not_after: cert.not_after };
  },
  async suspend(args) {
    return netmember.setStanding(need(args[0], 'the installation key'), 'suspended', flag(args, 'reason') || 'suspended by the master');
  },
  async reinstate(args) {
    return netmember.setStanding(need(args[0], 'the installation key'), 'active', null);
  },
  async revoke(args) {
    return netmember.setStanding(need(args[0], 'the installation key'), 'revoked', flag(args, 'reason') || 'revoked by the master');
  },
  async list() {
    return listMembers();
  }
};

(async () => {
  const [verb, ...args] = process.argv.slice(2);
  if (!VERBS[verb]) {
    console.error('usage: network-cert.cjs ' + Object.keys(VERBS).join(' | '));
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(await VERBS[verb](args), null, 2));
    process.exit(0);
  } catch (e) {
    console.error('network-cert: ' + e.message);
    process.exit(1);
  }
})();
