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

  // The point of the flex sizing: the image scales to whatever the screen has
  // left, in both directions, instead of stopping at a fixed `vh` cap.
  it.each(["host", "mobile"] as const)("scales the image to its frame (%s)", (variant) => {
    const { container } = render(<QuestionPrompt question={imageQuestion} variant={variant} />);
    const style = getComputedStyle(container.querySelector("img") as HTMLImageElement);
    expect(style.height).toBe("100%");
    expect(style.width).toBe("100%");
    // `contain` is what keeps "fills the frame" from meaning "stretched".
    expect(style.objectFit).toBe("contain");
    // And why the shadow can't be a box-shadow: see QuestionPrompt.
    expect(style.filter).toContain("drop-shadow");
    expect(style.boxShadow).toBe("");
  });

  it("only claims the leftover space when there is an image to fill it", () => {
    const { container: withImage } = render(<QuestionPrompt question={imageQuestion} />);
    const { container: textOnly } = render(<QuestionPrompt question={textOnlyQuestion} />);
    const flexOf = (container: HTMLElement) =>
      getComputedStyle(container.firstElementChild as HTMLElement).flex;
    // Serialized with a unit ("1 1 0px"), hence the prefix match.
    expect(flexOf(withImage).startsWith("1 1 0")).toBe(true);
    // A text-only prompt stays intrinsically sized so it still centres in the
    // screen (and still fits the geo panel, which has no height of its own).
    expect(flexOf(textOnly)).toBe("0 0 auto");
  });
});
