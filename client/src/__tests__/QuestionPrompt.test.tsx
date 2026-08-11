import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import type { PublicQuestion } from "../lib/protocol.js";

const textOnlyQuestion: PublicQuestion = {
  id: "q1",
  type: "number",
  prompt: "How many moons does Mars have?",
  points: 100,
  min: 0,
  max: 10,
  step: 1,
};

const imageQuestion: PublicQuestion = {
  ...textOnlyQuestion,
  id: "q2",
  media: { imageUrl: "https://example.com/mars.png" },
};

describe("QuestionPrompt", () => {
  afterEach(cleanup);

  it("renders the prompt text with no image element when there is no media", () => {
    const { container } = render(<QuestionPrompt question={textOnlyQuestion} />);
    expect(screen.getByText("How many moons does Mars have?")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the image above the prompt when media.imageUrl is set", () => {
    const { container } = render(<QuestionPrompt question={imageQuestion} />);
    expect(screen.getByText("How many moons does Mars have?")).toBeTruthy();
    const image = container.querySelector("img") as HTMLImageElement;
    expect(image.src).toBe("https://example.com/mars.png");
  });
});
