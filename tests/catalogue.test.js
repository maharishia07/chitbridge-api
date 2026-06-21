const request = require("supertest"); const app = require("../src/app"); const { pool } = require("../src/db");
const reg = (name) => request(app).post("/api/network/entities").send({ name });
beforeEach(async () => { await pool.query("truncate cb_catalogue_item, cb_catalogue_category, cb_entity restart identity cascade"); });
afterAll(async () => { await pool.end(); });
test("create + list catalogue item", async () => {
  const a = await reg("Shop");
  const it = await request(app).post(`/api/network/entities/${a.body.id}/catalogue`).send({ name:"Widget", price:9.5, priceType:"Business" });
  expect(it.body.name).toBe("Widget");
  const list = await request(app).get(`/api/network/entities/${a.body.id}/catalogue`);
  expect(list.body.map(x=>x.name)).toContain("Widget");
});
test("tier filter shows only that price_type", async () => {
  const a = await reg("Shop");
  await request(app).post(`/api/network/entities/${a.body.id}/catalogue`).send({ name:"Pub", price:10, priceType:"Business" });
  await request(app).post(`/api/network/entities/${a.body.id}/catalogue`).send({ name:"Emp", price:8, priceType:"Employee" });
  const biz = await request(app).get(`/api/network/entities/${a.body.id}/catalogue?tier=Business`);
  expect(biz.body.map(x=>x.name)).toEqual(["Pub"]);
});
test("update price + soft delete", async () => {
  const a = await reg("Shop");
  const it = await request(app).post(`/api/network/entities/${a.body.id}/catalogue`).send({ name:"X", price:1 });
  const up = await request(app).patch(`/api/network/catalogue/${it.body.id}`).send({ price:2 });
  expect(Number(up.body.price)).toBe(2);
  const del = await request(app).delete(`/api/network/catalogue/${it.body.id}`);
  expect(del.body.deleted).toBe(true);
});
