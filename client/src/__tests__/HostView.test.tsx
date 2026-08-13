import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HostView } from "../views/HostView.js";

const socketMock = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  connected: true,
};

vi.mock("../lib/socket.js", () => ({
  getSocket: () => socketMock,
  // Mirrors the real helper: run the join handshake right away on an
  // already-connected socket, and again on every later reconnect.
  onReconnect: (socket: typeof socketMock, rejoin: () => void) => {
    socket.on("connect", rejoin);
    if (socket.connected) rejoin();
    return () => socket.off("connect", rejoin);
  },
}));

// react-leaflet needs real layout/DOM measurement jsdom doesn't provide;
// stub it with plain elements for the geo reveal map.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children?: React.ReactNode }) => <div data-testid="correct-pin">{children}</div>,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => <div data-testid="guess-pin">{children}</div>,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

function renderAt(sessionId: string) {
  return render(
    <MemoryRouter initialEntries={[`/host/${sessionId}`]}>
      <Routes>
        <Route path="/host/:sessionId" element={<HostView />} />
      </Routes>
    </MemoryRouter>,
  );
}

function captureSocketHandlers() {
  const handlers = new Map<string, (payload: unknown) => void>();
  socketMock.on.mockImplementation((event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler);
  });
  return {
    fire(event: string, payload: unknown) {
      act(() => handlers.get(event)?.(payload));
    },
  };
}

describe("HostView", () => {
  beforeEach(() => {
    socketMock.emit.mockReset();
    socketMock.on.mockReset();
    socketMock.off.mockReset();
    sessionStorage.clear();
  });

  afterEach(cleanup);

  it("sends the sessionStorage-persisted host token with host:join", () => {
    sessionStorage.setItem("quizzinator:host-token:s1", "secret-1");
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "host:join") ack({ ok: false, error: "not_host" });
    });

    renderAt("s1");

    expect(socketMock.emit).toHaveBeenCalledWith(
      "host:join",
      { sessionId: "s1", hostToken: "secret-1" },
      expect.any(Function),
    );
  });

  it("renders the lobby once host:join acknowledges", () => {
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "host:join") {
        ack({
          ok: true,
          data: {
            sessionId: "s1",
            code: "ABCDE",
            state: "lobby",
            currentQuestionIndex: -1,
            totalQuestions: 0,
            players: [{ id: "p1", name: "Alice", connected: true, score: 0 }],
          },
        });
      }
    });

    renderAt("s1");

    expect(screen.getByText("ABCDE")).toBeTruthy();
    expect(screen.getByText("1 player joined")).toBeTruthy();
    expect(screen.getByText("Start quiz")).toBeTruthy();
    expect(document.querySelector(".join-qr svg")).toBeTruthy();
  });

  // Regression test for the reconnect bug: a reconnected socket is a new
  // socket id the server doesn't yet know is the host, so the handshake has
  // to be repeated or the TV silently stops receiving events.
  it("re-runs host:join when the socket reconnects", () => {
    sessionStorage.setItem("quizzinator:host-token:s1", "secret-1");
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "host:join") {
        ack({
          ok: true,
          data: {
            sessionId: "s1",
            code: "ABCDE",
            state: "lobby",
            currentQuestionIndex: -1,
            totalQuestions: 0,
            players: [],
          },
        });
      }
    });
    const handlers = captureSocketHandlers();
    renderAt("s1");

    const joinsAfterMount = socketMock.emit.mock.calls.filter(([event]) => event === "host:join").length;
    expect(joinsAfterMount).toBe(1);

    handlers.fire("connect", undefined);

    const joinsAfterReconnect = socketMock.emit.mock.calls.filter(([event]) => event === "host:join");
    expect(joinsAfterReconnect).toHaveLength(2);
    expect(joinsAfterReconnect[1][1]).toEqual({ sessionId: "s1", hostToken: "secret-1" });
  });

  it("shows an error when the session can't be found", () => {
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "host:join") ack({ ok: false, error: "session_not_found" });
    });

    renderAt("missing");

    expect(screen.getByText("session_not_found")).toBeTruthy();
  });

  it("shows the correct value and per-player guesses on a number reveal", () => {
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "host:join") {
        ack({
          ok: true,
          data: {
            sessionId: "s1",
            code: "ABCDE",
            state: "lobby",
            currentQuestionIndex: -1,
            totalQuestions: 1,
            players: [{ id: "p1", name: "Alice", connected: true, score: 0 }],
          },
        });
      }
    });
    const handlers = captureSocketHandlers();
    renderAt("s1");

    handlers.fire("question:show", {
      question: { id: "q1", type: "number", prompt: "How many?", points: 100, min: 0, max: 100, step: 1 },
      index: 0,
      total: 1,
      endsAt: Date.now() + 30_000,
      timeLimitSec: 30,
    });

    handlers.fire("question:revealed", {
      index: 0,
      correctAnswer: { correctValue: 50 },
      results: [{ playerId: "p1", value: 42, score: 80, correct: false, totalScore: 80 }],
      leaderboard: [{ id: "p1", name: "Alice", connected: true, score: 80 }],
    });

    expect(screen.getByText("Correct answer: 50")).toBeTruthy();
    expect(screen.getByText("Alice: 42 — +80")).toBeTruthy();
  });

  it("shows a map with the correct location and player guesses on a geo reveal", () => {
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "host:join") {
        ack({
          ok: true,
          data: {
            sessionId: "s1",
            code: "ABCDE",
            state: "lobby",
            currentQuestionIndex: -1,
            totalQuestions: 1,
            players: [{ id: "p1", name: "Alice", connected: true, score: 0 }],
          },
        });
      }
    });
    const handlers = captureSocketHandlers();
    renderAt("s1");

    handlers.fire("question:show", {
      question: { id: "q1", type: "geo", prompt: "Where?", points: 100, maxDistanceKm: 100 },
      index: 0,
      total: 1,
      endsAt: Date.now() + 30_000,
      timeLimitSec: 30,
    });

    handlers.fire("question:revealed", {
      index: 0,
      correctAnswer: { correctLat: 52.52, correctLng: 13.405 },
      results: [
        { playerId: "p1", value: { lat: 52.0, lng: 13.405 }, score: 42, correct: false, totalScore: 42, distanceKm: 57.8 },
      ],
      leaderboard: [{ id: "p1", name: "Alice", connected: true, score: 42 }],
    });

    expect(screen.getByTestId("correct-pin")).toBeTruthy();
    expect(screen.getByTestId("guess-pin")).toBeTruthy();
  });

  it("shows the accepted answers and per-player guesses on a fuzzy-text reveal", () => {
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "host:join") {
        ack({
          ok: true,
          data: {
            sessionId: "s1",
            code: "ABCDE",
            state: "lobby",
            currentQuestionIndex: -1,
            totalQuestions: 1,
            players: [{ id: "p1", name: "Alice", connected: true, score: 0 }],
          },
        });
      }
    });
    const handlers = captureSocketHandlers();
    renderAt("s1");

    handlers.fire("question:show", {
      question: { id: "q1", type: "fuzzy-text", prompt: "Who?", points: 100 },
      index: 0,
      total: 1,
      endsAt: Date.now() + 30_000,
      timeLimitSec: 30,
    });

    handlers.fire("question:revealed", {
      index: 0,
      correctAnswer: { acceptedAnswers: ["Marie Curie"] },
      results: [{ playerId: "p1", value: "marie curie", score: 100, correct: true, totalScore: 100 }],
      leaderboard: [{ id: "p1", name: "Alice", connected: true, score: 100 }],
    });

    expect(screen.getByText("Accepted answer: Marie Curie")).toBeTruthy();
    expect(screen.getByText("Alice: marie curie — +100")).toBeTruthy();
  });

  it("shows the per-question point delta alongside each player's total on reveal", () => {
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "host:join") {
        ack({
          ok: true,
          data: {
            sessionId: "s1",
            code: "ABCDE",
            state: "lobby",
            currentQuestionIndex: -1,
            totalQuestions: 1,
            players: [{ id: "p1", name: "Alice", connected: true, score: 0 }],
          },
        });
      }
    });
    const handlers = captureSocketHandlers();
    renderAt("s1");

    handlers.fire("question:show", {
      question: { id: "q1", type: "number", prompt: "How many?", points: 100, min: 0, max: 100, step: 1 },
      index: 0,
      total: 1,
      endsAt: Date.now() + 30_000,
      timeLimitSec: 30,
    });

    handlers.fire("question:revealed", {
      index: 0,
      correctAnswer: { correctValue: 50 },
      results: [{ playerId: "p1", value: 42, score: 80, correct: false, totalScore: 80 }],
      leaderboard: [{ id: "p1", name: "Alice", connected: true, score: 80 }],
    });

    // Name, running total and the delta gained this round are separate
    // elements in the redesigned leaderboard so they can be styled apart.
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("80")).toBeTruthy();
    expect(screen.getByText("+80")).toBeTruthy();
  });

  it("truncates a large lobby player list with a summary", () => {
    const players = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i}`,
      connected: true,
      score: 0,
    }));
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "host:join") {
        ack({
          ok: true,
          data: {
            sessionId: "s1",
            code: "ABCDE",
            state: "lobby",
            currentQuestionIndex: -1,
            totalQuestions: 0,
            players,
          },
        });
      }
    });

    const { container } = renderAt("s1");

    expect(screen.getByText("20 players joined")).toBeTruthy();
    expect(container.querySelectorAll(".player-list li")).toHaveLength(11);
    expect(screen.getByText("+10 more")).toBeTruthy();
  });

  it("truncates a large leaderboard on reveal with a summary", () => {
    const players = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i}`,
      connected: true,
      score: 0,
    }));
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "host:join") {
        ack({
          ok: true,
          data: {
            sessionId: "s1",
            code: "ABCDE",
            state: "lobby",
            currentQuestionIndex: -1,
            totalQuestions: 1,
            players,
          },
        });
      }
    });
    const handlers = captureSocketHandlers();
    const { container } = renderAt("s1");

    handlers.fire("question:show", {
      question: { id: "q1", type: "number", prompt: "How many?", points: 100, min: 0, max: 100, step: 1 },
      index: 0,
      total: 1,
      endsAt: Date.now() + 30_000,
      timeLimitSec: 30,
    });

    const results = players.map((p, i) => ({ playerId: p.id, value: i, score: i, correct: false, totalScore: i }));
    const leaderboard = players.map((p, i) => ({ ...p, score: i })).sort((a, b) => b.score - a.score);

    handlers.fire("question:revealed", {
      index: 0,
      correctAnswer: { correctValue: 50 },
      results,
      leaderboard,
    });

    expect(container.querySelectorAll(".leaderboard li")).toHaveLength(11);
    expect(screen.getByText("+10 more players")).toBeTruthy();
  });
});
