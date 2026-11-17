'use strict';
// @type: unit
/**
 * acc-176b-adviser-ui.test.cjs - proof of the web half of ACC-176b (adviser access, maker-checker): no browser, no api.
 *
 * OWNS      the rules the adviser screens must keep so data never mixes between clients: (1) the acting context builds headers and store_id from ONE place, the owner sends no header, an auditor only X-Books-For, an adviser both;
 *           (2) a different store clears every registered draft and cache first; the same store keeps them; (3) every write of the queues carries store_id and the body_hash it was shown, accept also total_minor and currency;
 *           (4) a late answer of the previous store is dropped; (5) the firm is offered review, the owner accept, both send back; (6) every refusal code of api PR #1313 has a plain sentence; (7) every control wears a code and an id, each code once; (8) no literal header name outside books-grant-api.js
 * CALLED BY CI (ci.yml, offline guards) · by hand: node e2e/acc-176b-adviser-ui.test.cjs   (ADV_MUTATE=store | clear | late | accept must fail it)
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const mutate = process.env.ADV_MUTATE || '';
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

let acting = read('books-acting.js'), actions = read('books-actions-view.js'), api = read('books-grant-api.js'), member = read('books-grant-member.js'), view = read('books-grant-view.js') + ['reports', 'cells', 'marks', 'list'].map((part) => read('books-grant-' + part + '.js')).join('\n');
if (mutate === 'store') acting = acting.replace('{ store_id: context && context.store.id }', '{}');
if (mutate === 'clear') acting = acting.replace('if (context && String(context.store.id) !== String(store.id)) clearAll();', '');
if (mutate === 'late') actions = actions.replace('if (root.CBBooksActing.current().store.id !== asked) return false;', '');
if (mutate === 'accept') actions = actions.replace('total_minor: row.total_minor, currency: row.currency', '');

/* (1) + (2) the context itself, run as the page runs it */
const sandbox = { tx: (s) => s, esc: (s) => String(s), CBBooksGrantApi: { HEADER: 'X-Books-For', ROLE_HEADER: 'X-Books-Role' } };
sandbox.window = sandbox; vm.createContext(sandbox); vm.runInContext(acting, sandbox);
const A = sandbox.CBBooksActing;
A.enter({ id: 's1', name: 'One' }, 'owner');
check(JSON.stringify(A.headers()) === '{}', 'the owner sends no header');
A.enter({ id: 's1', name: 'One' }, 'auditor');
check(A.headers()['X-Books-For'] === 's1' && !A.headers()['X-Books-Role'], 'an auditor names the store and no role');
A.enter({ id: 's1', name: 'One' }, 'adviser');
check(A.headers()['X-Books-For'] === 's1' && A.headers()['X-Books-Role'] === 'adviser', 'an adviser names the store and the role');
check(A.body({ body_hash: 'h' }).store_id === 's1' && A.body({ body_hash: 'h' }).body_hash === 'h', 'every write body carries the open store_id');
let cleared = 0;
A.onClear(() => { cleared++; });
A.enter({ id: 's1', name: 'One' }, 'adviser');
check(cleared === 0, 'the same store keeps its drafts');
A.enter({ id: 's2', name: 'Two' }, 'adviser');
check(cleared === 1 && A.headers()['X-Books-For'] === 's2' && A.body({}).store_id === 's2', 'another store clears drafts and caches first, then every request names the new store');
A.setCurrency('AUD');
check(/Acting for Two, AUD/.test(A.banner([{ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }]).replace(/<[^>]+>/g, '')), 'the banner says Acting for <store>, <currency>');
check(/ba_switch/.test(A.banner([{ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }])) && !/ba_switch/.test(A.banner([{ id: 's2', name: 'Two' }])), 'the switch is drawn only when the firm holds more than one store');
A.leave();
check(A.current() === null, 'leaving forgets the store');

/* (3) the writes */
for (const key of ['actionsReview', 'actionsReturn', 'actionsAccept']) {
  check(new RegExp("api\\('" + key + "', \\{ params: \\{ id: [a-z._]+ \\}, (?:headers: .*?, )?body: root\\.CBBooksActing\\.body\\(\\{ body_hash: row\\.body_hash").test(actions), key + ' carries store_id (the context) and the body_hash it was shown');
}
check(/total_minor: row\.total_minor, currency: row\.currency/.test(actions), 'accept carries the total and currency of its own row, per action');
check(/CBAction\.run\(/.test(actions) && (actions.match(/confirm: \{/g) || []).length >= 2 && /Accept and post\?/.test(actions) && /reachWords\(rows\)/.test(actions), 'accept asks first and the confirm names the store, count and total');
check(/reason: reason/.test(actions) && /Send this back\?/.test(actions), 'send back carries a reason');
/* (4) the late answer */
check(/if \(root\.CBBooksActing\.current\(\)\.store\.id !== asked\) return false;/.test(actions), 'an answer that arrives after the store changed is dropped');
/* (5) who is offered what */
check(/when: function \(r\) \{ return !owner && r\.state === 'waiting_review'; \}/.test(actions) && /when: function \(r\) \{ return owner && r\.state === 'waiting_accept'; \}/.test(actions), 'the firm is offered review, the owner accept');
check(/bulk: view\.o\.mode === 'owner' && view\.queue === 'accept'/.test(actions), 'bulk accept is the owner\'s, in the accept queue');
/* (6) refusal words */
const codes = ['ACTION_SELF_REVIEW', 'ACTION_NOT_REVIEWED', 'ACTION_BODY_CHANGED', 'ACTION_ACCESS_ENDED', 'ACTION_REF_OPEN', 'ACTION_REF_POSTED', 'ACTION_DUPLICATE', 'ACTION_CLOSED', 'STORE_MISMATCH', 'PREVIEW_TOTAL_DIFFERS', 'BOOKS_ACTION_NOT_SWITCHED_ON'];
check(codes.every((c) => new RegExp('\\b' + c + ': \'').test(api)), 'all ' + codes.length + ' refusal codes have a plain sentence');
/* (7) codes and ids */
const tags = (src) => [...src.matchAll(/<(button|input|select|textarea)\b[^<]*?data-cbsid="([A-Z]{3}\d{3}-[A-Z]\d{2})"[^<]*?>/g)].map((m) => ({ tag: m[0], code: m[2] }));
const mine = [].concat(tags(acting), tags(actions), tags(member).filter((t) => /NET004-(B10|S02)/.test(t.code)));
check(mine.length >= 8 && mine.every((t) => /\sid="/.test(t.tag)), mine.length + ' new controls each wear a code and an id');
const codeList = mine.map((t) => t.code);
check(new Set(codeList).size === codeList.length - 0 || codeList.filter((c, i) => codeList.indexOf(c) !== i).every((c) => c === 'NET007-B01'), 'no code written twice (NET007-B01 is the one generated queue tab)');
/* (9) prepare: the entry sheet PREPARES under an adviser, from the owner's books page opened for the store */
const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const entry = pub('app/cap-entry.js') + pub('app/cap-entry-preview.js'), core = pub('app/core.js'), accounts = pub('accounts.html');
check(entry.includes("enActingAdviser() ? await CBBooksActing.prepare(api, tx, body, bkToday().slice(0, 7)) : await api('booksEventPost'"), 'Save under an adviser grant prepares; any other login posts as before');
check(acting.includes("body({ kind: 'journal', body: journal, client_ref: entry.client_ref, working_month: month })") && acting.includes('if (!entry.date) throw'), 'prepare sends store_id, kind journal, the body, client_ref and working_month, and needs the date');
check(core.includes("typeof CBBooksActing !== 'undefined' ? CBBooksActing.headers() : {}") && core.includes('...actingHeaders()'), 'every request of a page acting for a store carries its headers; other pages send none');
check(accounts.includes('CBBooksActing.fromAddress(location.search)') && acting.includes("band.id = 'acting-band'") && accounts.includes('CBBooksActing.startPage(') && view.includes("'Prepare a journal'"), 'the books page reads the store from its address and shows the banner; the workspace offers Prepare a journal');
/* (10) acting: only the /api/books* tabs and calls; one accept key per attempt; a delegated post says it posted */
const A2 = (() => { const sb = { tx: (x) => x, esc: (x) => String(x), CBBooksGrantApi: { HEADER: 'X-Books-For', ROLE_HEADER: 'X-Books-Role' } }; sb.window = sb; vm.createContext(sb); vm.runInContext(acting, sb); return sb.CBBooksActing; })();
A2.enter({ id: 's1', name: 'One' }, 'adviser', 'adviser_posts');
check(A2.posts() && ['/api/books/daybook', '/api/books-actions', '/api/books-grants'].every((p) => A2.mayCall(p)) && ['/api/entities', '/api/chits', '/api/crm', '/api/relationships', '/api/tax', '/api/facts'].every((p) => !A2.mayCall(p)), 'acting: only /api/books, /api/books-actions and /api/books-grants may be called under the header');
const nav = [['todo'], ['daybook'], ['bank'], ['tb'], ['events']], groups = [['', ['todo']], ['Books', ['daybook', 'bank', 'tb']]];
A2.keepTabs(nav, groups);
check(nav.map((n) => n[0]).join() === 'daybook,bank,tb' && groups.length === 1 && groups[0][1].join() === 'daybook,bank,tb', 'acting: the menu keeps the books tabs and, for an adviser, the Bank (no To do, events); l16 adviser-bank');
A2.enter({ id: 's1', name: 'One' }, 'adviser', 'owner_approves');
check(!A2.posts(), 'an owner_approves grant prepares; only adviser_posts posts');
const host = { innerHTML: '' }, acts = { innerHTML: '' };
A2.paintPrepared(host, acts, { posted: true, state: 'accepted', entry_no: 'JV-0007' }, (x) => x, (x) => String(x));
check(/Posted JV-0007/.test(host.innerHTML.replace(/<[^>]+>/g, '')) && !/Nothing is posted/.test(host.innerHTML), 'a delegated post paints Posted <entry_no>, not Prepared');
check(actions.includes('attemptKey(row)') && !actions.includes("'accept-' + row.action_id }") && actions.includes('delete row.accept_key'), 'accept: one key per attempt, dropped once an answer under 500 settles it');
check(entry.includes("p: '/api/books-actions', idem: 'attempt' }") && entry.includes('EN.saved.posted) enSavedTell'), 'prepare is one key per attempt; a delegated post runs the after-save tell');
check(core.includes('CBBooksActing.guard(ep)') && accounts.includes('CBBooksActing.openPage(') && acting.includes('confirmGrant(base, token)') && acting.includes('keepTabs(menu, groups)') && !acting.includes('actingName'), 'the page enters only on a live adviser grant, the name comes from the grant row, the core refuses a call outside /api/books*');
/* (11) round 2: an acting adviser prepares, hides the bank, is named right; the switch lists every client */
A2.enter({ id: 's1', name: 'One' }, 'adviser', 'owner_approves');
check(A2.refusals([{ message: 'Only the owner may record this.' }, { message: 'Date is locked' }]).length === 1 && entry.includes('CBBooksActing.refusals(reply.refusals)'), 'an acting adviser is not stopped by the owner-only preview sentence; the sheet asks CBBooksActing');
check(!A2.hides('bank') && !A2.hides('tb') && A2.hides('compare') && /not open to an accountant/.test(A2.refusedFor()), 'acting: the bank is open to an adviser (the auditor reads it, read only: e2e/adviser-bank.test.cjs); the refusal names an adviser');
A2.enter({ id: 's2', name: 'Two' }, 'auditor');
check(!A2.hides('bank') && A2.hides('tb') && /not open to an auditor/.test(A2.refusedFor()) && A2.refusals(['x']).length === 1, 'an auditor is named as an auditor (the Bank is read-only open since audbank, the trial balance stays hidden)');
const heldBy = { s1: { preset: 'adviser', grantor_name: 'One' }, s2: { preset: 'auditor', grantor_name: 'Two' } };
check(A2.clientStores([{ entity_id: 's1', name: 'x' }, { entity_id: 's2', name: 'y' }, { entity_id: 's3', name: 'z' }], heldBy).map((c) => c.role).join() === 'adviser,auditor' && acting.includes("'Switch client'") && !acting.includes('Switch store'), 'the switch lists every client with its role (adviser and auditor), not only advisers');
check(api.includes("out.live[id].preset === 'adviser'") && api.includes('grant.revoked_at'), 'held(): the adviser grant wins when both are live; an ended grant is not held');
check(view.includes('num: isNumberColumn(column)') && view.includes('groupWords') && view.includes('paintDues') && !view.includes("facts: [['total_minor'") && view.includes('totalRows') && view.includes('monthRows') && view.includes('usePeriod'), 'the grant screens: money right-aligned, group words, two dues panels without a net, totals row, the month of the books');
/* (9) round 2b: parents from the answer, the firm's client list, ended grants, the front door */
const net = read('network-app.js') + ' ' + read('network-books.js'), door = read('books-clients-door.js');
check(member.includes('answer.parents') && member.includes('allParents()') && member.includes('entity_id'), 'Give access: the parents the server names (governance, commercial, agency) join the network list, once each');
check(api.includes('clientColumns') && api.includes("'since'") && api.includes("'until'") && api.includes("['city', 'km', 'purpose']") && net.includes('clientColumns(cols, N, T)'), 'the client list of a firm: Role, Since, Until; no City, Distance or purpose columns');
check(api.includes('heldSplit') && api.includes('endedWords') && net.includes('nw-ended-') && (net.includes('N.ended') || net.includes('page.ended')), 'ended grants are listed with their state in words and no Open books');
check(door.includes('home-your-clients') && door.includes('/network.html') && read('../app.html').includes('books-clients-door.js'), 'Home: a login with live received grants gets a "Your clients" card to My network');
check(view.includes('foldHead: true') && view.includes("setAttribute('tabindex', '-1')") && view.includes('focusHeading'), 'books view: the list head folds; focus moves to the heading on open');
/* (8) the header names live in one file */
check(![acting, actions, member, view].some((src) => /X-Books-(For|Role)/.test(src.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/^ \*.*$/gm, ''))), 'no literal header name outside books-grant-api.js');

console.log(failures ? '\nacc-176b-adviser-ui: ' + failures + ' FAILED' : '\nacc-176b-adviser-ui: all passed');
process.exit(failures ? 1 : 0);
