import { Router } from "express";
import { nanoid } from "nanoid";
import { createSession, getSessionByCode } from "../sessionStore.js";

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
