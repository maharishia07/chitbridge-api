const supertest = require("supertest");
const jwt = require("jsonwebtoken");
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long-xx";
const app = require("../src/app");
const { pool } = require("../src/db");
// cb_* catalogue routes now require auth (F1) and gate writes (NETWORK_WRITE_ENABLED, set in jest.setup.js).
// Attach an entity token to every request; identity_type:'entity' makes auth skip the actor DB revalidation.
const TOKEN = "Bearer " + jwt.sign({ identity_id: "00000000-0000-0000-0000-000000000000", identity_type: "entity" }, process.env.JWT_SECRET, { expiresIn: "1h" });
const agent = supertest(app);
const auth = (t) => t.set("Authorization", TOKEN);
const reg = (name) => auth(agent.post("/api/network/entities")).send({ name });

beforeEach(async () => { await pool.query("truncate cb_catalogue_item, cb_catalogue_category, cb_entity restart identity cascade"); });
afterAll(async () => { await pool.end(); });

test("create + list catalogue item", async () => {
  const a = await reg("Shop");
  const it = await auth(agent.post(`/api/network/entities/${a.body.id}/catalogue`)).send({ name:"Widget", price:9.5, priceType:"Business" });
  expect(it.body.name).toBe("Widget");
  const list = await auth(agent.get(`/api/network/entities/${a.body.id}/catalogue`));
  expect(list.body.map(x=>x.name)).toContain("Widget");
});

test("tier filter shows only that price_type", async () => {
  const a = await reg("Shop");
  await auth(agent.post(`/api/network/entities/${a.body.id}/catalogue`)).send({ name:"Pub", price:10, priceType:"Business" });
  await auth(agent.post(`/api/network/entities/${a.body.id}/catalogue`)).send({ name:"Emp", price:8, priceType:"Employee" });
  const biz = await auth(agent.get(`/api/network/entities/${a.body.id}/catalogue?tier=Business`));
  expect(biz.body.map(x=>x.name)).toEqual(["Pub"]);
});

test("update price + soft delete", async () => {
  const a = await reg("Shop");
  const it = await auth(agent.post(`/api/network/entities/${a.body.id}/catalogue`)).send({ name:"X", price:1 });
  const up = await auth(agent.patch(`/api/network/catalogue/${it.body.id}`)).send({ price:2 });
  expect(Number(up.body.price)).toBe(2);
  const del = await auth(agent.delete(`/api/network/catalogue/${it.body.id}`));
  expect(del.body.deleted).toBe(true);
});
