# Critique · API-4 sweep: entities (25 routes of routes/entities.js) · written with the capture, before the first route edit was committed

(a) The brief assumes, checked against the code
- 25 routes, mounted at /api/entities: TRUE (server.js:358; the register counts 25 rows of routes/entities.js, all "not started").
- POST /register and POST /verify are the sign-in and are only ALIASES of routes/signin.js handlers (askChecks, validate, handlers.ask, handlers.verify), `registerNew` being the one handler of their own: TRUE (routes/entities.js:132-133). Their validators and refusals ("Validation failed", the sign-in sentences) are routes/signin.js, whose own sweep is not done (8 rows, all "not started"): so these two cannot honestly reach 7/7 here. Left partial; only registerNew's three refusals are worded.
- Every refusal is a bare `res.status(N).json({ error, message })` and every 5xx goes through safeErr: TRUE (about 60 sites; no `err.message` in a 5xx). Exceptions: PUT /routing and PUT /populations/:code/desk send the database trigger's own sentence on purpose (b251/b252, a 409 the person acts on); GET /mis puts `counts_error` (code, message, the connecting role) in a 200 for the platform root, and GET /me puts `capabilities_debug` (the error's own text) in a 200: not fixed here, listed for cb-security.
- The platform root door `refuseUnlessRoot` (lib/platformroot.js) writes raw `res.status().json()`: TRUE; it is shared with GET /api/events/stats, so the Problem change reaches that route's refusal too (the old keys stay). Said in the PR for the events sweep.
- #363 (foreign-id world) is not needed from a branch: tests/lib/foreign-id-world.cjs is on main and identical to origin/api/sweep-orders (empty diff).

(b) Conflicts with existing rules
- tests/platform-door.test.cjs finds the erase route's door by `, platformGate,` in the route registration: the erase route keeps its place (door first, then the schema check, then the handler).
- tests that read this file's source (books-auto-post, policy-one-writer, supplier-list-scope, tester-code) pass unchanged.
- A body that is not an object is a new 400 on every write route (it was taken as an empty body). No web caller was found sending a list (grep of the EP table and its callers in the web checkout); said in the PR.

(c) Simpler way: none; lib/contract-kit.js, lib/products-contract.js (said · failed), lib/storefront-contract.js (refusalFor) and tests/lib/problem-world.cjs are the construct of the merged sweeps. Widened, not forked: middleware/validate.js gains validateAsProblem (the same chains, the same old "Validation failed" body, answered as a Problem) for PATCH /profile.

(d) Risks: AUTH area (Fable review): no code that issues, checks or expires a sign-in code or the token is touched; POST /register and POST /verify are RECORDED byte for byte by the test and not edited except registerNew's three refusals. GET /me and PATCH /:id/erase: refusals gain the Problem fields, success untouched. The Problem owns `hint`: a null hint on two database refusals becomes the register's sentence. Other sweeps touch scripts/guards.cjs, tests/engine-manifest.js, the register and the error table: merged from origin/main before the final regenerate.

(e) VERDICT: BUILD WITH CHANGES — sign-in (POST /register, POST /verify) stays partial and is recorded, not swept; GET /constitutions and GET /routing/preview have no refusal to word or test (always 200) and stay partial.
