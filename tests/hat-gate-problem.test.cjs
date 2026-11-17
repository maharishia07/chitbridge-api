/**
 * The hat gate's refusal is an RFC 9457 Problem (col14 role_matrix), with the three old keys kept.
 * CARD      18-identity-sign-in-and-access/access-levels-and-roles
 */
const gate = require('../middleware/hat-gate');
const codes = require('../docs/error-codes.json').codes.map((row) => row.code);
let fail = 0;
const check = (label, ok, got) => { if (!ok) fail++; console.log((ok ? '  ok  ' : '  FAIL ') + label + (ok ? '' : '  got ' + JSON.stringify(got))); };

function refuse(level) {
  const req = { method: 'POST', path: '/chits/send', id: 'req-hat', identity: { identity_type: 'actor', access_level: level, hat: level === 'viewer' ? 'view_only' : 'audit' } };
  const out = { headers: {} };
  const res = { locals: {}, status(s) { out.status = s; return this; }, set(k, v) { out.headers[k.toLowerCase()] = v; return this; }, json(b) { out.body = b; return this; } };
  gate(req, res, () => { out.allowed = true; });
  return out;
}
const V = refuse('viewer'), C = refuse('commenter');
[['viewer', V, 'READ_ONLY'], ['commenter', C, 'COMMENT_ONLY']].forEach(([lvl, o, code]) => {
  check(lvl + ': 403', o.status === 403, o.status);
  check(lvl + ': content-type is problem+json', /application\/problem\+json/.test(o.headers['content-type'] || ''), o.headers);
  check(lvl + ': the Problem fields are there', o.body && ['type', 'title', 'status', 'detail', 'request_id'].every((k) => o.body[k] !== undefined), o.body);
  check(lvl + ': code is ' + code + ' and registered', o.body && o.body.code === code && codes.includes(code), o.body && o.body.code);
  check(lvl + ': legacy error, message and access_level kept', o.body && o.body.error === 'Not permitted' && /^Your access is set to/.test(o.body.message) && o.body.access_level === lvl, o.body);
  check(lvl + ': detail equals the legacy message', o.body && o.body.detail === o.body.message, o.body);
});
check('an editor is still let through', refuse('editor').allowed === true);
process.exit(fail ? 1 : 0);
