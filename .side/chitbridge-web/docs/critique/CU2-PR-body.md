VERDICT: BUILD WITH CHANGES (critique: chitbridge-api docs/critique/CU2.md)
app.html `prodRowsSave` now sends `{ ui_prefs: { product_rows } }`, a merge-patch of its own key. Before, it re-sent the /me snapshot of the whole ui_prefs, which put back a theme changed since the page loaded.
Twin: api round/CU2-38352483400 lands first. This PR is safe alone because /profile already merged.
Checks: guard-static · token-guard · dup-functions · contract · check-syntax · check-app-parses all exit 0. Not walked: shot-rows.cjs, the only walk that saves product rows, needs a live API.
🤖 Generated with [Claude Code](https://claude.com/claude-code)
