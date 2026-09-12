/**
 * Unit-test the hat gate in isolation — before it goes anywhere near a deploy.
 *
 * ⚠️ The dangerous outcomes are not "a view_only actor got through". They are:
 *   · the ENTITY OWNER being gated  → a business locked out of its own records, with the only person who could
 *     lift it being the person locked out
 *   · an ACT/MANAGER actor being gated → every working co-assist stops working
 *   · a GET being gated → the product becomes unreadable for the hats that exist to read
 * Those are tested first and hardest.
 */
const gate = require('../middleware/hat-gate');

let pass = 0, fail = 0;
function check(label, { method = 'POST', path = '/chits/send', identity }, wantAllowed) {
  const req = { method, path, identity };
  let allowed = false, status = null, body = null;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  gate(req, res, () => { allowed = true; });
  const ok = allowed === wantAllowed;
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + label.padEnd(58)
    + (allowed ? 'ALLOWED' : 'BLOCKED ' + status) + (ok ? '' : '   ← EXPECTED ' + (wantAllowed ? 'ALLOWED' : 'BLOCKED')));
  return body;
}

console.log('\n── THE OUTCOMES THAT MUST NEVER HAPPEN ──');
check('entity owner sending a chit', { identity: { identity_type: 'entity' } }, true);
check('entity owner, no hat field at all', { identity: { identity_type: 'entity', hat: undefined } }, true);
check('actor with hat=act', { identity: { identity_type: 'actor', hat: 'act' } }, true);
check('actor with hat=manager', { identity: { identity_type: 'actor', hat: 'manager' } }, true);
check('actor with NO hat (pre-column staff)', { identity: { identity_type: 'actor' } }, true);
check('unauthenticated request', { identity: null }, true);
check('view_only READING (GET)', { method: 'GET', identity: { identity_type: 'actor', hat: 'view_only' } }, true);

console.log('\n── THE DEFECT, CLOSED ──');
const b = check('view_only sending a chit', { identity: { identity_type: 'actor', hat: 'view_only' } }, false);
check('audit sending a chit', { identity: { identity_type: 'actor', hat: 'audit' } }, false);
check('mis editing the catalogue', { path: '/products/x', identity: { identity_type: 'actor', hat: 'mis' } }, false);
check('view_only deleting a folder', { method: 'DELETE', path: '/folders/x', identity: { identity_type: 'actor', hat: 'view_only' } }, false);
check('view_only adding a co-assist', { path: '/actors', identity: { identity_type: 'actor', hat: 'view_only' } }, false);

console.log('\n── SELF-SCOPED: RESTRICTED HATS MUST STILL USE THE PRODUCT ──');
check('view_only saving their own appearance', { method: 'PATCH', path: '/entities/me/prefs/ui', identity: { identity_type: 'actor', hat: 'view_only' } }, true);
check('view_only saving their own locale', { method: 'PATCH', path: '/entities/me/prefs/locale', identity: { identity_type: 'actor', hat: 'view_only' } }, true);
check('audit clearing their own notifications', { path: '/notifications/dismiss', identity: { identity_type: 'actor', hat: 'audit' } }, true);
check('mis running a report', { path: '/metrics/run', identity: { identity_type: 'actor', hat: 'mis' } }, true);
check('view_only asking the assistant', { path: '/assist/ask', identity: { identity_type: 'actor', hat: 'view_only' } }, true);
check('view_only setting their own break', { path: '/actors/break', identity: { identity_type: 'actor', hat: 'view_only' } }, true);

console.log('\n── FAIL CLOSED: A PATH NOBODY THOUGHT ABOUT ──');
check('view_only on an endpoint invented tomorrow', { path: '/something-new/x', identity: { identity_type: 'actor', hat: 'view_only' } }, false);
check('a prefix that only LOOKS self-scoped', { path: '/assistant-impersonation', identity: { identity_type: 'actor', hat: 'view_only' } }, false);

/**
 * ⚠️⚠️ THE CASES THAT CAUGHT THE ONE REAL BUG. Every check above passed while the gate was still reading
 * `req.path` — which, inside a mounted router, is relative to the mount: `/me/prefs/ui`, not
 * `/entities/me/prefs/ui`. So NO self-scoped prefix matched, and because the gate fails closed the effect was
 * that a view_only co-assist could not save their own theme or clear their own notifications.
 *
 * Unit-tested, correct-looking, and wrong in production only. Found by starting a real express app and asking
 * it what it puts on the request, rather than assuming. These use the URL shape express actually produces.
 */
console.log('\n── REAL EXPRESS URL SHAPES ──');
function checkUrl(url, hat, wantAllowed) {
  let allowed = false;
  const res = { status() { return this; }, json() { return this; } };
  gate({ method: 'PATCH', originalUrl: url, path: url.replace(/^\/api\/[a-z-]+/, ''),
         identity: { identity_type: 'actor', hat } }, res, () => { allowed = true; });
  const ok = allowed === wantAllowed;
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + url.padEnd(34) + hat.padEnd(11) + (allowed ? 'ALLOWED' : 'BLOCKED'));
}
checkUrl('/api/entities/me/prefs/ui', 'view_only', true);
checkUrl('/api/entities/me/locale', 'view_only', true);
checkUrl('/api/notifications/dismiss', 'audit', true);
checkUrl('/api/assist/ask?x=1', 'view_only', true);
checkUrl('/api/chits/send', 'view_only', false);
checkUrl('/api/entities/profile', 'view_only', false);

console.log('\n── THE MESSAGE ──');
console.log('   ' + (b && b.message));
console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
