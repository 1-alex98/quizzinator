import { customAlphabet, nanoid } from "nanoid";
import type { Player, QuestionSet, QuizSession } from "./types.js";

// Unambiguous uppercase alphabet (no 0/O/1/I) for join codes read off a TV screen.
const generateCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

const sessions = new Map<string, QuizSession>();
const codeToSessionId = new Map<string, string>();

export function createSession(id: string): QuizSession {
  let code = generateCode();
  while (codeToSessionId.has(code)) {
    code = generateCode();
  }

  const session: QuizSession = {
    id,
    code,
    hostSocketId: null,
    state: "lobby",
    currentQuestionIndex: -1,
    questionSet: null,
    players: new Map(),
    createdAt: Date.now(),
    currentAnswers: new Map(),
    timer: null,
  };

  sessions.set(id, session);
  codeToSessionId.set(code, id);
  return session;
}

export function getSession(id: string): QuizSession | undefined {
  return sessions.get(id);
}

export function getSessionByCode(code: string): QuizSession | undefined {
  const id = codeToSessionId.get(code.toUpperCase());
  return id ? sessions.get(id) : undefined;
}

export function deleteSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  codeToSessionId.delete(session.code);
  sessions.delete(id);
}

export function listSessions(): QuizSession[] {
  return Array.from(sessions.values());
}

export function setQuestionSet(session: QuizSession, questionSet: QuestionSet): void {
  session.questionSet = questionSet;
}

/**
 * Adds a player, or returns the existing one if `playerId` matches an
 * existing session member — this is what lets a dropped phone rejoin under
 * its persisted id instead of showing up as a brand new player.
 */
export function upsertPlayer(session: QuizSession, name: string, playerId?: string): Player {
  if (playerId) {
    const existing = session.players.get(playerId);
    if (existing) return existing;
  }
  const player: Player = {
    id: playerId ?? nanoid(12),
    name,
    socketId: null,
    connected: false,
    score: 0,
    graceTimeout: null,
  };
  session.players.set(player.id, player);
  return player;
}
