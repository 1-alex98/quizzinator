import { Router } from "express";
import multer, { MulterError } from "multer";
import { nanoid } from "nanoid";
import { createSession, getSession, getSessionByCode, setQuestionSet } from "../sessionStore.js";
import { questionSetSchema } from "../questionSetSchema.js";
import { questionSetJsonSchema } from "../questionSetJsonSchema.js";
import {
  importZipQuestionSet,
  MAX_UPLOAD_BYTES,
  parseJsonQuestionSet,
  QuestionSetImportError,
} from "../questionSetImport.js";

export const apiRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// The question set format as a JSON Schema, generated from the same zod
// schema every upload is validated against. Public and cacheable: it is meant
// to be copied out of the host screen and pasted into an LLM, or read on the
// /docs/question-format page, so a quiz author never has to guess at fields.
apiRouter.get("/question-set-schema", (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  res.json(questionSetJsonSchema());
});

// Creates a new lobby and returns its host id + share code. hostToken is a
// secret only returned here, to the creator - it's required by the
// host:join socket event, so knowing the sessionId or join code alone
// isn't enough to take over hosting someone else's session.
apiRouter.post("/sessions", (_req, res) => {
  const session = createSession(nanoid(10));
  res.status(201).json({ id: session.id, code: session.code, hostToken: session.hostToken });
});

// Validates (and for ZIPs, safely extracts) an uploaded question set, and
// returns the parsed QuestionSet JSON. The client then attaches it to a
// session via PUT /sessions/:id/question-set as usual - this endpoint never
// touches session state itself. See CLAUDE.md -> "Question set delivery".
apiRouter.post("/question-sets", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err instanceof MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "The file is too large." : err.message;
      res.status(400).json({ error: "invalid_upload", message });
      return;
    }
    if (err) {
      res.status(400).json({ error: "invalid_upload", message: "Could not read the uploaded file." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "missing_file", message: "No file was uploaded." });
      return;
    }

    const name = req.file.originalname.toLowerCase();
    try {
      if (name.endsWith(".zip")) {
        const questionSet = importZipQuestionSet(req.file.buffer, nanoid(12));
        res.status(201).json(questionSet);
        return;
      }
      if (name.endsWith(".json")) {
        const questionSet = parseJsonQuestionSet(req.file.buffer);
        res.status(201).json(questionSet);
        return;
      }
      res.status(400).json({ error: "unsupported_file_type", message: "Upload a .json or .zip file." });
    } catch (importErr) {
      if (importErr instanceof QuestionSetImportError) {
        res.status(400).json({ error: "invalid_question_set", message: importErr.message });
        return;
      }
      throw importErr;
    }
  });
});

// Deliberately doesn't return the internal sessionId or hostToken - this
// endpoint is unauthenticated (anyone with a join code can call it), and
// the sessionId is what host:join needs, so leaking it here would let
// knowledge of the (short, guessable-by-brute-force) join code escalate
// into hosting control.
apiRouter.get("/sessions/by-code/:code", (req, res) => {
  const session = getSessionByCode(req.params.code);
  if (!session) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ code: session.code, state: session.state });
});

// Attaches a question set to a lobby directly as JSON - used both by the
// built-in test set and by the admin upload flow (which validates/extracts
// via POST /question-sets first, then PUTs the resulting parsed set here).
apiRouter.put("/sessions/:id/question-set", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = questionSetSchema.safeParse(req.body);
  if (!parsed.success) {
    // `message` mirrors the phrasing POST /question-sets uses for uploads, so
    // the admin screen can surface one readable line whichever way the set
    // arrived - pasted JSON lands here without passing through the importer.
    res.status(400).json({
      error: "invalid_question_set",
      message: `Question set failed validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      details: parsed.error.flatten(),
    });
    return;
  }
  setQuestionSet(session, parsed.data);
  res.json({ ok: true });
});
