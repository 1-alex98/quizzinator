import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DocsView } from "../views/DocsView.js";
import { compactPrompt, fullPrompt, geminiUrl, type QuestionSetSchema } from "../lib/questionSetFormat.js";

// A cut-down stand-in for what GET /api/question-set-schema serves. The real
// document is generated from the server's zod schema; what matters here is
// that the page renders whatever it is given rather than a second, hand-kept
// copy of the format.
const SCHEMA: QuestionSetSchema = {
  title: "Quizzinator question set",
  properties: {
    questions: {
      items: {
        anyOf: [
          {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique within the set." },
              prompt: { type: "string", description: "The question as read off the TV." },
              points: { type: "number", description: "Points for a perfect answer." },
              timeLimitSec: { type: "number", description: "Seconds allowed to answer." },
              type: { type: "string", const: "number" },
              correctValue: { type: "number", description: "The exact answer." },
            },
            required: ["id", "prompt", "points", "type", "correctValue"],
            description: "Guess a number on a slider.",
          },
          {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique within the set." },
              prompt: { type: "string", description: "The question as read off the TV." },
              points: { type: "number", description: "Points for a perfect answer." },
              type: { type: "string", const: "multiple-choice" },
              options: { type: "array", description: "The options as shown, in this order." },
              correctIndex: { type: "number", description: "0-based index of the correct entry." },
            },
            required: ["id", "prompt", "points", "type", "options", "correctIndex"],
            description: "Tap one of a few options.",
          },
        ],
      },
    },
  },
  examples: [{ id: "example-set", title: "Example", questions: [] }],
};

const fetchMock = vi.fn();

function renderDocs() {
  return render(
    <MemoryRouter initialEntries={["/docs/question-format"]}>
      <DocsView />
    </MemoryRouter>,
  );
}

describe("DocsView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(SCHEMA) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("documents each question type from the published schema", async () => {
    renderDocs();

    // Type-specific fields, with the schema's own descriptions - nothing on
    // this page is written out a second time here or in the component.
    // Headings specifically: "number" is also a type in every field table.
    expect(await screen.findByRole("heading", { name: "multiple-choice" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "number" })).toBeTruthy();
    expect(screen.getByText("correctIndex")).toBeTruthy();
    expect(screen.getByText("0-based index of the correct entry.")).toBeTruthy();
    expect(screen.getByText("Tap one of a few options.")).toBeTruthy();
  });

  it("lists the shared fields once, marking the optional ones", async () => {
    renderDocs();

    const sharedTable = (await screen.findByText("Every question")).closest("section") as HTMLElement;
    expect(sharedTable.textContent).toContain("prompt");
    // timeLimitSec is absent from the "required" list, so it must be flagged.
    expect(sharedTable.textContent).toContain("timeLimitSec");
    expect(sharedTable.querySelectorAll(".MuiChip-label")).not.toHaveLength(0);
    // The type field enumerates what a question can actually be.
    expect(sharedTable.textContent).toContain('"multiple-choice"');
  });

  it("shows the schema's bundled example", async () => {
    renderDocs();
    await waitFor(() => expect(screen.getByText(/"example-set"/)).toBeTruthy());
  });
});

describe("LLM prompts", () => {
  it("carries the whole schema when copied, but a compact spec in a URL", () => {
    const full = fullPrompt(SCHEMA, "90s music");
    expect(full).toContain("90s music");
    expect(full).toContain("correctIndex");
    expect(full).toContain("Reply with the JSON only");

    // The Gemini deep link has to survive being a URL: the full schema is
    // several kilobytes, so the link carries the field list instead.
    const compact = compactPrompt(SCHEMA, "90s music");
    expect(compact).toContain('- "multiple-choice": options: array, correctIndex: number');
    expect(compact.length).toBeLessThan(full.length / 2);
    expect(geminiUrl(compact).length).toBeLessThan(8000);
  });

  it("marks optional fields in the compact spec", () => {
    // correctValue is required for a number question, so it carries no "?".
    expect(compactPrompt(SCHEMA)).toContain('- "number": correctValue: number');
  });
});
