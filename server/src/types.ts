// Shared domain types for quiz sessions, questions and players.
// Kept intentionally small for the initial scaffold; the realtime engine
// (see GitHub issue "Realtime quiz engine") fleshes out session behavior.

export type QuestionType = "number" | "geo" | "fuzzy-text";

export interface QuestionMedia {
  /** Either a remote URL or a path relative to the question set's extracted image dir. */
  imageUrl?: string;
}

interface QuestionBase {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  /** Seconds allotted to answer. Defaults to 30 when omitted. */
  timeLimitSec?: number;
  media?: QuestionMedia;
}

export interface NumberQuestion extends QuestionBase {
  type: "number";
  min: number;
  max: number;
  step: number;
  correctValue: number;
}

export interface GeoQuestion extends QuestionBase {
  type: "geo";
  correctLat: number;
  correctLng: number;
  /** Distance in km beyond which a guess scores zero points. */
  maxDistanceKm: number;
}

export interface FuzzyTextQuestion extends QuestionBase {
  type: "fuzzy-text";
  acceptedAnswers: string[];
  /** Minimum similarity (0-1) required to count as correct. */
  threshold: number;
}

export type Question = NumberQuestion | GeoQuestion | FuzzyTextQuestion;

export interface QuestionSet {
  id: string;
  title: string;
  questions: Question[];
}

export type SessionState = "lobby" | "question" | "reveal" | "ended";

export interface Player {
  id: string;
  name: string;
  socketId: string | null;
  connected: boolean;
  score: number;
}

export interface QuizSession {
  id: string;
  /** Short human-friendly code the host shares with mobile participants. */
  code: string;
  hostSocketId: string | null;
  state: SessionState;
  currentQuestionIndex: number;
  questionSet: QuestionSet | null;
  players: Map<string, Player>;
  createdAt: number;
}
