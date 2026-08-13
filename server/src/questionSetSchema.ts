import { z } from "zod";

// Validates a QuestionSet (see types.ts). Reused both for JSON submitted
// directly to PUT /sessions/:id/question-set and for the parsed JSON inside
// an uploaded .json/.zip in questionSetImport.ts.
//
// The .describe() text is not decoration: questionSetJsonSchema.ts turns this
// schema into the JSON Schema published at GET /api/question-set-schema, which
// is what a quiz author (or the LLM they paste it into) reads to write a set.
// Documenting a field here is what documents it there - there is no second
// copy of the format to keep in sync.
const mediaSchema = z
  .object({
    imageUrl: z
      .string()
      .min(1)
      .optional()
      .describe(
        "An https:// URL, or - only when the set is uploaded as a .zip - the path of an image inside that archive, relative to its root.",
      ),
  })
  .optional()
  .describe("Optional image shown above the prompt, large on the TV and collapsible on phones.");

const questionBaseSchema = {
  id: z.string().min(1).describe("Unique within the set. Any stable string; never shown to players."),
  prompt: z.string().min(1).describe("The question as it is read off the TV, e.g. \"In what year did the Berlin Wall fall?\"."),
  points: z.number().positive().describe("Points for a perfect answer. Partial-credit types scale down from this."),
  timeLimitSec: z
    .number()
    .positive()
    .optional()
    .describe("Seconds allowed to answer. Defaults to 30. The server owns this countdown."),
  media: mediaSchema,
};

const numberQuestionSchema = z
  .object({
    ...questionBaseSchema,
    type: z.literal("number"),
    min: z.number().describe("Lower end of the slider the player drags."),
    max: z.number().describe("Upper end of the slider. Make it wider than the plausible answers so the target isn't obvious."),
    step: z.number().positive().describe("Slider increment, e.g. 1 for a year."),
    correctValue: z.number().describe("The exact answer. Full points for hitting it."),
    scoreToleranceValue: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        "How far off a guess may be before it scores nothing, with a linear falloff from full points at an exact hit. Independent of min/max, so a 1900-2026 slider can still only pay out within +-20. Defaults to (max - min); 0 means only an exact hit scores.",
      ),
  })
  .describe("Guess a number on a slider; points fall off linearly with the size of the error.");

const geoQuestionSchema = z
  .object({
    ...questionBaseSchema,
    type: z.literal("geo"),
    correctLat: z.number().min(-90).max(90).describe("Latitude of the correct location, in degrees."),
    correctLng: z.number().min(-180).max(180).describe("Longitude of the correct location, in degrees."),
    maxDistanceKm: z
      .number()
      .positive()
      .describe("Distance in km at which the score reaches 0, falling off linearly from full points at the exact spot."),
  })
  .describe("Drop a pin on a world map; points fall off with the great-circle distance from the right place.");

const fuzzyTextQuestionSchema = z
  .object({
    ...questionBaseSchema,
    type: z.literal("fuzzy-text"),
    acceptedAnswers: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        "Every spelling that should count, e.g. [\"Leonardo da Vinci\", \"Da Vinci\"]. Matching ignores case, accents and surrounding whitespace.",
      ),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Similarity (0-1) a typed answer needs against the closest accepted answer. 0.75 forgives a typo or two; 1 demands an exact match.",
      ),
  })
  .describe("Type an answer; scored all-or-nothing on how closely it matches an accepted answer.");

const multipleChoiceQuestionSchema = z
  .object({
    ...questionBaseSchema,
    type: z.literal("multiple-choice"),
    options: z
      .array(z.string().min(1))
      .min(2)
      .max(6)
      .describe("The options as shown, in this order. Keep them short - they are tapped on a phone."),
    correctIndex: z
      .number()
      .int()
      .nonnegative()
      .describe("0-based index of the correct entry in `options`, so 0 is the first option. Must be a valid index."),
  })
  .describe("Tap one of a few options; scored all-or-nothing, since there is no meaningful \"close\" on a short list.");

export const questionSchema = z
  .discriminatedUnion("type", [
    numberQuestionSchema,
    geoQuestionSchema,
    fuzzyTextQuestionSchema,
    multipleChoiceQuestionSchema,
  ])
  // A correctIndex pointing past the end of `options` is the one way to write
  // a syntactically valid multiple-choice question that can never be answered
  // correctly. It's a cross-field rule, so it lives here rather than in the
  // field's own schema (which would also break the discriminated union).
  .superRefine((question, ctx) => {
    if (question.type !== "multiple-choice") return;
    if (question.correctIndex >= question.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correctIndex"],
        message: `must be between 0 and ${question.options.length - 1} (there are ${question.options.length} options)`,
      });
    }
  });

export const questionSetSchema = z.object({
  id: z.string().min(1).describe("Identifier for the set itself. Any stable string."),
  title: z.string().min(1).describe("Name of the quiz."),
  questions: z.array(questionSchema).min(1).describe("Asked in this order."),
});
