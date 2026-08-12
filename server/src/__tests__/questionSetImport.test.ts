import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  dataDir,
  importZipQuestionSet,
  parseJsonQuestionSet,
  QuestionSetImportError,
} from "../questionSetImport.js";
import { buildRawZip } from "./zipFixture.js";

const VALID_SET = {
  id: "ignored-client-supplied-id",
  title: "Test set",
  questions: [
    {
      id: "q1",
      type: "number",
      prompt: "How many?",
      points: 100,
      min: 0,
      max: 10,
      step: 1,
      correctValue: 5,
    },
  ],
};

const createdSetIds: string[] = [];

function cleanupDirFor(setId: string) {
  createdSetIds.push(setId);
}

afterEach(() => {
  for (const setId of createdSetIds.splice(0)) {
    fs.rmSync(path.join(dataDir, setId), { recursive: true, force: true });
  }
});

describe("parseJsonQuestionSet", () => {
  it("parses a valid JSON-only question set", () => {
    const set = parseJsonQuestionSet(Buffer.from(JSON.stringify(VALID_SET)));
    expect(set.questions).toHaveLength(1);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseJsonQuestionSet(Buffer.from("{ not json"))).toThrow(QuestionSetImportError);
  });

  it("rejects a schema-invalid question set", () => {
    const invalid = { ...VALID_SET, questions: [] };
    expect(() => parseJsonQuestionSet(Buffer.from(JSON.stringify(invalid)))).toThrow(QuestionSetImportError);
  });

  it("rejects a set referencing a local image with no ZIP to provide it", () => {
    const withLocalImage = {
      ...VALID_SET,
      questions: [{ ...VALID_SET.questions[0], media: { imageUrl: "photo.jpg" } }],
    };
    expect(() => parseJsonQuestionSet(Buffer.from(JSON.stringify(withLocalImage)))).toThrow(
      QuestionSetImportError,
    );
  });
});

describe("importZipQuestionSet", () => {
  it("extracts a valid ZIP, rewrites local image URLs, and writes files under dataDir/<setId>", () => {
    const setWithImage = {
      ...VALID_SET,
      questions: [{ ...VALID_SET.questions[0], media: { imageUrl: "images/photo.jpg" } }],
    };
    const zip = new AdmZip();
    zip.addFile("set.json", Buffer.from(JSON.stringify(setWithImage)));
    zip.addFile("images/photo.jpg", Buffer.from("fake-image-bytes"));

    const setId = nanoid(12);
    cleanupDirFor(setId);
    const result = importZipQuestionSet(zip.toBuffer(), setId);

    expect(result.id).toBe(setId);
    expect(result.questions[0].media?.imageUrl).toBe(`/uploads/${setId}/images/photo.jpg`);
    expect(fs.readFileSync(path.join(dataDir, setId, "images/photo.jpg"), "utf8")).toBe("fake-image-bytes");
    // The JSON entry itself is not extracted alongside the images.
    expect(fs.existsSync(path.join(dataDir, setId, "set.json"))).toBe(false);
  });

  it("passes remote image URLs through unchanged", () => {
    const setWithRemoteImage = {
      ...VALID_SET,
      questions: [{ ...VALID_SET.questions[0], media: { imageUrl: "https://example.com/photo.jpg" } }],
    };
    const zip = new AdmZip();
    zip.addFile("set.json", Buffer.from(JSON.stringify(setWithRemoteImage)));

    const setId = nanoid(12);
    cleanupDirFor(setId);
    const result = importZipQuestionSet(zip.toBuffer(), setId);

    expect(result.questions[0].media?.imageUrl).toBe("https://example.com/photo.jpg");
  });

  it("rejects a ZIP without exactly one root-level .json file", () => {
    const zip = new AdmZip();
    zip.addFile("images/photo.jpg", Buffer.from("fake"));
    const setId = nanoid(12);
    cleanupDirFor(setId);
    expect(() => importZipQuestionSet(zip.toBuffer(), setId)).toThrow(QuestionSetImportError);
    expect(fs.existsSync(path.join(dataDir, setId))).toBe(false);
  });

  it("rejects a question set referencing an image missing from the archive", () => {
    const setWithMissingImage = {
      ...VALID_SET,
      questions: [{ ...VALID_SET.questions[0], media: { imageUrl: "images/missing.jpg" } }],
    };
    const zip = new AdmZip();
    zip.addFile("set.json", Buffer.from(JSON.stringify(setWithMissingImage)));
    const setId = nanoid(12);
    cleanupDirFor(setId);
    expect(() => importZipQuestionSet(zip.toBuffer(), setId)).toThrow(QuestionSetImportError);
    expect(fs.existsSync(path.join(dataDir, setId))).toBe(false);
  });

  it("rejects a zip-slip path traversal entry and writes nothing outside the target dir", () => {
    // AdmZip's own `addFile` sanitizes ".." out of names, so a realistic
    // malicious archive (crafted by a tool other than AdmZip) is built here
    // at the raw byte level instead - see zipFixture.ts.
    const buf = buildRawZip([
      { name: "set.json", data: Buffer.from(JSON.stringify(VALID_SET)) },
      { name: "../../etc/passthrough", data: Buffer.from("malicious") },
    ]);
    const setId = nanoid(12);
    cleanupDirFor(setId);

    expect(() => importZipQuestionSet(buf, setId)).toThrow(QuestionSetImportError);
    expect(fs.existsSync(path.join(dataDir, setId))).toBe(false);
    expect(fs.existsSync(path.resolve(dataDir, "../../etc/passthrough"))).toBe(false);
  });

  it("rejects an absolute-path entry", () => {
    const buf = buildRawZip([
      { name: "set.json", data: Buffer.from(JSON.stringify(VALID_SET)) },
      { name: "/etc/passthrough", data: Buffer.from("malicious") },
    ]);
    const setId = nanoid(12);
    cleanupDirFor(setId);

    expect(() => importZipQuestionSet(buf, setId)).toThrow(QuestionSetImportError);
    expect(fs.existsSync(path.join(dataDir, setId))).toBe(false);
  });

  it("rejects an archive containing a symlink entry", () => {
    const buf = buildRawZip([
      { name: "set.json", data: Buffer.from(JSON.stringify(VALID_SET)) },
      { name: "images/evil-link", data: Buffer.from("/etc/passwd"), unixMode: 0o120777 },
    ]);
    const setId = nanoid(12);
    cleanupDirFor(setId);

    expect(() => importZipQuestionSet(buf, setId)).toThrow(QuestionSetImportError);
    expect(fs.existsSync(path.join(dataDir, setId))).toBe(false);
  });

  it("rejects an archive with too many entries", () => {
    const zip = new AdmZip();
    zip.addFile("set.json", Buffer.from(JSON.stringify(VALID_SET)));
    zip.addFile("a.txt", Buffer.from("a"));
    zip.addFile("b.txt", Buffer.from("b"));
    const setId = nanoid(12);
    cleanupDirFor(setId);

    expect(() => importZipQuestionSet(zip.toBuffer(), setId, { maxZipEntries: 2 })).toThrow(
      QuestionSetImportError,
    );
    expect(fs.existsSync(path.join(dataDir, setId))).toBe(false);
  });

  it("rejects an archive exceeding the total uncompressed size limit (zip-bomb guard)", () => {
    const zip = new AdmZip();
    zip.addFile("set.json", Buffer.from(JSON.stringify(VALID_SET)));
    zip.addFile("big.bin", Buffer.alloc(1000, 1));
    const setId = nanoid(12);
    cleanupDirFor(setId);

    expect(() =>
      importZipQuestionSet(zip.toBuffer(), setId, { maxTotalUncompressedBytes: 500 }),
    ).toThrow(QuestionSetImportError);
    expect(fs.existsSync(path.join(dataDir, setId))).toBe(false);
  });

  it("rejects a single entry exceeding the per-file size limit", () => {
    const zip = new AdmZip();
    zip.addFile("set.json", Buffer.from(JSON.stringify(VALID_SET)));
    zip.addFile("big.bin", Buffer.alloc(1000, 1));
    const setId = nanoid(12);
    cleanupDirFor(setId);

    expect(() =>
      importZipQuestionSet(zip.toBuffer(), setId, { maxEntryUncompressedBytes: 500 }),
    ).toThrow(QuestionSetImportError);
    expect(fs.existsSync(path.join(dataDir, setId))).toBe(false);
  });
});
