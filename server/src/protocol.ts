// Socket.IO event protocol shared by the host (TV) client and player
// (mobile) clients. Typed so the Socket.IO server/client generics catch
// event-name and payload drift at compile time.
import type { Question, SessionState } from "./types.js";

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };

/** A question with fields that would reveal the correct answer stripped out. */
export type PublicQuestion =
  | Pick<Extract<Question, { type: "number" }>, "id" | "type" | "prompt" | "points" | "timeLimitSec" | "media" | "min" | "max" | "step">
  | Pick<Extract<Question, { type: "geo" }>, "id" | "type" | "prompt" | "points" | "timeLimitSec" | "media" | "maxDistanceKm">
  | Pick<Extract<Question, { type: "fuzzy-text" }>, "id" | "type" | "prompt" | "points" | "timeLimitSec" | "media">
  // `options` ships (the phone has to render them), `correctIndex` does not.
  | Pick<
      Extract<Question, { type: "multiple-choice" }>,
      "id" | "type" | "prompt" | "points" | "timeLimitSec" | "media" | "options"
    >;

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  score: number;
}

export interface QuestionShowPayload {
  question: PublicQuestion;
  index: number;
  total: number;
  /** Server clock timestamp (ms) the countdown ends at; clients only render this, never own it. */
  endsAt: number;
  timeLimitSec: number;
}

export interface StateSyncPayload {
  sessionId: string;
  code: string;
  state: SessionState;
  currentQuestionIndex: number;
  totalQuestions: number;
  players: PublicPlayer[];
  /** Present when state is "question", so a (re)joining client can render the in-flight question immediately. */
  question?: QuestionShowPayload;
}

export interface AnswerResult {
  playerId: string;
  value: unknown;
  score: number;
  correct: boolean;
  totalScore: number;
  /** How far off a geo guess was, in km. Only present for geo questions with a valid guess. */
  distanceKm?: number;
}

export interface QuestionRevealedPayload {
  index: number;
  correctAnswer: unknown;
  results: AnswerResult[];
  leaderboard: PublicPlayer[];
}

export interface QuestionProgressPayload {
  answered: number;
  total: number;
}

export interface LeaderboardPayload {
  players: PublicPlayer[];
}

export interface PlayerJoinAck {
  playerId: string;
  /**
   * This player's secret, sent only on their own socket. Persisted by the
   * phone and handed back on every rejoin; without it an existing playerId -
   * which everyone in the room can see - is not enough to claim an identity.
   */
  playerToken: string;
  sessionId: string;
  state: SessionState;
  /**
   * The in-flight question, when state is "question". Lets a phone that
   * dropped mid-question (screen lock, wifi blip) land straight back on the
   * answer screen instead of a blank one - the ack is the only per-socket
   * message a rejoining player gets, so it has to carry this.
   */
  question?: QuestionShowPayload;
  /** Whether this player already answered the in-flight question, so a rejoin doesn't offer a second attempt. */
  answered: boolean;
}

export interface ClientToServerEvents {
  "host:join": (
    payload: { sessionId: string; hostToken: string },
    ack: (res: AckResponse<StateSyncPayload>) => void,
  ) => void;
  "player:join": (
    payload: { code: string; name: string; playerId?: string; playerToken?: string },
    ack: (res: AckResponse<PlayerJoinAck>) => void,
  ) => void;
  "session:start": (payload: { sessionId: string }, ack?: (res: AckResponse<null>) => void) => void;
  "question:next": (payload: { sessionId: string }, ack?: (res: AckResponse<null>) => void) => void;
  "question:reveal": (payload: { sessionId: string }, ack?: (res: AckResponse<null>) => void) => void;
  "session:end": (payload: { sessionId: string }, ack?: (res: AckResponse<null>) => void) => void;
  // Back to the lobby with the same question set, the same players and the
  // same join code - so "play again" doesn't make the room re-scan anything.
  "session:restart": (payload: { sessionId: string }, ack?: (res: AckResponse<null>) => void) => void;
  // No playerId: the server resolves the answering player from the socket
  // that joined, so a player can only ever answer as themselves.
  "answer:submit": (
    payload: { sessionId: string; value: unknown },
    ack?: (res: AckResponse<{ score: number; correct: boolean }>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  "state:sync": (payload: StateSyncPayload) => void;
  "question:show": (payload: QuestionShowPayload) => void;
  "timer:tick": (payload: { remainingSec: number }) => void;
  "question:progress": (payload: QuestionProgressPayload) => void;
  "question:revealed": (payload: QuestionRevealedPayload) => void;
  "leaderboard:update": (payload: LeaderboardPayload) => void;
  "session:ended": (payload: LeaderboardPayload) => void;
}
