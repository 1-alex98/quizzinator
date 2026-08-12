import { describe, expect, it } from "vitest";
import { haversineKm, scoreAnswer } from "../scoring.js";
import type { FuzzyTextQuestion, GeoQuestion, NumberQuestion } from "../types.js";

const numberQuestion: NumberQuestion = {
  id: "q-number",
  type: "number",
  prompt: "How many?",
  points: 100,
  min: 0,
  max: 100,
  step: 1,
  correctValue: 50,
};

const geoQuestion: GeoQuestion = {
  id: "q-geo",
  type: "geo",
  prompt: "Where?",
  points: 100,
  correctLat: 52.52,
  correctLng: 13.405,
  maxDistanceKm: 100,
};

const fuzzyQuestion: FuzzyTextQuestion = {
  id: "q-fuzzy",
  type: "fuzzy-text",
  prompt: "Who?",
  points: 100,
  acceptedAnswers: ["Marie Curie"],
  threshold: 0.8,
};

describe("scoreAnswer for number questions", () => {
  it("awards full points for an exact guess", () => {
    expect(scoreAnswer(numberQuestion, 50)).toEqual({ score: 100, correct: true });
  });

  it("awards partial points that fall off with distance", () => {
    const result = scoreAnswer(numberQuestion, 60);
    expect(result.correct).toBe(false);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
  });

  it("falls off linearly: 10% of the range off loses 10% of the points", () => {
    // range is max - min = 100, so a guess 10 away is 10% off.
    expect(scoreAnswer(numberQuestion, 60)).toEqual({ score: 90, correct: false });
  });

  it("falls off linearly: half the range off loses half the points", () => {
    expect(scoreAnswer(numberQuestion, 100)).toEqual({ score: 50, correct: false });
  });

  it("awards zero once the guess is a full range-width away", () => {
    expect(scoreAnswer(numberQuestion, 150)).toEqual({ score: 0, correct: false });
  });

  it("awards zero for a non-numeric answer", () => {
    expect(scoreAnswer(numberQuestion, "not-a-number")).toEqual({ score: 0, correct: false });
  });
});

describe("scoreAnswer for geo questions", () => {
  it("awards full points for the exact coordinates", () => {
    const result = scoreAnswer(geoQuestion, { lat: 52.52, lng: 13.405 });
    expect(result.correct).toBe(true);
    expect(result.score).toBe(100);
  });

  it("falls off to zero beyond maxDistanceKm", () => {
    const result = scoreAnswer(geoQuestion, { lat: -52.52, lng: -166.595 });
    expect(result.score).toBe(0);
  });

  it("falls off linearly with the haversine distance to the correct point", () => {
    // A point due north of the correct location whose known haversine
    // distance is exactly half of maxDistanceKm should lose half the points.
    const halfway = { lat: geoQuestion.correctLat + (geoQuestion.maxDistanceKm / 2 / 111.32), lng: geoQuestion.correctLng };
    const distanceKm = haversineKm(halfway.lat, halfway.lng, geoQuestion.correctLat, geoQuestion.correctLng);
    expect(distanceKm).toBeCloseTo(geoQuestion.maxDistanceKm / 2, 0);

    const result = scoreAnswer(geoQuestion, halfway);
    expect(result.score).toBe(Math.round(geoQuestion.points * (1 - distanceKm / geoQuestion.maxDistanceKm)));
    expect(result.correct).toBe(false);
  });

  it("awards zero for a malformed guess", () => {
    expect(scoreAnswer(geoQuestion, { lat: "nope" })).toEqual({ score: 0, correct: false });
  });
});

describe("scoreAnswer for fuzzy-text questions", () => {
  it("accepts an exact match", () => {
    expect(scoreAnswer(fuzzyQuestion, "Marie Curie")).toEqual({ score: 100, correct: true });
  });

  it("accepts a close-enough match above the threshold", () => {
    const result = scoreAnswer(fuzzyQuestion, "marie curi");
    expect(result.correct).toBe(true);
    expect(result.score).toBe(100);
  });

  it("rejects an answer below the threshold", () => {
    expect(scoreAnswer(fuzzyQuestion, "Albert Einstein")).toEqual({ score: 0, correct: false });
  });

  it("rejects an empty answer", () => {
    expect(scoreAnswer(fuzzyQuestion, "")).toEqual({ score: 0, correct: false });
  });

  it("ignores accents/diacritics", () => {
    const question: FuzzyTextQuestion = { ...fuzzyQuestion, acceptedAnswers: ["Beyonce"] };
    expect(scoreAnswer(question, "Beyoncé")).toEqual({ score: 100, correct: true });
  });

  it("collapses extra internal whitespace", () => {
    expect(scoreAnswer(fuzzyQuestion, "  Marie   Curie  ")).toEqual({ score: 100, correct: true });
  });

  it("tolerates a small typo above the threshold", () => {
    const result = scoreAnswer(fuzzyQuestion, "Marie Curei");
    expect(result.correct).toBe(true);
    expect(result.score).toBe(100);
  });
});
