import { distance as levenshteinDistance } from "fastest-levenshtein";
import type { FuzzyTextQuestion, GeoQuestion, NumberQuestion, Question } from "./types.js";

export interface ScoreResult {
  score: number;
  correct: boolean;
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreNumber(question: NumberQuestion, value: unknown): ScoreResult {
  const guess = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(guess)) return { score: 0, correct: false };
  const range = Math.max(question.max - question.min, Number.EPSILON);
  const closeness = Math.max(0, 1 - Math.abs(guess - question.correctValue) / range);
  return { score: Math.round(question.points * closeness), correct: guess === question.correctValue };
}

function scoreGeo(question: GeoQuestion, value: unknown): ScoreResult {
  const guess = value as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = typeof guess?.lat === "number" ? guess.lat : NaN;
  const lng = typeof guess?.lng === "number" ? guess.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { score: 0, correct: false };
  const distanceKm = haversineKm(lat, lng, question.correctLat, question.correctLng);
  const closeness = Math.max(0, 1 - distanceKm / question.maxDistanceKm);
  return { score: Math.round(question.points * closeness), correct: distanceKm <= question.maxDistanceKm * 0.01 };
}

function scoreFuzzyText(question: FuzzyTextQuestion, value: unknown): ScoreResult {
  const guess = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!guess) return { score: 0, correct: false };
  const bestSimilarity = question.acceptedAnswers.reduce((best, accepted) => {
    const normalized = accepted.trim().toLowerCase();
    const maxLen = Math.max(guess.length, normalized.length, 1);
    const similarity = 1 - levenshteinDistance(guess, normalized) / maxLen;
    return Math.max(best, similarity);
  }, 0);
  const correct = bestSimilarity >= question.threshold;
  return { score: correct ? question.points : 0, correct };
}

/** Server-authoritative scoring for a submitted answer, dispatched by question type. */
export function scoreAnswer(question: Question, value: unknown): ScoreResult {
  switch (question.type) {
    case "number":
      return scoreNumber(question, value);
    case "geo":
      return scoreGeo(question, value);
    case "fuzzy-text":
      return scoreFuzzyText(question, value);
  }
}
