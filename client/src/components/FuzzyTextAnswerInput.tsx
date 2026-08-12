// Free-text answer widget for fuzzy-text questions: a single large,
// keyboard-friendly input. Scoring/matching is entirely server-side (see
// server/src/scoring.ts) — this just captures raw text.
export function FuzzyTextAnswerInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <div className="fuzzy-input">
      <span className="material-symbols-rounded fuzzy-input__icon">edit</span>
      <input
        className="fuzzy-input__field"
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="sentences"
        enterKeyHint="done"
        placeholder="Type your answer…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
      />
    </div>
  );
}
