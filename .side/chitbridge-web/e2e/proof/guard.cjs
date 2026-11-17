'use strict';
/* OWNS: the proof packs' WRITE GUARD (safety is the network). Every request of a pack's browser goes through guardDecision(); 'abort' = it never
   leaves the browser. A write verb to /api/ on ANY app host (the web origin AND the api origin: the local stack serves them on two ports) is aborted;
   a navigation off the app hosts is aborted. Same rule as the SIT sweep's sweep-guard.cjs, widened to a host list. Proof: node e2e/proof/guard.test.cjs */
const WRITE_VERBS = /^(POST|PUT|PATCH|DELETE)$/i;
function guardDecision(method, url, hosts, isNavigation) {
  let u; try { u = new URL(url); } catch (_) { return { act: 'fallback' }; }
  const mine = [].concat(hosts);
  if (mine.includes(u.host) && u.pathname.startsWith('/api/') && WRITE_VERBS.test(method)) return { act: 'abort', why: 'write', path: u.pathname };
  if (isNavigation && !mine.includes(u.host)) return { act: 'abort', why: 'offhost' };
  return { act: 'fallback' };
}
/* THE HOST DECISION for --remote-ok (pure; lib.cjs exits 2 on a refusal). Positive allowlist first (remote-hosts.json: staging.<dashed-ip>.sslip.io of the named SIT boxes),
   then the denylist as a second check (the gate box in dashed or dotted form, production, railway, supabase). Everything is lowercased; https only; the api is the base; the flag names the base host. */
const HOSTS_FILE = require('./remote-hosts.json');
const norm = (u) => String(u || '').trim().toLowerCase().replace(/\/+$/, '');
function remoteHostDecision(base, api, remoteOk, file) {
  const cfg = file || HOSTS_FILE, flag = String(remoteOk || '').trim().toLowerCase(), b = norm(base), a = norm(api);
  let u; try { u = new URL(b); } catch (_) { return { ok: false, why: 'base is not a URL' }; }
  if (u.protocol !== 'https:') return { ok: false, why: 'base must be https' };
  if (u.pathname !== '/' && u.pathname !== '') return { ok: false, why: 'base must be a bare origin' };
  if (a !== b) return { ok: false, why: 'api must be the same origin as base' };
  if (!flag || flag !== u.host) return { ok: false, why: '--remote-ok must equal the base host' };
  const dashed = u.host.replace(/\./g, '-');
  if ((cfg.refused || []).some((x) => dashed.includes(x.replace(/\./g, '-')))) return { ok: false, why: 'gate box or production host: refused' };
  if (!Object.values(cfg.hosts || {}).includes(u.host)) return { ok: false, why: 'host is not on the SIT allowlist (e2e/proof/remote-hosts.json)' };
  return { ok: true, why: '' };
}
module.exports = { guardDecision, WRITE_VERBS, remoteHostDecision };
