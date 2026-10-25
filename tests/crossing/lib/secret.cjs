'use strict';
/**
 * tests/crossing/lib/secret.cjs — the tester code, read at run time and kept in memory only.
 * OWNS      reading TESTER_CODE (+ TESTER_CODE_TZ) from an installation's api container over ssh · expanding {yymmdd} / {yyyymmdd} · the redaction of the code from any text
 * CALLED BY lib/client.cjs (the sign-in) · web e2e/lib/crossing.cjs
 * FLOW      read(topo, installation) → a Secret whose value() only the sign-in call uses; redact(text) wipes it from errors and logs
 * ⚠️ The code is in NO file, NO log line, NO URL and NO query string. A Secret prints as "[tester code]" and has no JSON form. The expansion mirrors the api's own
 * (lib/dev-otp.js testerCodesNow: the day in TESTER_CODE_TZ, default Asia/Kolkata - NOT UTC; the brief said UTC, the api says Kolkata, the api is right).
 */
const ssh = require('./ssh.cjs');

const DAY_SLOT = /\{(yymmdd|yyyymmdd)\}/g;
const DEFAULT_ZONE = 'Asia/Kolkata';

/** today's date (YYYY-MM-DD) in an IANA zone */
function dayIn(zone, nowMs) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
  return parts; // en-CA is YYYY-MM-DD
}

/** the template with its one date slot filled for the zone's day; a static code comes back as it is */
function expand(template, zone, nowMs) {
  const text = String(template || '').trim();
  const slots = text.match(DAY_SLOT) || [];
  if (slots.length > 1) throw new Error('TESTER_CODE carries more than one date slot');
  if (!slots.length) return text;
  const day = dayIn(zone || DEFAULT_ZONE, nowMs == null ? Date.now() : nowMs);
  return text.replace(DAY_SLOT, (_, form) => (form === 'yymmdd' ? day.slice(2) : day).replace(/-/g, ''));
}

class Secret {
  constructor(code) {
    Object.defineProperty(this, '_code', { value: String(code), enumerable: false });
  }
  value() {
    return this._code;
  }
  /** wipe the code from any text (an error message, a log line) */
  redact(text) {
    return String(text).split(this._code).join('[tester code]');
  }
  toString() {
    return '[tester code]';
  }
  toJSON() {
    return undefined;
  }
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return '[tester code]';
  }
}

/** read the code from the installation's api container; the printenv lines never leave this function */
async function read(topo, key) {
  const api = ssh.container(topo, key, 'api');
  const got = await ssh.run(topo, key, 'sudo docker exec ' + api + ' sh -c \'printf "%s\n%s" "$TESTER_CODE" "$TESTER_CODE_TZ"\'');
  if (got.code !== 0) throw new Error('could not read the tester code on ' + key + ' (ssh/docker exit ' + got.code + ')');
  const [template, zone] = got.stdout.split('\n');
  if (!String(template || '').trim()) throw new Error('TESTER_CODE is not set on ' + key + ': the tester door is shut there');
  return new Secret(expand(template, String(zone || '').trim() || DEFAULT_ZONE));
}

module.exports = { Secret, expand, dayIn, read, DEFAULT_ZONE };
