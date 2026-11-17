# W2-NET critique (13 Nov 2026, written before the edits; lane w2-net, one-pass ids + header)

(a) What the brief assumes, checked against origin/main 54b1a2db
- "18 files, all customer": FALSE. Reached from a home card by a script tag or a page loader: network-app (network.html), cap-suppliers (operations.html), cap-assist (tasks.html), cap-settings and register-form (settings.html), chit-sheet, rail-thread, rail-advice, rail-bell, signin-ui, catalogue-lines, catalogue.html, signin-lab.html. Reached only through app.html (SUPPORT, header only): cap-network-member, cap-traceability, cap-iddocs, cap-legend, cap-cmdb (CAP_OF / ensureCap in app.html; no page carries their script tag).
- "untagged counts": cap-assist 0, rail-bell 0, cap-settings 1, catalogue-lines 1, catalogue.html 0 elements (only a popup site); the rest as measured. Total to stamp: 60.
- "no header": every file already had loose OWNS/CALLED BY words; five CALLED BY lines were the knowledge-graph copy and are wrong (rail-advice names cap-admin and cap-settings, which never call CBAdvice; cap-assist names accounts-shell; catalogue.html names storefront links; signin-lab names Home and Settings links, the only door is lab-kit.js:27). Every line is re-grepped.
- signin-lab.html and catalogue.html: no behaviour to change; header check only.

(b) Conflicts with standing rules
- signin-ui.js is web master of a byte copy in the api kit (scripts/vendor-till.cjs, tools/tally-connector/signin-ui.js). A data-cbsid and a header change the copy: an api twin (vendor-till) is needed; behaviour is unchanged. Not mine to edit: said in the PR.
- chit-sheet.js is shared by five pages: header and ids only; no option added, other callers byte-identical.
- Screen codes: scripts shared by several pages take SCR### (never OWN###). SCR050-SCR055 are minted here from a gap left clear of the open lanes (SCR038-SCR047 are other lanes); cb-capability may renumber at batch time. NET001-003 and SLB001 are declared in screen-id.js and only lacked register rows.

(c) Simpler way: none for ids (the stamp tool is the one path). The code goes right after the tag name (tool default); no e2e regex binds any touched tag (grep of e2e/ and api tests), so attribute order is moot.

(d) Risks: api kit copy drift (twin); CB_BUILD bump touches app.html (other lanes bump it too: conflict is one line); SCREENS.json rows in a docs PR must land with or before the web PR (the new test prints codes as pending until then); verb gap: the closed verb list has no COPY (two Copy buttons use DOWNLOAD, flagged).

(e) VERDICT: BUILD WITH CHANGES: stamp the 10 customer files; header-only on the SUPPORT five (found at build: cap-cmdb, cap-legend, cap-network-member, cap-traceability fail the readability touch guard on old test-minimum debt, so their headers are held back and the files stay byte-identical; cap-iddocs passes); signin-ui.js flagged for the api twin.
