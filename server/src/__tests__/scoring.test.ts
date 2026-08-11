import { describe, expect, it } from "vitest";
import { scoreAnswer } from "../scoring.js";
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
});
