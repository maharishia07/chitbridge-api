'use strict';
// @stage poc
// OWNS assertPublicHttps / isBlockedAddress (SSRF guard for outbound fetches to a host a stranger names) · CALLED BY lib/ctpdirectory.js, lib/ctptransport.js
// FLOW url → https only → resolve every address (dns, all) → any loopback/private/link-local/CGNAT/unspecified/mapped → refuse      CARD 01-rail-core-the-chit/ctp-outbound-guard
// @stage-note SEC-80. A peer address is data a stranger supplies; without this the server would dial its own
//             loopback, the private network or the cloud metadata address (169.254.169.254) on their behalf.
// @stage-why  One guard in one place, so the two CTP fetches cannot drift apart.
/**
 * assertPublicHttps(url) gives { ok:true } or { ok:false, why }. It never throws and sends nothing.
 *
 * ⚠️ KNOWN LIMIT: we resolve here and fetch() resolves again, so a host that answers differently the second
 * time (DNS rebinding) can slip past. Closing it needs a pinned-address agent; not built.
 *
 * Local development only: CB_CTP_ALLOW_PRIVATE=1 lifts the check (http and private addresses allowed).
 * Off unless set; never default it on.
 */
const log = require('./logger');
const netTools = require('net');
const dnsPromises = require('dns').promises;

const blockedRanges = new netTools.BlockList();
[['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]].forEach(
  (range) => blockedRanges.addSubnet(range[0], range[1], 'ipv4')
);
[['fc00::', 7], ['fe80::', 10]].forEach((range) => blockedRanges.addSubnet(range[0], range[1], 'ipv6'));
blockedRanges.addAddress('::1', 'ipv6');
blockedRanges.addAddress('::', 'ipv6');

/** ::ffff:a.b.c.d (dotted, or the hex form URL() normalises to) gives a.b.c.d, else null */
function unmapV4(address) {
  const parts = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(address);
  if (!parts) return null;
  if (parts[1]) return parts[1];
  const high = parseInt(parts[2], 16);
  const lowPart = parseInt(parts[3], 16);
  return [high >> 8, high & 255, lowPart >> 8, lowPart & 255].join('.');
}

/** True when the literal address is loopback, private, link-local, unspecified, CGNAT or a mapped form of those. */
function isBlockedAddress(address) {
  const family = netTools.isIP(address);
  if (!family) return true; /* not an address at all: refuse rather than guess */
  if (family === 4) return blockedRanges.check(address, 'ipv4');
  const mapped = unmapV4(address);
  if (mapped) return blockedRanges.check(mapped, 'ipv4');
  return blockedRanges.check(address, 'ipv6');
}

/** the explicit local-development opt-in, off unless set */
const allowPrivate = () => process.env.CB_CTP_ALLOW_PRIVATE === '1';

/** every address a host name (or literal) stands for */
async function addressesOf(host, lookup) {
  const bare = host.replace(/^\[|\]$/g, '');
  if (netTools.isIP(bare)) return [bare];
  const rows = await (lookup || dnsPromises.lookup)(bare, { all: true });
  return rows.map((row) => row.address);
}

/** the plain-words reason a host is refused, or null when every address is public */
async function refusalFor(url, lookup) {
  try {
    const addresses = await addressesOf(url.hostname, lookup);
    if (!addresses.length) return 'the host did not resolve — nothing was sent';
    if (addresses.some(isBlockedAddress)) return 'that address points at a private or internal network — nothing was sent';
    return null;
  } catch (err) {
    log.fellBack('safe-url: host lookup failed — the fetch is refused', err, 'debug');
    return 'the host could not be looked up — nothing was sent';
  }
}

/** the guard: https only, and every address public */
async function assertPublicHttps(url, opts) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (err) {
    log.fellBack('safe-url: not a web address — the fetch is refused', err, 'debug');
    return { ok: false, why: 'that address is not a web address — nothing was sent' };
  }
  if (allowPrivate()) return { ok: true };
  if (parsed.protocol !== 'https:') return { ok: false, why: 'only https addresses are allowed — nothing was sent' };
  const reason = await refusalFor(parsed, opts && opts.lookup);
  return reason ? { ok: false, why: reason } : { ok: true };
}

module.exports = { assertPublicHttps, isBlockedAddress };
