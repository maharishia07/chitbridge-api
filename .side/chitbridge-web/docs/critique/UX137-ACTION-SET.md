# Critique · UX137-ACTION-SET (first CMP slice: ui.action / ui.dialog and nine actions)
Written before the code (cloud-build-rules 00), by the builder; the coordinator's critic gates it.
(a) Assumptions checked against code
- "CBAction and CBConfirm exist and carry confirm:" TRUE (accounts-shell.js:469 actRun, :731 CBConfirm). "modal() draws its own close" TRUE (app.html:23265, `.mx` is already a native button).
- "There is no button helper" TRUE: every control is a raw string. "public/app/ui.js" does not exist: new file, justified as the home the pack names (PM/UX-137-ROLLOUT.md section C).
- "Widen modal()" PARTLY: modal lives in app.html (the workshop, nothing new lands there). ui.dialog CALLS modal() and closeModal(); it edits neither.
- "Reload" is in Athi's list, the pack folds it into "Try again": one component RELOAD, visible label Try again.
(b) Conflicts: a mount makes the element carry the component code in data-cbsid, so the old ACC002-B19/B20/B22 literals leave source: the register rows stay (alias via the mount), cb-capability decides the CMDB shape. The pack says Save is a commit; Athi says a preference save is not: the mount must declare effect, no default.
(c) Simpler way: none that keeps one component per action.
(d) Risks: settings walks name testids/ids (kept by generation); cap-settings.js/cap-print.js touched with 2 attribute-size edits (rebase risk low); ui.js adds one document click listener (only acts on [data-cbmount] with a registered onPress).
(e) VERDICT: BUILD WITH CHANGES: mounts only where the markup stays the same (3 mounts); Add/Remove/Done/Back/Open/Reload/Close/Dialog get components and tests but no mount yet (a mount would change a visible label or add a confirm: Athi's call).
Review changes (cb-capability, 8 Nov): CMP002 (the dialog container) takes fcode verb SHOW (`SHOW <object> dialog`), not OPEN: OPEN stays CMP010's verb (an action that opens a record); SHOW is added to the closed verb list. CMP005 records `behaves_as: CANCEL`; CMP009 carries the alias "Try again"; `ui.set` is now `ui.components`.
