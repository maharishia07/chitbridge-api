# Critique · UX137-GALLERY (the UI standard page) · 2026-11-08 · cb-ux-locale
(a) Assumptions checked against code
- "Real ui.dialog()" works on a utility page: FALSE. ui.dialog needs modal() and closeModal(), which only app.html defines (public/app.html:23265); ui.js refuses without it (ui.js dialog). The page supplies a small modal host with the same classes. Ask: move the host to a shared file (ui.js owner).
- "CBConfirm is a standard popup": TRUE it is real and shared (accounts-shell.js:731) BUT it draws its own raw Cancel/OK buttons, not CMP003/CMP004. Shown as found; fix belongs to accounts-shell owner.
- "An icon set exists": FALSE. No icon font or sprite (grep ICONS, CBIcon, symbol: none). Glyphs sit in ACTION_SET.shown; drawings in public/illustrations (manifest.json). The page shows both and says so.
- "A design-system or gallery page exists to widen": FALSE for components. public/screen-gallery.html is the till's screen kit (themes/keys), another subject; not widened. seams gallery/design/tokens/showcase: nothing for components.
- "One .act style": FALSE. .act is defined per page (accounts.html:119 44px, catalogue.html:59 40px). The page defines its own from tokens and shows this as a finding.
- Keys: ui.js has English labels through tx(); the CMPnnn.label keys (ux137-i18n-keys) have not landed. '‹ Back' and '+ Add' have no entry in any pack. Shown per component, live.
(b) Conflicts: shell.js/avatar read the session and call /me; the public page must not, so it does not load the shell (rule "one shell" waived for a no-login demo; said in the PR). Toggle/tab/select have no CMP: native elements with stable codes, flagged as requests, not new components.
(c) Simpler: none that keeps real components (screenshots were refused by the brief).
(d) Risks: lands after #501 (base main, stacked content); no ui.js edit; strings in a page-local pack file (translation PR of the four packs trips the readability guard, ledger 2026-11-08); public page: no api, no storage, no session.
(e) VERDICT: BUILD WITH CHANGES (modal host on the page; chrome strings in strings-ui-standard.js; toggles native and flagged).
