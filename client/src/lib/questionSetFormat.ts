// Everything the app needs to hand the question set format to a human or an
// LLM: the published JSON Schema, a prompt built around it, and clipboard /
// deep-link plumbing.
//
// The schema is fetched from GET /api/question-set-schema rather than kept as
// a copy here, because that endpoint generates it from the same zod schema
// every upload is validated against (see server/src/questionSetJsonSchema.ts).
// A second copy in the client would be exactly the drift this feature exists
// to prevent: a set written to it would import with an error.

export interface QuestionSetSchema {
  title?: string;
  description?: string;
  properties?: {
    questions?: { items?: { anyOf?: JsonSchemaObject[] } };
  };
  examples?: unknown[];
  [key: string]: unknown;
}

interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, { type?: string; const?: string; description?: string }>;
  required?: string[];
  description?: string;
}

let pending: Promise<QuestionSetSchema> | null = null;

/** Fetches (once per page load) the published schema. The document is static, so one request is enough. */
export function fetchQuestionSetSchema(): Promise<QuestionSetSchema> {
  if (!pending) {
    pending = fetch("/api/question-set-schema")
      .then((res) => {
        if (!res.ok) throw new Error("Could not load the question set schema.");
        return res.json() as Promise<QuestionSetSchema>;
      })
      .catch((err) => {
        // Don't cache a failure: a flaky first request shouldn't disable the
        // copy button for the rest of the session.
        pending = null;
        throw err;
      });
  }
  return pending;
}

/** The per-type question schemas, in the order the server declares them. */
export function questionVariants(schema: QuestionSetSchema): JsonSchemaObject[] {
  return schema.properties?.questions?.items?.anyOf ?? [];
}

export function variantType(variant: JsonSchemaObject): string {
  return variant.properties?.type?.const ?? "";
}

/** Fields every question type shares, so the docs and the prompt can list them once. */
export const SHARED_FIELDS = ["id", "type", "prompt", "points", "timeLimitSec", "media"];

export function schemaExample(schema: QuestionSetSchema): unknown {
  return schema.examples?.[0] ?? null;
}

/**
 * The format boiled down to a few lines per question type, derived from the
 * schema rather than written out again. This is what goes in the Gemini deep
 * link: the full JSON Schema is ~8kB, which a URL carries badly, while this
 * is under 1kB and still names every field and whether it is required.
 */
export function compactSpec(schema: QuestionSetSchema): string {
  const lines = questionVariants(schema).map((variant) => {
    const required = new Set(variant.required ?? []);
    const fields = Object.entries(variant.properties ?? {})
      .filter(([name]) => name !== "type" && !SHARED_FIELDS.includes(name))
      .map(([name, def]) => `${name}${required.has(name) ? "" : "?"}: ${def.type ?? "any"}`);
    return `- "${variantType(variant)}": ${fields.join(", ")}`;
  });
  return lines.join("\n");
}

const PROMPT_INTRO =
  "Write a quiz as a single JSON object for Quizzinator, a live party quiz app. " +
  "Reply with the JSON only - no markdown fences, no commentary - so it can be pasted straight into the app.";

const PROMPT_RULES = [
  'The object is {"id": string, "title": string, "questions": [...]}.',
  `Every question has: id (unique), type, prompt, points (e.g. 100), and optionally timeLimitSec (default 30) and media.imageUrl (a public https:// image URL).`,
  "Type-specific fields:",
];

const PROMPT_OUTRO =
  "Mix the question types, keep prompts short enough to read off a TV from across the room, " +
  "and make sure every answer is actually correct.";

/**
 * The full prompt, carrying the complete JSON Schema. Used by the "copy
 * prompt" buttons, where length costs nothing and a machine-readable contract
 * is the most reliable way to get JSON back that imports on the first try.
 */
export function fullPrompt(schema: QuestionSetSchema, topic = "a topic of your choice"): string {
  return [
    PROMPT_INTRO,
    "",
    `Topic: ${topic}. Write 10 questions.`,
    "",
    "It must validate against this JSON Schema:",
    JSON.stringify(schema, null, 2),
    "",
    PROMPT_OUTRO,
  ].join("\n");
}

/** The same brief, shrunk to fit in a URL. See {@link compactSpec}. */
export function compactPrompt(schema: QuestionSetSchema, topic = "a topic of your choice"): string {
  return [
    PROMPT_INTRO,
    "",
    `Topic: ${topic}. Write 10 questions.`,
    "",
    ...PROMPT_RULES,
    compactSpec(schema),
    "",
    "Example:",
    JSON.stringify(schemaExample(schema)),
    "",
    PROMPT_OUTRO,
  ].join("\n");
}

/**
 * Gemini's web app prefills its composer from `?q=`. It is not a documented
 * API, so the UI never relies on it alone - every place this link appears
 * also offers the prompt on the clipboard.
 */
export function geminiUrl(prompt: string): string {
  return `https://gemini.google.com/app?q=${encodeURIComponent(prompt)}`;
}

/**
 * Clipboard write with a fallback: navigator.clipboard is unavailable on
 * plain-HTTP origins, which is exactly how this app gets deployed on a home
 * server, so falling back to execCommand keeps the copy buttons working there.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copying isn't available in this browser.");
  } finally {
    document.body.removeChild(textarea);
  }
}
