/**
 * tests/network-cert.test.cjs — THE CERTIFICATE, THE KEY SLOTS AND THE ROOT NAMES (PLT-45 / RAIL-97, 25 Oct 2026). Pure: no database, no network.
 *   · lib/ctpkeys holds a SECOND named key (CB_NETWORK_ROOT_KEY) beside CTP_PRIVATE_KEY, and neither reads the other
 *   · lib/netcert: a certificate is sealed over canon.hash, checked against a pinned key, bound to installation / domain / key, in date (start tolerant, end exact), not revoked;
 *     a 10-minute certificate lapses at 10 minutes (the SIT proof) and every refusal has a code and a sentence
 *   · the root handles the spin allocates (cb<scope><nn>-root) pass lib/handle.js, and the handles the design first proposed (cb + 8) are refused
 *   · the existing questions (resolve, catalogue) are built exactly as before; the network's new questions carry only the fields they need
 * On main: ctpkeys has one slot, there is no netcert, `-root` handles were never allocated and ctpquery knows two wants.
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
const API = path.join(__dirname, '..');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const keys = require(path.join(API, 'lib', 'ctpkeys'));
const netcert = require(path.join(API, 'lib', 'netcert'));
const ctpquery = require(path.join(API, 'lib', 'ctpquery'));
const handle = require(path.join(API, 'lib', 'handle'));

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (extra ? '\n          ' + extra : '')); } };

/* ── key slots ── */
const ctp = keys.generate();
const net = keys.generate('network');
t('generate(network) names CB_NETWORK_ROOT_KEY', Object.keys(net).includes('CB_NETWORK_ROOT_KEY') && !Object.keys(net).includes('CTP_PRIVATE_KEY'));
t('generate() still names CTP_PRIVATE_KEY', Object.keys(ctp).includes('CTP_PRIVATE_KEY'));
delete process.env.CTP_PRIVATE_KEY; delete process.env.CB_NETWORK_ROOT_KEY; keys._reset();
t('no key set → neither slot signs, and each says which variable is missing', !keys.status().can_sign && !keys.status('network').can_sign && /CTP_PRIVATE_KEY is not set/.test(keys.status().why) && /CB_NETWORK_ROOT_KEY is not set/.test(keys.status('network').why));
process.env.CB_NETWORK_ROOT_KEY = net.CB_NETWORK_ROOT_KEY; keys._reset();
t('the network slot signs; the ctp slot still does not (no cross-reading)', keys.status('network').can_sign && !keys.status().can_sign && keys.signer() === null);
t('an unknown slot does not sign', !keys.status('bogus').can_sign);
process.env.CTP_PRIVATE_KEY = ctp.CTP_PRIVATE_KEY; keys._reset();
t('both slots sign with different keys', keys.status().public_key !== keys.status('network').public_key && keys.status().can_sign && keys.status('network').can_sign);
process.env.CB_NETWORK_ROOT_KEY = 'not a pem'; keys._reset();
t('a broken network key is not "no key": it says unusable', /CB_NETWORK_ROOT_KEY is set but unusable/.test(keys.status('network').why));
process.env.CB_NETWORK_ROOT_KEY = net.CB_NETWORK_ROOT_KEY; keys._reset();

/* ── certificates ── */
const member = keys.generate().public_key; /* the member's published CTP key */
const other = keys.generate().public_key;
const NOW = new Date('2026-10-25T12:00:00Z');
const ctx = (patch) => Object.assign({
  pin: { installation_key: 'master-1', public_key: net.public_key },
  who: { installation_key: 'au-1', domain: 'au.example.com', public_key: member },
  now: NOW, revoked: []
}, patch);
const issued = netcert.issue({ installation_key: 'au-1', domain: 'AU.example.com', public_key: member, issued_by: 'master-1' }, NOW);
t('a certificate has the agreed shape', ['v', 'serial', 'installation_key', 'domain', 'public_key_hash', 'accepts_populations', 'not_before', 'not_after', 'issued_by'].every((k) => k in issued.cert) && issued.cert.domain === 'au.example.com');
t('default life is 30 days', Date.parse(issued.cert.not_after) - Date.parse(issued.cert.not_before) === 30 * 24 * 3600 * 1000);
t('it checks out against the pinned key', netcert.check(issued, ctx()).ok === true);
const refusal = (m, c) => netcert.check(m, c);
t('no certificate → CTP_NO_MEMBERSHIP naming the master', refusal(null, ctx()).code === 'CTP_NO_MEMBERSHIP' && /master-1/.test(refusal(null, ctx()).why));
t('a different pinned key → CTP_MEMBERSHIP_UNTRUSTED', refusal(issued, ctx({ pin: { installation_key: 'master-1', public_key: keys.generate('network').public_key } })).code === 'CTP_MEMBERSHIP_UNTRUSTED');
t('an edited certificate → untrusted (its contents do not match its seal)', refusal({ cert: Object.assign({}, issued.cert, { not_after: '2099-01-01T00:00:00.000Z' }), sealed: issued.sealed }, ctx()).why.includes('do not match its seal'));
t('an unsigned certificate → untrusted', refusal({ cert: issued.cert, sealed: null }, ctx()).code === 'CTP_MEMBERSHIP_UNTRUSTED');
t('another installation → mismatch', refusal(issued, ctx({ who: { installation_key: 'au-2', domain: 'au.example.com', public_key: member } })).code === 'CTP_MEMBERSHIP_MISMATCH');
t('another domain → mismatch', refusal(issued, ctx({ who: { installation_key: 'au-1', domain: 'x.example.com', public_key: member } })).code === 'CTP_MEMBERSHIP_MISMATCH');
t('another signing key (a copy of the installation) → mismatch', refusal(issued, ctx({ who: { installation_key: 'au-1', domain: 'au.example.com', public_key: other } })).code === 'CTP_MEMBERSHIP_MISMATCH');
t('the domain match ignores case', netcert.check(issued, ctx({ who: { installation_key: 'au-1', domain: 'AU.Example.com', public_key: member } })).ok);
t('revoked serial → CTP_MEMBERSHIP_REVOKED and the sentence says data is untouched', (() => { const r = refusal(issued, ctx({ revoked: new Set([issued.cert.serial]) })); return r.code === 'CTP_MEMBERSHIP_REVOKED' && /data are untouched/.test(r.why); })());

const MIN = 60 * 1000;
const short = netcert.issue({ installation_key: 'au-1', domain: 'au.example.com', public_key: member, life_ms: 10 * MIN }, NOW);
const at = (ms) => ctx({ now: new Date(NOW.getTime() + ms) });
t('a 10-minute certificate is good at 9:59', netcert.check(short, at(10 * MIN - 1000)).ok);
t('and exactly at 10:00', netcert.check(short, at(10 * MIN)).ok);
t('a second later it has lapsed → CTP_MEMBERSHIP_LAPSED with the date', (() => { const r = netcert.check(short, at(10 * MIN + 1000)); return r.code === 'CTP_MEMBERSHIP_LAPSED' && r.why.includes(short.cert.not_after); })());
t('a clock 4 minutes behind is tolerated at the start; 6 minutes is not (ONE skew constant: ctpquery MAX_AGE_MS)', netcert.check(short, at(-4 * MIN)).ok && netcert.check(short, at(-6 * MIN)).code === 'CTP_MEMBERSHIP_NOT_YET' && netcert.SKEW_MS === ctpquery.MAX_AGE_MS);
t('sealing needs the network key: without it, a clear error code', (() => { delete process.env.CB_NETWORK_ROOT_KEY; keys._reset(); try { netcert.issue({ installation_key: 'a', domain: 'b', public_key: member }); return false; } catch (e) { return e.code === 'NO_NETWORK_KEY'; } finally { process.env.CB_NETWORK_ROOT_KEY = net.CB_NETWORK_ROOT_KEY; keys._reset(); } })());
t('the fingerprint is the sha256 of the key, whatever the newline spelling', netcert.fingerprint(member) === netcert.fingerprint(member.replace(/\n/g, '\\n')) && /^[0-9a-f]{64}$/.test(netcert.fingerprint(member)));

/* ── names ── */
for (const ok of ['cbin01-root', 'cbau01-root', 'cbae01-root', 'cbau02-root', 'cbmaster00-root', 'cbgrund01-root', 'cbgl01-root', 'cbincroot']) t('handle ' + ok + ' passes handle.check', handle.check(ok).ok === true, JSON.stringify(handle.check(ok)));
for (const bad of ['cbau00root', 'cbin00root', 'cbgl00root']) t('handle ' + bad + ' (cb + 8) is refused as a User ID lookalike', handle.check(bad).ok === false);
t('the longest root handle fits the 20-character user id cap', 'cbgrund01-root'.length <= 20 && 'cbmaster00-root'.length <= 20);

/* ── questions ── */
const from = { installation_key: 'a' }, to = { domain: 'x.y' };
t('resolve and catalogue are built as before', JSON.stringify(ctpquery.build(from, to, { want: 'resolve', handle: ' h ' }).ask) === '{"want":"resolve","handle":"h"}' && JSON.stringify(ctpquery.build(from, to, { want: 'catalogue', bridge_id: 'CBX' }).ask) === '{"want":"catalogue","bridge_id":"CBX"}');
t('registry_changes carries after and a capped limit and nothing else', JSON.stringify(ctpquery.build(from, to, { want: 'registry_changes', after: '7', limit: 99999, junk: 1 }).ask) === '{"want":"registry_changes","after":7,"limit":1000}');
t('certificate and directory carry no fields; locate needs an id', JSON.stringify(ctpquery.build(from, to, { want: 'certificate', x: 1 }).ask) === '{"want":"certificate"}' && (() => { try { ctpquery.build(from, to, { want: 'locate' }); return false; } catch (e) { return /bridge id/.test(e.message); } })());
t('an unknown want is still refused', (() => { try { ctpquery.build(from, to, { want: 'everything' }); return false; } catch (e) { return /must want one of/.test(e.message); } })());

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
console.log('  ' + pass + ' checks');
process.exit(fail ? 1 : 0);
