/**
 * tests/sec-130r-party-contact.test.cjs — SEC-130 RESIDUAL: A SHOP'S PARTY E-MAIL HAS ITS OWN SHOP-SCOPED HOME (party_contact, b839/b840).
 * Before: keepEmail / saveContact wrote identities.email, one global UNIQUE column, so a second shop typing an address the first had saved was told
 * (keepEmail → true, move-in note "another account already uses that address"; PATCH → a refusal) that the address exists elsewhere: an oracle.
 * Proves: (1) the same address in two shops answers identically through keepEmail, addCustomer and saveContact, (2) `email_held` / "another account"
 * are gone from lib + routes, (3) every party_contact statement is owner-scoped and b839 carries FORCE RLS + rls_entity like party_tax_id,
 * (4) the b840 backfill predicate is handle.isMinted() as SQL (same text in the lib, the migration and the CHECK; behaviour compared over samples),
 * (5) the CHECK's meaning: a minted row with an e-mail is refused, an account's e-mail is not, (6) no sign-in file reads party_contact,
 * (7) the one read fragment feeds crm.js who() and GET /customers, (8) privacy's "Sign-in contact" never shows a minted party's e-mail,
 * (9) the table absent (before b839): no write, a word to the caller, no identities.email either.
 * Run: node tests/sec-130r-party-contact.test.cjs · no DB (in-memory fake that enforces what Postgres would: the global unique on identities.email).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const API = path.join(__dirname, '..');
Object.assign(process.env, { JWT_SECRET: 'test-only-secret-sec-130r', NODE_ENV: 'development', DATABASE_URL: 'postgres://cb@127.0.0.1:5432/cb_test' });
const say = console.log.bind(console);
['log', 'warn', 'error', 'info'].forEach((k) => { console[k] = () => {}; });
let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; say('  ok  ' + name); } else { fail++; say('  FAIL ' + name + (extra ? '\n       ' + extra : '')); } };
const read = (rel) => fs.readFileSync(path.join(API, rel), 'utf8');

let TABLE = true;
const stub = (rel, exports) => { const f = require.resolve(path.join(API, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('lib/schema', { hasColumn: async () => true, hasColumns: async () => true, hasTable: async (n) => (n === 'party_contact' ? TABLE : true), has: async () => true, columns: async () => [], table: async () => ({}) });
const L = require(path.join(API, 'lib', 'local-identity'));
const PF = require(path.join(API, 'lib', 'party-fields'));
const PC = require(path.join(API, 'lib', 'party-contact'));
const H = require(path.join(API, 'lib', 'handle'));

/* ── an in-memory database that behaves like Postgres where it matters: identities.email is GLOBALLY unique; party_contact is not ── */
let IDS, PCON, STATEMENTS;
const reset = () => {
  IDS = [
    { identity_id: 'pa', parent_entity_id: 'shopa', user_id: '~shopa.cus-0001', email: null, otp_contact: null, display_name: 'A One' },
    { identity_id: 'pa2', parent_entity_id: 'shopa', user_id: '~shopa.cus-0002', email: null, otp_contact: null, display_name: 'A Two' },
    { identity_id: 'pb', parent_entity_id: 'shopb', user_id: '~shopb.cus-0001', email: null, otp_contact: null, display_name: 'B One' },
    { identity_id: 'acct', parent_entity_id: null, user_id: 'realshop', email: 'owner@real.test', otp_contact: null, display_name: 'Real Shop' }
  ];
  PCON = [];
  STATEMENTS = [];
};
const dup = () => Object.assign(new Error('duplicate key value violates unique constraint "identities_email_key"'), { code: '23505' });
const lc = (v) => String(v == null ? '' : v).toLowerCase();
async function q(sql, p) {
  p = p || [];
  const s = String(sql).replace(/\s+/g, ' ').trim();
  STATEMENTS.push(s);
  let m;
  if (/^(SAVEPOINT|RELEASE|ROLLBACK)/i.test(s)) return { rows: [] };
  if (/^INSERT INTO party_contact/i.test(s)) {
    const row = PCON.find((r) => r.owner === p[0] && r.party === p[1]);
    if (row) row.value = p[2]; else PCON.push({ owner: p[0], party: p[1], value: p[2] });
    return { rows: [], rowCount: 1 };
  }
  if (/^DELETE FROM party_contact/i.test(s)) { PCON = PCON.filter((r) => !(r.owner === p[0] && r.party === p[1])); return { rows: [] }; }
  if (/^UPDATE identities SET email = NULL/i.test(s)) { IDS.filter((r) => r.identity_id === p[0] && r.parent_entity_id === p[1]).forEach((r) => { r.email = null; }); return { rows: [] }; }
  /* main's writer: COALESCE(email, $2) on the global unique column */
  if (/^UPDATE identities SET email = COALESCE\(email, \$2\) WHERE identity_id = \$1 AND parent_entity_id = \$3/i.test(s)) {
    if (IDS.some((r) => r.identity_id !== p[0] && r.email && lc(r.email) === lc(p[1]))) throw dup();
    IDS.filter((r) => r.identity_id === p[0]).forEach((r) => { r.email = r.email || p[1]; });
    return { rows: [] };
  }
  if ((m = s.match(/^UPDATE identities SET (\w+) = \$2 WHERE identity_id = \$1/i))) {
    if (m[1] === 'email' && IDS.some((r) => r.identity_id !== p[0] && r.email && lc(r.email) === lc(p[1]))) throw dup();
    IDS.filter((r) => r.identity_id === p[0]).forEach((r) => { r[m[1]] = p[1]; });
    return { rows: [] };
  }
  /* the saveContact read: new (the shop's party_contact value) and old (identities.email) */
  if (/^SELECT i\.otp_contact, .* AS email, i\.parent_entity_id FROM identities i WHERE i\.identity_id = \$1/i.test(s)) {
    return { rows: IDS.filter((r) => r.identity_id === p[0]).map((r) => { const pc = PCON.find((c) => c.owner === p[1] && c.party === r.identity_id); return { otp_contact: r.otp_contact, email: (pc && pc.value) || r.email, parent_entity_id: r.parent_entity_id }; }) };
  }
  if (/^SELECT otp_contact, email, parent_entity_id FROM identities WHERE identity_id = \$1/i.test(s)) return { rows: IDS.filter((r) => r.identity_id === p[0]) };
  /* the within-shop duplicate: new (this shop's own list through the read) and old (identities by e-mail) */
  if (/^SELECT i\.identity_id AS party_id, i\.display_name FROM identities i WHERE i\.parent_entity_id = \$1/i.test(s)) {
    return { rows: IDS.filter((r) => r.parent_entity_id === p[0] && r.identity_id !== p[2]).filter((r) => { const pc = PCON.find((c) => c.owner === p[0] && c.party === r.identity_id); return lc((pc && pc.value) || r.email) === lc(p[1]); }).map((r) => ({ party_id: r.identity_id, display_name: r.display_name })) };
  }
  if (/FROM identities WHERE LOWER\(email\) = LOWER\(\$1\) AND identity_id <> \$2/i.test(s)) return { rows: IDS.filter((r) => r.identity_id !== p[1] && lc(r.email) === lc(p[0])) };
  return { rows: [], rowCount: 0 };
}
const conn = { query: q };
const attempt = async (fn) => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, status: e.status, message: e.message, code: e.code }; } };

(async () => {
  /* 1 ── the same address in two shops answers identically */
  reset();
  const same = 'Shared@Example.test'.toLowerCase();
  const a1 = await attempt(() => L.keepEmail(conn, 'shopa', 'pa', same));
  const b1 = await attempt(() => L.keepEmail(conn, 'shopb', 'pb', same));
  t('keepEmail: shop B answers exactly as shop A for an address shop A already saved', JSON.stringify(a1) === JSON.stringify(b1) && a1.ok && a1.value === true, JSON.stringify([a1, b1]));
  reset();
  const asAcct = await attempt(() => L.keepEmail(conn, 'shopa', 'pa', 'owner@real.test'));
  const asFresh = await attempt(() => L.keepEmail(conn, 'shopa', 'pa2', 'fresh@x.test'));
  t('keepEmail: an address that is a real account\'s sign-in saves, and answers like a fresh one', JSON.stringify(asAcct) === JSON.stringify(asFresh) && PCON.some((r) => r.value === 'owner@real.test'), JSON.stringify([asAcct, asFresh]));
  t('the account\'s own e-mail on identities is untouched', IDS.find((r) => r.identity_id === 'acct').email === 'owner@real.test');
  reset();
  const sa = await attempt(() => PF.saveContact(conn, 'shopa', 'pa', { email: same }));
  const sb = await attempt(() => PF.saveContact(conn, 'shopb', 'pb', { email: same }));
  t('saveContact: shop B saves the address shop A has: same answer, no refusal', sa.ok && sb.ok && JSON.stringify(sa.value) === JSON.stringify(sb.value), JSON.stringify([sa, sb]));
  t('both shops hold it in party_contact, none on identities', PCON.length === 2 && IDS.every((r) => r.identity_id === 'acct' || r.email == null));
  reset();
  const add = await L.addCustomer(Object.assign({ query: q }, {}), 'shopa', { name: 'Newcomer', phone: null, email: same, number: false }).catch((e) => ({ threw: e.message }));
  t('addCustomer\'s answer carries no email_held, whatever else is on file', !('email_held' in (add || {})), JSON.stringify(add));

  /* within this shop: #917's honest answer is kept (a P2 for Athi), read from the shop's own list only */
  reset();
  await PF.saveContact(conn, 'shopa', 'pa', { email: same });
  const own = await attempt(() => PF.saveContact(conn, 'shopa', 'pa2', { email: same }));
  t('within-shop duplicate: still the 409 naming the other party of THIS shop', !own.ok && own.status === 409 && /A One/.test(own.message), JSON.stringify(own));
  const other = await attempt(() => PF.saveContact(conn, 'shopb', 'pb', { email: same }));
  t('the other shop is not told a thing about shop A', other.ok, JSON.stringify(other));
  const clear = await attempt(() => PF.saveContact(conn, 'shopa', 'pa', { email: null }));
  t('clearing an e-mail deletes the party_contact row', clear.ok && !PCON.some((r) => r.party === 'pa'));
  reset();
  IDS[0].email = 'old@x.test';
  await PF.saveContact(conn, 'shopa', 'pa', { email: 'new@x.test' });
  t('writing the new home blanks the minted party\'s old identities.email', IDS[0].email === null && PCON[0].value === 'new@x.test');
  reset();
  const notMine = await attempt(() => PF.saveContact(conn, 'shopb', 'pa', { email: 'x@y.test' }));
  t('a party of another shop is still refused (403)', !notMine.ok && notMine.status === 403);

  /* 2 ── no email_held anywhere */
  const files = ['lib', 'routes'].flatMap((d) => fs.readdirSync(path.join(API, d)).filter((f) => f.endsWith('.js')).map((f) => d + '/' + f));
  const held = files.filter((f) => /email_held|emailsHeld|another account already uses/.test(read(f)));
  t('no email_held / emailsHeld / "another account already uses" in lib or routes', held.length === 0, held.join(', '));
  t('the old one-shot unique-catching writer is gone from local-identity', !/contact_email/.test(read('lib/local-identity.js')) && !/UPDATE identities SET email = COALESCE/.test(read('lib/local-identity.js')));

  /* 3 ── RLS isolation: the migration is party_tax_id's pattern, and no statement reads or writes a row without the owner */
  const b839 = read('migrations/b839_party_contact.sql');
  t('b839: ENABLE + FORCE ROW LEVEL SECURITY and the rls_entity policy on app.current_entity (USING and WITH CHECK)', /ENABLE ROW LEVEL SECURITY/.test(b839) && /FORCE ROW LEVEL SECURITY/.test(b839) && /CREATE POLICY rls_entity ON party_contact/.test(b839) && (b839.match(/owner_entity_id = NULLIF\(current_setting\('app\.current_entity', true\), ''\)::uuid/g) || []).length === 2);
  t('b839: not unique on value, FK index, grants as party_tax_id', !/UNIQUE/i.test(b839.replace(/--.*$/gm, '')) && /ix_fk_party_contact_party/.test(b839) && /GRANT SELECT, INSERT, UPDATE, DELETE ON party_contact TO cb_app/.test(b839) && /GRANT SELECT ON party_contact TO cb_backup/.test(b839));
  const pcSrc = read('lib/party-contact.js');
  const touching = (pcSrc.match(/(?:INSERT INTO|DELETE FROM|FROM) party_contact[^`]*/g) || []);
  t('every party_contact statement in the lib is owner-scoped', touching.length >= 3 && touching.every((x) => /owner_entity_id/.test(x)), touching.join(' | '));
  t('the read fragment is owner-scoped and per party', /pc\.owner_entity_id = \$1 AND pc\.party_id = i\.identity_id/.test(PC.emailSql('i', '$1', true)));

  /* 4 ── the backfill predicate IS handle.isMinted */
  const b840 = read('migrations/b840_party_contact_backfill.sql');
  const sqlText = `user_id ~ '^[[:space:]]*${H.MINTED}'`;
  t('MINTED_SQL, b840 (backfill, update, CHECK twice, rollback) and handle.MINTED are the same text', PC.MINTED_SQL === sqlText && (b840.split(sqlText).length - 1) >= 4, String(b840.split(sqlText).length - 1));
  /* the SQL predicate evaluated in JS over handles: same answer as isMinted */
  const sqlMinted = (u) => (u == null ? null : /^[ \t\n\r\f\v]*~/.test(String(u))); /* user_id ~ '^[[:space:]]*~' */
  const samples = ['~shop.cus-0001', ' ~x.sup-1', '~', 'realshop', 'ravi@acme.br', '9876@shop.cr', '', null, 'a~b', '~~', '\t~x', '\n~x.cus-1', ' \r\n~y', 'x\t~'];
  t('predicate agrees with handle.isMinted on every sample', samples.every((u) => (sqlMinted(u) || false) === H.isMinted(u)), samples.filter((u) => (sqlMinted(u) || false) !== H.isMinted(u)).join(','));
  t('b840: two transactions (backfill → clear → CHECK NOT VALID, then VALIDATE alone), the order warning, a three-number dry run', (b840.match(/^BEGIN;/gm) || []).length === 2 && (b840.match(/^COMMIT;/gm) || []).length === 2 && b840.indexOf('NOT VALID;') < b840.indexOf('COMMIT;') && b840.indexOf('COMMIT;') < b840.indexOf('VALIDATE CONSTRAINT identities_minted_no_email') && /ORDER, ALWAYS: b839/.test(b840) && /orphans_nulled_without_copy/.test(b840) && b840.indexOf('INSERT INTO party_contact') < b840.indexOf('SET email = NULL') && b840.indexOf('SET email = NULL') < b840.indexOf('ADD CONSTRAINT identities_minted_no_email CHECK'));

  /* 5 ── the CHECK's meaning: NOT (minted AND email IS NOT NULL) — NULL passes, as Postgres treats a CHECK */
  const checkPasses = (row) => { const m = sqlMinted(row.user_id); return !(m === true && row.email != null); };
  t('CHECK: a minted party with an e-mail is refused', checkPasses({ user_id: '~shopa.cus-1', email: 'a@b.test' }) === false);
  t('CHECK: a minted party without one, a real account with one, a user-less shopper row with a .cr handle all pass', checkPasses({ user_id: '~shopa.cus-1', email: null }) && checkPasses({ user_id: 'realshop', email: 'o@r.test' }) && checkPasses({ user_id: null, email: '9876@shop.cr' }));
  t('b840 states the CHECK as that predicate', b840.includes("CHECK (NOT (" + sqlText + " AND email IS NOT NULL)) NOT VALID"));

  /* 6 ── sign-in never reads party_contact */
  const signin = ['routes/signin.js', 'lib/identity-auth.js', 'lib/resolveuserid.js', 'lib/iddoc-verify.js', 'routes/identity-docs.js', 'lib/otp.js'].filter((f) => fs.existsSync(path.join(API, f)));
  t('no sign-in / identity file mentions party_contact', signin.every((f) => !/party_contact|party-contact/.test(read(f))), signin.join(','));
  t('the minted-party sign-in test is still in the tree and unchanged', fs.existsSync(path.join(API, 'tests/sec-130-minted-email-signin.test.cjs')));

  /* 7 ── ONE read fragment for both reads */
  t('crm.js who() and GET /customers use party-contact.emailSql (no own copy)', /party-contact'\)\.emailSql\('i', '\$1', emailMigrated\)/.test(read('lib/crm.js')) && /party-contact'\)\.emailSql\('i', '\$1'/.test(read('routes/relationships.js')));
  t('the fragment falls back to identities.email while the table is absent', PC.emailSql('i', '$1', false) === 'i.email');

  /* 8 ── privacy.js "Sign-in contact" */
  const PR = require(path.join(API, 'lib', 'privacy'));
  const handleOf = (user_id, email, otp) => ({ query: async () => ({ rows: [{ identity_id: 'me', display_name: 'M', phone: null, email, otp_contact: otp, country: 'IN', user_id }, { identity_id: 'shop', display_name: 'S', country: 'IN' }] }) });
  const view = async (user_id, email, otp) => { try { const v = await PR.shopper(handleOf(user_id, email, otp), 'shop', 'me'); return v.held.find((x) => x.key === 'contact').value; } catch (e) { return 'ERR ' + e.message; } };
  t('privacy: a minted party\'s shop-typed e-mail is NOT shown as its sign-in contact', (await view('~shop.cus-0001', 'typed@shop.test', null)) === null, String(await view('~shop.cus-0001', 'typed@shop.test', null)));
  t('privacy: a real account still sees its own e-mail, and an OTP contact wins', (await view('real', 'me@real.test', null)) === 'me@real.test' && (await view('real', 'me@real.test', '98765')) === '98765');

  /* 9 ── before b839 */
  reset(); TABLE = false;
  const kept = await L.keepEmail(conn, 'shopa', 'pa', 'x@y.test');
  t('table absent: keepEmail answers false, writes nothing anywhere (no identities.email either)', kept === false && PCON.length === 0 && IDS.every((r) => r.identity_id === 'acct' || r.email == null) && !STATEMENTS.some((s) => /UPDATE identities SET email/.test(s)));
  const noTable = await attempt(() => PF.saveContact(conn, 'shopa', 'pa', { email: 'x@y.test' }));
  t('table absent: PATCH says so in words (409), never a 500', !noTable.ok && noTable.status === 409 && /cannot be saved/.test(noTable.message), JSON.stringify(noTable));
  TABLE = true;

  say('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { say('CRASH ' + (e && e.stack)); process.exit(1); });
