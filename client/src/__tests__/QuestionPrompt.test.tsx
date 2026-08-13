import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    // Grows into the leftover space, but never shrinks below its contents -
    // an overflowing block would paint over the answer options below it.
    expect(flexOf(withImage)).toBe("1 1 auto");
    // A text-only prompt stays intrinsically sized so it still centres in the
    // screen (and still fits the geo panel, which has no height of its own).
    expect(flexOf(textOnly)).toBe("0 0 auto");
  });

  // The bug this guards: with a bare `flex: 1 1 0` and no floor, a phone
  // showing four tap targets and a submit button squeezed the picture down to
  // a 30px sliver - and to nothing at all on a small screen.
  it.each(["host", "mobile"] as const)("keeps a floor under the image frame (%s)", (variant) => {
    const { container } = render(<QuestionPrompt question={imageQuestion} variant={variant} />);
    const frame = (container.querySelector("img") as HTMLImageElement).parentElement as HTMLElement;
    expect(getComputedStyle(frame).minHeight).toBe("min(20vh, 200px)");
  });

  // The geo panel floats over the map the player has to tap, so it hugs its
  // image rather than claiming space - and must not carry the floor either.
  it("does not reserve space for the image in the geo panel", () => {
    const { container } = render(<QuestionPrompt question={imageQuestion} variant="panel" />);
    const frame = (container.querySelector("img") as HTMLImageElement).parentElement as HTMLElement;
    expect(getComputedStyle(frame).flex).toBe("0 0 auto");
    expect(getComputedStyle(frame).minHeight).toBe("0");
  });

  // Sets written by an LLM routinely carry image URLs that 404, and a phone on
  // the venue wifi may not be on the internet at all. Either way the question
  // still has to be answerable, and the screen has to say what happened.
  it("says so and drops the frame when the image fails to load", () => {
    const { container } = render(<QuestionPrompt question={imageQuestion} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.getByText("How many moons does Mars have?")).toBeTruthy();
  });

  // Keyed by URL, so the next question's image still gets its own chance.
  it("retries on the next question's image", () => {
    const { container, rerender } = render(<QuestionPrompt question={imageQuestion} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    rerender(
      <QuestionPrompt
        question={{ ...imageQuestion, id: "q3", media: { imageUrl: "https://example.com/venus.png" } }}
      />,
    );
    expect((container.querySelector("img") as HTMLImageElement).src).toBe(
      "https://example.com/venus.png",
    );
  });
});
