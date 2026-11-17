'use strict';
/* MNT (6 Nov 2026): public/app/cap-crm-groups.js, Groups and segments with their offer reach, run in node with a stub page: the one
   server answer split into segment rows and group rows, the reach sentence ("2 may be sent offers", "1 not — 1 said no"), the
   server's may/why for an action with the login's level as the guess before it lands, the sentence that greys a row action, the
   members of a row, and the list's orders. Pins the behaviour the readability pass must not change. Run: node tests/crm-groups-reach.test.cjs */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok  ' + m); };

const cx = vm.createContext({
  console, tx: (s) => s, txf: (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]), esc: (s) => String(s == null ? '' : s),
  CRM: { rows: [], route: null, loaded: true }, crmEdit: () => cx.__edit, crmOwner: () => cx.__owner, crmIsLead: (p) => !!p.lead,
  crmPlural: (count, one, many) => count + ' ' + (count === 1 ? one : many), toast: () => {},
  document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {} }
});
cx.window = cx;
vm.runInContext(fs.readFileSync(__dirname + '/../public/app/cap-crm-groups.js', 'utf8'), cx);
const run = (code) => vm.runInContext(code, cx);
const json = (value) => JSON.stringify(value);

const rows = cx.crmGroupsRows({ segments: [{ key: 'vip' }], groups: [{ name: 'Diwali' }] });
ok(json(rows.map((r) => r.kind)) === '["segment","group"]', 'one answer becomes segment rows then group rows, each marked with its kind');
ok(cx.crmGroupsRows(null).length === 0, 'no answer is no rows');

const reach = cx.crmReachWords({ may: 2, not: 3, refused_by: [{ n: 2, code: 'SAID_NO' }, { n: 1, code: 'ODD_CODE' }] });
ok(reach.may === '2 may be sent offers' && reach.not === '3 not — 2 said no · 1 odd_code', 'the reach sentence counts who may be sent offers and why the rest are left out, in the shop’s words');
ok(cx.crmReachWords({ may: 1, not: 0 }).not === '' && cx.crmReachWords(undefined).may === '0 may be sent offers', 'nobody refused says nothing more; no reach counts zero');

cx.__edit = true; cx.__owner = false;
ok(cx.crmGroupsMay('send') === '' && cx.crmGroupsMay('delete') === 'Only the owner deletes a group.', 'before the answer lands: an editor may send, only the owner deletes');
cx.__edit = false;
ok(cx.crmGroupsMay('send') === 'Your login can only view.', 'a view-only login is told so');
run("GROUPS.may = { send: { may: false, why: 'No consent migrated' }, offer: { may: true } };");
ok(cx.crmGroupsMay('send') === 'No consent migrated' && cx.crmGroupsMay('offer') === '', 'the server’s may and why win over the guess');
ok(cx.crmGroupsWhyNot({ count: 0 }, 'offer') !== undefined && cx.crmGroupsWhyNot({ count: 0 }, 'send') === 'No consent migrated', 'a refused send is greyed with the server’s sentence');
run("GROUPS.may = null;"); cx.__edit = true;
ok(cx.crmGroupsWhyNot({ count: 0 }, 'send') === 'Nobody to send to' && cx.crmGroupsWhyNot({ count: 3 }, 'send') === '', 'sending to an empty group is greyed; a group with members may be sent to');

cx.CRM.rows = [{ segment: 'vip', roles: ['customer'] }, { segment: 'vip', roles: ['customer'], lead: true }, { roles: ['customer'], groups: ['Diwali'] }, { kind: 'walk-in', segment: 'vip', roles: ['customer'] }, { segment: 'vip', roles: ['supplier'] }];
ok(cx.crmGroupMembers({ kind: 'segment', key: 'vip' }).length === 1 && cx.crmGroupMembers({ kind: 'group', name: 'Diwali' }).length === 1, 'members are customers only, never a lead or a walk-in');

const sorts = cx.crmGroupSorts();
ok(Array.isArray(sorts) && sorts.length >= 2 && sorts.every((s) => typeof s.cmp === 'function' && s.key && s.label), 'the groups list has its orders, each with a key, a label and a comparer');
ok(cx.crmGroupsParamsHref({ kind: 'segment', key: 'a b' }) === '#/parties?seg=a%20b' && cx.crmGroupsParamsHref({ kind: 'group', name: 'D' }) === '#/parties?group=D', 'a row links to the Parties list filtered by its segment or group');
console.log(n + ' checks, all ok');
