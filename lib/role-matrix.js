'use strict';
/*
 * OWNS      the ROLE MATRIX vocabulary (API register column 14, role_matrix; OWASP API5:2023 broken function level authorisation): the five seats and the answers a route may DECLARE for each,
 *           the shared classes the contracts name (SEATS.*), and the one check that a declaration is well formed.
 * CALLED BY lib/books-contract.js · lib/books-grants-contract.js · lib/books-actions-contract.js · lib/flags-contract.js (a row's `seats`) · lib/contract-kit.js (x-seats on the operation) · tools/api-reported.cjs · tests/role-matrix.test.cjs · tools/role-matrix-live.cjs
 * FLOW      a contract row says `seats: SEATS.X` ──▶ operation['x-seats'] ──▶ the register reads it ──▶ tools/role-matrix-live.cjs asks every route as every seat against a real stack ──▶ evidence role_matrix: true
 * CARD      28-platform-and-operations/api-standard
 *
 * It declares what the code ALREADY enforces; it adds no permission. A declaration is a claim a live run must prove: allowed seats answer 2xx or the route's own business answer (never 401/403), refused seats answer the one 401/403/404 Problem shape.
 *   owner    allow | deny                    the signed-in owner of the business
 *   staff    allow | edit | manager | deny             a PLAIN actor of the business (not whole-entity, no cost visibility): allow = any level; edit = editor level only (a viewer is refused); deny = never
 *   adviser  read | door | allow | deny      the firm's adviser seat under a LIVE grant (X-Books-For): read = GET only; door = also the listed action doors; deny = refused; allow = a route outside the grant front, asked as the firm person itself
 *   auditor  read | allow | deny             the firm's auditor seat under a live grant: read = GET only on the allow-list; allow = as itself, outside the grant front; deny = refused
 *   anon     deny                            no sign-in: always refused (401); a route that is public says `public: true` in its row and declares anon 'allow'
 */
const SEAT_NAMES = ['owner', 'staff', 'adviser', 'auditor', 'anon'];
const ANSWERS = { owner: ['allow', 'deny'], staff: ['allow', 'edit', 'manager', 'deny'], adviser: ['read', 'door', 'allow', 'deny'], auditor: ['read', 'allow', 'deny'], anon: ['allow', 'deny'] };
/** the refusal statuses a seat may be answered with (the one shape: a Problem body) */
const REFUSAL_STATUSES = [401, 403, 404];

const seats = (owner, staff, adviser, auditor, anon) => Object.freeze({ owner, staff, adviser, auditor, anon: anon || 'deny' });
/** the classes the books, grants and flags routes use: one name per pattern the code enforces today (owner, staff, adviser, auditor) */
const SEATS = {
  OWNER_ONLY: seats('allow', 'deny', 'deny', 'deny'),
  /** ASSIGN-1 (W3): the partner (owner) or an actor whose hat is manager (lib/owner mayAt); a plain actor, an adviser and an auditor seat are refused */
  OWNER_MANAGER_ONLY: seats('allow', 'manager', 'deny', 'deny'),
  OWNER_ADVISER_READS: seats('allow', 'deny', 'read', 'deny'),
  /** AK-F-02: the owner, or the owner's own accountant or bookkeeper (manager hat who can edit, lib/owner isInHouseAccountant, RC-7), as a Xero Adviser runs the pack and the rates */
  OWNER_MANAGER_BOTH_READ: seats('allow', 'manager', 'read', 'read'),
  OWNER_MANAGER_ADVISER_READS: seats('allow', 'manager', 'read', 'deny'),
  OWNER_MANAGER_ADVISER_DOOR: seats('allow', 'manager', 'door', 'deny'),
  OWNER_BOTH_READ: seats('allow', 'deny', 'read', 'read'),
  ANY_NO_GRANT: seats('allow', 'allow', 'deny', 'deny'),
  ANY_ADVISER_READS: seats('allow', 'allow', 'read', 'deny'),
  ANY_BOTH_READ: seats('allow', 'allow', 'read', 'read'),
  ANY_ADVISER_DOOR: seats('allow', 'allow', 'door', 'deny'),
  EDITOR_NO_GRANT: seats('allow', 'edit', 'deny', 'deny'),
  EDITOR_ADVISER_DOOR: seats('allow', 'edit', 'door', 'deny'),
  OWNER_ADVISER_DOOR: seats('allow', 'deny', 'door', 'deny'),
  /** RC-11: the action reads are the auditor's too (read only: the review record is audit evidence) */
  OWNER_ADVISER_DOOR_AUDITOR_READS: seats('allow', 'deny', 'door', 'read'),
  FIRM_ONLY: seats('deny', 'deny', 'door', 'deny'),
  /** SHOPBK-B: prepare an action: the firm's adviser door, or the shop's own Bookkeeper (hat manager) when the owner asked to approve; the owner, a plain actor and an auditor are refused */
  FIRM_OR_BOOKKEEPER: seats('deny', 'manager', 'door', 'deny'),
  /** routes outside the books grant front (no X-Books-For): a firm person is asked as itself, in its own organisation */
  EVERYONE_SIGNED_IN: seats('allow', 'allow', 'allow', 'allow'),
  OWNER_AND_FIRM_SEATS: seats('allow', 'deny', 'allow', 'allow')
};

/** the sentences that fail for a declared seats object, or [] when it is well formed */
function problemsOf(declared) {
  if (!declared || typeof declared !== 'object') return ['no seats declared'];
  const problems = [];
  SEAT_NAMES.forEach((seat) => {
    if (!ANSWERS[seat].includes(declared[seat])) problems.push('seat "' + seat + '" is ' + JSON.stringify(declared[seat]) + ', not one of ' + ANSWERS[seat].join('|'));
  });
  Object.keys(declared).filter((key) => !SEAT_NAMES.includes(key)).forEach((key) => problems.push('"' + key + '" is not a seat'));
  return problems;
}

/** may this seat's declared answer be a success? (the live run expects a non-refusal for it, a refusal otherwise); `viewer` says which staff level asks */
const allowedFor = (declared, seat, staffLevel) => (seat === 'staff' ? declared.staff === 'allow' || (declared.staff === 'edit' && staffLevel === 'editor') || (declared.staff === 'manager' && staffLevel === 'manager') : ['allow', 'read', 'door'].includes(declared[seat]));

/**
 * the verdict of one live answer against the declaration: null when it is what was declared, else the sentence that says how it differs (SEAT = a wrong status, SHAPE = the right refusal status in a body that is not the Problem shape).
 * An ALLOWED seat must not be refused as a seat (401, 403) and must not meet a handler fault (a 503 is a declared store answer); a REFUSED seat must be answered 401 (no sign-in) or 403 (every other seat) in the Problem shape.
 */
function verdictOf(answer, allowed, seat) {
  const said = (answer.body && (answer.body.code || answer.body.error)) || '';
  return allowed ? allowedVerdict(answer, said) : refusedVerdict(answer, said, seat);
}
const allowedVerdict = (answer, said) => {
  if ([401, 403].includes(answer.status)) return 'SEAT allowed seat was refused ' + answer.status + ' ' + said;
  return answer.status >= 500 && answer.status !== 503 ? 'SEAT allowed seat reached a handler fault ' + answer.status : null;
};
const refusedVerdict = (answer, said, seat) => {
  const wanted = seat === 'anon' ? 401 : 403;
  if (answer.status !== wanted) return 'SEAT refused seat was answered ' + answer.status + ' ' + said + ' (wanted ' + wanted + ')';
  const problemShape = !!answer.body && typeof answer.body.status === 'number' && typeof answer.body.code === 'string';
  return problemShape ? null : 'SHAPE refusal is not the Problem shape: ' + JSON.stringify(answer.body).slice(0, 120);
};

module.exports = { verdictOf, SEAT_NAMES, ANSWERS, REFUSAL_STATUSES, SEATS, problemsOf, allowedFor };
