import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
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
    <Stack alignItems="center" gap={1} sx={{ width: "100%", maxWidth: 360 }}>
      <Typography
        component="div"
        sx={{ color: "secondary.main", fontSize: "3rem", fontWeight: 700, lineHeight: 1.1 }}
      >
        {value}
      </Typography>
      <Slider
        value={value}
        min={question.min}
        max={question.max}
        step={question.step}
        // No value-label bubble: on a phone it sits under the finger that's
        // dragging, and the big number above already reads the value out.
        valueLabelDisplay="off"
        // Thumb/track are oversized on purpose: this is dragged with a thumb,
        // in a dim room, often while the timer is running out.
        sx={{
          height: 12,
          "& .MuiSlider-thumb": { width: 30, height: 30 },
        }}
        onChange={(_event, next) => onChange(Array.isArray(next) ? next[0] : next)}
      />
      <Stack direction="row" justifyContent="space-between" sx={{ width: "100%" }}>
        <Typography variant="body2" color="text.secondary">
          {question.min}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {question.max}
        </Typography>
      </Stack>
    </Stack>
  );
}
