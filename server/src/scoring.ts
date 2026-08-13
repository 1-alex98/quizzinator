import { distance as levenshteinDistance } from "fastest-levenshtein";
import type { FuzzyTextQuestion, GeoQuestion, NumberQuestion, Question } from "./types.js";

export interface ScoreResult {
  score: number;
  correct: boolean;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two lat/lng points, in kilometers. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Falloff curve: linear from full `points` at zero distance down to 0 at
 * (or beyond) the question's error tolerance — `question.scoreToleranceValue`
 * for number questions, `question.maxDistanceKm` for geo. A guess exactly at
 * the tolerance boundary scores 0; anything further also scores 0 (closeness
 * is clamped, not extrapolated negative).
 *
 * A number question's tolerance defaults to the slider's own width
 * (`max - min`), which is the behaviour from before the field existed: half
 * the range off is worth half the points. Setting it explicitly decouples
 * "how wide a range can I drag over" from "how close do I have to be" — a
 * 0-100 slider with a tolerance of 1 only pays out within ±1. A tolerance of
 * 0 means nothing but an exact hit scores.
 */
function scoreNumber(question: NumberQuestion, value: unknown): ScoreResult {
  const guess = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(guess)) return { score: 0, correct: false };
  const error = Math.abs(guess - question.correctValue);
  const tolerance = question.scoreToleranceValue ?? question.max - question.min;
  const correct = guess === question.correctValue;
  if (tolerance <= 0) return { score: correct ? question.points : 0, correct };
  const closeness = Math.max(0, 1 - error / tolerance);
  return { score: Math.round(question.points * closeness), correct };
}

/** See {@link scoreNumber} for the shared linear falloff curve description. */
function scoreGeo(question: GeoQuestion, value: unknown): ScoreResult {
  const guess = value as { lat?: unknown; lng?: unknown } | null | undefined;
  const lat = typeof guess?.lat === "number" ? guess.lat : NaN;
  const lng = typeof guess?.lng === "number" ? guess.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { score: 0, correct: false };
  const distanceKm = haversineKm(lat, lng, question.correctLat, question.correctLng);
  const closeness = Math.max(0, 1 - distanceKm / question.maxDistanceKm);
  return { score: Math.round(question.points * closeness), correct: distanceKm <= question.maxDistanceKm * 0.01 };
}

/** Lowercases, strips accents/diacritics, and collapses internal whitespace. */
function normalizeAnswer(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function scoreFuzzyText(question: FuzzyTextQuestion, value: unknown): ScoreResult {
  const guess = typeof value === "string" ? normalizeAnswer(value) : "";
  if (!guess) return { score: 0, correct: false };
  const bestSimilarity = question.acceptedAnswers.reduce((best, accepted) => {
    const normalized = normalizeAnswer(accepted);
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
