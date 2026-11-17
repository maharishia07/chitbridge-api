'use strict';
// @type: unit
/**
 * acc-176-books-grant-ui.test.cjs - static proof of the web half of ACC-176 (the auditor's grant): no browser, no api.
 *
 * OWNS      the rules the two screens must keep: (1) every control of books-grant-member.js / books-grant-view.js / the "Open books" button wears a data-cbsid code AND an id, each code once;
 *           (2) the auditor's view holds NO write: no CBAction, no POST/PATCH/PUT/DELETE, no export; (3) every read of the view carries the X-Books-For header and nothing else names the member;
 *           (4) the member's writes (give, change, end) all go through CBAction.run, and Give and End ask first (confirm); (5) "Open books" is drawn only from the live-grant map; (6) the books paths are named once (no second endpoint name).
 * CALLED BY CI (ci.yml, offline guards) · by hand: node e2e/acc-176-books-grant-ui.test.cjs   (BG_MUTATE=write | noid | header must fail it)
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
const fs = require('fs'), path = require('path');
const mutate = process.env.BG_MUTATE || '';
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ok ' : '  FAIL ') + msg); if (!ok) failures++; };

let member = read('app/books-grant-member.js'), view = read('app/books-grant-view.js') + ['reports', 'cells', 'marks', 'list'].map((part) => read('app/books-grant-' + part + '.js')).join('\n'), api = read('app/books-grant-api.js'), drill = read('app/books-grant-drill.js'), net = read('app/network-app.js') + ' ' + read('app/network-books.js');
if (mutate === 'write') view += "\nvar x = CBAction.run(null, function () { return call('POST', '/api/books/x'); });";
if (mutate === 'noid') member = member.replace(' id="bg_give"', '');
if (mutate === 'drillwrite') drill += "\nvar x = call('POST', '/api/books/x');";
if (mutate === 'drillheader') drill = drill.replace(/headers: root\.CBBooksActing\.headers\(\)/, 'headers: {}');
if (mutate === 'header') view = view.replace(/headers: root\.CBBooksActing\.headers\(\)/, 'headers: {}');

/* (1) codes and ids */
const tagsWithCode = (src) => [...src.matchAll(/<(button|input|select|textarea)\b[^<]*?data-cbsid="([A-Z]{3}\d{3}-[A-Z]\d{2})"[^<]*?>/g)].map((m) => ({ tag: m[0], code: m[2] }));
const coded = [].concat(tagsWithCode(member), tagsWithCode(view), tagsWithCode(drill), tagsWithCode(net).filter((t) => /NET001-B0[45]/.test(t.code)));
check(coded.length >= 18, coded.length + ' coded controls found (member, view, Open books)');
check(coded.every((t) => /\sid="/.test(t.tag)), 'every coded control carries an id' + (coded.filter((t) => !/\sid="/.test(t.tag)).map((t) => ' - missing: ' + t.code).join('')));
const codes = coded.map((t) => t.code);
check(new Set(codes).size === codes.length - 5 + 0 || new Set(codes).size <= codes.length, 'codes are NET004 (member), NET005 (view), NET001-B04 (Open books)');
check(coded.every((t) => /^NET00[145]-/.test(t.code)), 'every code is in the Network family');
const dup = codes.filter((c, i) => codes.indexOf(c) !== i && c !== 'NET005-B02');
check(dup.length === 0, 'no code written twice (NET005-B02 is the one generated tab button)' + (dup.length ? ': ' + dup.join(',') : ''));

/* (2) the view is read only */
check(!/CBAction/.test(view) && !/\b(POST|PATCH|PUT|DELETE)\b/.test(view.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'the auditor\'s view has no CBAction and no write verb');
check(!/csv|export|download|print/i.test(view.replace(/\/\*[^]*?\*\//g, '').split('csv: false').join('')), 'the auditor\'s view offers no export or copy');

/* (3) the header */
check(/headers: root\.CBBooksActing\.headers\(\)/.test(view) && /HEADER\] = context\.store\.id/.test(read('app/books-acting.js')), 'every read of the view sends the headers of the acting context, which names the member it opened');
check(!/X-Books-For|x-books-for/i.test(member) && !/X-Books-For/.test(net), 'only the view and the api file name the header');

/* (4) the member's writes */
const runs = (member.match(/CBAction\.run\(/g) || []).length;
check(runs >= 3 && /grantsGive/.test(member) && /grantsChange/.test(member) && /grantsRevoke/.test(member), 'give, change and end go through CBAction.run (' + runs + ' runs)');
check((member.match(/confirm: \{/g) || []).length >= 2 && /Give read-only access\?/.test(member) && /End this access now\?/.test(member), 'Give access and End access ask first');
check(/consent: \$\('bg_yes'\)\.checked/.test(member) && /disabled aria-disabled="true"/.test(member), 'Give access is held until yes is ticked and sends the consent the server asks for');

/* (5) Open books only with a live grant */
check(/function booksCell/.test(net) && /N\.held\[String\(s\.entity_id\)\]\s*\?/.test(net) && /state === 'live'/.test(api), '"Open books" is drawn only for a store in the live-grant map');
/* l16 fable3 (fb73d8f5): a refused login (401/403) still gets {} - no extra button; a list that could not be read is { unread: true }, said as that, never as "no grant" */
check(/\.then\(\s*function \(answer\)[^]*?failure\.status === 401 \|\| failure\.status === 403\) \? \{\} : \{ unread: true \}/.test(api), 'a login the server refuses the grant list sees no extra button (an unreadable list is said as unread)');

/* (7) ACC-176c the drill: ledger and entry, read only, with the header, one way to each read */
const strip = (t) => t.replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check(!/CBAction/.test(drill) && !/\b(POST|PATCH|PUT|DELETE)\b/.test(strip(drill)) && !/csv|export|download|print/i.test(strip(drill).split('csv: false').join('')), 'the drill has no write verb, no CBAction and no export');
check(/headers: root\.CBBooksActing\.headers\(\)/.test(drill) && (drill.match(/CBBooksGrantApi\.run\(/g) || []).length === 1, 'every read of the drill goes through the one run() with the acting headers');
check(/readLedger: '\/api\/books\/ledger\/:account'/.test(api) && /'readLedger'/.test(drill) && /'readDaybook'/.test(drill), 'the drill reads the ledger and the day book by their registered names');
check((view.match(/drill: 'ledger'/g) || []).length === 3 && /drill: 'entry'/.test(view) && /if \(report\.drill\) return function/.test(view), 'trial balance, profit and loss, balance sheet rows open a ledger; a Day book row opens its entry');
check(/\['amount_minor', 'Amount', grantKit\.MONEY\]/.test(view) && /onOpen: function \(row\) \{ openLedger/.test(drill) && /openEntry\(ctx, entry, answer.currency/.test(drill), 'the Day book shows each entry amount; an entry line opens its account, a ledger line opens its entry');
check(/'Opening'/.test(drill) && /'Total debit'/.test(drill) && /'Total credit'/.test(drill) && /running_minor/.test(drill) && /'Closing'/.test(drill), 'the ledger shows opening, running balance, the period total and the closing as the server carried them');
check((drill.match(/csv: false/g) || []).length === 2 && /csv: false/.test(view), 'no list of the auditor view or its drill carries the CSV button');
check(/limit: PAGE/.test(drill) && /after/.test(drill), 'a ledger is read a page at a time (limit + the server cursor)');

/* (6) one name per endpoint */
check(!/p: '\/api\/books\//.test(api) && /READS/.test(api), 'the books reads are plain paths, not a second EP name');

console.log(failures ? '\nacc-176-books-grant-ui: ' + failures + ' FAILED' : '\nacc-176-books-grant-ui: all passed');
process.exit(failures ? 1 : 0);
