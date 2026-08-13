// Mirrors server/src/protocol.ts. Duplicated rather than shared across the
// two npm workspaces to avoid introducing a third build target just for
// types; keep the two files in sync when the event protocol changes.
export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };

export type QuestionType = "number" | "geo" | "fuzzy-text";

interface PublicQuestionBase {
  id: string;
  prompt: string;
  points: number;
  timeLimitSec?: number;
  media?: { imageUrl?: string };
}

export type PublicQuestion =
  | (PublicQuestionBase & { type: "number"; min: number; max: number; step: number })
  | (PublicQuestionBase & { type: "geo"; maxDistanceKm: number })
  | (PublicQuestionBase & { type: "fuzzy-text" });

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
  endsAt: number;
  timeLimitSec: number;
}

export type SessionState = "lobby" | "question" | "reveal" | "ended";

export interface StateSyncPayload {
  sessionId: string;
  code: string;
  state: SessionState;
  currentQuestionIndex: number;
  totalQuestions: number;
  players: PublicPlayer[];
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
  sessionId: string;
  state: SessionState;
}

export interface ClientToServerEvents {
  "host:join": (
    payload: { sessionId: string; hostToken: string },
    ack: (res: AckResponse<StateSyncPayload>) => void,
  ) => void;
  "player:join": (
    payload: { code: string; name: string; playerId?: string },
    ack: (res: AckResponse<PlayerJoinAck>) => void,
  ) => void;
  "session:start": (payload: { sessionId: string }, ack?: (res: AckResponse<null>) => void) => void;
  "question:next": (payload: { sessionId: string }, ack?: (res: AckResponse<null>) => void) => void;
  "question:reveal": (payload: { sessionId: string }, ack?: (res: AckResponse<null>) => void) => void;
  "session:end": (payload: { sessionId: string }, ack?: (res: AckResponse<null>) => void) => void;
  "answer:submit": (
    payload: { sessionId: string; playerId: string; value: unknown },
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
