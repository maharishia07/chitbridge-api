# Critique · API-4 sweep: testing (33 routes of routes/testing.js) · written before any route edit

(a) The brief assumes, checked against the code
- 33 routes, mounted at /api/testing, /vocabulary public: TRUE (routes/testing.js route list; server.js:317, :450).
- Every refusal is a bare `res.status(N).json({ error, message })`; every 5xx already goes through safeErr: TRUE (about 60 sites; no `err.message` in a 5xx).
- `recordResults` returns `{ status, body }` and two routes relay it with `res.status(out.status).json(out.body)`: TRUE (:1203, :1211, :1336, :1547). The 200 stays a plain success; the 422 becomes a Problem.
- JUnit body is JSON `{ xml: "<testsuites>…" }`, not a raw XML media type: TRUE (:1504). Declared with `contentMediaType: application/xml` on the `xml` field; parser untouched.
- #363 (foreign-id world) is not on main: TRUE. The file is brought in unchanged from origin/api/sweep-orders; problem-world.cjs unchanged from origin/api/sweep-network (`after`, `cannotRide`).

(b) Conflicts with existing rules
- tests/testing-board-writes.test.cjs reads the source for `boardRefused(req, res)` and the literal NOT_BOARD_WRITER sentence: the gate keeps its name and place.
- A malformed id in a path (`::uuid` cast) answers 500 today: kept (no behaviour change); listed for API-4c.

(c) Simpler way: none; the table-of-routes contract (lib/contract-kit.js) is the construct of the merged sweeps. Nothing forked.

(d) Risks: a schema refuses a body that is not an object and a query value given twice (new 400, the board's own two keys): said in the PR. Source-reading tests re-pointed, never weakened. Other sweeps touch tests/lib/problem-world.cjs: taken unchanged so the branches merge cleanly.

(e) VERDICT: BUILD AS BRIEFED.
