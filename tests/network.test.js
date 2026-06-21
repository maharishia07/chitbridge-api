const request = require("supertest");
const app = require("../src/app");           // export the Express app from app.js
const { pool } = require("../src/db");
const reg  = (name, body = {}) => request(app).post("/api/network/entities").send({ name, ...body });
const look = (bridgeId) => request(app).get("/api/network/entities/lookup").query({ bridgeId });
const reqC = (parentId, childBridgeId) => request(app).post("/api/network/connections").send({ parentId, childBridgeId });
const appr = (id, actingEntityId) => request(app).post(`/api/network/connections/${id}/approve`).send({ actingEntityId });
const subtree = (id) => request(app).get(`/api/network/entities/${id}/subtree`);
beforeEach(async () => { await pool.query("truncate cb_edge, cb_entity restart identity cascade"); });
afterAll(async () => { await pool.end(); });
test("T1 register + lookup returns a public card only", async () => {
  const a = await reg("Alpha"); const b = await reg("Bravo");
  expect(a.body.bridge_id).toMatch(/^CB-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  const card = await look(b.body.bridge_id);
  expect(card.body.found).toBe(true);
  expect(card.body.entity.name).toBe("Bravo");
  expect(card.body.entity.path).toBeUndefined();     // internals not exposed
});
test("T2 request -> approve nests child under parent", async () => {
  const a = await reg("Alpha"); const b = await reg("Bravo");
  const e = await reqC(a.body.id, b.body.bridge_id);
  expect(e.body.state).toBe("requested");
  const ok = await appr(e.body.id, b.body.id);
  expect(ok.body.state).toBe("active");
  const t = await subtree(a.body.id);
  expect(t.body.map(n => n.name)).toEqual(expect.arrayContaining(["Alpha", "Bravo"]));
});
test("T3 tree-only: a second parent is rejected", async () => {
  const a = await reg("Alpha"); const b = await reg("Bravo"); const c = await reg("Cee");
  const e = await reqC(a.body.id, b.body.bridge_id); await appr(e.body.id, b.body.id);
  const bad = await reqC(c.body.id, b.body.bridge_id);
  expect(bad.status).toBe(409); expect(bad.body.code).toBe("HAS_PARENT");
});
test("T4 cycle guard", async () => {
  const a = await reg("Alpha"); const b = await reg("Bravo");
  const e1 = await reqC(a.body.id, b.body.bridge_id); await appr(e1.body.id, b.body.id);   // A -> B
  const e2 = await reqC(b.body.id, a.body.bridge_id);                                       // B -> A request ok (A is root)
  const bad = await appr(e2.body.id, a.body.id);
  expect(bad.status).toBe(409); expect(bad.body.code).toBe("CYCLE");
});
test("T5 register-if-absent: unclaimed stub cannot consent", async () => {
  const a = await reg("Alpha"); const s = await reg("Stub", { claimed: false });
  const e = await reqC(a.body.id, s.body.bridge_id);
  const blocked = await appr(e.body.id, s.body.id);
  expect(blocked.status).toBe(409); expect(blocked.body.code).toBe("UNCLAIMED");
  await request(app).post(`/api/network/entities/${s.body.id}/claim`);
  const ok = await appr(e.body.id, s.body.id);
  expect(ok.body.state).toBe("active");
});
test("T6 disconnect: in-flight guard then settle detaches", async () => {
  const a = await reg("Alpha"); const b = await reg("Bravo");
  const e = await reqC(a.body.id, b.body.bridge_id); await appr(e.body.id, b.body.id);
  await pool.query("update cb_edge set in_flight=true where id=$1", [e.body.id]);
  const blocked = await request(app).post(`/api/network/connections/${e.body.id}/disconnect`).send({ settle: false });
  expect(blocked.status).toBe(409); expect(blocked.body.code).toBe("IN_FLIGHT");
  const ok = await request(app).post(`/api/network/connections/${e.body.id}/disconnect`).send({ settle: true });
  expect(ok.body.state).toBe("disconnected");
  const t = await subtree(a.body.id);
  expect(t.body.map(n => n.name)).not.toContain("Bravo");     // detached
});
test("T7 decline leaves child parentless", async () => {
  const a = await reg("Alpha"); const b = await reg("Bravo");
  const e = await reqC(a.body.id, b.body.bridge_id);
  const d = await request(app).post(`/api/network/connections/${e.body.id}/decline`).send({ actingEntityId: b.body.id });
  expect(d.body.state).toBe("declined");
  const t = await subtree(a.body.id);
  expect(t.body.map(n => n.name)).not.toContain("Bravo");
});
test("T8 suspend / resume", async () => {
  const a = await reg("Alpha"); const b = await reg("Bravo");
  const e = await reqC(a.body.id, b.body.bridge_id); await appr(e.body.id, b.body.id);
  const s = await request(app).post(`/api/network/connections/${e.body.id}/suspend`).send();
  expect(s.body.state).toBe("suspended");
  const r = await request(app).post(`/api/network/connections/${e.body.id}/resume`).send();
  expect(r.body.state).toBe("active");
});
