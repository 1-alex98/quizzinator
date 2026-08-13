import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { styled } from "@mui/material/styles";
import { AppIcon } from "../components/AppIcon.js";
import {
  CopyPromptButton,
  GeminiPromptButton,
  useQuestionSetSchema,
} from "../components/QuestionFormatActions.js";
import { Screen } from "../components/Screen.js";
import { TEST_QUESTION_SET } from "../lib/testQuestionSet.js";

// Off-screen rather than `display: none` so the input keeps its accessible
// name and stays focusable via the wrapping <Button component="label">.
const HiddenFileInput = styled("input")({
  clipPath: "inset(50%)",
  position: "absolute",
  bottom: 0,
  left: 0,
  height: 1,
  width: 1,
  overflow: "hidden",
  whiteSpace: "nowrap",
});

// Picks or uploads a question set, then immediately creates a session,
// attaches the set, and redirects to the host lobby - one click from the
// front page through to a shareable /play/:code link, no intermediate
// "session created, now what" step (see CLAUDE.md -> "Entry flow").
export function AdminView() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [topic, setTopic] = useState("");
  // Loaded up front so the Gemini link is a real href by the time it's
  // clicked - a popup opened from an async callback gets blocked.
  const { schema } = useQuestionSetSchema();

  const hostWithQuestionSet = async (questionSet: unknown) => {
    const sessionRes = await fetch("/api/sessions", { method: "POST" });
    if (!sessionRes.ok) throw new Error("Could not create the session.");
    const session = (await sessionRes.json()) as { id: string; hostToken: string };

    const setRes = await fetch(`/api/sessions/${session.id}/question-set`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(questionSet),
    });
    if (!setRes.ok) {
      // The endpoint spells out which field of which question is wrong; that
      // detail is the whole value of pasting JSON straight from a chat.
      const body = (await setRes.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "Could not attach the question set.");
    }

    // Kept in sessionStorage (not the URL/query string) so it isn't shown on
    // screen, logged by proxies, or left in browser history - host:join
    // requires it, so only whoever created this session can take control.
    sessionStorage.setItem(`quizzinator:host-token:${session.id}`, session.hostToken);
    navigate(`/host/${session.id}`);
  };

  const startTestQuiz = async () => {
    setError(null);
    setStarting(true);
    try {
      await hostWithQuestionSet(TEST_QUESTION_SET);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStarting(false);
    }
  };

  const onFileChosen = async (file: File) => {
    setError(null);
    setStarting(true);
    setFileName(file.name);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/question-sets", { method: "POST", body: formData });
      const uploadBody = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) {
        throw new Error(uploadBody?.message ?? "Could not read that question set.");
      }
      await hostWithQuestionSet(uploadBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStarting(false);
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onJsonPasted = async (raw: string) => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Chat UIs love to wrap JSON in ``` fences; say so rather than echoing
      // a parser error about an unexpected token.
      setError("That isn't valid JSON. Paste the object only - no ``` fences or surrounding text.");
      return;
    }
    setPasteOpen(false);
    setStarting(true);
    try {
      await hostWithQuestionSet(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStarting(false);
    }
  };

  return (
    // Unlike the game phases this screen is a form and can outgrow a short
    // viewport, so it scrolls instead of clipping.
    <Screen phaseKey="admin" gap={3} sx={{ overflowY: "auto" }}>
      <Box>
        <Typography variant="h2" component="h1">
          Host a quiz
        </Typography>
        <Typography variant="h4" component="p" sx={{ color: "text.secondary", fontWeight: 400, mt: 1 }}>
          Pick a question set to get a join code on screen.
        </Typography>
      </Box>

      <Stack
        direction={{ xs: "column", md: "row" }}
        gap={2}
        alignItems="stretch"
        sx={{ width: "100%", maxWidth: 1040 }}
      >
        <OptionCard
          icon="upload_file"
          title="Upload a question set"
          description="A .json file, or a .zip with its images alongside."
        >
          {/* MUI's file-input pattern: the real input stays in the DOM (and
              keeps its label for assistive tech) but is hidden behind the
              button that wraps it. */}
          <Button component="label" disabled={starting} startIcon={<AppIcon name="folder_open" />}>
            Choose file
            <HiddenFileInput
              ref={fileInputRef}
              type="file"
              accept=".json,.zip"
              disabled={starting}
              aria-label="Question set file"
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const file = e.target.files?.[0];
                if (file) onFileChosen(file);
              }}
            />
          </Button>
          {fileName && (
            <Typography variant="body2" sx={{ color: "secondary.main", wordBreak: "break-all" }}>
              {fileName}
            </Typography>
          )}
        </OptionCard>

        {/* Straight from an LLM chat window, where the JSON is text on screen
            and saving it to a file first is pure friction. */}
        <OptionCard
          icon="content_paste"
          title="Paste JSON"
          description="Copied a question set out of a chat? Paste it here - no file needed."
        >
          <Button disabled={starting} onClick={() => setPasteOpen(true)} startIcon={<AppIcon name="content_paste" />}>
            Paste JSON
          </Button>
        </OptionCard>

        <OptionCard
          icon="science"
          title="Try it out"
          description="A built-in four-question set - one of each question type."
        >
          <Button
            color="secondary"
            disabled={starting}
            onClick={startTestQuiz}
            startIcon={starting ? <CircularProgress size={20} color="inherit" /> : <AppIcon name="science" />}
          >
            {starting ? "Starting…" : "Start quiz with test data"}
          </Button>
        </OptionCard>
      </Stack>

      {/* Nobody has a question set the first time they land here. This turns
          "I have nothing" into a two-click path: generate, then paste back. */}
      <Paper
        elevation={0}
        sx={{ width: "100%", maxWidth: 1040, p: 2.5, border: 1, borderColor: "divider" }}
      >
        <Stack gap={2} alignItems="center">
          <Typography variant="h4" component="h2">
            Don&rsquo;t have one? Have an AI write it
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            The prompt carries the question format, so the JSON that comes back can be pasted straight into the box
            above.
          </Typography>
          <TextField
            size="small"
            label="Quiz topic (optional)"
            placeholder="e.g. 90s music, or our team"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            sx={{ width: "min(100%, 380px)" }}
          />
          <Stack direction={{ xs: "column", sm: "row" }} gap={1.5} flexWrap="wrap" justifyContent="center">
            <GeminiPromptButton schema={schema} topic={topic.trim() || undefined} />
            <CopyPromptButton topic={topic.trim() || undefined} />
            <Button
              component={RouterLink}
              to="/docs/question-format"
              variant="text"
              color="inherit"
              startIcon={<AppIcon name="help" />}
            >
              Format docs
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Box sx={{ width: "100%", maxWidth: 1040, minHeight: 10 }}>
        {starting && <LinearProgress color="secondary" />}
      </Box>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ width: "100%", maxWidth: 1040, textAlign: "left" }}>
          {error}
        </Alert>
      )}

      <PasteJsonDialog open={pasteOpen} onClose={() => setPasteOpen(false)} onSubmit={onJsonPasted} />
    </Screen>
  );
}

function PasteJsonDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (raw: string) => void;
}) {
  const [raw, setRaw] = useState("");
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Paste a question set</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          The JSON object itself - the one starting with <code>{"{"}</code> and ending with <code>{"}"}</code>.
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={12}
          maxRows={20}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={'{\n  "id": "my-quiz",\n  "title": "My Quiz",\n  "questions": [ … ]\n}'}
          slotProps={{
            htmlInput: {
              spellCheck: false,
              autoCapitalize: "off",
              autoCorrect: "off",
              style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.9rem" },
            },
          }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button variant="text" color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!raw.trim()} onClick={() => onSubmit(raw)} startIcon={<AppIcon name="play_arrow" />}>
          Start quiz
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function OptionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        p: 3,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1.5,
        border: 1,
        borderColor: "divider",
      }}
    >
      <AppIcon name={icon} color="primary" sx={{ fontSize: "2.75rem" }} />
      <Typography variant="h4" component="h2">
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", flexGrow: 1 }}>
        {description}
      </Typography>
      {children}
    </Paper>
  );
}
