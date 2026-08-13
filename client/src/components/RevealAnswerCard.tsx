import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import { AppIcon } from "./AppIcon.js";
import { MAX_VISIBLE_PLAYERS } from "./Leaderboard.js";
import type { AnswerResult, PublicPlayer, PublicQuestion, QuestionRevealedPayload } from "../lib/protocol.js";

// The "here's what it was, here's what you all said" surface on the TV.
//
// This replaces a hand-formatted "Name: guess — +score" string per row: the
// three pieces are different kinds of information (who, what they said, what
// it was worth) and a dash between them made them one undifferentiated line
// at TV distance. As a Material list they get their own slots - name as the
// primary text, guess as secondary, points as a trailing chip - so the eye can
// scan one column at a time.

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Every question type except geo, which reveals on a map instead of in a
 * card - excluded at the type level so the branches below stay total.
 */
type CardQuestion = Exclude<PublicQuestion, { type: "geo" }>;

/** The answer itself, headlined above the per-player rows. */
function CorrectAnswer({ question, correctAnswer }: { question: CardQuestion; correctAnswer: unknown }) {
  if (question.type === "fuzzy-text") {
    const { acceptedAnswers } = correctAnswer as { acceptedAnswers: string[] };
    return (
      <>
        <Label>{acceptedAnswers.length > 1 ? "Accepted answers" : "Accepted answer"}</Label>
        <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
          {acceptedAnswers.map((accepted) => (
            <Chip key={accepted} color="success" variant="outlined" label={accepted} sx={{ fontSize: "1.05rem", height: 38 }} />
          ))}
        </Stack>
      </>
    );
  }

  const text =
    question.type === "number"
      ? String((correctAnswer as { correctValue: number }).correctValue)
      : formatChoice(
          (correctAnswer as { correctIndex: number }).correctIndex,
          (correctAnswer as { correctOption: string }).correctOption,
        );

  return (
    <>
      <Label>Correct answer</Label>
      <Typography variant="h3" sx={{ color: "success.main", textAlign: "left", textWrap: "balance" }}>
        {text}
      </Typography>
    </>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="overline"
      component="p"
      sx={{ color: "text.secondary", letterSpacing: "0.16em", lineHeight: 1.4 }}
    >
      {children}
    </Typography>
  );
}

function formatChoice(index: number, option: string): string {
  return `${LETTERS[index] ?? index + 1}. ${option}`;
}

/** What a player actually submitted, in the terms of the question they answered. */
function formatGuess(question: CardQuestion, result: AnswerResult): string {
  if (result.value === null || result.value === undefined || result.value === "") return "No answer";
  switch (question.type) {
    case "multiple-choice": {
      const index = Number(result.value);
      const option = question.options[index];
      return option === undefined ? String(result.value) : formatChoice(index, option);
    }
    case "fuzzy-text":
      return `“${String(result.value)}”`;
    default:
      return String(result.value);
  }
}

export function RevealAnswerCard({
  question,
  revealed,
  players,
}: {
  question: CardQuestion;
  revealed: QuestionRevealedPayload;
  players: PublicPlayer[];
}) {
  const nameFor = (playerId: string) => players.find((p) => p.id === playerId)?.name ?? "Player";
  // Best guesses first: the room cares who got closest, and it means the rows
  // that survive the truncation below are the ones worth showing.
  const ranked = [...revealed.results].sort((a, b) => b.score - a.score);
  const visible = ranked.slice(0, MAX_VISIBLE_PLAYERS);
  const hidden = ranked.length - visible.length;

  return (
    <Paper elevation={6} className="reveal-answer" sx={{ width: "100%", overflow: "hidden", textAlign: "left" }}>
      <Stack
        direction="row"
        alignItems="center"
        gap={2}
        sx={{
          p: { xs: 2, sm: 2.5 },
          bgcolor: (t: Theme) => alpha(t.palette.success.main, 0.12),
        }}
      >
        <Box
          aria-hidden
          sx={{
            flex: "0 0 auto",
            display: "grid",
            placeItems: "center",
            width: 56,
            height: 56,
            borderRadius: "50%",
            bgcolor: (t: Theme) => alpha(t.palette.success.main, 0.2),
          }}
        >
          <AppIcon name="check" sx={{ color: "success.main", fontSize: 32 }} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <CorrectAnswer question={question} correctAnswer={revealed.correctAnswer} />
        </Box>
      </Stack>

      <Divider />

      <List dense disablePadding>
        {visible.map((result) => (
          <ListItem
            key={result.playerId}
            divider
            sx={{ px: { xs: 1.5, sm: 2.5 }, py: 1, opacity: result.score > 0 ? 1 : 0.65 }}
            secondaryAction={
              <Chip
                size="small"
                label={`+${result.score}`}
                color={result.score > 0 ? "secondary" : "default"}
                variant={result.score > 0 ? "filled" : "outlined"}
                sx={{ fontVariantNumeric: "tabular-nums" }}
              />
            }
          >
            <ListItemAvatar sx={{ minWidth: 44 }}>
              <AppIcon
                name={result.correct ? "check_circle" : result.score > 0 ? "target" : "cancel"}
                sx={{ fontSize: 28 }}
                color={result.correct ? "success" : result.score > 0 ? "secondary" : "disabled"}
              />
            </ListItemAvatar>
            <ListItemText
              primary={nameFor(result.playerId)}
              secondary={formatGuess(question, result)}
              slotProps={{
                primary: { noWrap: true, sx: { fontWeight: 600, fontSize: "clamp(1rem, 1.5vw, 1.25rem)" } },
                secondary: { noWrap: true, sx: { fontSize: "clamp(0.9rem, 1.3vw, 1.1rem)" } },
              }}
            />
          </ListItem>
        ))}
        {hidden > 0 && (
          <ListItem sx={{ px: { xs: 1.5, sm: 2.5 }, py: 1 }}>
            <ListItemText
              className="list-more"
              primary={`+${hidden} more player${hidden === 1 ? "" : "s"}`}
              slotProps={{ primary: { sx: { color: "text.secondary", fontStyle: "italic" } } }}
            />
          </ListItem>
        )}
      </List>
    </Paper>
  );
}
