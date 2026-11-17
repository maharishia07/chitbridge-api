// tests/app-network-refusal.spec.js — src/app.js (the NET feature app) refuses an unsigned request and has no catalogue mount (MNT-52).
// Needs no database: the refusal comes before any query. Run: npx jest tests/app-network-refusal.spec.js
const supertest = require("supertest");
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long-xx";
const app = require("../src/app");

test("fail-closed: an unsigned write to /api/network is refused with 401 and the token_missing problem", async () => {
  const r = await supertest(app).post("/api/network/entities").send({ name: "Alpha" });
  expect(r.status).toBe(401);
  expect(r.body.code).toBe("TOKEN_MISSING");
});

test("the removed catalogue routes are not served: the item list of an entity is refused or unknown, never data", async () => {
  const r = await supertest(app).get("/api/network/entities/1/catalogue");
  expect([401, 404]).toContain(r.status);
});
