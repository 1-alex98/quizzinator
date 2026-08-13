import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import { AppIcon } from "./AppIcon.js";

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
    <TextField
      fullWidth
      placeholder="Type your answer…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
      sx={{ maxWidth: 380 }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <AppIcon name="edit" color="secondary" />
            </InputAdornment>
          ),
          sx: { borderRadius: 999, fontSize: "1.35rem", py: 1, pl: 2.5 },
        },
        // Phone keyboards: sentence case for names/titles, but no
        // autocorrect/autocomplete second-guessing a quiz answer.
        htmlInput: {
          inputMode: "text",
          autoComplete: "off",
          autoCorrect: "off",
          autoCapitalize: "sentences",
          enterKeyHint: "done",
        },
      }}
    />
  );
}
