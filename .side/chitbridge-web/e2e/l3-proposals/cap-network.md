# L3 prose pass — `public/app/cap-network.js`

Proposal only. **No source file was modified.** 21 sites from
`node e2e/prose-scan.cjs --interp --file app/cap-network.js`, plus an
"adjacent" section of sites the scanner did not flag but that are the same
defect on the same lines.

Reference: `txf` / `txn` as shipped in `public/app.html:3713` and `public/app.html:3737`.
`txf` does **not** escape — every `esc(x)` in a BEFORE stays `esc(x)` in the AFTER.
`{count}` is supplied automatically by `txn` and must **not** be passed in `vars`.

---

## 1. `cap-network.js:578` — narrow-exposure confirm, title

```
BEFORE  _netConfirmNarrow('Closing "' + n.name + '" closes what is inside it',
AFTER   _netConfirmNarrow(txf('Closing "{name}" closes what is inside it', { name: n.name }),
```

NOTE — `n.name` is deliberately **un**escaped here: `_netConfirmNarrow` (line 545) does
`esc(title)` itself when it builds the modal header, and escapes the `lead` **not at all**.
That asymmetry is correct and must survive: raw here, `esc()` at line 579.

## 2. `cap-network.js:579` — narrow-exposure confirm, lead

```
BEFORE  'A store can never be more open than the department containing it, so closing <b>' + esc(n.name)
          + '</b> closes the stores underneath.'
AFTER   txf('A store can never be more open than the department containing it, so closing <b>{name}</b> closes the stores underneath.',
            { name: esc(n.name) })
```

NOTE — `lead` is injected as raw HTML, hence `esc()` stays. `<b>` stays inside the string.

## 3. `cap-network.js:598` — delete-node confirm body

This is one site in the scan but three grammatical decisions on one statement. The
sub-node clause and the live-store clause are both English-plural switches embedded
mid-sentence, so the whole `msg` has to be reshaped together.

```
BEFORE  var msg = 'Remove <b>' + esc(n.name) + '</b>' + (cnt ? ' and its ' + cnt + ' sub-node' + (cnt === 1 ? '' : 's') : '') + ' from the design?<br><br>'
            + (live ? '<b>' + live + ' of these ' + (live === 1 ? 'is a live store' : 'are live stores')
                      + '</b> — they keep trading and keep their logins. This design just stops tracking them, and rebuilding will not adopt them back.'
                    : 'Nothing was created yet, so nothing is lost.');

AFTER   var msg = (cnt
              ? txn('Remove <b>{name}</b> and its {count} sub-node from the design?',
                    'Remove <b>{name}</b> and its {count} sub-nodes from the design?', cnt, { name: esc(n.name) })
              : txf('Remove <b>{name}</b> from the design?', { name: esc(n.name) }))
          + '<br><br>'
          + (live
              ? txn('<b>{count} of these is a live store</b> — they keep trading and keep their logins. This design just stops tracking them, and rebuilding will not adopt them back.',
                    '<b>{count} of these are live stores</b> — they keep trading and keep their logins. This design just stops tracking them, and rebuilding will not adopt them back.', live)
              : tx('Nothing was created yet, so nothing is lost.'));
```

NOTE — `' and its N sub-nodes'` cannot be its own translatable unit (a bare prepositional
tail is unplaceable in a verb-final language), so the two whole questions are the units.
The `<br><br>` is layout and stays outside both.
The live-store branch is line 599–600, which the scanner did **not** list (its left half is
markup-only) — it is the same defect and is fixed here because it shares the statement.

## 4. `cap-network.js:639` — revert blocked by a closed parent

```
BEFORE  toast('"' + n.name + '" cannot go back to ' + _netLab(back)
          + ' while ' + ((p && !p.root) ? '"' + p.name + '"' : 'the network') + ' is closed — revert that first.', true);

AFTER   var pn = (p && !p.root) ? p.name : null;
        toast(pn
          ? txf('"{node}" cannot go back to {level} while "{parent}" is closed — revert that first.',
                { node: n.name, level: _netLab(back), parent: pn })
          : txf('"{node}" cannot go back to {level} while the network is closed — revert that first.',
                { node: n.name, level: _netLab(back) }), true);
```

NOTE — I deliberately did **not** keep `'the network'` as a substituted value. A bare noun
phrase dropped into a slot is the classic gettext trap: it cannot take the case, article or
gender the surrounding sentence needs. Two complete sentences cost one duplicated msgid and
are correct everywhere.
NOTE — `_netLab(back)` (line 2526) returns a `NET_EXPOSURE` label with its leading glyph
stripped ("Private", "Public"). Those labels are **not** currently translated, so `{level}`
will substitute English into a translated sentence. Out of scope here; flagged for the
`NET_EXPOSURE` table's own pass.

## 5. `cap-network.js:667` — revert-all list line

```
BEFORE  'remove <b>' + esc(c.name) + '</b> (never created)'
AFTER   txf('remove <b>{name}</b> (never created)', { name: esc(c.name) })
```

NOTE — lowercase leading `r` is correct: these are bullet lines under
"The design goes back to matching the live network:". Kept as-is.

## 6. `cap-network.js:686` — start-over confirm body

```
BEFORE  'This network has <b>' + built + ' live store' + (built === 1 ? '' : 's') + '</b>.<br><br>'
AFTER   txn('This network has <b>{count} live store</b>.', 'This network has <b>{count} live stores</b>.', built) + '<br><br>'
```

## 7. `cap-network.js:690` — start-over confirm title

```
BEFORE  confirmAsk('Start over? ' + built + ' store' + (built === 1 ? '' : 's') + ' are live', msg, ...)
AFTER   confirmAsk(txn('Start over? {count} store are live', 'Start over? {count} stores are live', built), msg, ...)
```

⚠ NOTE — **existing English bug, preserved deliberately.** Today the singular renders
"Start over? 1 store **are** live". Rule 5 says do not silently improve, so the AFTER above
is faithful. The obvious fix is `'Start over? {count} store is live'` for the `one` form —
that is a **one-word English change and needs a human yes**. Do not apply it silently:
whichever form is chosen becomes the permanent msgid.

## 8. `cap-network.js:715` — build dry-run plan line

```
BEFORE  lines.push('· bind ' + job.feeds.length + ' <b>system-fed</b> field(s) to connector(s)');
AFTER   lines.push(txf('· bind {count} <b>system-fed</b> field(s) to connector(s)', { count: job.feeds.length }));
```

NOTE — `txf`, not `txn`, because "field(s)" is what the English says today and converting it
to a real singular/plural pair **is** a change to the English. It should probably become
`txn('· bind {count} <b>system-fed</b> field to connector(s)', '· bind {count} <b>system-fed</b> fields to connector(s)', job.feeds.length)`,
because the "(s)" convention does not exist in most target languages and a translator has no
correct move — but that is an editorial decision, not a mechanical one. **Human call.**
The same "(s)" convention runs through seven sibling lines at 712–722; whatever is decided
here should be applied to all of them in one go.
NOTE — the leading `'· '` is a bullet glyph shared by the whole block; left inside the string
so the line renders identically. It could be hoisted out of every string in the block, which
is a tidier but larger change.

## 9. `cap-network.js:720` — build dry-run plan line

```
BEFORE  lines.push('· wire ' + job.triggers.length + ' <b>loop</b> trigger(s)');
AFTER   lines.push(txf('· wire {count} <b>loop</b> trigger(s)', { count: job.triggers.length }));
```

NOTE — same "(s)" question as site 8.

## 10. `cap-network.js:816` — Build button label, first chip

```
BEFORE  create.length ? 'Create ' + create.length + ' store' + (create.length === 1 ? '' : 's') : ''
AFTER   create.length ? txn('Create {count} store', 'Create {count} stores', create.length) : ''
```

NOTE — the three chips at 816–818 are `.filter(Boolean).join(' · ')`-ed into one button
label. Each chip is a self-contained unit, so per-chip `txn` is sound; the `' · '` join stays
as a separator. The lowercase second and third chips ("change 2", "send 1 invitation") are an
English sentence-case convention a translator will not see the context for — worth a
translator comment, not a code change.

## 11. `cap-network.js:818` — Build button label, third chip

```
BEFORE  invite.length ? 'send ' + invite.length + ' invitation' + (invite.length === 1 ? '' : 's') : ''
AFTER   invite.length ? txn('send {count} invitation', 'send {count} invitations', invite.length) : ''
```

## 12. `cap-network.js:1033` — member-view footer

```
BEFORE  'Only <b>' + esc(rootName) + '</b> can add, change or remove stores in this network. '
          + 'Ask them if something here is wrong.</div>'
AFTER   txf('Only <b>{operator}</b> can add, change or remove stores in this network. Ask them if something here is wrong.',
            { operator: esc(rootName) })
          + '</div>'
```

NOTE — the two sentences are one paragraph on screen and become one msgid; that is the
gettext-preferred granularity ("Ask them" has no referent on its own). `</div>` stays outside.
NOTE — `rootName` can fall back to the literal `'the network operator'` (line 1026), which
would substitute untranslated English into a translated sentence. That fallback needs its own
`tx()` — see the adjacent section.

## 13. `cap-network.js:1090` — availability, no match

```
BEFORE  'No store in your network carries anything '
          + 'matching “' + esc(q) + '”.</div>'
AFTER   txf('No store in your network carries anything matching “{query}”.', { query: esc(q) })
          + '</div>'
```

NOTE — the typographic quotes “ ” are inside the string, which is right: a translator swaps
them for the locale's own quotation marks (« », „ “, 「 」). That is the point of keeping them in.

## 14. `cap-network.js:1128` — availability, per-product tally

```
BEFORE  g.have.length ? g.total + ' across ' + g.have.length + ' store' + (g.have.length === 1 ? '' : 's')
                      : 'nobody has reported any'
AFTER   g.have.length ? txn('{total} across {count} store', '{total} across {count} stores', g.have.length, { total: g.total })
                      : tx('nobody has reported any')
```

NOTE — two numbers, and the plural is governed by the **store count**, not the quantity, so
`g.have.length` is the `n` argument and `g.total` is an ordinary named var. Getting these the
wrong way round is the easy mistake here.
NOTE — `g.total` (line 1114) is a raw summed quantity that is **not** passed through
`CBLocale.number()`, so it will print Western digits with no grouping in every locale.
`{count}` is formatted, `{total}` is not — an inconsistency inside one sentence. Pre-existing;
fixing it means `CBLocale.number(g.total)` and is a separate, safe follow-up.

## 15. `cap-network.js:1183` — availability, ask button

```
BEFORE  (unknown ? 'Ask if they have it' : 'Request from ' + esc(r.store))
AFTER   (unknown ? tx('Ask if they have it') : txf('Request from {store}', { store: esc(r.store) }))
```

## 16. `cap-network.js:1195` — availability, row cap notice

```
BEFORE  'Showing the first ' + R.truncated.shown + ' matches across the network — narrow the search to see the rest.'
AFTER   txn('Showing the first {count} match across the network — narrow the search to see the rest.',
            'Showing the first {count} matches across the network — narrow the search to see the rest.', R.truncated.shown)
```

⚠ NOTE — the singular form is **new English that has never been on screen** (the cap is
always >1 in practice). It has to exist for Arabic/Russian to select a correct form for
whatever number actually appears, so `txn` is the right call — but a human should sign off on
the invented singular wording. The faithful-but-weaker alternative is
`txf('Showing the first {count} matches …', { count: R.truncated.shown })`, which hard-codes
the English plural for every language.

## 17. `cap-network.js:1715` — rail status line

```
BEFORE  built ? '✓ your network · ' + built + ' store' + (built === 1 ? '' : 's') + ' live'
              : 'design · saved for this network · nothing created yet'
AFTER   built ? txn('✓ your network · {count} store live', '✓ your network · {count} stores live', built)
              : tx('design · saved for this network · nothing created yet')
```

NOTE — the `✓` and the `·` are kept **inside** the msgid. They are the line's own punctuation
rather than surrounding layout, and a translator who needs to reorder "your network" and the
count needs the separator to move with it. Hoisting `'✓ '` out is defensible; do it to both
branches or neither.

## 18. `cap-network.js:1795` — adopted-pricing explainer

The scanned half is the tail of a three-literal paragraph beginning at 1793. Whole paragraph
becomes one unit.

```
BEFORE  'The <b>product</b> stays the '
          + 'network\'s — a corrected picture or spec reaches every store. Only the <b>price</b> is ever this store\'s, '
          + 'stamped in <b>' + esc(cur) + '</b> and never converted afterwards.</div>'
AFTER   txf('The <b>product</b> stays the network\'s — a corrected picture or spec reaches every store. Only the <b>price</b> is ever this store\'s, stamped in <b>{currency}</b> and never converted afterwards.',
            { currency: esc(cur) })
          + '</div>'
```

⚠ NOTE — `cur` (line 1789) falls back to the literal string `'the network\'s'` when no
currency is known, so this can render "stamped in **the network's** and never converted".
That fallback is untranslated English prose being injected through a value slot — a real
localisation hole, and arguably an English wart already ("stamped in the network's" is not a
sentence). Needs a human: either `tx()` the fallback, or split into two whole sentences the
way site 4 does.

## 19. `cap-network.js:2226` — `_inp` helper

```
SKIP — not prose
```

`'" oninput="' + oninput + '" placeholder="'` is HTML attribute assembly inside the shared
`<input>` builder. Nothing here is language.

## 20. `cap-network.js:2421` — network-name prompt hint

```
BEFORE  hint:'Every store is prefixed with it — <b>' + esc(cur) + '.north</b>, <b>' + esc(cur) + '.south</b>.<br>'
          + 'It is also your own <b>User ID</b>, so people can use it to add you as a supplier.<br>'
          + 'Letters, numbers and dashes only — no spaces.'
AFTER   hint: txf('Every store is prefixed with it — <b>{handle}.north</b>, <b>{handle}.south</b>.', { handle: esc(cur) })
          + '<br>' + tx('It is also your own <b>User ID</b>, so people can use it to add you as a supplier.')
          + '<br>' + tx('Letters, numbers and dashes only — no spaces.')
```

NOTE — `{handle}` appears twice in one msgid. `txf`'s replace is a global regex, so repeated
named placeholders work; this is the case positional `{0}`/`{1}` would have made unsafe.
NOTE — `.north` and `.south` stay inside the string as **example** suffixes, which lets a
translator swap them for locale-natural examples. That is intended, not an oversight.
NOTE — three separate units joined by `<br>`, because they are three independent statements
in a hint list, not one paragraph.

## 21. `cap-network.js:2690` — unsaved-handle explainer

```
BEFORE  'Suggested from your business name — <b>not saved yet</b>. A handle cannot contain a space, so "'
          + esc((typeof SESSION !== 'undefined' && SESSION.entity) || '') + '" becomes "' + esc(_netRootHandle())
          + '". Change it now if you want something else; after Build the stores keep the name they were given.'
AFTER   txf('Suggested from your business name — <b>not saved yet</b>. A handle cannot contain a space, so "{business}" becomes "{handle}". Change it now if you want something else; after Build the stores keep the name they were given.',
            { business: esc((typeof SESSION !== 'undefined' && SESSION.entity) || ''),
              handle: esc(_netRootHandle()) })
```

NOTE — straight `"` quotes here vs. typographic `“ ”` at site 13. Inconsistent in the source;
preserved as-is, flagged for whoever owns the style.

---

## ADJACENT — same defect, same lines, **not** on the scanner's work-list

The interpolation scanner reports one hit per line and skips halves that are markup-only, so
these were missed. Listing them because touching the lines above without fixing them leaves
the file half-done.

**`cap-network.js:551`** — inside `_netConfirmNarrow`, so it affects site 1 and 2's modal.
```
BEFORE  '<b>' + names.length + ' store' + (names.length === 1 ? '' : 's') + '</b> will change: ' + esc(names.join(', ')) + '.'
AFTER   txn('<b>{count} store</b> will change: {names}.', '<b>{count} stores</b> will change: {names}.',
            names.length, { names: esc(names.join(', ')) })
```
NOTE — `names.join(', ')` hard-codes an English list separator. Arabic and Chinese use
different ones; `Intl.ListFormat` is the adopt-don't-reinvent answer. Separate follow-up.

**`cap-network.js:627`** — `toast('"' + n.name + '" text left as it is on the store')`
→ `toast(txf('"{name}" text left as it is on the store', { name: n.name }))`

**`cap-network.js:644`** — `toast('"' + n.name + '" left as ' + _netLab(back))`
→ `toast(txf('"{name}" left as {level}', { name: n.name, level: _netLab(back) }))`
NOTE — same untranslated-`_netLab` caveat as site 4.

**`cap-network.js:669–670`** — `NEEDS-HUMAN`.
```
'<b>' + esc(u.name) + '</b> back to ' + [u.from ? … : '', u.purpose ? 'its current wording' : ''].filter(Boolean).join(' and ')
```
Four different sentences are assembled from an optional-fragment array joined with `' and '`.
"back to Private", "back to its current wording", "back to Private and its current wording".
This cannot be placeholder-ised without deciding whether to write out the three complete
sentences or restructure the list. It also injects `_netPlatLab[u.from]` — another
untranslated data label. Needs a person.

**`cap-network.js:817`** — `update.length ? 'change ' + update.length : ''`
→ `txf('change {count}', { count: update.length })`
NOTE — `NEEDS-HUMAN`-ish: "change 2" is elliptical English with the noun omitted; there may be
no grammatical equivalent. Probably wants to become "change {count} stores" — an English
change, so a human decides.

**`cap-network.js:1026`** — `|| 'the network operator'` is a bare untranslated fallback that
lands in sites 12 and the 1029 sentence. Should be `|| tx('the network operator')`.

**`cap-network.js:1029–1030`**
```
BEFORE  'You are part of <b>' + esc(rootName) + '</b>. The structure is set by the network operator — you can see it here, and you look after your own store, its catalogue and its people.'
AFTER   txf('You are part of <b>{operator}</b>. The structure is set by the network operator — you can see it here, and you look after your own store, its catalogue and its people.',
            { operator: esc(rootName) })
```

**`cap-network.js:1194`** — the sibling of site 16, same conditional.
```
BEFORE  'Asked the first ' + R.truncated.asked + ' of ' + R.truncated.of + ' stores.'
AFTER   txn('Asked the first {asked} of {count} store.', 'Asked the first {asked} of {count} stores.',
            R.truncated.of, { asked: R.truncated.asked })
```
NOTE — plural is governed by `R.truncated.of` (the total), which is the `n`; `asked` is a
plain var. Singular "of 1 store" is new English — same sign-off question as site 16.

**`cap-network.js:2693`**
```
BEFORE  kindLine + ' · ' + childCount + ' child' + (childCount === 1 ? '' : 'ren')
AFTER   kindLine + ' · ' + txn('{count} child', '{count} children', childCount)
```
NOTE — irregular English plural (`child`/`children`), which is exactly what a
`n === 1 ? '' : 'ren'` suffix hack cannot express in any other language.

---

## Summary

- **19 propose-ready** of the 21 scanned sites (plus 8 adjacent sites proposed as a bonus). Two carry a
  ⚠ that needs a yes before applying (site 7's `store are live` bug; site 16's invented singular).
- **1 SKIP** — site 19 / line 2226, HTML attribute assembly in `_inp`. The file's other
  style-string concatenation never reached the work-list, so the `--interp` scanner filtered
  it correctly; I found no false positives beyond this one.
- **1 NEEDS-HUMAN** on the work-list (site 18 / line 1795 — the `'the network\'s'` currency
  fallback is untranslated prose entering through a value slot and is an English wart already),
  plus 2 more in the adjacent set (669–670, 817).
- **Not anticipated by the brief:** (a) the scanner under-reports — it emits one hit per line
  and drops halves that are markup-only, so lines 551, 599, 1029, 1194 and 2693 are the same
  defect and were invisible; (b) three separate cases of an **untranslated data label being
  substituted into a translated sentence** (`_netLab`, `_netPlatLab`, `'the network operator'`)
  — placeholders alone do not fix those, the label tables need their own pass; (c) the
  `field(s)` / `connector(s)` parenthetical-plural convention appears on ~7 sibling lines at
  712–722 and has no equivalent in most target languages — it is one editorial decision that
  should be taken once for the whole block, not per line; (d) `names.join(', ')` at 551 and
  the unformatted `g.total` at 1128 are localisation gaps that sit *inside* these sentences
  but are not interpolation problems (`Intl.ListFormat` / `CBLocale.number`).
