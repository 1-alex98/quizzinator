import { z } from "zod";

// Validates a QuestionSet (see types.ts). Reused both for JSON submitted
// directly to PUT /sessions/:id/question-set and for the parsed JSON inside
// an uploaded .json/.zip in questionSetImport.ts.
const mediaSchema = z.object({ imageUrl: z.string().min(1).optional() }).optional();

const questionBaseSchema = {
  id: z.string().min(1),
  prompt: z.string().min(1),
  points: z.number().positive(),
  timeLimitSec: z.number().positive().optional(),
  media: mediaSchema,
};

const numberQuestionSchema = z.object({
  ...questionBaseSchema,
  type: z.literal("number"),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  correctValue: z.number(),
});

const geoQuestionSchema = z.object({
  ...questionBaseSchema,
  type: z.literal("geo"),
  correctLat: z.number().min(-90).max(90),
  correctLng: z.number().min(-180).max(180),
  maxDistanceKm: z.number().positive(),
});

const fuzzyTextQuestionSchema = z.object({
  ...questionBaseSchema,
  type: z.literal("fuzzy-text"),
  acceptedAnswers: z.array(z.string().min(1)).min(1),
  threshold: z.number().min(0).max(1),
});

export const questionSchema = z.discriminatedUnion("type", [
  numberQuestionSchema,
  geoQuestionSchema,
  fuzzyTextQuestionSchema,
]);

export const questionSetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  questions: z.array(questionSchema).min(1),
});
