#!/usr/bin/env node
// @type: unit
/**
 * sec3-s13-ssrf-ranges.test.cjs — S13 (VERIFY-EL-SECURITY): the outbound-URL block list missed several special-use ranges.
 * ATTACK    a connector or CTP address whose DNS name resolves to a NAT64 / 6to4 / benchmarking / multicast / reserved address that fronts an internal service passes the "public https only" check.
 * RULE      192.0.0.0/24, 198.18.0.0/15, 224.0.0.0/4, 240.0.0.0/4, 64:ff9b::/96, 2002::/16 and ff00::/8 are refused with the older ranges; public addresses still pass; the opt-in CB_CTP_ALLOW_PRIVATE says so at boot.
 * RUN       node tests/sec3-s13-ssrf-ranges.test.cjs        STANDARD  OWASP ASVS 4.0.3 V12.6.1 · API7:2023 (server side request forgery) · IANA special-purpose registries
 * CARD      23-connectors-and-integrations
 */
'use strict';
const safe = require('../lib/safe-url');
let bad = 0;
const t = (n, ok) => { process.stdout.write((ok ? 'ok   ' : 'FAIL ') + n + '\n'); if (!ok) bad++; };
const refused = ['192.0.0.8', '198.18.0.1', '198.19.255.255', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255', '64:ff9b::a00:1', '2002:c0a8:101::1', 'ff02::1',
  '169.254.169.254', '10.0.0.1', '127.0.0.1', '100.64.0.1', 'fe80::1', '::1', '::ffff:10.0.0.1'];
t('every special-use address is refused: ' + refused.join(' '), refused.every((a) => safe.isBlockedAddress(a)));
const open = ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '198.20.0.1', '223.255.255.255'];
t('public addresses still pass: ' + open.join(' '), open.every((a) => !safe.isBlockedAddress(a)));
delete process.env.CB_CTP_ALLOW_PRIVATE;
t('no boot notice when the opt-in is off', safe.allowPrivateNotice() === null);
process.env.CB_CTP_ALLOW_PRIVATE = '1';
t('the opt-in says so at boot (warn)', !!safe.allowPrivateNotice() && safe.allowPrivateNotice().level === 'warn');
process.exit(bad ? 1 : 0);
