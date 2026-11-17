/**
 * OWNS      the "build" kind of the ONE standards register (CAP-STD-1, Athi 14 Nov 2026): the standards we BUILD to, one row each, with its source, the rule and the
 *           check that proves it. It widens STANDARDS (cap-standards.js) in place: the same array, the same row shape, never a second list.
 * CALLED BY /standards.html (the "How we build" view) and the generator toolset/ui-identity/std-cmdb.cjs (docs repo), which loads this file to learn each row's check key.
 * FLOW      TABLE (one array per standard) → row() → STANDARDS.push + STD_KINDS gets 'build' → the page paints it; the generator stamps `standards: [{code, status, by, at}]`
 *           on every CMDB CI from check output that already exists and writes public/data/build-standards.json, which the page reads for the three counts.
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/standards-register
 *
 * ⚠️ A row is only added where a SOURCE can be named. A row whose check does not exist yet (ck 'none') is status Partly with the missing words: the CMDB shows
 * "not checked" for it, never pass. Rows already in the register under another id (rfc9457, iso4217 …) are NAMED by `std`, not copied.
 * Row fields beyond the register's own: src (the official page) · rule (what we hold ourselves to) · chk (the check, in words) · ck (the check's key in std-cmdb.cjs)
 * · sc (which CI kinds it applies to: screen · component · route · table) · std (the register row it widens, or '').
 */
var STD_BUILD_TABLE = [
  /* [id, std, name, source url or doc, rule, check in words, check key, scope] */
  ['build-wcag22-aa', 'wcag-audit', 'WCAG 2.2 level AA', 'https://www.w3.org/TR/WCAG22/',
    'Every screen passes the WCAG 2.2 A and AA success criteria: no serious or critical axe finding at 1366 and 390 wide.',
    'axe-core in the UI sweep (--measure) → PM/SCREEN-SWEEP.json, a11y.pass', 'axe', ['screen', 'component']],
  ['build-wcag-214', '', 'WCAG 2.2 success criterion 2.1.4, character key shortcuts', 'https://www.w3.org/TR/WCAG22/#character-key-shortcuts',
    'A single-character shortcut can be turned off, remapped, or works only while its control has focus. One register holds every key.',
    'MNT-61 shortcuts lane: public/app/shortcuts-register.js + e2e/shortcuts-guard.cjs (branch feat/shortcuts-mnt63); not yet written to the CMDB', 'none', ['screen', 'component']],
  ['build-apg', '', 'WAI-ARIA Authoring Practices patterns', 'https://www.w3.org/WAI/ARIA/apg/patterns/',
    'A custom widget (dialog, combobox, tabs, menu) follows its APG pattern: roles, keys and focus order.',
    'keyboard-only pass in the UI sweep (the keyboard_pattern column is n/c today)', 'none', ['component']],
  ['build-rfc9457', 'rfc9457', 'RFC 9457 problem details', 'https://www.rfc-editor.org/rfc/rfc9457.html',
    'Every api refusal is one problem+json answer: type, title, status, detail and a registered error code.',
    'api register column error_shape (chitbridge-api docs/api-register.json)', 'api-error-shape', ['route']],
  ['build-asvs-l1', '', 'Application security verification, level 1 (the parts we check)', 'https://asvs.owasp.org',
    'Input is validated strictly, a foreign id answers 404, and the answer carries only its allow-listed fields.',
    'api register columns strict_input · foreign_id_404 · output_allowlist, where each applies', 'api-asvs', ['route']],
  ['build-iso4217', 'iso4217', 'ISO 4217 currency on every money value', 'https://www.iso.org/iso-4217-currency-codes.html',
    'Money carries its currency; an operator refuses a mismatch. A route that moves money names the currency it answers in.',
    'no route-level currency check yet: the register only says money: true', 'none', ['route'], 'https://www.six-group.com/en/products-services/financial-information/data-standards.html'],
  ['build-iso8601', 'iso8601', 'ISO 8601 dates and times', 'https://www.iso.org/iso-8601-date-and-time-format.html',
    'A date or time on the wire is ISO 8601, with its offset.',
    'no route-level date check yet', 'none', ['route']],
  ['build-rls', 'postgres-rls', 'Postgres row level security on every table', 'https://www.postgresql.org/docs/current/ddl-rowsecurity.html',
    'Every shop-scoped table has row level security on and a policy; a read as another shop returns nothing.',
    'RLS isolation tests (cb-db); there are no table CIs in the CMDB yet', 'none', ['table']],
  ['build-fn-size', '', 'Function size: no function over 40 lines', 'PM/CODE-STANDARD.md · DISCIPLINES.md §6',
    'No function is longer than 40 lines.', 'tools/readability.cjs ratchet, counter long40 = 0 on the CI\'s files', 'ratchet:long40', ['module']],
  ['build-complexity', '', 'Complexity: no function above 10', 'PM/CODE-STANDARD.md · DISCIPLINES.md §6',
    'No function has a cyclomatic complexity above 10.', 'readability ratchet, counter complex10 = 0 on the CI\'s files', 'ratchet:complex10', ['module']],
  ['build-nesting', '', 'Nesting: no function deeper than 3', 'PM/CODE-STANDARD.md · DISCIPLINES.md §6',
    'No function nests blocks deeper than 3 levels.', 'readability ratchet, counter deep3 = 0 on the CI\'s files', 'ratchet:deep3', ['module']],
  ['build-file-size', '', 'File size: no file grows past its baseline', 'PM/CODE-STANDARD.md · MNT-58',
    'No file grows past its filesize baseline.', 'the filesize baseline (MNT-58) is not built yet', 'none', ['module']],
  ['build-header', '', 'Module header: what it owns, who calls it, its card', 'PM/CODE-STANDARD.md · DISCIPLINES.md §6',
    'Every module opens with a header that says what it owns, who calls it and which card it belongs to.', 'readability ratchet, counter noHeader = 0 on the CI\'s files', 'ratchet:noHeader', ['module']],
  ['build-readability-touch', '', 'Readability: a touched file comes out better or zero', 'DISCIPLINES.md §6 · rule 2 (Athi 14 Nov 2026)',
    'A file a change touches ends with a lower readability score, or zero.', 'tools/readability/touch.cjs runs on the PR diff; it leaves nothing the CMDB can read yet', 'none', ['module']],
  ['build-element-id', '', 'Every UI element has a code on the element (data-cbsid)', 'DISCIPLINES.md §3a · SCREENS.json _scheme (Athi 2 Nov 2026)',
    'Each control carries its register code on the element and is named in the CMDB.', 'ui-cmdb.cjs: the element\'s code is found in the page\'s own files; a failing SWEEP control overrides', 'element-code', ['screen', 'component']]
];
var STD_BUILD_SCOPES = [['screen', 'Screen'], ['component', 'UI component'], ['route', 'Api route'], ['module', 'Source file'], ['table', 'Database table']];
/** one register row from one table line: the shape the page and the other readers already know */
function stdBuildRow(line) {
  var checked = line[6] !== 'none';
  return {
    id: line[0], std: line[1], pa: 'testing', a: 'build', k: 'build-rule', c: ['GLOBAL'],
    p: line[2], g: 'How we build', n: line[2], w: line[4], ex: line[3], src: line[3], src2: line[8] || '', rule: line[4], chk: line[5], ck: line[6], sc: line[7],
    s: checked ? 'live' : 'part', m: checked ? '' : 'No check yet: the CMDB shows "not checked", never pass',
    note: '', at: 'Standards › How we build', go: '',
    why: 'A claim of "we follow it" without a check goes stale; the CMDB row for each item is rewritten from the check\'s own output on every run.', added: '2026-11-14'
  };
}
var STD_BUILD = STD_BUILD_TABLE.map(stdBuildRow);
if (typeof STANDARDS !== 'undefined' && STD_KINDS.every(function (kind) { return kind[0] !== 'build-rule'; })) {
  STD_KINDS.push(['build-rule', 'Build rule', 'we hold ourselves to it']);
  STD_BUILD.forEach(function (row) { STANDARDS.push(row); });
}
if (typeof module !== 'undefined') module.exports = { STD_BUILD_TABLE: STD_BUILD_TABLE, STD_BUILD: STD_BUILD, STD_BUILD_SCOPES: STD_BUILD_SCOPES, stdBuildRow: stdBuildRow };
