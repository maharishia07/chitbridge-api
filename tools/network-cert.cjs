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
 *   list                                     this installation and its members: certificate state, businesses held (ids and counts only), last pull, version and last seen (lib/netmember.listMembers, the panel's reader too)
 *
 * ⚠️ Prints no secret: the private network key never leaves the environment; a fingerprint and a public key are public by design.
 * OWNS: nothing (a thin caller of lib/netmember.js and lib/netcert.js). CALLED BY: the operator; deploy/sit/spin.sh.
 * FLOW  argv verb → VERBS[verb](args) → lib/netmember (the one reader and the one writer of standing) → JSON on stdout
 * CARD 28-platform-and-operations/network-control-panel
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'lib', 'netmember'));
const netcert = require(path.join(API, 'lib', 'netcert'));
const keys = require(path.join(API, 'lib', 'ctpkeys'));

const flag = (args, name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const need = (v, what) => {
  if (!v) throw new Error('missing ' + what);
  return v;
};

const VERBS = {
  async show() {
    const role = await net.roleOf();
    const k = keys.status('network');
    return { installation_key: net.ownKey(), role: role.role, row_says: role.row, holds_network_key: k.can_sign, network_fingerprint: net.networkFingerprint(), why: k.why };
  },
  async fingerprint() {
    const k = keys.status('network');
    if (!k.can_sign) throw new Error('this installation holds no network root key: ' + k.why);
    return { public_key: k.public_key, fingerprint: netcert.fingerprint(k.public_key) };
  },
  async 'next-handle'(args) {
    return { handle: await net.nextRootHandle(need(args[0], 'a scope')) };
  },
  async register(args) {
    return net.registerMember({
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
    const cert = await net.issueTo(need(args[0], 'the installation key'), { life_ms: minutes > 0 ? minutes * 60 * 1000 : undefined });
    return { serial: cert.serial, installation_key: cert.installation_key, not_before: cert.not_before, not_after: cert.not_after };
  },
  async suspend(args) {
    return net.setStanding(need(args[0], 'the installation key'), 'suspended', flag(args, 'reason') || 'suspended by the master');
  },
  async reinstate(args) {
    return net.setStanding(need(args[0], 'the installation key'), 'active', null);
  },
  async revoke(args) {
    return net.setStanding(need(args[0], 'the installation key'), 'revoked', flag(args, 'reason') || 'revoked by the master');
  },
  async list() {
    return net.listMembers();
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
