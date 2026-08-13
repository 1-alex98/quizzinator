// The published, machine-readable description of the question set format,
// served by GET /api/question-set-schema and shown on the client's
// /docs/question-format page.
//
// Generated from the zod schema rather than hand-written: this document's
// whole job is to be pasted into an LLM so the JSON that comes back imports
// without an error, which it can only do if it describes the validator the
// upload will actually be run through. A hand-maintained copy would be one
// forgotten edit away from telling authors something the server rejects.
import { zodToJsonSchema } from "zod-to-json-schema";
import { questionSetSchema } from "./questionSetSchema.js";

/** A complete, valid set - one question of each type - to anchor the format for a reader or an LLM. */
export const EXAMPLE_QUESTION_SET = {
  id: "eighties-night",
  title: "Eighties Night",
  questions: [
    {
      id: "q1",
      type: "multiple-choice",
      prompt: "Which of these came out first?",
      points: 100,
      timeLimitSec: 20,
      options: ["The Walkman", "The CD player", "The iPod", "The MiniDisc"],
      correctIndex: 0,
    },
    {
      id: "q2",
      type: "number",
      prompt: "In what year did the Berlin Wall fall?",
      points: 100,
      min: 1900,
      max: 2026,
      step: 1,
      correctValue: 1989,
      scoreToleranceValue: 20,
    },
    {
      id: "q3",
      type: "geo",
      prompt: "Where is the Eiffel Tower?",
      points: 100,
      correctLat: 48.8584,
      correctLng: 2.2945,
      maxDistanceKm: 1000,
    },
    {
      id: "q4",
      type: "fuzzy-text",
      prompt: "Who painted the Mona Lisa?",
      points: 100,
      acceptedAnswers: ["Leonardo da Vinci", "Da Vinci"],
      threshold: 0.75,
      media: { imageUrl: "https://example.com/mona-lisa.jpg" },
    },
  ],
} as const;

/** Generated once at first use: the schema never changes at runtime. */
let cached: Record<string, unknown> | null = null;

export function questionSetJsonSchema(): Record<string, unknown> {
  if (cached) return cached;
  // Inlined ($refStrategy "none") and un-named on purpose: the document is
  // read top-to-bottom by a human or pasted whole into a chat, where a web of
  // $refs into a definitions block costs more than the repetition saves.
  const generated = zodToJsonSchema(questionSetSchema, { $refStrategy: "none" }) as Record<string, unknown>;

  cached = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Quizzinator question set",
    description:
      "A quiz for Quizzinator: a title plus an ordered list of questions. Every question carries `id`, `type`, `prompt` and `points`; the remaining fields depend on `type`. Upload the result as a .json file, or paste it into the host screen.",
    ...generated,
    examples: [EXAMPLE_QUESTION_SET],
  };
  return cached;
}
