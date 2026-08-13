import type { Server, Socket } from "socket.io";
import { getSession, getSessionByCode, upsertPlayer } from "./sessionStore.js";
import { haversineKm, scoreAnswer } from "./scoring.js";
import type { Question, QuizSession } from "./types.js";
import type {
  AckResponse,
  ClientToServerEvents,
  PublicPlayer,
  PublicQuestion,
  QuestionShowPayload,
  ServerToClientEvents,
  StateSyncPayload,
} from "./protocol.js";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** How long a disconnected player's identity/score is held before being dropped. */
export const RECONNECT_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_TIME_LIMIT_SEC = 30;

function room(sessionId: string): string {
  return `session:${sessionId}`;
}

function ok<T>(data: T): AckResponse<T> {
  return { ok: true, data };
}

function fail(error: string): AckResponse<never> {
  return { ok: false, error };
}

function sanitizeQuestion(question: Question): PublicQuestion {
  const base = {
    id: question.id,
    prompt: question.prompt,
    points: question.points,
    timeLimitSec: question.timeLimitSec,
    media: question.media,
  };
  switch (question.type) {
    case "number":
      return { ...base, type: "number", min: question.min, max: question.max, step: question.step };
    case "geo":
      return { ...base, type: "geo", maxDistanceKm: question.maxDistanceKm };
    case "fuzzy-text":
      return { ...base, type: "fuzzy-text" };
  }
}

function publicPlayers(session: QuizSession): PublicPlayer[] {
  return Array.from(session.players.values())
    .map((p) => ({ id: p.id, name: p.name, connected: p.connected, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

/** Players who can currently submit an answer (excludes disconnected players in their reconnect grace period). */
function connectedPlayerCount(session: QuizSession): number {
  let count = 0;
  for (const player of session.players.values()) {
    if (player.connected) count++;
  }
  return count;
}

function currentQuestion(session: QuizSession): Question | null {
  if (!session.questionSet) return null;
  return session.questionSet.questions[session.currentQuestionIndex] ?? null;
}

function buildQuestionShowPayload(session: QuizSession): QuestionShowPayload | undefined {
  const question = currentQuestion(session);
  if (!question || !session.timer || !session.questionSet) return undefined;
  return {
    question: sanitizeQuestion(question),
    index: session.currentQuestionIndex,
    total: session.questionSet.questions.length,
    endsAt: session.timer.endsAt,
    timeLimitSec: question.timeLimitSec ?? DEFAULT_TIME_LIMIT_SEC,
  };
}

function buildStateSync(session: QuizSession): StateSyncPayload {
  return {
    sessionId: session.id,
    code: session.code,
    state: session.state,
    currentQuestionIndex: session.currentQuestionIndex,
    totalQuestions: session.questionSet?.questions.length ?? 0,
    players: publicPlayers(session),
    question: session.state === "question" ? buildQuestionShowPayload(session) : undefined,
  };
}

function broadcastStateSync(io: IoServer, session: QuizSession): void {
  io.to(room(session.id)).emit("state:sync", buildStateSync(session));
}

function clearTimer(session: QuizSession): void {
  if (!session.timer) return;
  clearTimeout(session.timer.timeout);
  clearInterval(session.timer.interval);
  session.timer = null;
}

function extractCorrectAnswer(question: Question): unknown {
  switch (question.type) {
    case "number":
      return { correctValue: question.correctValue };
    case "geo":
      return { correctLat: question.correctLat, correctLng: question.correctLng };
    case "fuzzy-text":
      return { acceptedAnswers: question.acceptedAnswers };
  }
}

/** Distance in km between a geo guess and the correct location, if the guess is well-formed. */
function distanceForGeoGuess(question: Question, value: unknown): number | undefined {
  if (question.type !== "geo") return undefined;
  const guess = value as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = typeof guess?.lat === "number" ? guess.lat : NaN;
  const lng = typeof guess?.lng === "number" ? guess.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return haversineKm(lat, lng, question.correctLat, question.correctLng);
}

function revealQuestion(io: IoServer, session: QuizSession): void {
  if (session.state !== "question") return;
  clearTimer(session);
  session.state = "reveal";

  const question = currentQuestion(session);
  if (!question) return;

  const results = Array.from(session.players.values()).map((player) => {
    const answer = session.currentAnswers.get(player.id);
    if (answer) {
      player.score += answer.score;
    }
    const distanceKm = answer ? distanceForGeoGuess(question, answer.value) : undefined;
    return {
      playerId: player.id,
      value: answer?.value ?? null,
      score: answer?.score ?? 0,
      correct: answer?.correct ?? false,
      totalScore: player.score,
      ...(distanceKm !== undefined ? { distanceKm } : {}),
    };
  });

  io.to(room(session.id)).emit("question:revealed", {
    index: session.currentQuestionIndex,
    correctAnswer: extractCorrectAnswer(question),
    results,
    leaderboard: publicPlayers(session),
  });
  broadcastStateSync(io, session);
}

function advanceToNextQuestion(io: IoServer, session: QuizSession): void {
  clearTimer(session);
  const nextIndex = session.currentQuestionIndex + 1;
  const questions = session.questionSet?.questions ?? [];

  if (nextIndex >= questions.length) {
    session.state = "ended";
    io.to(room(session.id)).emit("session:ended", { players: publicPlayers(session) });
    return;
  }

  session.currentQuestionIndex = nextIndex;
  session.state = "question";
  session.currentAnswers = new Map();

  const question = questions[nextIndex];
  const timeLimitSec = question.timeLimitSec ?? DEFAULT_TIME_LIMIT_SEC;
  const endsAt = Date.now() + timeLimitSec * 1000;

  const interval = setInterval(() => {
    const remainingSec = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    io.to(room(session.id)).emit("timer:tick", { remainingSec });
  }, 1000);

  const timeout = setTimeout(() => {
    revealQuestion(io, session);
  }, timeLimitSec * 1000);

  session.timer = { endsAt, timeout, interval };

  io.to(room(session.id)).emit("question:show", buildQuestionShowPayload(session)!);
}

interface SocketRegistryEntry {
  sessionId: string;
  isHost: boolean;
  playerId?: string;
}

export function registerQuizEngine(io: IoServer): void {
  const socketRegistry = new Map<string, SocketRegistryEntry>();

  function requireHostSession(socket: IoSocket, sessionId: string): QuizSession | undefined {
    const session = getSession(sessionId);
    if (!session || session.hostSocketId !== socket.id) return undefined;
    return session;
  }

  io.on("connection", (socket: IoSocket) => {
    socket.on("host:join", ({ sessionId, hostToken }, ack) => {
      const session = getSession(sessionId);
      if (!session) {
        ack(fail("session_not_found"));
        return;
      }
      if (hostToken !== session.hostToken) {
        ack(fail("not_host"));
        return;
      }
      session.hostSocketId = socket.id;
      socketRegistry.set(socket.id, { sessionId: session.id, isHost: true });
      socket.join(room(session.id));
      ack(ok(buildStateSync(session)));
    });

    socket.on("player:join", ({ code, name, playerId }, ack) => {
      const session = getSessionByCode(code);
      if (!session) {
        ack(fail("session_not_found"));
        return;
      }
      const trimmedName = name?.trim();
      if (!trimmedName) {
        ack(fail("invalid_name"));
        return;
      }

      const player = upsertPlayer(session, trimmedName, playerId);
      if (player.graceTimeout) {
        clearTimeout(player.graceTimeout);
        player.graceTimeout = null;
      }
      player.connected = true;
      player.socketId = socket.id;

      socketRegistry.set(socket.id, { sessionId: session.id, isHost: false, playerId: player.id });
      socket.join(room(session.id));

      ack(
        ok({
          playerId: player.id,
          sessionId: session.id,
          state: session.state,
          question: session.state === "question" ? buildQuestionShowPayload(session) : undefined,
          // Only meaningful while a question is in flight; answers linger in
          // currentAnswers through the reveal that follows.
          answered: session.state === "question" && session.currentAnswers.has(player.id),
        }),
      );
      broadcastStateSync(io, session);
    });

    socket.on("session:start", ({ sessionId }, ack) => {
      const session = requireHostSession(socket, sessionId);
      if (!session) {
        ack?.(fail("not_host"));
        return;
      }
      if (session.state !== "lobby") {
        ack?.(fail("not_in_lobby"));
        return;
      }
      if (!session.questionSet || session.questionSet.questions.length === 0) {
        ack?.(fail("no_question_set"));
        return;
      }
      advanceToNextQuestion(io, session);
      ack?.(ok(null));
    });

    socket.on("question:reveal", ({ sessionId }, ack) => {
      const session = requireHostSession(socket, sessionId);
      if (!session || session.state !== "question") {
        ack?.(fail("not_answering"));
        return;
      }
      revealQuestion(io, session);
      ack?.(ok(null));
    });

    socket.on("question:next", ({ sessionId }, ack) => {
      const session = requireHostSession(socket, sessionId);
      if (!session || session.state !== "reveal") {
        ack?.(fail("not_in_reveal"));
        return;
      }
      advanceToNextQuestion(io, session);
      ack?.(ok(null));
    });

    socket.on("session:end", ({ sessionId }, ack) => {
      const session = requireHostSession(socket, sessionId);
      if (!session) {
        ack?.(fail("not_host"));
        return;
      }
      clearTimer(session);
      session.state = "ended";
      io.to(room(session.id)).emit("session:ended", { players: publicPlayers(session) });
      ack?.(ok(null));
    });

    socket.on("answer:submit", ({ sessionId, playerId, value }, ack) => {
      const session = getSession(sessionId);
      if (!session || session.state !== "question") {
        ack?.(fail("not_accepting_answers"));
        return;
      }
      const player = session.players.get(playerId);
      if (!player) {
        ack?.(fail("unknown_player"));
        return;
      }
      if (session.currentAnswers.has(playerId)) {
        ack?.(fail("already_answered"));
        return;
      }
      const question = currentQuestion(session);
      if (!question) {
        ack?.(fail("no_active_question"));
        return;
      }

      const { score, correct } = scoreAnswer(question, value);
      session.currentAnswers.set(playerId, { playerId, value, score, correct, submittedAt: Date.now() });
      ack?.(ok({ score, correct }));

      const total = connectedPlayerCount(session);
      io.to(room(session.id)).emit("question:progress", {
        answered: session.currentAnswers.size,
        total,
      });

      // Skip the rest of the timer once every connected player has answered,
      // instead of leaving everyone waiting out the full time limit.
      if (total > 0 && session.currentAnswers.size >= total) {
        revealQuestion(io, session);
      }
    });

    socket.on("disconnect", () => {
      const entry = socketRegistry.get(socket.id);
      socketRegistry.delete(socket.id);
      if (!entry) return;

      const session = getSession(entry.sessionId);
      if (!session) return;

      if (entry.isHost) {
        if (session.hostSocketId === socket.id) session.hostSocketId = null;
        return;
      }

      if (!entry.playerId) return;
      const player = session.players.get(entry.playerId);
      if (!player) return;

      // A flaky connection can deliver the old socket's "disconnect" after
      // the replacement socket has already rejoined. Only the socket that is
      // still the player's current one is allowed to mark them offline,
      // otherwise a successful reconnect gets undone by its own predecessor.
      if (player.socketId !== socket.id) return;

      player.socketId = null;
      player.connected = false;
      broadcastStateSync(io, session);

      player.graceTimeout = setTimeout(() => {
        session.players.delete(entry.playerId!);
        broadcastStateSync(io, session);
      }, RECONNECT_GRACE_MS);
    });
  });
}
