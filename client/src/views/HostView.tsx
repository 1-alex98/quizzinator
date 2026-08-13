import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Grow from "@mui/material/Grow";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getSocket, onReconnect } from "../lib/socket.js";
import { celebrate } from "../lib/celebrate.js";
import { AppIcon } from "../components/AppIcon.js";
import { CountdownRing } from "../components/CountdownRing.js";
import { GeoRevealMap } from "../components/GeoRevealMap.js";
import { Leaderboard, MAX_VISIBLE_PLAYERS } from "../components/Leaderboard.js";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import { Screen } from "../components/Screen.js";
import type {
  AnswerResult,
  LeaderboardPayload,
  PublicPlayer,
  PublicQuestion,
  QuestionProgressPayload,
  QuestionRevealedPayload,
  QuestionShowPayload,
  SessionState,
  StateSyncPayload,
} from "../lib/protocol.js";

// Big-screen view: lobby (join link/code + player list), the live question
// with a synced countdown, the reveal (per-type correct answer + a
// per-question leaderboard delta), and the final leaderboard.

function hostTokenKey(sessionId: string): string {
  return `quizzinator:host-token:${sessionId}`;
}

export function HostView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [phase, setPhase] = useState<SessionState | "loading">("loading");
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [code, setCode] = useState<string>("");
  const [question, setQuestion] = useState<QuestionShowPayload | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [progress, setProgress] = useState<QuestionProgressPayload | null>(null);
  const [revealed, setRevealed] = useState<QuestionRevealedPayload | null>(null);
  const [ended, setEnded] = useState<LeaderboardPayload | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const socket = getSocket();
    const hostToken = sessionStorage.getItem(hostTokenKey(sessionId)) ?? "";

    const applySync = (data: StateSyncPayload) => {
      setPhase(data.state);
      setPlayers(data.players);
      setCode(data.code);
      if (data.question) {
        setQuestion(data.question);
        setRemainingSec(Math.max(0, Math.round((data.question.endsAt - Date.now()) / 1000)));
      }
    };

    // Re-run the handshake on every (re)connection, not just on mount: a
    // reconnect gives us a brand new socket id, which the server does not yet
    // know is the host - without this the TV silently stops receiving events
    // after the laptop sleeps or the wifi blips.
    const joinAsHost = () => {
      socket.emit("host:join", { sessionId, hostToken }, (res) => {
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setError(null);
        setOnline(true);
        applySync(res.data);
      });
    };
    const stopRejoining = onReconnect(socket, joinAsHost);

    const onDisconnect = () => setOnline(false);
    const onStateSync = (payload: StateSyncPayload) => applySync(payload);
    const onQuestionShow = (payload: QuestionShowPayload) => {
      setPhase("question");
      setQuestion(payload);
      setRemainingSec(payload.timeLimitSec);
      setProgress(null);
      setRevealed(null);
    };
    const onTimerTick = (payload: { remainingSec: number }) => {
      setRemainingSec(payload.remainingSec);
    };
    const onProgress = (payload: QuestionProgressPayload) => {
      setProgress(payload);
    };
    const onRevealed = (payload: QuestionRevealedPayload) => {
      setPhase("reveal");
      setRevealed(payload);
      setPlayers(payload.leaderboard);
    };
    const onEnded = (payload: LeaderboardPayload) => {
      setPhase("ended");
      setEnded(payload);
      setPlayers(payload.players);
    };

    socket.on("disconnect", onDisconnect);
    socket.on("state:sync", onStateSync);
    socket.on("question:show", onQuestionShow);
    socket.on("timer:tick", onTimerTick);
    socket.on("question:progress", onProgress);
    socket.on("question:revealed", onRevealed);
    socket.on("session:ended", onEnded);

    return () => {
      stopRejoining();
      socket.off("disconnect", onDisconnect);
      socket.off("state:sync", onStateSync);
      socket.off("question:show", onQuestionShow);
      socket.off("timer:tick", onTimerTick);
      socket.off("question:progress", onProgress);
      socket.off("question:revealed", onRevealed);
      socket.off("session:ended", onEnded);
    };
  }, [sessionId]);

  if (!sessionId) return null;

  if (error) {
    return (
      <Screen phaseKey="error">
        <AppIcon name="error" sx={{ fontSize: 72 }} color="error" />
        <Typography variant="h2">Couldn't load session</Typography>
        <Typography color="text.secondary">{error}</Typography>
      </Screen>
    );
  }

  if (phase === "loading") {
    return (
      <Screen phaseKey="loading">
        <AppIcon name="cast" sx={{ fontSize: 72 }} color="primary" />
        <Typography color="text.secondary">Connecting…</Typography>
      </Screen>
    );
  }

  const joinUrl = `${window.location.origin}/play/${code}`;

  const startQuiz = () => {
    getSocket().emit("session:start", { sessionId }, (res) => {
      if (!res.ok) setError(res.error);
    });
  };
  const revealNow = () => getSocket().emit("question:reveal", { sessionId });
  const nextQuestion = () => getSocket().emit("question:next", { sessionId });
  const endQuiz = () => getSocket().emit("session:end", { sessionId });

  if (phase === "ended") {
    return (
      <Screen phaseKey="ended" gap={2}>
        <ConnectionWarning online={online} />
        <AppIcon name="emoji_events" sx={{ fontSize: 72 }} color="secondary" />
        <Typography variant="h1">Final leaderboard</Typography>
        <Box sx={{ width: "min(100%, 720px)" }}>
          <Leaderboard players={ended?.players ?? players} />
        </Box>
        <FinalCelebration />
      </Screen>
    );
  }

  const revealDeltas =
    revealed && new Map(revealed.results.map((result) => [result.playerId, result.score]));

  if (phase === "question" && question) {
    const answeredFraction =
      progress && progress.total > 0 ? (progress.answered / progress.total) * 100 : 0;
    return (
      <Screen phaseKey={`question-${question.index}`} gap={2} sx={{ justifyContent: "space-between" }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ width: "100%" }}>
          <Chip
            color="primary"
            variant="outlined"
            label={`Question ${question.index + 1} / ${question.total}`}
          />
          <ConnectionWarning online={online} />
          <CountdownRing
            remainingSec={remainingSec ?? question.timeLimitSec}
            totalSec={question.timeLimitSec}
          />
        </Stack>

        <QuestionPrompt question={question.question} variant="host" />

        <Stack alignItems="center" gap={1.5} sx={{ width: "min(100%, 640px)" }}>
          {progress && (
            <>
              <Typography color="text.secondary">
                {progress.answered} / {progress.total} answered
              </Typography>
              <LinearProgress
                variant="determinate"
                value={answeredFraction}
                color="secondary"
                sx={{ width: "100%" }}
              />
            </>
          )}
          <Button onClick={revealNow} startIcon={<AppIcon name="visibility" />}>
            Reveal now
          </Button>
        </Stack>
      </Screen>
    );
  }

  if (phase === "reveal" && revealed && question) {
    return (
      <Screen phaseKey={`reveal-${revealed.index}`} gap={2} sx={{ justifyContent: "space-between" }}>
        <Typography variant="h3">{question.question.prompt}</Typography>
        {/* Side by side on a TV, stacked on anything narrower: the correct
            answer and the standings are both "what everyone looks at now". */}
        <Stack
          direction={{ xs: "column", md: "row" }}
          gap={3}
          alignItems="center"
          justifyContent="center"
          sx={{ width: "100%", minHeight: 0, flex: 1 }}
        >
          <Box sx={{ flex: 1, maxWidth: 680, width: "100%" }}>
            <QuestionRevealDetail question={question.question} revealed={revealed} players={players} />
          </Box>
          <Box sx={{ flex: 1, maxWidth: 680, width: "100%" }}>
            <Typography variant="h4" sx={{ mb: 1.5 }}>
              Leaderboard
            </Typography>
            <Leaderboard players={revealed.leaderboard} deltas={revealDeltas ?? undefined} />
          </Box>
        </Stack>
        <Button size="large" onClick={nextQuestion} startIcon={<AppIcon name="skip_next" />}>
          Next question
        </Button>
      </Screen>
    );
  }

  return (
    <Screen phaseKey="lobby" gap={2} sx={{ justifyContent: "space-between" }}>
      <Stack alignItems="center" gap={1}>
        <ConnectionWarning online={online} />
        <Typography variant="h2">Join the quiz</Typography>
        <Typography color="text.secondary">{joinUrl}</Typography>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} gap={4} alignItems="center" justifyContent="center">
        <Paper className="join-qr" elevation={8} sx={{ p: 2, lineHeight: 0, bgcolor: "#ffffff" }}>
          <QRCodeSVG value={joinUrl} size={220} marginSize={2} />
        </Paper>
        <Stack alignItems="center" gap={0.5}>
          <Typography color="text.secondary" sx={{ letterSpacing: "0.18em", textTransform: "uppercase" }}>
            Code
          </Typography>
          <Typography
            variant="h1"
            sx={{ letterSpacing: "0.18em", color: "secondary.main", fontVariantNumeric: "tabular-nums" }}
          >
            {code}
          </Typography>
        </Stack>
      </Stack>

      <Stack alignItems="center" gap={2} sx={{ width: "100%", minHeight: 0 }}>
        <Typography color="text.secondary">
          {players.length} player{players.length === 1 ? "" : "s"} joined
        </Typography>
        <PlayerChips players={players} />
        <Stack direction="row" gap={2} alignItems="center">
          <Button size="large" onClick={startQuiz} startIcon={<AppIcon name="play_arrow" />}>
            Start quiz
          </Button>
          <Button variant="text" color="inherit" onClick={endQuiz}>
            End quiz
          </Button>
        </Stack>
      </Stack>
    </Screen>
  );
}

/** Lobby roster. Truncated like the leaderboard so a full room can't overflow the no-scroll screen. */
function PlayerChips({ players }: { players: PublicPlayer[] }) {
  const visible = players.slice(0, MAX_VISIBLE_PLAYERS);
  const hidden = players.length - visible.length;
  return (
    <Box
      component="ul"
      className="player-list"
      sx={{
        listStyle: "none",
        m: 0,
        p: 0,
        display: "flex",
        flexWrap: "wrap",
        gap: 1,
        justifyContent: "center",
      }}
    >
      {visible.map((p, index) => (
        <Grow in key={p.id} timeout={280} style={{ transitionDelay: `${Math.min(index, 8) * 40}ms` }}>
          <Box component="li">
            <Chip
              label={p.name}
              color={p.connected ? "primary" : "default"}
              variant={p.connected ? "filled" : "outlined"}
              sx={{ opacity: p.connected ? 1 : 0.5 }}
              icon={<AppIcon name={p.connected ? "person" : "wifi_off"} sx={{ fontSize: 20 }} />}
            />
          </Box>
        </Grow>
      ))}
      {hidden > 0 && (
        <Box component="li" className="list-more" sx={{ alignSelf: "center", opacity: 0.7 }}>
          <Typography component="span" fontStyle="italic">
            +{hidden} more
          </Typography>
        </Box>
      )}
    </Box>
  );
}

/** Surfaces a dropped socket on the TV, since the room can't tell a frozen screen from a live one. */
function ConnectionWarning({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <Chip
      color="warning"
      variant="outlined"
      icon={<AppIcon name="sync_problem" sx={{ fontSize: 20 }} />}
      label="Reconnecting…"
    />
  );
}

/** Fires once when the final leaderboard appears - the moment the room cheers. */
function FinalCelebration() {
  useEffect(() => {
    celebrate("big");
  }, []);
  return null;
}

// Per-type "correct answer" display for the reveal phase.
function QuestionRevealDetail({
  question,
  revealed,
  players,
}: {
  question: PublicQuestion;
  revealed: QuestionRevealedPayload;
  players: PublicPlayer[];
}) {
  const nameFor = (playerId: string) => players.find((p) => p.id === playerId)?.name ?? "Player";

  if (question.type === "geo") {
    const correct = revealed.correctAnswer as { correctLat: number; correctLng: number };
    const playerNames = new Map(players.map((p) => [p.id, p.name]));
    return (
      <GeoRevealMap
        correctLat={correct.correctLat}
        correctLng={correct.correctLng}
        results={revealed.results}
        playerNames={playerNames}
      />
    );
  }

  const answerText =
    question.type === "number"
      ? `Correct answer: ${(revealed.correctAnswer as { correctValue: number }).correctValue}`
      : formatAcceptedAnswers(revealed.correctAnswer as { acceptedAnswers: string[] });

  return (
    <Paper
      elevation={6}
      className={question.type === "number" ? "reveal-number" : "reveal-fuzzy"}
      sx={{ p: 3, width: "100%", textAlign: "left" }}
    >
      <Typography variant="h4" sx={{ color: "success.main", mb: 2 }}>
        {answerText}
      </Typography>
      <Stack component="ul" gap={0.5} sx={{ listStyle: "none", m: 0, p: 0 }}>
        {revealed.results.slice(0, MAX_VISIBLE_PLAYERS).map((result: AnswerResult) => (
          <Stack
            component="li"
            key={result.playerId}
            direction="row"
            gap={1}
            alignItems="center"
            justifyContent="space-between"
          >
            <Typography noWrap sx={{ opacity: result.score > 0 ? 1 : 0.55 }}>
              {`${nameFor(result.playerId)}: ${formatGuess(result.value)} — +${result.score}`}
            </Typography>
            {result.correct && <AppIcon name="check_circle" color="success" sx={{ fontSize: 20 }} />}
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

function formatAcceptedAnswers(correct: { acceptedAnswers: string[] }): string {
  const label = correct.acceptedAnswers.length > 1 ? "Accepted answers" : "Accepted answer";
  return `${label}: ${correct.acceptedAnswers.join(", ")}`;
}

function formatGuess(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(no answer)";
  return String(value);
}
