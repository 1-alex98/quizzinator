import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSocket } from "../lib/socket.js";
import type {
  AnswerResult,
  LeaderboardPayload,
  PublicQuestion,
  QuestionRevealedPayload,
  QuestionShowPayload,
} from "../lib/protocol.js";

type Phase = "join" | "waiting" | "answering" | "submitted" | "revealed" | "ended";

function storageKey(code: string): string {
  return `quizzinator:player:${code}`;
}

// Mobile participant app. One phase fills the screen at a time; the
// type-specific answer widgets here (plain range/number/text inputs) are
// deliberately minimal — the slider/map/fuzzy-text polish lands with their
// respective question-type issues.
export function PlayView() {
  const { code } = useParams<{ code: string }>();
  const [phase, setPhase] = useState<Phase>("join");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [question, setQuestion] = useState<QuestionShowPayload | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<QuestionRevealedPayload | null>(null);
  const [ended, setEnded] = useState<LeaderboardPayload | null>(null);
  const [answerValue, setAnswerValue] = useState<string>("");

  useEffect(() => {
    if (!code) return;
    const socket = getSocket();

    const onQuestionShow = (payload: QuestionShowPayload) => {
      setQuestion(payload);
      setRemainingSec(payload.timeLimitSec);
      setAnswerValue(defaultAnswerFor(payload.question));
      setRevealed(null);
      setPhase("answering");
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

    socket.on("question:show", onQuestionShow);
    socket.on("timer:tick", onTimerTick);
    socket.on("question:revealed", onRevealed);
    socket.on("session:ended", onEnded);

    return () => {
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
    const existingPlayerId = localStorage.getItem(storageKey(code)) ?? undefined;
    getSocket().emit("player:join", { code, name: trimmed, playerId: existingPlayerId }, (res) => {
      if (!res.ok) {
        setError(res.error);
        return;
      }
      localStorage.setItem(storageKey(code), res.data.playerId);
      setPlayerId(res.data.playerId);
      setSessionId(res.data.sessionId);
      setPhase(res.data.state === "question" ? "answering" : res.data.state === "reveal" ? "revealed" : "waiting");
    });
  };

  const submitAnswer = () => {
    if (!sessionId || !playerId || !question) return;
    const value = parseAnswer(question.question, answerValue);
    getSocket().emit("answer:submit", { sessionId, playerId, value }, (res) => {
      if (res && !res.ok) {
        setError(res.error);
        return;
      }
      setPhase("submitted");
    });
  };

  if (error) {
    return (
      <div className="screen">
        <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
          error
        </span>
        <p>{error}</p>
      </div>
    );
  }

  if (phase === "join") {
    return (
      <div className="screen">
        <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
          smartphone
        </span>
        <h1>Join code: {code}</h1>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          onKeyDown={(e) => e.key === "Enter" && join()}
        />
        <button className="btn" onClick={join}>
          Join
        </button>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="screen">
        <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
          hourglass_top
        </span>
        <p>Waiting for the host to start…</p>
      </div>
    );
  }

  if (phase === "answering" && question) {
    return (
      <div className="screen">
        <p>{remainingSec ?? question.timeLimitSec}s left</p>
        <h1>{question.question.prompt}</h1>
        <AnswerInput question={question.question} value={answerValue} onChange={setAnswerValue} />
        <button className="btn" onClick={submitAnswer}>
          Submit
        </button>
      </div>
    );
  }

  if (phase === "submitted") {
    return (
      <div className="screen">
        <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
          check_circle
        </span>
        <p>Answer submitted, waiting for other players…</p>
      </div>
    );
  }

  if (phase === "revealed") {
    const mine = playerId ? revealed?.results.find((r: AnswerResult) => r.playerId === playerId) : undefined;
    return (
      <div className="screen">
        <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
          {mine?.correct ? "check_circle" : "cancel"}
        </span>
        <h1>{mine ? `+${mine.score} points` : "Waiting for next question…"}</h1>
      </div>
    );
  }

  if (phase === "ended") {
    const mine = ended?.players.find((p) => p.id === playerId);
    return (
      <div className="screen">
        <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
          emoji_events
        </span>
        <h1>Final score: {mine?.score ?? 0}</h1>
      </div>
    );
  }

  return null;
}

function defaultAnswerFor(question: PublicQuestion): string {
  if (question.type === "number") return String(Math.round((question.min + question.max) / 2));
  return "";
}

function parseAnswer(question: PublicQuestion, raw: string): unknown {
  if (question.type === "number") return Number(raw);
  if (question.type === "geo") {
    const [lat, lng] = raw.split(",").map((part) => Number(part.trim()));
    return { lat, lng };
  }
  return raw;
}

function AnswerInput({
  question,
  value,
  onChange,
}: {
  question: PublicQuestion;
  value: string;
  onChange: (value: string) => void;
}) {
  if (question.type === "number") {
    return (
      <input
        type="range"
        min={question.min}
        max={question.max}
        step={question.step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (question.type === "geo") {
    return (
      <input
        type="text"
        placeholder="lat, lng"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
}
