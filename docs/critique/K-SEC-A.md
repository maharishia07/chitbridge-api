# K-SEC PR A · critique before build (2026-10-21)

The full critic review is the docs repo's `docs/18-identity-sign-in-and-access/reviews/K-SEC-critic-2026-10-21.md` (verdict CHANGE). This file records what the builder checked against the code before writing any.

(a) Assumptions checked
- The issueToken fallback mints a legacy token when listing fails: TRUE, lib/identity-auth.js:440.
- autoraise signs a no-jti 60 s entity token: TRUE, lib/autoraise.js:44.
- Customers never reach middleware/auth.js: TRUE. Auth admits entity/actor only (auth.js:40). Customers use middleware/customer-auth.js.
- Only the till sends a device id: TRUE. The web has 51 hand-set `Bearer` headers and no shared fetch wrapper. cb_sess is shared by every page, so one jti token minted anywhere reaches pages that never send X-Device-Id. That would be a 401 DEVICE_MISMATCH lockout unless EVERY page stamps the header.
- `all_task_visible` is read nowhere: TRUE. Its first save writes `COALESCE($4,false)` (routes/actors.js:1559), so a shop can hold FALSE although the column default is TRUE.

(b) Conflicts
- The review puts the device-id maker in signin-ui.js. That file loads on 13 pages, not the 30+ that hold a token, and it throws without /engine/signin.js. The maker goes in a stand-alone `public/app/device-id.js` that every token page loads first. Lifting it out of till.html touches the counter area and the PC kit's file list, so that step goes to cb-counter.
- The review says "no public CSP-report route". The brief asks for the smallest rate-limited one. The brief wins. The route takes no credential, has its own limiter and an 8 KB cap, and logs only shaped fields.

(c) Simpler: stamp X-Device-Id in ONE fetch wrapper instead of editing 51 call sites.

(d) Risks
- Web lockout if any token page misses device-id.js. A static guard lists every page that holds a token.
- AI-15 wiring would hide tasks in shops holding FALSE. Per the brief's stop rule, this PR only counts.

(e) VERDICT: BUILD WITH CHANGES. The changes are the two conflicts above. AI-15 stops at the count.
