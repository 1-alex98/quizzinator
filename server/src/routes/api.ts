import { Router } from "express";
import { nanoid } from "nanoid";
import { createSession, getSession, getSessionByCode, setQuestionSet } from "../sessionStore.js";
import { questionSetSchema } from "../questionSetSchema.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Creates a new lobby and returns its host id + share code. Question set
// upload, join, and gameplay endpoints land with the realtime engine issue.
apiRouter.post("/sessions", (_req, res) => {
  const session = createSession(nanoid(10));
  res.status(201).json({ id: session.id, code: session.code });
});

apiRouter.get("/sessions/by-code/:code", (req, res) => {
  const session = getSessionByCode(req.params.code);
  if (!session) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ id: session.id, code: session.code, state: session.state });
});

// Attaches a question set to a lobby directly as JSON. The admin upload
// flow (ZIP/JSON file, zip-slip-safe extraction, image serving) lands with
// the question-set import issue and will call into the same validation.
apiRouter.put("/sessions/:id/question-set", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = questionSetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_question_set", details: parsed.error.flatten() });
    return;
  }
  setQuestionSet(session, parsed.data);
  res.json({ ok: true });
});
