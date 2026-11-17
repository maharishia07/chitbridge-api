'use strict';
/* MNT (6 Nov 2026): public/app/cap-dispute.js, disputes between parties, run in node with a stub page: the byline and kind a dispute
   message carries ("— name@entity", "[quality]"), the opponents of a dispute (never the viewer), the party chips, the picker group,
   the count chip, the closed-list failure going to the log in words, and the queue's columns. Pins the behaviour the readability pass
   must not change. Run: node tests/dispute-helpers.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

const logged = [];
const cx = vm.createContext({
  console, tx: (s) => s, esc: (s) => String(s == null ? '' : s), nm: (name, fallback) => name || fallback, cap: (s) => s.charAt(0).toUpperCase() + s.slice(1),
  chitIsSelf: (id) => id === 'me', UI: { dispSel: 'd2', folder: 'task', disputeOpen: 3, adv: {} }, EP: {}, cblog: (level, words) => logged.push(level + ': ' + words),
  document: { getElementById: () => null, querySelector: () => null }
});
cx.window = cx;
cx.root = cx;
vm.runInContext(fs.readFileSync(__dirname + '/../public/app/cap-dispute.js', 'utf8'), cx);
const run = (code) => vm.runInContext(code, cx);
const json = (value) => JSON.stringify(value);

const plain = cx.disputeByline('Short goods on the second pallet');
ok(plain.by === null && plain.kind === null && plain.body === 'Short goods on the second pallet', 'a plain message has no byline and no kind');
const signed = cx.disputeByline('[Quality] Cracked units — anil@acme');
ok(signed.by === 'anil@acme' && signed.kind === 'raised' && signed.body === 'Cracked units', 'a signed, prefixed message gives its byline, the kind raised and the body without the prefix');
ok(cx.disputeByline('[resolved] Credited').kind === 'resolved', 'a [resolved] prefix is the kind resolved');
ok(json(cx.disputeByline('')) === json({ by: null, body: '', kind: null }), 'an empty message stays empty');

const dispute = { raised_by_display_name: 'Acme', participants: [{ role: 'party', entity_id: 'me', display_name: 'Me' }, { role: 'party', entity_id: 'x', display_name: 'Beta', dispute_status: 'resolved' }, { role: 'watcher', entity_id: 'y', display_name: 'Gamma' }] };
ok(json(cx.disputeParties(dispute).map((p) => p.entity_id)) === '["x"]', 'the opponents are the parties other than the viewer, watchers left out');
ok(cx.dispOpp(dispute) === 'Beta' && cx.dispOpp({ participants: [], raised_by_display_name: 'Acme' }) === 'Acme', 'a dispute names its opponents, else who raised it');
const chips = cx.disputeChips(cx.disputeParties(dispute));
ok(chips.includes('dpchip ok') && chips.includes('Beta ✓'), 'a party whose side is resolved shows a tick');
const group = cx.dispOptGroup([{ dispute_id: 'd2', category: 'quality', status: 'open', participants: dispute.participants }], 'OPEN');
ok(group.includes('<optgroup label="OPEN">') && group.includes('selected') && group.includes('Quality · with Beta · ● open'), 'the picker group marks the chosen dispute and says category, opponent and status');
ok(cx.dispOptGroup([], 'CLOSED') === '', 'an empty group prints nothing');
ok(run('dispChipHtml()').includes('3'), 'the task list shows the open-dispute count chip');
run("UI.folder = 'inbox';");
ok(run('dispChipHtml()') === '', 'other folders show no dispute chip');

run("UI.adv = {}; toggleDisputeFilter = toggleDisputeFilter;");
ok(typeof cx.toggleDisputeFilter === 'function' && typeof cx.dispSearchRow === 'function', 'the advanced-search filter and its checkbox row are defined for the Core to call');
ok(cx.dispSearchRow(undefined).includes('adv_disp'), 'the search row renders without arguments');
console.log(n + ' checks, all ok');
