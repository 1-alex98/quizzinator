import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { PublicQuestion } from "../lib/protocol.js";

type MultipleChoiceQuestion = Extract<PublicQuestion, { type: "multiple-choice" }>;

// A, B, C… labels so the room can talk about "B" without reading the whole
// option out, and so the tap target has something to anchor on at a glance.
const LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Pick-then-submit rather than submit-on-tap: the first submission for a
 * player is final (the server ignores the rest), so a stray thumb landing on
 * the wrong option while the phone is being raised would otherwise be the
 * answer. The selected option is held by PlayView like every other answer
 * type, which is what lets a mid-question reconnect restore it.
 */
export function MultipleChoiceAnswerInput({
  question,
  value,
  onChange,
}: {
  question: MultipleChoiceQuestion;
  /** Index of the selected option, or null when nothing is picked yet. */
  value: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <ToggleButtonGroup
      exclusive
      orientation="vertical"
      value={value}
      onChange={(_event, next: number | null) => {
        // MUI hands back null when the selected button is tapped again;
        // deselecting would just leave the player with nothing to submit.
        if (next !== null) onChange(next);
      }}
      // Sized against the viewport height, not in fixed pixels: six options
      // plus a countdown, a prompt and a submit button leave a small phone
      // with nothing for the question's image (see QuestionPrompt). Every
      // clamp bottoms out above the ~44px minimum tap target, so the options
      // give up padding on a short screen rather than tappability - and the
      // picture keeps a usable slot.
      sx={{ width: "100%", maxWidth: 420, gap: "clamp(6px, 1.2vh, 12px)" }}
    >
      {question.options.map((option, index) => (
        <ToggleButton
          key={option}
          value={index}
          sx={{
            justifyContent: "flex-start",
            gap: 1.5,
            px: 2,
            py: "clamp(6px, 1.1vh, 12px)",
            minHeight: 44,
            border: 1,
            borderColor: "divider",
            borderRadius: 3,
            textTransform: "none",
            // Every button keeps its own rounded shape: the group's default is
            // to square off the inner edges into one welded column.
            "&:not(:first-of-type)": { borderRadius: 3, borderTop: 1, borderTopColor: "divider", mt: 0 },
            "&.Mui-selected": {
              bgcolor: "primary.main",
              color: "primary.contrastText",
              borderColor: "primary.main",
              "&:hover": { bgcolor: "primary.main" },
            },
          }}
        >
          <Stack
            aria-hidden
            sx={{
              flex: "0 0 auto",
              display: "grid",
              placeItems: "center",
              width: "clamp(28px, 4.4vh, 34px)",
              height: "clamp(28px, 4.4vh, 34px)",
              borderRadius: "50%",
              bgcolor: "background.default",
              color: "text.primary",
              fontWeight: 700,
            }}
          >
            {LETTERS[index] ?? index + 1}
          </Stack>
          <Typography
            sx={{
              textAlign: "left",
              fontSize: "clamp(1rem, 2.1vh, 1.15rem)",
              fontWeight: 600,
              lineHeight: 1.25,
            }}
          >
            {option}
          </Typography>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
