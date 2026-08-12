// Validates and (for ZIPs) safely extracts an uploaded question set. See
// CLAUDE.md -> "Question set delivery" for the format decisions and
// "Storage" for why extracted images live on disk under server/data/<setId>/
// rather than in memory.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import { questionSetSchema } from "./questionSetSchema.js";
import type { QuestionSet } from "./types.js";

export class QuestionSetImportError extends Error {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Directory extracted question-set images are written to and served from. */
export const dataDir = path.resolve(__dirname, "../data");

/** Enforced by multer on the route; re-exported so the route stays in sync with this module's limits. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_ZIP_ENTRIES = 300;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 15 * 1024 * 1024; // 15MB per file
const MAX_TOTAL_UNCOMPRESSED_BYTES = 60 * 1024 * 1024; // 60MB extracted, guards against zip bombs

export interface ImportLimits {
  maxUploadBytes?: number;
  maxZipEntries?: number;
  maxEntryUncompressedBytes?: number;
  maxTotalUncompressedBytes?: number;
}

function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Parses and validates a question set submitted as a plain JSON file (no local images). */
export function parseJsonQuestionSet(buffer: Buffer): QuestionSet {
  let raw: unknown;
  try {
    raw = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new QuestionSetImportError("The file is not valid JSON.");
  }
  const parsed = questionSetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new QuestionSetImportError(
      `Question set failed validation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  for (const question of parsed.data.questions) {
    if (question.media?.imageUrl && !isRemoteUrl(question.media.imageUrl)) {
      throw new QuestionSetImportError(
        `Question "${question.id}" references a local image ("${question.media.imageUrl}") but no ZIP was uploaded to provide it.`,
      );
    }
  }
  return parsed.data;
}

/** Resolves an archive entry's path, rejecting anything that would escape `baseDir` (zip-slip). */
function resolveSafeEntryPath(baseDir: string, entryName: string): string {
  if (path.isAbsolute(entryName) || /^[a-zA-Z]:/.test(entryName) || entryName.startsWith("\\")) {
    throw new QuestionSetImportError(`Unsafe path in archive: "${entryName}"`);
  }
  const normalized = path.normalize(entryName);
  if (normalized.split(path.sep).includes("..")) {
    throw new QuestionSetImportError(`Unsafe path in archive: "${entryName}"`);
  }
  const resolved = path.resolve(baseDir, normalized);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    throw new QuestionSetImportError(`Unsafe path in archive: "${entryName}"`);
  }
  return resolved;
}

/** Unix symlink mode bit (S_IFLNK), stored in the upper 16 bits of the external file attribute. */
function isSymlinkEntry(entry: AdmZip.IZipEntry): boolean {
  return ((entry.attr >>> 16) & 0xf000) === 0xa000;
}

/**
 * Validates and extracts a ZIP-packaged question set: the archive must
 * contain exactly one root-level `.json` file plus any local image files it
 * references by relative path. Every entry is checked for zip-slip and
 * symlink tricks, and the archive is size/entry-count bounded, before
 * anything is parsed or written to disk.
 */
export function importZipQuestionSet(buffer: Buffer, setId: string, limits: ImportLimits = {}): QuestionSet {
  const maxZipEntries = limits.maxZipEntries ?? MAX_ZIP_ENTRIES;
  const maxEntryUncompressedBytes = limits.maxEntryUncompressedBytes ?? MAX_ENTRY_UNCOMPRESSED_BYTES;
  const maxTotalUncompressedBytes = limits.maxTotalUncompressedBytes ?? MAX_TOTAL_UNCOMPRESSED_BYTES;

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new QuestionSetImportError("The file is not a valid ZIP archive.");
  }

  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new QuestionSetImportError("The ZIP archive is empty.");
  }
  if (entries.length > maxZipEntries) {
    throw new QuestionSetImportError(`The ZIP archive has too many entries (max ${maxZipEntries}).`);
  }

  const targetDir = path.join(dataDir, setId);

  let totalUncompressed = 0;
  for (const entry of entries) {
    // Validates the path even for directory entries so a malicious name
    // can't be used to probe/create paths outside targetDir.
    resolveSafeEntryPath(targetDir, entry.entryName);
    if (entry.isDirectory) continue;
    if (isSymlinkEntry(entry)) {
      throw new QuestionSetImportError(`Symlinks are not allowed in the archive: "${entry.entryName}"`);
    }
    if (entry.header.size > maxEntryUncompressedBytes) {
      throw new QuestionSetImportError(
        `"${entry.entryName}" is too large uncompressed (max ${maxEntryUncompressedBytes} bytes).`,
      );
    }
    totalUncompressed += entry.header.size;
    if (totalUncompressed > maxTotalUncompressedBytes) {
      throw new QuestionSetImportError(
        `The archive is too large uncompressed (max ${maxTotalUncompressedBytes} bytes total).`,
      );
    }
  }

  const jsonEntries = entries.filter(
    (e) => !e.isDirectory && !e.entryName.includes("/") && e.entryName.toLowerCase().endsWith(".json"),
  );
  if (jsonEntries.length !== 1) {
    throw new QuestionSetImportError("The ZIP archive must contain exactly one root-level .json file.");
  }
  const jsonEntry = jsonEntries[0];

  let raw: unknown;
  try {
    raw = JSON.parse(jsonEntry.getData().toString("utf8"));
  } catch {
    throw new QuestionSetImportError(`"${jsonEntry.entryName}" is not valid JSON.`);
  }
  const parsed = questionSetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new QuestionSetImportError(
      `Question set failed validation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  const entryNames = new Set(entries.filter((e) => !e.isDirectory).map((e) => e.entryName));
  for (const question of parsed.data.questions) {
    const imageUrl = question.media?.imageUrl;
    if (imageUrl && !isRemoteUrl(imageUrl) && !entryNames.has(imageUrl)) {
      throw new QuestionSetImportError(
        `Question "${question.id}" references image "${imageUrl}" which is not present in the archive.`,
      );
    }
  }

  // Everything validated - now it's safe to touch disk.
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of entries) {
    if (entry.isDirectory || entry === jsonEntry) continue;
    const targetPath = resolveSafeEntryPath(targetDir, entry.entryName);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, entry.getData());
  }

  const questionSet: QuestionSet = {
    ...parsed.data,
    id: setId,
    questions: parsed.data.questions.map((question) => {
      const imageUrl = question.media?.imageUrl;
      if (!imageUrl || isRemoteUrl(imageUrl)) return question;
      return { ...question, media: { ...question.media, imageUrl: `/uploads/${setId}/${imageUrl}` } };
    }),
  };
  return questionSet;
}
