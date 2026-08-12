import type { PublicQuestion } from "../lib/protocol.js";

type NumberQuestion = Extract<PublicQuestion, { type: "number" }>;

export function NumberAnswerInput({
  question,
  value,
  onChange,
}: {
  question: NumberQuestion;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="number-input">
      <span className="material-symbols-rounded number-input__icon">tune</span>
      <div className="number-input__value">{value}</div>
      <input
        className="number-input__slider"
        type="range"
        min={question.min}
        max={question.max}
        step={question.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="number-input__bounds">
        <span>{question.min}</span>
        <span>{question.max}</span>
      </div>
    </div>
  );
}
