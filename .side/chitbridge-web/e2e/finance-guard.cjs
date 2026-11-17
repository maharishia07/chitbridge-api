/* Finance guard (F1 · F2 · F3): static — no browser. CB Finance · Collections agrees with itself and with the pieces it reuses:
   · finance.html wears the ONE frame (CBAvatar · the header with Home · the kural band · the one sign-in) and loads what cap-finance.js reaches for;
   · the Home door points at /finance.html (state built);
   · the only call is the existing booksDues row, asked with finance=1; Receive is payOpen (the one payment path), Remind is bkRemind (M28);
   · cap-finance.js computes no money (no arithmetic on *_minor), never paints a server message raw, and shows the owner-only sentence greyed. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let fail = 0; const bad = (m) => { fail++; console.log('FAIL ' + m); }; const ok = (m) => console.log('  ok  ' + m);

const page = read('public/finance.html'), cap = read('public/app/cap-finance.js'), man = JSON.parse(read('public/app/manifest.json'));

['/app/avatar.js', '/app/core.js', '/app/accounts-shell.js', '/app/list-ctl.js', '/app/cap-books.js', '/app/rail-thread.js', '/app/signin-ui.js', '/app/cap-finance.js', '/app/kural.js'].forEach((s) => { if (page.indexOf('src="' + s + '"') < 0) bad('finance.html does not load ' + s); });
/* the frame is CBFrame.mount (page-frame.js → shell.js): the shell mounts the avatar, the bell and ⌂ Home itself (SHELL-ONE) */
['CBFrame.mount', 'CBKural.mount', 'CBSignin.mount', 'data-testid="fin-shell"', '/app/shell.js', '/app/page-frame.js', '/app/rail-bell.js'].forEach((s) => { if (page.indexOf(s) < 0) bad('finance.html lacks the frame piece ' + s); });
{ const sh = read('public/app/shell.js'); ['CBAvatar.mount', 'CBBell.mount', "testid: 'shell-home'"].forEach((x) => { if (sh.indexOf(x) < 0) bad('shell.js no longer carries ' + x); }); }
if (!fail) ok('one frame: CBFrame → the shell (avatar · Home · bell) · kural band · the one sign-in');

const door = man.entries.filter((e) => e.id === 'finance')[0];
if (!door || door.route !== '/finance.html' || door.state !== 'built') bad('the Finance door must open /finance.html as built'); else ok('Home door → /finance.html');

const noCom = cap.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const calls = [...noCom.matchAll(/\bapi\('(\w+)'/g)].map((m) => m[1]);
/* WALK2 W36 (FIN-2): the dues, and beside them the unbilled orders (workFacts ?unbilled=1, the Home box's read) — no other call, no money worked out here */
if (calls.length !== 2 || calls.indexOf('booksDues') < 0 || calls.indexOf('workFacts') < 0) bad('the only calls must be booksDues and workFacts, found ' + JSON.stringify(calls)); else ok('two calls: booksDues · workFacts (unbilled orders, W36)');
if (!/unbilled:\s*'1'/.test(cap)) bad('workFacts must be asked with unbilled=1');
if (!/finance:\s*'1'/.test(cap)) bad('booksDues must be asked with finance=1');
if (!/payOpen\(\\?'customer\\?'/.test(cap)) bad('Receive must open payOpen (the one payment path)');
if (!/bkRemind\(/.test(cap)) bad('Remind must be bkRemind (M28)');
else ok('Receive = payOpen · Remind = bkRemind');

/* no arithmetic on the server's figures: a sum for a group head is the list's own "fig" (bkOwes of the rows), the rest is painted as given */
const stripped = cap.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
if (/_minor\s*[*\/]/.test(stripped) || /[*\/]\s*\w+\.\w*_minor/.test(stripped)) bad('cap-finance.js must not compute with *_minor'); else ok('no money computed here');
if (/e(rr)?\.message|error\.message/.test(stripped)) bad('a server message must not be painted raw'); else ok('no raw server message');
if (!/fin-denied/.test(cap) || !/Only the owner may see collections\./.test(cap) || !/status === 403/.test(cap)) bad('the owner-only refusal must be drawn as its sentence'); else ok('owner-only: the sentence, greyed');
if (/\bconfirm\(|\balert\(/.test(cap)) bad('no browser confirm/alert');
if (/#[0-9a-fA-F]{3,6}\b/.test(stripped)) bad('no raw colours');

/* ── F2 · Terms (cap-finance-terms.js + the CRM record's read-only block): static, no browser ── */
const ft = read('public/app/cap-finance-terms.js'), crmRec = read('public/app/cap-crm-record.js'), crmJs = read('public/app/cap-crm.js');
const ftc = ft.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
if (page.indexOf('/app/cap-finance-terms.js') < 0 || page.indexOf('data-testid="fin-nav-terms"') < 0 || page.indexOf('href="#/terms"') < 0) bad('finance.html must load cap-finance-terms.js and carry the Terms nav'); else ok('Terms tab: script + nav');
const ftCalls = [...ftc.matchAll(/\bapi\('(\w+)'/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort().join();
if (ftCalls !== 'booksTerms,booksTermsSet,crmParties') bad('the Terms tab calls booksTerms · booksTermsSet · crmParties, found ' + ftCalls); else ok('Terms calls: booksTerms · booksTermsSet · crmParties');
if (!/CBAction\.run\(\s*btn/.test(ftc) || (ftc.match(/CBAction\.run\(/g) || []).length < 2) bad('both Saves (shop, party) go through CBAction.run (M64)'); else ok('Saves are M64 actions');
if (!/bkMoneyInput\(/.test(ftc) || !/bkMoneyRead\(/.test(ftc)) bad('the limit is the M36 money unit (bkMoneyInput / bkMoneyRead)'); else ok('the limit is the money unit');
if (/_minor\s*[*\/+\-]|[*\/]\s*\w+\.\w*_minor|\*\s*100\b/.test(ftc)) bad('the Terms tab must not compute money'); else ok('Terms: no money computed');
if (/e(rr)?\.message|error\.message/.test(ftc) || /\bconfirm\(|\balert\(/.test(ftc) || /#[0-9a-fA-F]{3,6}\b/.test(ftc)) bad('Terms: no raw server message, no browser dialog, no raw colour'); else ok('Terms: no raw message / dialog / colour');
if (!/Terms arrive after the next update\./.test(ftc) || !/may_set/.test(ftc) || !/why_not/.test(ftc)) bad('Terms: the not-yet-migrated sentence and the server\'s may/why must be shown'); else ok('Terms: unmigrated and not-allowed said in words, greyed');
if (/coming/.test(crmRec.replace(/\/\*[\s\S]*?\*\//g, '')) && /Finance[^'"]*coming/.test(crmRec)) bad('the CRM record still says Finance is coming'); else ok('CRM record: the "coming" text is gone');
if (!/booksTerms/.test(crmRec) || !/booksTerms/.test(crmJs) || !/crm-terms/.test(crmRec)) bad('the CRM record must read booksTerms (read-only) and show the changes'); else ok('CRM record reads terms, read-only');
if (/booksTermsSet/.test(crmRec)) bad('the CRM record must not SET terms — Finance is the one place'); else ok('CRM record never sets terms');

/* ── F3 · Cash (cap-finance-cash.js): static, no browser — the tab paints the server's cash position and computes nothing ── */
const fc = read('public/app/cap-finance-cash.js');
const fcc = fc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
if (page.indexOf('/app/cap-finance-cash.js') < 0 || page.indexOf('data-testid="fin-nav-cash"') < 0 || page.indexOf('href="#/cash"') < 0) bad('finance.html must load cap-finance-cash.js and carry the Cash nav'); else ok('Cash tab: script + nav');
const fcCalls = [...fcc.matchAll(/\bapi\('(\w+)'/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).join();
if (fcCalls !== 'booksCashflow') bad('the Cash tab calls booksCashflow and nothing else, found ' + JSON.stringify(fcCalls)); else ok('Cash calls: booksCashflow only');
if (!/query:\s*\{\s*days:/.test(fcc)) bad('the 7/30 toggle must re-ask the server (query days), never slice the answer');
/* no arithmetic on the server's figures: the bars are drawn FROM balance_minor (a scale is geometry, not money); in · out · balance · shortfall are painted as given */
if (/_minor\s*[*\/+\-]\s*[\w(]/.test(fcc.replace(/Number\(d\.balance_minor \|\| 0\)/g, '')) || /\*\s*100\b/.test(fcc)) bad('cap-finance-cash.js must not compute with *_minor'); else ok('Cash: no money computed here');
if (/e(rr)?\.message|error\.message/.test(fcc) || /\bconfirm\(|\balert\(/.test(fcc)) bad('Cash: no raw server message, no browser dialog'); else ok('Cash: no raw message / dialog');
if (/#[0-9a-fA-F]{3,6}\b/.test(fcc.replace(/var\(--[\w-]+,\s*#[0-9a-fA-F]{3,8}\)/g, ''))) bad('Cash: a raw colour outside a var() fallback'); else ok('Cash: theme tokens only (var(--token,#fallback))');
if (!/finOff\(\)/.test(fcc) || !/finDenied\(FC_OWNER_ONLY\)/.test(fcc) || !/Only the owner may see the cash position\./.test(fcc) || !/status === 403/.test(fcc) || !/status === 404/.test(fcc)) bad('Cash: the ledger-off card and the owner-only sentence must be the shared ones'); else ok('Cash: ledger off → finOff · owner only → the sentence, greyed');
if (!/CBList\.mount\(/.test(fcc) || !/CBList\.nextRow\(/.test(fcc) || !/notices/.test(fcc)) bad('Cash: the days are the one list (CBList), a day opens with nextRow, the sentence rides as a head notice'); else ok('Cash: CBList table · nextRow · head notice');
/* WALK2 W32 (FIN-1): a shopkeeper reads money and "short", never Dr/Cr — fcBal over bkMoney (M36); the drawer and UPI/bank are two named figures */
if (/bkDrCr\(/.test(fcc) || !/function fcBal\(/.test(fcc) || !/bkMoney\(/.test(fcc) || !/fc-drawer/.test(fcc) || !/fc-bank/.test(fcc)) bad('Cash: balances in words (fcBal, no Dr/Cr), amounts through bkMoney (M36), drawer and UPI/bank named (W32)'); else ok('Cash: no Dr/Cr · M36 money unit · drawer and UPI/bank named (W32)');
if (!/role="img"/.test(fcc) || !/aria-label=/.test(fcc)) bad('Cash: the chart needs role=img and an aria-label (the table carries the numbers)'); else ok('Cash: chart is labelled; numbers are also the table');
if (!/booksCashflow/.test(read('e2e/fixtures/web-api.contract.json')) && !/\/api\/books\/cashflow/.test(read('e2e/fixtures/web-api.contract.json'))) bad('the contract copy must list GET /api/books/cashflow'); else ok('contract copy lists /api/books/cashflow');
const flows = read('docs/process/flows.json');
if (!/"cash position"/.test(flows) || !/cap-finance-cash\.js/.test(flows)) bad('flows.json must carry the cash position step (PM1)'); else ok('flows.json: cash position step');

/* ── F4 · Payables (cap-finance-pay.js + payOpen's offer): static, no browser — the tab paints the server's payables and computes nothing ── */
const fp = read('public/app/cap-finance-pay.js'), books = read('public/app/cap-books.js');
const fpc = fp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
if (page.indexOf('/app/cap-finance-pay.js') < 0 || page.indexOf('data-testid="fin-nav-payables"') < 0 || page.indexOf('href="#/payables"') < 0) bad('finance.html must load cap-finance-pay.js and carry the Payables nav'); else ok('Payables tab: script + nav');
const fpCalls = [...fpc.matchAll(/\bapi\('(\w+)'/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).join();
/* R106 (OPS-60): three doors beside the one dues read — the held bills from the pay sheet's open-bills reader (booksPayPreview, read only when a row with
   disputed_minor opens), the books' one hold (booksDispute = POST /parties/:id/dispute, Hold and Release); the debit note goes through cap-entry's enOpen */
if (fpCalls !== 'booksDues,booksPayPreview,booksDispute' || !/side:\s*'supplier',\s*finance:\s*'1'/.test(fpc)) bad('Payables reads the SAME dues route (booksDues, side=supplier&finance=1), the held bills through booksPayPreview and the hold through booksDispute — nothing else, found ' + JSON.stringify(fpCalls)); else ok('Payables calls: booksDues (side=supplier, finance=1) · booksPayPreview (held bills) · booksDispute (hold/release) — no second dues route');
if (!/payOpen\('supplier',\s*pid,\s*\{\s*offer:/.test(fpc) || /booksPayRecord/.test(fpc)) bad('Pay must be payOpen (the one payment path) with the server\'s offer — no second pay form'); else ok('Pay = payOpen with the offer');
if (!/allocate: 'none'/.test(fpc) || !/item\.disputed && Number\(item\.open_minor\) > 0/.test(fpc)) bad('the held list reads the preview with allocate none and keeps only the server\'s disputed bills'); else ok('held bills: the preview\'s disputed rows, nothing allocated');
if (!/enOpen\(\{ kind: 'debit_note'/.test(fpc) || !/CBAction\.run\(/.test(fpc) || !/booksDispute', \{ params: \{ id: pid \}, body: \{ against_ref: ref, side: 'supplier', disputed: false \}/.test(fpc)) bad('R106: Hold/Release through CBAction (ask first) on the books\' dispute route; Note a difference through the one Entry door'); else ok('R106: Hold · Release ask first (CBAction) · Note a difference = enOpen debit_note');
/* no arithmetic on the server's figures; the one sum is the group head's fig, as Collections' */
if (/_minor\s*[*\/\-]|[*\/]\s*\w+\.\w*_minor|\*\s*100\b/.test(fpc.replace(/t \+ Number\(p\.payable\.total_minor \|\| 0\)/, ''))) bad('cap-finance-pay.js must not compute money'); else ok('Payables: no money computed here');
if (/e(rr)?\.message|error\.message/.test(fpc) || /\bconfirm\(|\balert\(/.test(fpc)) bad('Payables: no raw server message, no browser dialog'); else ok('Payables: no raw message / dialog');
if (/#[0-9a-fA-F]{3,6}\b/.test(fpc.replace(/var\(--[\w-]+,\s*#[0-9a-fA-F]{3,8}\)/g, ''))) bad('Payables: a raw colour outside a var() fallback'); else ok('Payables: theme tokens only');
if (!/finOff\(\)/.test(fpc) || !/finDenied\(FP_OWNER_ONLY/.test(fpc) || !/Only the owner may see what you owe\./.test(fpc)) bad('Payables: the ledger-off card and the owner-only sentence must be the shared ones'); else ok('Payables: ledger off → finOff · owner only → the sentence, greyed');
if (!/CBList\.mount\(/.test(fpc) || !/CBList\.nextRow\(/.test(fpc) || !/order: \['overdue', 'msme', 'week', 'later'\]/.test(fpc)) bad('Payables: one list (CBList) grouped Overdue · MSME at risk · Due this week · Later, a row opens with nextRow'); else ok('Payables: CBList grouped by the server\'s group · nextRow');
/* INT5b: payOpen's third argument is `pre` — a row's name, BR1's prefill, or F4's { offer, after } */
if (!(/function payOpen\(kind, partyId, pre\)/.test(books) && /'offer' in pre/.test(books)) || !/api\('booksEntryPost', \{ body: Object\.assign\(\{ date: bkToday\(\) \}, f\.record\.body\) \}\)/.test(books) || !/CBAction\.run\(\s*btn,\s*function \(\) \{\s*return api\('booksEntryPost'/.test(books)) bad('payOpen takes the offer additively; the discount sends the server\'s ready body through CBAction (M64)'); else ok('payOpen: offer widened · Record discount = the server\'s body via CBAction');
if (!/data-testid="pay_gst_note" disabled aria-disabled="true"/.test(books) || !/pay_gst_why/.test(books)) bad('the GST credit note is a greyed button WITH the server\'s sentence — never automatic'); else ok('GST credit note: greyed with its sentence');
if (!/"supplier bill → payment"|"payables"/.test(flows) || !/cap-finance-pay\.js/.test(flows)) bad('flows.json must carry the P2P payables step (PM1)'); else ok('flows.json: P2P payables step');

console.log(fail ? fail + ' FAILED' : 'finance-guard: all ok');
process.exit(fail ? 1 : 0);
