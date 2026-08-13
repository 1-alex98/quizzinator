import type { Server, Socket } from "socket.io";
import { getSession, getSessionByCode, upsertPlayer } from "./sessionStore.js";
import { haversineKm, scoreAnswer } from "./scoring.js";
import type { Player, Question, QuizSession } from "./types.js";
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

/**
 * The two grace periods a dropped phone gets. Both are deliberately generous:
 * a venue's wifi, a locked iPhone or a backgrounded tab drop sockets all the
 * time, and every one of those is a player still standing in the room - so
 * nothing about the game should be decided the instant a socket goes quiet.
 * Mutable so tests can shrink them; production never writes to this.
 */
export const graceTimings = {
  /**
   * How long a disconnected player's identity/score is held before being
   * dropped from the session. Long enough to outlast a flat battery being
   * put on a charger - the cost of holding it is a few bytes in a Map.
   */
  reconnectMs: 30 * 60 * 1000,
  /**
   * How long a disconnected player still counts as "in the room" for the
   * "everyone has answered" check. Without it, one phone locking its screen
   * mid-question cuts that question short for everyone else.
   */
  presenceMs: 20 * 1000,
};
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
    case "multiple-choice":
      // correctIndex is deliberately not spread in: the options go to the
      // phones, the answer stays here until the reveal.
      return { ...base, type: "multiple-choice", options: question.options };
  }
}

function publicPlayers(session: QuizSession): PublicPlayer[] {
  return Array.from(session.players.values())
    .map((p) => ({ id: p.id, name: p.name, connected: p.connected, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Players expected to answer the question in flight. A player whose socket
 * dropped seconds ago is still counted: they are almost certainly still in
 * the room with a phone that is reconnecting, and dropping them immediately
 * would let a single wifi blip trigger the "everyone answered" reveal and cut
 * the question short for the rest of the room.
 */
function activePlayerCount(session: QuizSession): number {
  const now = Date.now();
  let count = 0;
  for (const player of session.players.values()) {
    if (player.connected) {
      count++;
    } else if (player.disconnectedAt !== null && now - player.disconnectedAt < graceTimings.presenceMs) {
      count++;
    }
  }
  return count;
}

/** Reveals as soon as everyone still expected to answer has - the check behind both an answer and a lapsed presence grace. */
function maybeAutoReveal(io: IoServer, session: QuizSession): void {
  if (session.state !== "question") return;
  const total = activePlayerCount(session);
  if (total > 0 && session.currentAnswers.size >= total) {
    revealQuestion(io, session);
  }
}

/**
 * Marks a player offline and starts both grace clocks. Used by the socket's
 * own `disconnect` and by a socket that joins a *different* session, which
 * abandons the player it was holding just as surely as a dropped connection.
 */
function markPlayerOffline(io: IoServer, session: QuizSession, player: Player): void {
  player.socketId = null;
  player.connected = false;
  player.disconnectedAt = Date.now();
  // The leaderboard says "offline" straight away - only the answer count
  // above is allowed to keep pretending they are still here.
  broadcastStateSync(io, session);

  if (player.graceTimeout) clearTimeout(player.graceTimeout);
  player.graceTimeout = setTimeout(() => {
    session.players.delete(player.id);
    broadcastStateSync(io, session);
  }, graceTimings.reconnectMs);
  player.graceTimeout.unref?.();

  // Nothing else re-runs the quorum check once the presence grace lapses: if
  // this player never comes back, the others would otherwise wait out the
  // full timer even though they have all answered.
  setTimeout(() => maybeAutoReveal(io, session), graceTimings.presenceMs + 50).unref?.();
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
    case "multiple-choice":
      return { correctIndex: question.correctIndex, correctOption: question.options[question.correctIndex] };
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

  /**
   * Detaches a socket from any session that isn't the one it is joining now.
   * The client keeps a single shared Socket.IO connection for the whole SPA,
   * so hosting a second quiz ("New quiz" off the final screen) or scanning a
   * new join code reuses the socket that is still in the previous session's
   * room. Left alone, that socket keeps receiving the old session's
   * broadcasts - which is how a TV mid-question could suddenly show the
   * *previous* quiz's final leaderboard, everyone in it long since offline,
   * until the next sync for the real session put it back.
   */
  function leaveOtherSessions(socket: IoSocket, keepSessionId: string): void {
    const keep = room(keepSessionId);
    for (const joined of socket.rooms) {
      if (joined !== keep && joined.startsWith("session:")) socket.leave(joined);
    }

    const previous = socketRegistry.get(socket.id);
    if (!previous || previous.sessionId === keepSessionId) return;
    const previousSession = getSession(previous.sessionId);
    if (!previousSession) return;

    if (previous.isHost) {
      if (previousSession.hostSocketId === socket.id) previousSession.hostSocketId = null;
      return;
    }
    // This socket was somebody in the old session, and isn't coming back to
    // it: retire that player properly instead of leaving them "connected"
    // forever behind a socket id that will never answer again.
    const abandoned = previous.playerId ? previousSession.players.get(previous.playerId) : undefined;
    if (abandoned && abandoned.socketId === socket.id) {
      markPlayerOffline(io, previousSession, abandoned);
    }
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
      leaveOtherSessions(socket, session.id);
      session.hostSocketId = socket.id;
      socketRegistry.set(socket.id, { sessionId: session.id, isHost: true });
      socket.join(room(session.id));
      ack(ok(buildStateSync(session)));
    });

    socket.on("player:join", ({ code, name, playerId, playerToken }, ack) => {
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

      const result = upsertPlayer(session, trimmedName, playerId, playerToken);
      if (!result.ok) {
        ack(fail(result.error));
        return;
      }
      const player = result.player;
      leaveOtherSessions(socket, session.id);
      if (player.graceTimeout) {
        clearTimeout(player.graceTimeout);
        player.graceTimeout = null;
      }
      player.connected = true;
      player.disconnectedAt = null;
      player.socketId = socket.id;

      socketRegistry.set(socket.id, { sessionId: session.id, isHost: false, playerId: player.id });
      socket.join(room(session.id));

      ack(
        ok({
          playerId: player.id,
          // Only ever sent here, on this player's own socket - never in a
          // broadcast, so the rest of the room can't rejoin as them.
          playerToken: player.token,
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

    // "Play again": the same room, the same question set, everyone back on
    // zero. Deliberately reuses this session rather than creating a new one,
    // so the join code on the TV and every phone's stored identity stay
    // valid - nobody has to re-scan the QR code between games.
    socket.on("session:restart", ({ sessionId }, ack) => {
      const session = requireHostSession(socket, sessionId);
      if (!session) {
        ack?.(fail("not_host"));
        return;
      }
      if (!session.questionSet || session.questionSet.questions.length === 0) {
        ack?.(fail("no_question_set"));
        return;
      }
      clearTimer(session);
      session.state = "lobby";
      session.currentQuestionIndex = -1;
      session.currentAnswers = new Map();
      for (const player of session.players.values()) {
        player.score = 0;
      }
      broadcastStateSync(io, session);
      ack?.(ok(null));
    });

    socket.on("answer:submit", ({ sessionId, value }, ack) => {
      // Who is answering comes from the socket's own join, never from the
      // payload: a playerId is public, so trusting one here would let anyone
      // in the room submit as a rival and burn their answer for them.
      const entry = socketRegistry.get(socket.id);
      if (!entry || entry.isHost || !entry.playerId || entry.sessionId !== sessionId) {
        ack?.(fail("not_joined"));
        return;
      }
      const playerId = entry.playerId;

      const session = getSession(sessionId);
      if (!session || session.state !== "question") {
        ack?.(fail("not_accepting_answers"));
        return;
      }
      if (!session.players.has(playerId)) {
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

      io.to(room(session.id)).emit("question:progress", {
        answered: session.currentAnswers.size,
        total: activePlayerCount(session),
      });

      // Skip the rest of the timer once everyone still expected to answer
      // has, instead of leaving the room waiting out the full time limit.
      maybeAutoReveal(io, session);
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

      markPlayerOffline(io, session, player);
    });
  });
}
