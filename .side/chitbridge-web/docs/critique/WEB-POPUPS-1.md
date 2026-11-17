# Critique WEB-POPUPS-1: move the CRM popups onto the one library popup (13 Nov 2026)
Page chosen: crm.html, 12 real popups (PM/POPUP-FAMILIES-2026-11-12.json, page "CRM / Marketing"). All popups read 0 tested in PM/WEB-DONE.json; till.html has 83 but is the api's vendored master (cb-counter), so it is left alone. The next three files hold 6 each and are app.html-only (workshop, back office later).
(a) Assumptions checked
- "ui.dialog (CMP002) is the library popup": true, public/app/ui.js dialog(); no page uses it yet (grep: only ui-standard.js and settings.html name it).
- "the 12 carry a code": the register holds POP095..POP106, one each (SCREENS.json Popup > fn). Nothing writes the code on the element on crm.html (modalStamp lives in app.html only): FALSE for part (b).
- "ui.dialog can take these forms": PARTLY. It has no sub line, no body test id, no popup code, no way to keep a caller-painted footer (send has 3 coded buttons, import repaints its footer per step). Gaps G7 and G9 of PM/POPUP-FAMILIES.
- "keyboard works": unknown; crm.html's host is a native <dialog>, so trap and Esc come free; focus return and first-field focus are unproven. The new walk measures them.
(b) Conflicts: none with DECISIONS. The three money popups (Send to group, Add follow-up reach, privacy answer) keep every word; only the plumbing moves. No second popup is built: ui.dialog is widened, the pages call it.
(c) Simpler way: stamp POP codes at crm.html's host only. Rejected: it leaves 12 hand-built shells, which is what the swap is meant to remove.
(d) Risks: tests that read the old markup (e2e/crm.cjs, walk-crm-*.cjs, ui-codes-crm.test.cjs read testids and literal data-cbsid codes: both are kept); mount codes CRM00x-U2nn are new and need register rows (cb-capability); the census does not see ui.dialog( sites yet (toolset/coverage/ui-identity.cjs, docs repo) so total/identified would fall for these 12 until it counts them.
(e) VERDICT: BUILD WITH CHANGES: widen ui.dialog (sub, testid, pop, footerHtml, first-field focus); keep each popup's body and words unchanged; one real walk for all 12; census widened in the docs repo.
