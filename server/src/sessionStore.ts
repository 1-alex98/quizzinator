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
    hostToken: nanoid(24),
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

export type UpsertPlayerResult =
  | { ok: true; player: Player }
  | { ok: false; error: "invalid_player_token" };

/**
 * Adds a player, or returns the existing one if `playerId` matches an
 * existing session member — this is what lets a dropped phone rejoin under
 * its persisted id instead of showing up as a brand new player.
 *
 * Claiming an existing id requires that player's `token`: the id alone is
 * public (it rides along in every leaderboard), so without this anyone in
 * the room could rejoin as anyone else and take over their name and score.
 * An unknown id gets a fresh, server-generated player rather than an error —
 * that's a phone carrying a stale id from a session that no longer exists,
 * which is a normal restart, not an attack. Ids are never taken from the
 * client, so a chosen id can't squat on someone else's identity either.
 */
export function upsertPlayer(
  session: QuizSession,
  name: string,
  playerId?: string,
  playerToken?: string,
): UpsertPlayerResult {
  const existing = playerId ? session.players.get(playerId) : undefined;
  if (existing) {
    if (!playerToken || playerToken !== existing.token) {
      return { ok: false, error: "invalid_player_token" };
    }
    return { ok: true, player: existing };
  }
  const player: Player = {
    id: nanoid(12),
    token: nanoid(24),
    name,
    socketId: null,
    connected: false,
    score: 0,
    disconnectedAt: null,
    graceTimeout: null,
  };
  session.players.set(player.id, player);
  return { ok: true, player };
}
