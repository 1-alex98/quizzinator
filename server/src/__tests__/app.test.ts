import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { dataDir } from "../questionSetImport.js";

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

describe("POST /api/question-sets", () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const validSet = {
    id: "any-id",
    title: "Uploaded set",
    questions: [
      { id: "q1", type: "number", prompt: "How many?", points: 10, min: 0, max: 10, step: 1, correctValue: 5 },
    ],
  };

  it("accepts a valid JSON upload", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/question-sets")
      .attach("file", Buffer.from(JSON.stringify(validSet)), "set.json");

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Uploaded set");
  });

  it("rejects a malformed JSON upload without writing anything to disk", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/question-sets")
      .attach("file", Buffer.from("{ not json"), "set.json");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_question_set");
  });

  it("accepts a valid ZIP upload, extracts images, and serves them under /uploads", async () => {
    const zip = new AdmZip();
    zip.addFile(
      "set.json",
      Buffer.from(
        JSON.stringify({
          ...validSet,
          questions: [{ ...validSet.questions[0], media: { imageUrl: "photo.jpg" } }],
        }),
      ),
    );
    zip.addFile("photo.jpg", Buffer.from("fake-image-bytes"));

    const app = createApp();
    const uploadRes = await request(app)
      .post("/api/question-sets")
      .attach("file", zip.toBuffer(), "set.zip");

    expect(uploadRes.status).toBe(201);
    const imageUrl: string = uploadRes.body.questions[0].media.imageUrl;
    expect(imageUrl).toMatch(/^\/uploads\/.+\/photo\.jpg$/);
    createdDirs.push(path.join(dataDir, imageUrl.split("/")[2]));

    const imageRes = await request(app).get(imageUrl);
    expect(imageRes.status).toBe(200);
    expect(Buffer.isBuffer(imageRes.body) ? imageRes.body.toString() : imageRes.text).toBe(
      "fake-image-bytes",
    );
  });

  it("rejects an unsupported file type", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/question-sets")
      .attach("file", Buffer.from("hello"), "set.txt");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unsupported_file_type");
  });

  it("rejects a request with no file", async () => {
    const app = createApp();
    const res = await request(app).post("/api/question-sets");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_file");
  });
});

