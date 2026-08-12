import type { PublicQuestion } from "../lib/protocol.js";

// Shared by the mobile answer screen and the host/TV question + reveal
// screens (see CLAUDE.md: a question is text-only or image+text, never
// image-only). Falls back to a clean text-only layout when there's no image.
export function QuestionPrompt({ question }: { question: PublicQuestion }) {
  return (
    <div className="question-prompt">
      {question.media?.imageUrl && (
        <img className="question-prompt__image" src={question.media.imageUrl} alt="" />
      )}
      <h1 className="question-prompt__text">{question.prompt}</h1>
    </div>
  );
}
