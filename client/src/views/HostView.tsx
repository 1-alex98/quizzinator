import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSocket } from "../lib/socket.js";
import { GeoRevealMap } from "../components/GeoRevealMap.js";
import { QuestionPrompt } from "../components/QuestionPrompt.js";
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
// with a synced countdown, the reveal, and the leaderboard between
// questions. Phase-specific visual polish lands with the mobile/TV screen
// polish issue; this wires the state machine end to end.
export function HostView() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [error, setError] = useState<string | null>(null);
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

    socket.emit("host:join", { sessionId }, (res) => {
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPhase(res.data.state);
      setPlayers(res.data.players);
      setCode(res.data.code);
      if (res.data.question) {
        setQuestion(res.data.question);
        setRemainingSec(Math.max(0, Math.round((res.data.question.endsAt - Date.now()) / 1000)));
      }
    });

    const onStateSync = (payload: StateSyncPayload) => {
      setPhase(payload.state);
      setPlayers(payload.players);
      setCode(payload.code);
    };
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

    socket.on("state:sync", onStateSync);
    socket.on("question:show", onQuestionShow);
    socket.on("timer:tick", onTimerTick);
    socket.on("question:progress", onProgress);
    socket.on("question:revealed", onRevealed);
    socket.on("session:ended", onEnded);

    return () => {
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
      <div className="screen">
        <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
          error
        </span>
        <h1>Couldn't load session</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="screen">
        <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
          cast
        </span>
        <p>Connecting…</p>
      </div>
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
      <div className="screen">
        <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
          emoji_events
        </span>
        <h1>Final leaderboard</h1>
        <Leaderboard players={ended?.players ?? players} />
      </div>
    );
  }

  if (phase === "question" && question) {
    return (
      <div className="screen">
        <p>
          Question {question.index + 1} / {question.total}
        </p>
        <QuestionPrompt question={question.question} />
        <p className="card">{remainingSec ?? question.timeLimitSec}s left</p>
        {progress && (
          <p>
            {progress.answered} / {progress.total} answered
          </p>
        )}
        <button className="btn" onClick={revealNow}>
          <span className="material-symbols-rounded">visibility</span>
          Reveal now
        </button>
      </div>
    );
  }

  if (phase === "reveal" && revealed && question) {
    return (
      <div className="screen">
        <QuestionPrompt question={question.question} />
        <QuestionRevealDetail question={question.question} revealed={revealed} players={players} />
        <h1>Leaderboard</h1>
        <Leaderboard players={revealed.leaderboard} />
        <button className="btn" onClick={nextQuestion}>
          <span className="material-symbols-rounded">skip_next</span>
          Next question
        </button>
      </div>
    );
  }

  return (
    <div className="screen">
      <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
        cast
      </span>
      <h1>Join at {joinUrl}</h1>
      <p className="card">Code: {code}</p>
      <p>
        {players.length} player{players.length === 1 ? "" : "s"} joined
      </p>
      <ul>
        {players.map((p) => (
          <li key={p.id}>
            {p.name} {p.connected ? "" : "(disconnected)"}
          </li>
        ))}
      </ul>
      <button className="btn" onClick={startQuiz}>
        <span className="material-symbols-rounded">play_arrow</span>
        Start quiz
      </button>
      <button className="btn" onClick={endQuiz}>
        End quiz
      </button>
    </div>
  );
}

function Leaderboard({ players }: { players: PublicPlayer[] }) {
  return (
    <ol>
      {players.map((p) => (
        <li key={p.id}>
          {p.name} — {p.score}
        </li>
      ))}
    </ol>
  );
}

// Per-type "correct answer" display for the reveal phase: fuzzy-text has no
// widget of its own yet (lands with issue #3), so it falls through to just
// the leaderboard.
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

  if (question.type === "number") {
    const correct = revealed.correctAnswer as { correctValue: number };
    return (
      <div className="card reveal-number">
        <p className="reveal-number__answer">Correct answer: {correct.correctValue}</p>
        <ul className="reveal-number__list">
          {revealed.results.map((result: AnswerResult) => (
            <li key={result.playerId}>
              {nameFor(result.playerId)}: {String(result.value)} — +{result.score}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}
