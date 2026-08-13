import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Zoom from "@mui/material/Zoom";
import { getSocket, onReconnect } from "../lib/socket.js";
import { celebrate } from "../lib/celebrate.js";
import { AppIcon } from "../components/AppIcon.js";
import { CountdownRing } from "../components/CountdownRing.js";
import { FuzzyTextAnswerInput } from "../components/FuzzyTextAnswerInput.js";
import { GeoMapInput, type GeoGuess } from "../components/GeoMapInput.js";
import { MultipleChoiceAnswerInput } from "../components/MultipleChoiceAnswerInput.js";
import { NumberAnswerInput } from "../components/NumberAnswerInput.js";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
import { Screen } from "../components/Screen.js";
import type {
  AnswerResult,
  LeaderboardPayload,
  PlayerJoinAck,
  PublicPlayer,
  PublicQuestion,
  QuestionRevealedPayload,
  QuestionShowPayload,
  StateSyncPayload,
} from "../lib/protocol.js";

/**
 * "between" is the reveal seen from a phone that has no result of its own to
 * show - either the player joined late, or they were offline when the reveal
 * event went out. The scores are on the TV, so the phone just says so.
 */
type Phase = "join" | "waiting" | "answering" | "submitted" | "between" | "revealed" | "ended";

function playerIdKey(code: string): string {
  return `quizzinator:player:${code}`;
}

// The name is persisted alongside the id because player:join needs both: it
// is what lets the app re-run the join handshake by itself after a reconnect
// (or a Safari tab reload) without making the player re-type anything.
function playerNameKey(code: string): string {
  return `quizzinator:player-name:${code}`;
}

// The id is public - it is in every leaderboard - so rejoining under it also
// requires this secret, issued in the join ack. Persisted next to the id and
// name so the unattended rejoin above still works after a screen lock.
function playerTokenKey(code: string): string {
  return `quizzinator:player-token:${code}`;
}

// Mobile participant app. One phase fills the screen at a time. The geo
// question type takes over the full screen for its map (see GeoMapInput);
// number and fuzzy-text share the generic centered "screen" layout.
export function PlayView() {
  const { code } = useParams<{ code: string }>();
  const [phase, setPhase] = useState<Phase>("join");
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [question, setQuestion] = useState<QuestionShowPayload | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<QuestionRevealedPayload | null>(null);
  const [ended, setEnded] = useState<LeaderboardPayload | null>(null);
  const [answerValue, setAnswerValue] = useState<string>("");
  const [geoPin, setGeoPin] = useState<GeoGuess | null>(null);

  // Which question the UI is currently built around, so a resync for the
  // question already on screen doesn't wipe a half-dragged slider or pin.
  const shownQuestionId = useRef<string | null>(null);
  const joinRef = useRef<(playerName: string) => void>(() => {});

  useEffect(() => {
    if (!code) return;
    const socket = getSocket();

    // A "play again" restarts the same set, so question ids repeat. Without
    // clearing the id the phone last rendered, showQuestion would treat the
    // replayed question as the one already on screen and keep the previous
    // game's slider position, pin and reveal.
    const forgetCurrentQuestion = () => {
      shownQuestionId.current = null;
      setRevealed(null);
    };

    const showQuestion = (payload: QuestionShowPayload, answered: boolean) => {
      const isNewQuestion = shownQuestionId.current !== payload.question.id;
      shownQuestionId.current = payload.question.id;
      setQuestion(payload);
      setRemainingSec(Math.max(0, Math.round((payload.endsAt - Date.now()) / 1000)));
      if (isNewQuestion) {
        setAnswerValue(defaultAnswerFor(payload.question));
        setGeoPin(null);
        setRevealed(null);
      }
      setPhase(answered ? "submitted" : "answering");
    };

    const applyJoinAck = (data: PlayerJoinAck) => {
      localStorage.setItem(playerIdKey(code), data.playerId);
      localStorage.setItem(playerTokenKey(code), data.playerToken);
      setPlayerId(data.playerId);
      setSessionId(data.sessionId);
      if (data.state === "question" && data.question) {
        showQuestion(data.question, data.answered);
        return;
      }
      if (data.state === "lobby") forgetCurrentQuestion();
      setPhase(data.state === "ended" ? "ended" : data.state === "reveal" ? "between" : "waiting");
    };

    const joinAsPlayer = (playerName: string, allowRetry = true) => {
      const existingPlayerId = localStorage.getItem(playerIdKey(code)) ?? undefined;
      const existingPlayerToken = localStorage.getItem(playerTokenKey(code)) ?? undefined;
      const payload = {
        code,
        name: playerName,
        playerId: existingPlayerId,
        playerToken: existingPlayerToken,
      };
      socket.emit("player:join", payload, (res) => {
        if (!res.ok) {
          // A persisted id whose token no longer matches (storage half-cleared,
          // an id copied between phones). Better to come back as a fresh
          // player than to strand this phone on an error screen mid-party.
          if (res.error === "invalid_player_token" && allowRetry) {
            localStorage.removeItem(playerIdKey(code));
            localStorage.removeItem(playerTokenKey(code));
            joinAsPlayer(playerName, false);
            return;
          }
          setError(res.error);
          return;
        }
        localStorage.setItem(playerNameKey(code), playerName);
        setError(null);
        setOnline(true);
        applyJoinAck(res.data);
      });
    };
    joinRef.current = joinAsPlayer;

    // The heart of the reconnect fix: a reconnected socket is a new socket id
    // the server doesn't associate with this player, so it is no longer in
    // the session's room and receives no further events. Locking an iPhone
    // for a few seconds was enough to trigger exactly that. Re-running the
    // handshake on every connection puts the phone back in the room and, via
    // the ack, back on the right screen. Also covers a reloaded tab.
    const rejoin = () => {
      const storedName = localStorage.getItem(playerNameKey(code));
      if (!storedName) return;
      joinAsPlayer(storedName);
    };
    const stopRejoining = onReconnect(socket, rejoin);

    const onDisconnect = () => setOnline(false);
    const onQuestionShow = (payload: QuestionShowPayload) => {
      showQuestion(payload, false);
    };
    const onTimerTick = (payload: { remainingSec: number }) => {
      setRemainingSec(payload.remainingSec);
    };
    const onRevealed = (payload: QuestionRevealedPayload) => {
      setRevealed(payload);
      setPhase("revealed");
    };
    const onEnded = (payload: LeaderboardPayload) => {
      setEnded(payload);
      setPhase("ended");
    };
    // Safety net for anything missed while backgrounded: the server's view of
    // the session wins. Only acted on when it disagrees with what's on screen,
    // so a routine sync (another player joining) never disturbs this phone.
    const onStateSync = (payload: StateSyncPayload) => {
      if (payload.state === "question" && payload.question) {
        if (shownQuestionId.current !== payload.question.question.id) {
          showQuestion(payload.question, false);
        }
        return;
      }
      if (payload.state === "lobby") forgetCurrentQuestion();
      setPhase((current) => {
        if (payload.state === "ended") return "ended";
        if (payload.state === "reveal") return current === "revealed" ? current : "between";
        if (payload.state === "lobby") return current === "join" ? current : "waiting";
        return current;
      });
    };

    socket.on("disconnect", onDisconnect);
    socket.on("state:sync", onStateSync);
    socket.on("question:show", onQuestionShow);
    socket.on("timer:tick", onTimerTick);
    socket.on("question:revealed", onRevealed);
    socket.on("session:ended", onEnded);

    return () => {
      stopRejoining();
      socket.off("disconnect", onDisconnect);
      socket.off("state:sync", onStateSync);
      socket.off("question:show", onQuestionShow);
      socket.off("timer:tick", onTimerTick);
      socket.off("question:revealed", onRevealed);
      socket.off("session:ended", onEnded);
    };
  }, [code]);

  if (!code) return null;

  const join = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    joinRef.current(trimmed);
  };

  const submitAnswer = (value: unknown) => {
    if (!sessionId || !playerId) return;
    // No playerId on the wire: the server takes it from this socket's join.
    getSocket().emit("answer:submit", { sessionId, value }, (res) => {
      if (res && !res.ok) {
        setError(res.error);
        return;
      }
      setPhase("submitted");
    });
  };

  if (error) {
    return (
      <Screen phaseKey="error">
        <AppIcon name="error" sx={{ fontSize: 64 }} color="error" />
        <Typography color="text.secondary">{error}</Typography>
      </Screen>
    );
  }

  if (phase === "join") {
    return (
      <Screen phaseKey="join">
        <AppIcon name="smartphone" sx={{ fontSize: 64 }} color="primary" />
        <Chip color="secondary" variant="outlined" label={`Join code: ${code}`} sx={{ letterSpacing: "0.1em" }} />
        <TextField
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoFocus
          fullWidth
          onKeyDown={(e) => e.key === "Enter" && join()}
          slotProps={{ htmlInput: { autoComplete: "nickname", enterKeyHint: "go", maxLength: 24 } }}
          sx={{ maxWidth: 340, "& .MuiOutlinedInput-root": { borderRadius: 999, fontSize: "1.25rem" } }}
        />
        <Button size="large" onClick={join} disabled={!name.trim()} startIcon={<AppIcon name="login" />}>
          Join
        </Button>
      </Screen>
    );
  }

  if (phase === "waiting") {
    return (
      <Screen phaseKey="waiting">
        <OfflineChip online={online} />
        <AppIcon name="hourglass_top" sx={{ fontSize: 64 }} color="primary" />
        <Typography variant="h4" color="text.secondary">
          Waiting for the host to start…
        </Typography>
      </Screen>
    );
  }

  if (phase === "answering" && question) {
    if (question.question.type === "geo") {
      return (
        <GeoMapInput
          question={question.question}
          remainingSec={remainingSec ?? question.timeLimitSec}
          pin={geoPin}
          onPick={setGeoPin}
          onSubmit={() => geoPin && submitAnswer(geoPin)}
        />
      );
    }
    // The number slider always has a value; typing and tapping both start empty.
    const canSubmit = question.question.type === "number" || answerValue.trim().length > 0;
    const doSubmit = () => canSubmit && submitAnswer(parseAnswer(question.question, answerValue));
    return (
      // A tighter frame than the other phases: this is the one screen with an
      // image on it, and every pixel of padding is a pixel the picture doesn't get.
      <Screen
        phaseKey={`answering-${question.question.id}`}
        gap={2}
        sx={{ justifyContent: "space-between", px: 2, py: 2 }}
      >
        <Stack alignItems="center" gap={1} sx={{ flex: "0 0 auto" }}>
          <OfflineChip online={online} />
          <CountdownRing
            remainingSec={remainingSec ?? question.timeLimitSec}
            totalSec={question.timeLimitSec}
            size={72}
          />
        </Stack>
        <QuestionPrompt question={question.question} variant="mobile" />
        <Stack alignItems="center" gap={3} sx={{ flex: "0 0 auto", width: "100%" }}>
          <AnswerInput
            question={question.question}
            value={answerValue}
            onChange={setAnswerValue}
            onSubmit={doSubmit}
          />
          <Button size="large" disabled={!canSubmit} onClick={doSubmit} startIcon={<AppIcon name="send" />}>
            Submit
          </Button>
        </Stack>
      </Screen>
    );
  }

  if (phase === "submitted") {
    return (
      <Screen phaseKey="submitted">
        <OfflineChip online={online} />
        <Zoom in appear>
          <Box>
            <AppIcon name="check_circle" sx={{ fontSize: 88 }} color="success" />
          </Box>
        </Zoom>
        <Typography variant="h4">Answer submitted, waiting for other players…</Typography>
      </Screen>
    );
  }

  if (phase === "between") {
    return (
      <Screen phaseKey="between">
        <OfflineChip online={online} />
        <AppIcon name="tv" sx={{ fontSize: 64 }} color="primary" />
        <Typography variant="h4" color="text.secondary">
          Scores are on the big screen…
        </Typography>
      </Screen>
    );
  }

  if (phase === "revealed") {
    const mine = playerId ? revealed?.results.find((r: AnswerResult) => r.playerId === playerId) : undefined;
    const rank = rankOf(revealed?.leaderboard, playerId);
    const scored = (mine?.score ?? 0) > 0;
    return (
      <Screen phaseKey={`revealed-${revealed?.index ?? 0}`}>
        <OfflineChip online={online} />
        {mine?.correct && <Celebration />}
        <Zoom in appear>
          <Box>
            <AppIcon
              name={mine?.correct ? "check_circle" : scored ? "target" : "cancel"}
              sx={{ fontSize: 96 }}
              color={scored ? "success" : "error"}
            />
          </Box>
        </Zoom>
        <Typography variant="h1" sx={{ color: scored ? "secondary.main" : "text.primary" }}>
          {mine ? `+${mine.score} points` : "Waiting for next question…"}
        </Typography>
        {rank && <RankBadge position={rank.position} total={rank.total} />}
      </Screen>
    );
  }

  if (phase === "ended") {
    const mine = ended?.players.find((p) => p.id === playerId);
    const rank = rankOf(ended?.players, playerId);
    return (
      <Screen phaseKey="ended">
        {rank?.position === 1 && <Celebration />}
        <AppIcon name="emoji_events" sx={{ fontSize: 96 }} color="secondary" />
        <Typography variant="h1">Final score: {mine?.score ?? 0}</Typography>
        {rank && <RankBadge position={rank.position} total={rank.total} />}
      </Screen>
    );
  }

  return null;
}

function RankBadge({ position, total }: { position: number; total: number }) {
  return (
    <Chip
      color="primary"
      variant="outlined"
      size="medium"
      icon={<AppIcon name="military_tech" sx={{ fontSize: 22 }} />}
      label={`Rank #${position} of ${total}`}
      className="rank-badge"
      sx={{ fontSize: "1.1rem", height: 44, px: 1 }}
    />
  );
}

/** Tells the player their phone has dropped, so a frozen screen isn't mistaken for a slow host. */
function OfflineChip({ online }: { online: boolean }) {
  if (online) return null;
  return (
    <Chip
      color="warning"
      variant="outlined"
      size="small"
      icon={<AppIcon name="sync_problem" sx={{ fontSize: 18 }} />}
      label="Reconnecting…"
    />
  );
}

/** Confetti, fired once per mount - i.e. once per reveal the player got right. */
function Celebration() {
  useEffect(() => {
    celebrate("big");
  }, []);
  return null;
}

/** This player's 1-based standing within a leaderboard already sorted by score descending. */
function rankOf(
  leaderboard: PublicPlayer[] | undefined,
  playerId: string | null,
): { position: number; total: number } | undefined {
  if (!leaderboard || !playerId) return undefined;
  const index = leaderboard.findIndex((p) => p.id === playerId);
  if (index < 0) return undefined;
  return { position: index + 1, total: leaderboard.length };
}

function defaultAnswerFor(question: PublicQuestion): string {
  if (question.type === "number") return String(Math.round((question.min + question.max) / 2));
  return "";
}

function parseAnswer(question: PublicQuestion, raw: string): unknown {
  // Multiple choice travels as the index of the chosen option, not its text:
  // the server scores against correctIndex, and an index can't be mangled by
  // an option that happens to contain punctuation.
  if (question.type === "number" || question.type === "multiple-choice") return Number(raw);
  return raw;
}

function AnswerInput({
  question,
  value,
  onChange,
  onSubmit,
}: {
  question: PublicQuestion;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  if (question.type === "number") {
    return (
      <NumberAnswerInput
        question={question}
        value={Number(value)}
        onChange={(next) => onChange(String(next))}
      />
    );
  }
  if (question.type === "multiple-choice") {
    return (
      <MultipleChoiceAnswerInput
        question={question}
        value={value === "" ? null : Number(value)}
        onChange={(next) => onChange(String(next))}
      />
    );
  }
  return <FuzzyTextAnswerInput value={value} onChange={onChange} onSubmit={onSubmit} />;
}
