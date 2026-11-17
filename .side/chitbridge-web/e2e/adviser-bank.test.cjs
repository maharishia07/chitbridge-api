'use strict';
// @type: unit
/**
 * adviser-bank.test.cjs - the web half of lane l16/adviser-bank, no browser, no api: an acting ADVISER works the Bank page.
 *
 * OWNS      (1) the Bank tab opens for an adviser and opens read-only for an auditor (audbank); (2) the seat rule: a firm holding ONE adviser grant (and one auditor grant) sends X-Books-Role: adviser / none,
 *           chosen by the held grant's preset, never by how many grants are held; (3) the post adapter: posts only when the grant posts, never makes a party; (4) the words of who did it.
 * CALLED BY CI (offline guards) · by hand: node e2e/adviser-bank.test.cjs
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };
const fill = (s, h) => Object.keys(h || {}).reduce((t, k) => t.split('{' + k + '}').join(h[k]), s);
const box = { tx: (s) => s, txf: fill, esc: (s) => String(s), console };
box.window = box; box.globalThis = box; vm.createContext(box);
for (const f of ['books-grant-api.js', 'books-acting.js', 'cap-bank-post.js']) vm.runInContext(read(f), box, { filename: f });
const A = box.CBBooksActing, G = box.CBBooksGrantApi, P = box.CBBankPost;
const BAYSIDE = 'Bayside Bookkeeping - demo';

/* (1) the tab */
A.enter({ id: 's1', name: 'Client Co' }, 'adviser', 'adviser_posts');
check(!A.hides('bank') && A.hides('compare'), 'an adviser sees the Bank tab (and not the tabs outside the books)');
const menu = [['daybook'], ['bank'], ['compare']], groups = [['Books', ['daybook', 'compare', 'bank']]];
A.keepTabs(menu, groups);
check(menu.map((m) => m[0]).join() === 'daybook,bank' && groups[0][1].join() === 'daybook,bank', 'the menu cut keeps Bank for an adviser');
A.enter({ id: 's1', name: 'Client Co' }, 'auditor');
check(!A.hides('bank') && !A.posts(), 'an auditor gets the Bank tab, read only (audbank: it never posts)');
A.enter({ id: 's1', name: 'Client Co' }, 'owner');
check(!A.hides('bank'), 'the owner is not held back');

/* (2) the seat rule, from the grants the api lists */
const callOf = (list) => () => Promise.resolve({ received: list.map((g) => Object.assign({ state: 'live' }, g)) });
(async () => {
  const one = await G.heldSplit(callOf([{ grantor_entity: 'c1', preset: 'adviser', posting: 'adviser_posts' }]));
  check(A.roleOf(one.live, 'c1') === 'adviser', 'one adviser grant held: the role is adviser');
  A.enter({ id: 'c1', name: 'Bayside client' }, A.roleOf(one.live, 'c1'), one.live.c1.posting);
  check(A.headers()['X-Books-Role'] === 'adviser' && A.headers()['X-Books-For'] === 'c1' && A.posts(), 'one adviser grant: every request carries X-Books-For and X-Books-Role: adviser');
  const both = await G.heldSplit(callOf([{ grantor_entity: 'c1', preset: 'auditor' }, { grantor_entity: 'c1', preset: 'adviser', posting: 'owner_approves' }]));
  check(A.roleOf(both.live, 'c1') === 'adviser' && both.seats.c1.auditor && both.seats.c1.adviser, 'adviser and auditor held: the adviser seat acts, both seats are offered');
  const aud = await G.heldSplit(callOf([{ grantor_entity: 'c1', preset: 'auditor' }]));
  A.enter({ id: 'c1', name: 'x' }, A.roleOf(aud.live, 'c1'));
  check(!A.headers()['X-Books-Role'], 'one auditor grant: no role header');
  A.enter({ id: 'c1', name: 'x' }, 'adviser');
  check(!A.posts(), 'a grant that does not post (no posting) is known up front');

  /* (3) the post adapter */
  const calls = [];
  const api = async (key) => { calls.push(key); return { ok: true, entry_no: 'E1' }; };
  const item = (type, party) => ({ ref: 'bank:abc-1', event: { type, date: '2026-11-01', amount: 100, narration: 'n' }, line: { credit_minor: 100 }, party });
  const run = (who, it) => P.adapter({ api, who })(it);
  let r = await run({ role: 'adviser', posts: false }, item('expense'));
  check(!r.ok && /owner has not let you post straight into these books\. Prepare a journal for the owner to accept instead\./.test(r.why) && !calls.length, 'an adviser whose grant does not post is refused up front, nothing sent');
  r = await run({ role: 'adviser', posts: true }, item('expense'));
  check(r.ok && calls.join() === 'booksEventPost', 'an adviser whose grant posts adds an expense through POST /events');
  calls.length = 0;
  r = await run({ role: 'adviser', posts: true }, item('payment_received', { status: 'existing', id: 'p1', name: 'Rao' }));
  check(r.ok && calls.join() === 'booksPayRecord', 'a payment from an existing party goes through POST /payments');
  calls.length = 0;
  r = await run({ role: 'adviser', posts: true }, item('payment_made', { status: 'new', name: 'Kumar Traders', kind: 'supplier' }));
  check(!r.ok && r.why === 'Ask the owner to add Kumar Traders to the party list first, then add this line.' && !calls.length, 'a line that needs a new party is refused for the adviser, no party made');
  r = await run({ role: 'adviser', posts: true }, item('payment_made', null));
  check(!r.ok && !calls.length, 'a payment with no party id is refused');
  r = await run({ role: 'owner' }, item('expense'));
  check(r.ok, 'the owner is unchanged');
  r = await run({ role: 'other' }, item('expense'));
  check(!r.ok && /for the owner/.test(r.why), 'any other login is still told it is the owner\'s');

  /* (4) the words */
  const sb = { tx: (s) => s, txf: fill, bkDate: (d) => d, bkbBy: () => 'Viewer Name', cbMeId: () => 'bbbbbbbb-1111-2222-3333-444444444444', CBBooksActing: A, console };
  sb.window = sb; vm.createContext(sb);
  vm.runInContext(read('cap-bank-store.js').replace(/^const /gm, 'var ') + '\nthis.f = { signer: bankStoreSigner, full: bankStoreSignerFull, madeBy: bankStoreMadeBy };', sb);
  A.leave();
  const other = 'aaaaaaaa-1111-2222-3333-444444444444';
  check(sb.f.full({ by: other, by_name: 'Pat Lee', by_firm: BAYSIDE }) === 'Pat Lee, ' + BAYSIDE, 'sign-off by an adviser names who and the firm');
  check(sb.f.signer({ by: other }) === '', 'an id of someone else with no name never prints the viewer\'s name');
  check(sb.f.signer({ by: 'bbbbbbbb-1111-2222-3333-444444444444' }) === 'Viewer Name', 'this login\'s own id still reads as its own name');
  check(sb.f.signer({ by: 'Owner Name' }) === 'Owner Name', 'a plain name stays');
  check(sb.f.madeBy({ made_by: 'Pat', by_name: 'Pat Lee', by_firm: 'Bayside' }) === 'Pat Lee, Bayside', 'the owner reads "name, firm"');
  A.enter({ id: 'c1', name: 'Client Co' }, 'adviser', 'adviser_posts');
  check(sb.f.madeBy({ made_by: 'Pat', by_name: 'Pat Lee', by_firm: 'Bayside' }) === 'Pat Lee for Client Co', 'the adviser reads "name for client"');
  check(A.postedByWords({ posted_by: { name: 'Pat Lee', firm: 'Bayside' } }) === 'by Pat Lee for Client Co' && A.postedByWords({ posted_by: null }) === '', 'Day book: adviser view words, none when nobody posted');
  A.enter({ id: 'c1', name: 'Client Co' }, 'owner');
  check(A.postedByWords({ posted_by: { name: 'Pat Lee', firm: 'Bayside' } }) === 'Posted by Pat Lee, Bayside', 'Day book: owner view words');
  const routes = read('books-grant-words.js');
  for (const k of ['GET /bank/log', 'POST /bank/marks', 'POST /bank/statements', 'POST /events', 'POST /payments']) check(routes.includes("'" + k + "':"), 'the owner\'s log words cover ' + k);
  console.log(failures ? failures + ' FAILED' : 'adviser-bank: all ok');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
