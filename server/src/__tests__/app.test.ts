import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const app = createApp();
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /api/sessions", () => {
  it("creates a session with a 5-character join code", async () => {
    const app = createApp();
    const res = await request(app).post("/api/sessions");
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Z0-9]{5}$/);
  });
});
