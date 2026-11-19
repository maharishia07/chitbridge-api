'use strict';
/**
 * tests/books-evidence-s1.realstack.cjs — SLICE 1 of REQ-2026-11-20-evidence-and-classification-checks on the REAL stack: a receipt on ANY posted entry + exact-duplicate file. No AI.
 *
 * owns: the 8 pass rows of the critic's slice 1 (a to h), through the real api (POST /api/attachments with entry_id, GET /api/books/daybook · /attention · /returns · /evidence/:id), a fresh AU shop (GST registered), a second shop, a firm under a live grant.
 * FLOW  fresh AU shop A + shop B + firm P (grant read) + employees: Auditor seat (commenter), View-only, Bookkeeper (editor)
 *   S1-a  the owner attaches a PNG to a posted entry (a bank fee, no source) and to the reversal of another: Day book evidence.count 1, /attention no_source down by 1, the SAME values for the owner, the firm under the grant, the Auditor seat
 *   S1-b  7 MB refused in words (413); an .exe refused; an .exe renamed with an image mime refused (415); HEIC refused; the books and the count do not move
 *   S1-c  Auditor seat and View-only attach = 403 with a sentence; the firm (own login, and with X-Books-For) = 403/404 and nothing stored; the edit seat (Bookkeeper) may (200)
 *   S1-d  delete and replace of a file on an entry refused (409 ATTACHMENT_ADD_ONLY); a second file adds and the first stays (count 2)
 *   S1-e  the same file on a second entry: both rows carry "same file as entry N", the firm reads the same note; a different file stays silent; two genuinely different receipts that look alike (same amount, other bytes) stay silent
 *   S1-f  an expense with GST 30.00 and no tax invoice carries no_tax_invoice; a file on it clears it by the same rule; the BAS "claimed with no tax invoice" total (returns.unsupported_input.tax_minor) falls by exactly that entry's posted GST line
 *   S1-g  shop B asks for shop A's file through GET /api/books/evidence/:id and gets the SAME answer as for a made-up id (404, same code)
 *   S1-h  BEFORE migration b887 (run this file on a box where it has NOT been applied): attach answers 503 in words, the Day book is unchanged, no 500. After the migration this row is skipped (and a-g run); before it, a-g are skipped.
 * CARD 14-accounting/ledger-accounts-day-book-entries-reverse
 * Run: API_BASE=http://127.0.0.1:<port> [TRUTH_DB=postgres://...] node tests/books-evidence-s1.realstack.cjs   ⚠️ LOCAL or a named SIT box other than sit-au (the harness refuses anything else). Writes through routes; the database is only SELECTed (column check).
 *      Run it twice around the migration to see both states: once before b887 (row h), once after (rows a-g). The BAS row reads the period holding yesterday; a run on the first day of a quarter reads the old quarter and its delta check will say so.
 */
const { Client } = require('pg');
const H = require('./lib/truth-harness.cjs');
const { DB, j, raw, ok, kase, skip, expect, freshShop, finish } = H;
const { shopDayAt } = require('./lib/shop-day.cjs');

const RUN = 'es' + (Date.now() % 1e8).toString(36).padStart(6, '0');
const ZONE = 'Australia/Sydney';
const DAY = shopDayAt(-1, ZONE);
const AU = { country: 'AU', currency: 'AUD', fy_start_month: 7, timezone: ZONE, tax: { registered: true, number: '51824753556', scheme: 'regular' } };
const key = (tag) => ('k' + tag + RUN.slice(-6)).slice(0, 12);
let n = 0;
const ref = () => RUN + '-' + ++n;

const PNG = (seed) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, seed)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(80, 7)]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(40, 5)]);
const b64 = (b) => b.toString('base64');
const said = (r) => JSON.stringify([r.status, r.b]).slice(0, 260);

const books = (token, path, o) => j('/api/books' + path, Object.assign({ token }, o || {}));
const post = (token, body) => j('/api/books/events', { method: 'POST', token, body: Object.assign({ kind: 'expense', date: DAY, paid_from: 'bank', client_ref: ref() }, body) });
const fee = (token, tag) => post(token, { class: 'bank_charges', amount_minor: 1500, narration: 'Account fee ' + tag });
const attach = (token, entry, buf, name, extra) => j('/api/attachments', { method: 'POST', token, body: Object.assign({ entry_id: entry, name: name || 'receipt.png', mime: 'image/png', data_base64: b64(buf) }, extra || {}) });
const daybook = async (token) => ok(await books(token, '/daybook?from=' + DAY + '&to=' + DAY), 'day book').b.entries || [];
const evidenceOf = async (token, entryId) => (await daybook(token)).find((e) => e.entry_id === entryId).evidence;
const attention = async (token) => ok(await books(token, '/attention?from=' + DAY + '&to=' + DAY), 'attention').b;
const asFirm = (firmToken, memberId, path) => raw('/api/books' + path, firmToken, { headers: { 'x-books-for': memberId } });
const firmJson = async (firmToken, memberId, path) => { const r = await asFirm(firmToken, memberId, path); let b = {}; try { b = await r.json(); } catch (_) { /* no body */ } return { status: r.status, b }; };
const addActor = async (shop, name, tag, extra) => ok(await j('/api/actors', { method: 'POST', token: shop.token, body: Object.assign({ display_name: name, actor_key: key(tag), email: key(tag) + '@local.test', access_level: 'editor', whole_entity: true, can_see_costs: true }, extra) }), 'add ' + name);
const signIn = async (person) => ok(await j('/api/actors/login', { method: 'POST', body: { username: person.b.actor.login_format, otp: H.ENTITY_OTP } }), 'sign-in').b.token;

(async () => {
  console.log('\n══ evidence S1 · attach to any posted entry + exact-duplicate file · real stack · ' + RUN + ' ══\n');
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  try {
    const cols = await pg.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'cb_attachment' AND column_name IN ('entry_id', 'sha256')`);
    const MIGRATED = cols.rows[0].n === 2;
    console.log('  migration b887 on this database: ' + (MIGRATED ? 'YES (rows a-g run, h skipped)' : 'NO (row h runs, a-g skipped)'));
    const A = await freshShop(RUN + 'a', 'Evidence A', AU);
    ok(await j('/api/books/enable', { method: 'POST', token: A.token }), 'books on (A)');

    if (!MIGRATED) {
      await kase('S1-h', 'migration not run: attach answers in words (503), the Day book is unchanged, no 500', async () => {
        const e = ok(await fee(A.token, 'h'), 'fee').b;
        const before = JSON.stringify(await daybook(A.token));
        const r = await attach(A.token, e.entry_id, PNG(1));
        expect(r.status === 503 && /not switched on|Nothing was attached/i.test(JSON.stringify(r.b)), 'attach before the migration: ' + said(r));
        expect(JSON.stringify(await daybook(A.token)) === before, 'the Day book moved');
        const old = await j('/api/attachments', { method: 'POST', token: A.token, body: { chit_id: '00000000-0000-4000-8000-000000000000', name: 'x.png', data_base64: b64(PNG(2)) } });
        expect(old.status !== 500, 'the old chit door answered 500 before the migration: ' + said(old));
        return '503 in words; day book unchanged; the chit door answers ' + old.status;
      });
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach((r) => skip('S1-' + r, 'needs migration b887', 'run b887 on this database, then run this file again'));
      return;
    }
    skip('S1-h', 'migration not run', 'b887 is applied here: run this file on a database BEFORE the migration to see this row');

    const B = await freshShop(RUN + 'b', 'Evidence B', AU);
    ok(await j('/api/books/enable', { method: 'POST', token: B.token }), 'books on (B)');
    const P = await freshShop(RUN + 'p', 'Evidence Firm', AU);
    /* the network edge first (books_grant_no_parent, lib/books-grant.js): the firm asks to be A's agency parent, A approves, then A grants the AUDITOR preset (the same three calls as toolset/sitfull/firm-door.cjs) */
    const edge = ok(await j('/api/network/connections', { method: 'POST', token: P.token, body: { childBridgeId: A.bridge, type: 'agency' } }), 'firm asks for the edge').b;
    ok(await j('/api/network/connections/' + (edge.id || (edge.edge && edge.edge.id)) + '/approve', { method: 'POST', token: A.token, body: {} }), 'owner approves the edge');
    ok(await j('/api/books-grants', { method: 'POST', token: A.token, body: { grantee: P.entity, preset: 'auditor', purpose: 'audit of the books', consent: true } }), 'grant for the firm (auditor, read)');
    const auditorPerson = await addActor(A, 'Asha Audit', 'a', { access_level: 'commenter', hat: 'audit' });
    const viewerPerson = await addActor(A, 'Vik View', 'v', { access_level: 'viewer', whole_entity: false, can_see_costs: false });
    const bookkeeperPerson = await addActor(A, 'Ravi Books', 'r', { hat: 'manager' });
    const AUD = await signIn(auditorPerson), VIEW = await signIn(viewerPerson), RAVI = await signIn(bookkeeperPerson);

    let e1, e2, e3;
    await kase('S1-a', 'the owner attaches a PNG to a posted entry (and to a reversal): count 1, no_source down by 1, the same for owner, firm under grant and Auditor seat', async () => {
      e1 = ok(await fee(A.token, 'a1'), 'fee 1').b;
      e2 = ok(await fee(A.token, 'a2'), 'fee 2').b;
      const before = await attention(A.token);
      const r = ok(await attach(A.token, e1.entry_id, PNG(11)), 'attach');
      expect(r.b.entry_id === e1.entry_id && r.b.mime === 'image/png' && r.b.id, 'attach answered ' + said(r));
      const after = await attention(A.token);
      expect(after.no_source === before.no_source - 1, 'no_source ' + before.no_source + ' -> ' + after.no_source + ' (down by 1 expected)');
      const own = await evidenceOf(A.token, e1.entry_id);
      expect(own.count === 1 && own.files.length === 1 && own.files[0].name === 'receipt.png' && !own.duplicate, 'owner evidence ' + JSON.stringify(own));
      const firm = (await firmJson(P.token, A.entity, '/daybook?from=' + DAY + '&to=' + DAY)).b.entries.find((e) => e.entry_id === e1.entry_id).evidence;
      const aud = await evidenceOf(AUD, e1.entry_id);
      expect(JSON.stringify(firm) === JSON.stringify(own) && JSON.stringify(aud) === JSON.stringify(own), 'owner / firm / auditor differ: ' + JSON.stringify([own, firm, aud]));
      /* /attention is the owner's own to-do: an AUDITOR preset is refused it by design (GRANT_ROUTE_NOT_LISTED, middleware/books-grant.js), so the firm reads the same fact through the Day book it IS listed for */
      const refused = await firmJson(P.token, A.entity, '/attention?from=' + DAY + '&to=' + DAY);
      expect(refused.status === 403 && refused.b.code === 'GRANT_ROUTE_NOT_LISTED', 'the auditor preset read /attention: ' + said(refused));
      const fileRead = await asFirm(P.token, A.entity, '/evidence/' + r.b.id);
      expect(fileRead.status === 200, 'the firm reads the file under its grant: ' + fileRead.status);
      /* a reversal accepts a file too */
      const rev = ok(await books(A.token, '/entries/' + e2.entry_id + '/reverse', { method: 'POST', body: { reason: 'wrong shop' } }), 'reverse').b;
      const revId = (rev.entry && rev.entry.entry_id) || rev.entry_id;
      ok(await attach(A.token, revId, PNG(12)), 'attach to the reversal');
      expect((await evidenceOf(A.token, revId)).count === 1, 'the reversal carries its file');
      return 'count 1 · no_source ' + before.no_source + '->' + after.no_source + ' · owner = firm = auditor';
    });

    await kase('S1-b', '7 MB, an .exe, an .exe renamed as an image, HEIC: all refused, nothing stored', async () => {
      const held = (await attention(A.token)).no_source;
      const big = await attach(A.token, e2.entry_id, Buffer.concat([PNG(1), Buffer.alloc(7 * 1024 * 1024)]));
      expect(big.status === 413 && /6 MB|Too large/i.test(JSON.stringify(big.b)), '7 MB: ' + said(big));
      const exe = await attach(A.token, e2.entry_id, EXE, 'run.exe', { mime: 'application/octet-stream' });
      const renamed = await attach(A.token, e2.entry_id, EXE, 'photo.png', { mime: 'image/png' });
      const heic = await attach(A.token, e2.entry_id, HEIC, 'photo.heic', { mime: 'image/heic' });
      expect([exe, renamed, heic].every((r) => r.status === 415 && /JPEG, PNG or PDF/.test(JSON.stringify(r.b))), 'type refusals: ' + [exe, renamed, heic].map(said).join(' | '));
      expect((await evidenceOf(A.token, e2.entry_id)).count === 0 && (await attention(A.token)).no_source === held, 'a refused file moved the books');
      return '413 · 415 x3 · nothing stored';
    });

    await kase('S1-c', 'Auditor seat and View-only: 403 with a sentence; the firm: refused; the edit seat may', async () => {
      const refused = [['auditor', await attach(AUD, e2.entry_id, PNG(21))], ['view-only', await attach(VIEW, e2.entry_id, PNG(22))]];
      const bad = refused.filter(([, r]) => r.status !== 403 || !/owner|edit/i.test(JSON.stringify(r.b))).map(([w, r]) => w + ' ' + said(r));
      expect(!bad.length, 'not refused with a sentence: ' + bad.join(' | '));
      const own = await attach(P.token, e2.entry_id, PNG(23));
      const named = await raw('/api/attachments', P.token, { method: 'POST', headers: { 'content-type': 'application/json', 'x-books-for': A.entity }, body: JSON.stringify({ entry_id: e2.entry_id, name: 'r.png', data_base64: b64(PNG(24)) }) });
      expect(own.status >= 400 && own.status < 500 && named.status === 403, 'firm: own login ' + own.status + ', naming the shop ' + named.status);
      expect((await evidenceOf(A.token, e2.entry_id)).count === 0, 'a refused seat stored a file');
      const edit = await attach(RAVI, e2.entry_id, PNG(25), 'ravi.png');
      expect(edit.status === 200, 'the edit seat: ' + said(edit));
      return 'auditor 403 · view-only 403 · firm ' + own.status + '/403 · edit seat 200';
    });

    await kase('S1-d', 'a file on an entry is never deleted or replaced; a second adds and the first stays', async () => {
      const files = (await evidenceOf(A.token, e2.entry_id)).files;
      const id = files[0].id;
      const del = await j('/api/attachments/' + id, { method: 'DELETE', token: A.token });
      const put = await j('/api/attachments/' + id, { method: 'PUT', token: A.token, body: { name: 'x', data_base64: b64(PNG(31)) } });
      const patch = await j('/api/attachments/' + id, { method: 'PATCH', token: A.token, body: { name: 'y' } });
      expect([del, put, patch].every((r) => r.status === 409 && r.b.code === 'ATTACHMENT_ADD_ONLY'), 'refusals: ' + [del, put, patch].map(said).join(' | '));
      ok(await attach(A.token, e2.entry_id, PNG(32), 'second.png'), 'second file');
      const after = await evidenceOf(A.token, e2.entry_id);
      expect(after.count === 2 && after.files.some((f) => f.id === id), 'count ' + after.count + ', first kept: ' + after.files.some((f) => f.id === id));
      return 'DELETE/PUT/PATCH 409 · count 2';
    });

    await kase('S1-e', 'the same file on a second entry: both say "same file as entry N", the firm too; a different file, and a look-alike receipt, stay silent', async () => {
      e3 = ok(await fee(A.token, 'e3'), 'fee 3').b;
      const twinA = ok(await fee(A.token, 'twin-a'), 'twin a').b, twinB = ok(await fee(A.token, 'twin-b'), 'twin b').b;
      ok(await attach(A.token, e3.entry_id, PNG(11), 'again.png'), 'the SAME bytes as the first entry');
      const first = await evidenceOf(A.token, e1.entry_id), second = await evidenceOf(A.token, e3.entry_id);
      expect(first.duplicate && first.duplicate.entry_no === e3.entry_no && second.duplicate && second.duplicate.entry_no === e1.entry_no, 'notes: ' + JSON.stringify([first.duplicate, second.duplicate]));
      const firm = (await firmJson(P.token, A.entity, '/daybook?from=' + DAY + '&to=' + DAY)).b.entries.find((e) => e.entry_id === e3.entry_id).evidence;
      const aud = await evidenceOf(AUD, e3.entry_id);
      expect(JSON.stringify(firm.duplicate) === JSON.stringify(second.duplicate) && JSON.stringify(aud.duplicate) === JSON.stringify(second.duplicate), 'firm / auditor note differs');
      const own2 = await evidenceOf(A.token, e2.entry_id);
      expect(!own2.duplicate, 'a different file got a note: ' + JSON.stringify(own2.duplicate));
      ok(await attach(A.token, twinA.entry_id, PNG(41)), 'look-alike receipt A');
      ok(await attach(A.token, twinB.entry_id, PNG(42)), 'look-alike receipt B (same fee, other bytes)');
      expect(!(await evidenceOf(A.token, twinA.entry_id)).duplicate && !(await evidenceOf(A.token, twinB.entry_id)).duplicate, 'two different receipts for the same amount were called duplicates');
      return 'twins named on both rows, firm and auditor see it; different bytes silent';
    });

    await kase('S1-f', 'a file on a no-tax-invoice purchase clears the flag; the BAS unsupported total falls by that entry\'s own GST line', async () => {
      /* since f7db1a265 a tax invoice is needed only for a gross MORE THAN A$82.50, and the bank-sheet door (input_tax_minor) refuses 422 without tax_invoice 'held'; the typed BILL door (books-manual `bill`, GST by the tax engine) lets an un-evidenced claimed-tax expense through: A$300.00 + 10% = gross A$330.00, GST A$30.00 */
      const bill = ok(await post(A.token, { class: 'sundry_expense', narration: 'Supplier purchase with GST', bill: { supplier_gstin: '53004085616', my_gstin: AU.tax.number, price_includes_tax: false, lines: [{ name: 'Supplier purchase', qty: 1, unit_price: 300, gst_rate: 10 }] } }), 'purchase (bill door, gross 330.00 > 82.50)').b;
      const entry = (await daybook(A.token)).find((e) => e.entry_id === bill.entry_id);
      expect(entry.evidence.flag === 'no_tax_invoice', 'the purchase is not flagged: ' + JSON.stringify(entry.evidence));
      const gstLine = entry.lines.find((l) => String(l.code) === '2210');
      expect(gstLine && gstLine.dr_minor === 3000, 'the posted GST line: ' + JSON.stringify(entry.lines));
      const bas = async () => ok(await books(A.token, '/returns'), 'returns').b;
      const before = await bas(), flaggedBefore = (await attention(A.token)).no_tax_invoice;
      expect(before.period && before.period.start <= DAY && DAY <= before.period.end, 'the return read a period that does not hold ' + DAY + ' (a run on the first day of a quarter): ' + JSON.stringify(before.period));
      ok(await attach(A.token, bill.entry_id, PNG(51), 'tax-invoice.png'), 'attach');
      const after = await bas();
      expect((await evidenceOf(A.token, bill.entry_id)).flag === null, 'the flag did not clear');
      expect((await attention(A.token)).no_tax_invoice === flaggedBefore - 1, 'the flagged count did not fall by 1');
      expect(before.unsupported_input.tax_minor - after.unsupported_input.tax_minor === gstLine.dr_minor && before.unsupported_input.count - after.unsupported_input.count === 1, 'unsupported ' + JSON.stringify([before.unsupported_input, after.unsupported_input]));
      return 'flag cleared · unsupported tax ' + before.unsupported_input.tax_minor + ' -> ' + after.unsupported_input.tax_minor;
    });

    await kase('S1-g', 'shop B cannot fetch shop A\'s file: the same answer as for a made-up id', async () => {
      const fileId = (await evidenceOf(A.token, e1.entry_id)).files[0].id;
      const foreign = await j('/api/books/evidence/' + fileId, { token: B.token });
      const made = await j('/api/books/evidence/00000000-0000-4000-8000-0000000000aa', { token: B.token });
      expect(foreign.status === 404 && made.status === 404 && foreign.b.code === made.b.code, 'foreign ' + said(foreign) + ' vs made-up ' + said(made));
      const viaAttach = await j('/api/attachments/' + fileId, { token: B.token });
      expect(viaAttach.status === 404, 'the old door gave B ' + viaAttach.status);
      const toForeignEntry = await attach(B.token, e1.entry_id, PNG(61));
      expect(toForeignEntry.status === 404, 'B attached to A\'s entry: ' + said(toForeignEntry));
      return '404 = 404; B cannot attach to A\'s entry (404)';
    });
  } finally {
    await pg.end();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => finish('books-evidence-s1', process.env.S1_JSON || null));
