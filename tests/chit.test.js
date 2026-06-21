const request = require("supertest");
const app = require("../src/app");
const { pool } = require("../src/db");
const reg = (name) => request(app).post("/api/network/entities").send({ name });
const link = async (parent, childBridge, childId) => {
  const e = await request(app).post("/api/network/connections").send({ parentId: parent, childBridgeId: childBridge });
  await request(app).post(`/api/network/connections/${e.body.id}/approve`).send({ actingEntityId: childId });
  return e.body.id;
};
beforeEach(async () => { await pool.query("truncate cb_chit_item, cb_chit, cb_edge, cb_entity restart identity cascade"); });
afterAll(async () => { await pool.end(); });
test("route resolves N levels A→B→C", async () => {
  const a = await reg("A"), b = await reg("B"), cc = await reg("C");
  await link(a.body.id, b.body.bridge_id, b.body.id);
  await link(b.body.id, cc.body.bridge_id, cc.body.id);
  const r = await request(app).get("/api/network/route").query({ from: a.body.id, target: cc.body.id });
  expect(r.body.length).toBe(3);                       // A,B,C
});
test("createChit chains down with originator/parent and for=origin", async () => {
  const a = await reg("A"), b = await reg("B"), cc = await reg("C");
  await link(a.body.id, b.body.bridge_id, b.body.id);
  await link(b.body.id, cc.body.bridge_id, cc.body.id);
  const res = await request(app).post("/api/network/chits").send({ fromId: a.body.id, targetId: cc.body.id, items: [{ particulars: "widgets", qty: 10, price: 5 }] });
  expect(res.body.hops.length).toBe(2);                // A→B, B→C
  expect(res.body.hops.every(h => h.originator_id === res.body.originatorId)).toBe(true);
  expect(res.body.hops[0].for_entity).toBe(a.body.id); // for = origin
});
test("downstream sees its hop, not the customer", async () => {
  const a = await reg("A"), b = await reg("B"), cc = await reg("C");
  await link(a.body.id, b.body.bridge_id, b.body.id);
  await link(b.body.id, cc.body.bridge_id, cc.body.id);
  await request(app).post("/api/network/chits").send({ fromId: a.body.id, targetId: cc.body.id, items: [] });
  const cInbox = await request(app).get(`/api/network/entities/${cc.body.id}/inbox`);
  const hop = cInbox.body[0];
  expect(hop.from_entity).toBe(b.body.id);             // C's counterparty is B
  expect(hop.for_entity).toBeUndefined();              // origin A is opaque to C
});
test("in-flight guard is real: open chit blocks disconnect, completing unblocks", async () => {
  const a = await reg("A"), b = await reg("B");
  const edgeId = await link(a.body.id, b.body.bridge_id, b.body.id);
  const res = await request(app).post("/api/network/chits").send({ fromId: a.body.id, targetId: b.body.id, items: [] });
  const blocked = await request(app).post(`/api/network/connections/${edgeId}/disconnect`).send({ settle: false });
  expect(blocked.status).toBe(409); expect(blocked.body.code).toBe("IN_FLIGHT");
  const chitId = res.body.hops[0].id;
  for (const s of ["Accepted","InProgress","Finished","Completed"])
    await request(app).post(`/api/network/chits/${chitId}/advance`).send({ to: s });
  const ok = await request(app).post(`/api/network/connections/${edgeId}/disconnect`).send({ settle: false });
  expect(ok.body.state).toBe("disconnected");
});
test("illegal lifecycle transition is rejected", async () => {
  const a = await reg("A"), b = await reg("B");
  await link(a.body.id, b.body.bridge_id, b.body.id);
  const res = await request(app).post("/api/network/chits").send({ fromId: a.body.id, targetId: b.body.id, items: [] });
  const bad = await request(app).post(`/api/network/chits/${res.body.hops[0].id}/advance`).send({ to: "Completed" });
  expect(bad.status).toBe(409); expect(bad.body.code).toBe("BAD_TXN");
});
