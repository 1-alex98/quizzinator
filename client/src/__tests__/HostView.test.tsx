import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
const mapMock = { setView: vi.fn(), fitBounds: vi.fn() };

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children?: React.ReactNode }) => <div data-testid="correct-pin">{children}</div>,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => <div data-testid="guess-pin">{children}</div>,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: React.ReactNode }) => <div data-testid="guess-label">{children}</div>,
  useMap: () => mapMock,
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

/** Acks host:join with a lobby sync, which is the precondition for every screen below. */
function joinsAs({ players, totalQuestions }: { players: unknown[]; totalQuestions: number }) {
  socketMock.emit.mockImplementation((event, _payload, ack) => {
    if (event === "host:join") {
      ack({
        ok: true,
        data: {
          sessionId: "s1",
          code: "ABCDE",
          state: "lobby",
          currentQuestionIndex: -1,
          totalQuestions,
          players,
        },
      });
    }
  });
}

describe("HostView", () => {
  beforeEach(() => {
    socketMock.emit.mockReset();
    socketMock.on.mockReset();
    socketMock.off.mockReset();
    mapMock.setView.mockReset();
    mapMock.fitBounds.mockReset();
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

    expect(screen.getByText("Correct answer")).toBeTruthy();
    expect(screen.getByText("50")).toBeTruthy();
    // Name, guess and points each get their own slot in the answer card.
    const row = screen.getByText("42").closest("li") as HTMLElement;
    expect(within(row).getByText("Alice")).toBeTruthy();
    expect(within(row).getByText("+80")).toBeTruthy();
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

  it("names the three closest guesses on the geo reveal map and frames them", () => {
    const players = [
      { id: "p1", name: "Alice", connected: true, score: 0 },
      { id: "p2", name: "Bob", connected: true, score: 0 },
      { id: "p3", name: "Cleo", connected: true, score: 0 },
      { id: "p4", name: "Dan", connected: true, score: 0 },
    ];
    joinsAs({ players, totalQuestions: 1 });
    const handlers = captureSocketHandlers();
    renderAt("s1");

    handlers.fire("question:show", {
      question: { id: "q1", type: "geo", prompt: "Where?", points: 100, maxDistanceKm: 1000 },
      index: 0,
      total: 1,
      endsAt: Date.now() + 30_000,
      timeLimitSec: 30,
    });

    handlers.fire("question:revealed", {
      index: 0,
      correctAnswer: { correctLat: 52.52, correctLng: 13.405 },
      results: [
        // Deliberately out of order, and with the runaway guess last: the
        // labels follow distance, not the order answers arrived.
        { playerId: "p2", value: { lat: 50, lng: 14 }, score: 60, correct: false, totalScore: 60, distanceKm: 285 },
        { playerId: "p1", value: { lat: 52.3, lng: 13.4 }, score: 90, correct: true, totalScore: 90, distanceKm: 24 },
        { playerId: "p4", value: { lat: -33, lng: 151 }, score: 0, correct: false, totalScore: 0, distanceKm: 16_000 },
        { playerId: "p3", value: { lat: 48, lng: 11 }, score: 30, correct: false, totalScore: 30, distanceKm: 550 },
      ],
      leaderboard: players,
    });

    // Markers keep the order the results arrived in; the rank is in the label.
    const labels = screen
      .getAllByTestId("guess-label")
      .map((el) => el.textContent ?? "")
      .sort();
    expect(labels).toEqual(["1. Alice · 24 km", "2. Bob · 285 km", "3. Cleo · 550 km"]);
    // Every guess still gets a dot, including the one too far away to name.
    expect(screen.getAllByTestId("guess-pin")).toHaveLength(4);
    // The far-flung guess must not drag the viewport back out to the world map.
    const [bounds] = mapMock.fitBounds.mock.calls.at(-1) as [[number, number][]];
    expect(bounds).toEqual([
      [52.52, 13.405],
      [52.3, 13.4],
      [50, 14],
      [48, 11],
    ]);
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

    expect(screen.getByText("Accepted answer")).toBeTruthy();
    expect(screen.getByText("Marie Curie")).toBeTruthy();
    const row = screen.getByText("“marie curie”").closest("li") as HTMLElement;
    expect(within(row).getByText("Alice")).toBeTruthy();
    expect(within(row).getByText("+100")).toBeTruthy();
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
    const board = document.querySelector(".leaderboard") as HTMLElement;
    expect(within(board).getByText("Alice")).toBeTruthy();
    expect(within(board).getByText("80")).toBeTruthy();
    expect(within(board).getByText("+80")).toBeTruthy();
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
    const board = container.querySelector(".leaderboard") as HTMLElement;
    expect(within(board).getByText("+10 more players")).toBeTruthy();
    // The answer card truncates the same way, so a full room can't push the
    // reveal off a no-scroll screen.
    const answerCard = container.querySelector(".reveal-answer") as HTMLElement;
    expect(within(answerCard).getByText("+10 more players")).toBeTruthy();
  });

  it("shows a multiple-choice reveal with the winning option and each player's pick", () => {
    joinsAs({ players: [{ id: "p1", name: "Alice", connected: true, score: 0 }], totalQuestions: 1 });
    const handlers = captureSocketHandlers();
    renderAt("s1");

    handlers.fire("question:show", {
      question: {
        id: "q1",
        type: "multiple-choice",
        prompt: "Which came first?",
        points: 100,
        options: ["The Walkman", "The CD player", "The iPod"],
      },
      index: 0,
      total: 1,
      endsAt: Date.now() + 30_000,
      timeLimitSec: 30,
    });

    handlers.fire("question:revealed", {
      index: 0,
      correctAnswer: { correctIndex: 0, correctOption: "The Walkman" },
      results: [{ playerId: "p1", value: 1, score: 0, correct: false, totalScore: 0 }],
      leaderboard: [{ id: "p1", name: "Alice", connected: true, score: 0 }],
    });

    // Lettered both places, so the room can compare a pick to the answer
    // without re-reading either option in full.
    expect(screen.getByText("A. The Walkman")).toBeTruthy();
    expect(screen.getByText("B. The CD player")).toBeTruthy();
  });

  it("offers a new game at the end and restarts the same session", () => {
    joinsAs({ players: [], totalQuestions: 1 });
    const handlers = captureSocketHandlers();
    renderAt("s1");

    handlers.fire("session:ended", {
      players: [{ id: "p1", name: "Alice", connected: true, score: 100 }],
    });

    fireEvent.click(screen.getByText("New game, same questions"));

    // Restarting this session (rather than creating one) is what keeps the
    // join code on the TV and every phone in the room valid for round two.
    expect(socketMock.emit).toHaveBeenCalledWith(
      "session:restart",
      { sessionId: "s1" },
      expect.any(Function),
    );

    // The server answers with a lobby state:sync; the TV must land back on
    // the lobby rather than keep showing the final leaderboard.
    handlers.fire("state:sync", {
      sessionId: "s1",
      code: "ABCDE",
      state: "lobby",
      currentQuestionIndex: -1,
      totalQuestions: 1,
      players: [{ id: "p1", name: "Alice", connected: true, score: 0 }],
    });

    expect(screen.getByText("Start quiz")).toBeTruthy();
    expect(screen.queryByText("Final leaderboard")).toBeNull();
  });

  // The whole SPA shares one socket, so a quiz this laptop hosted earlier can
  // still push syncs at it. Repainting on those is what flashed a stale final
  // leaderboard - every player in it offline - over a live question.
  it("ignores a state sync belonging to a different session", () => {
    joinsAs({ players: [], totalQuestions: 1 });
    const handlers = captureSocketHandlers();
    renderAt("s1");

    handlers.fire("question:show", {
      question: { id: "q1", type: "fuzzy-text", prompt: "Who?", points: 100 },
      index: 0,
      total: 1,
      endsAt: Date.now() + 30_000,
      timeLimitSec: 30,
    });

    handlers.fire("state:sync", {
      sessionId: "an-older-session",
      code: "ZZZZZ",
      state: "ended",
      currentQuestionIndex: 0,
      totalQuestions: 1,
      players: [{ id: "old", name: "Gone", connected: false, score: 10 }],
    });

    expect(screen.queryByText("Final leaderboard")).toBeNull();
    expect(screen.getByText("Who?")).toBeTruthy();
  });

  it("renders the join link as a clickable anchor", () => {
    joinsAs({ players: [], totalQuestions: 0 });
    renderAt("s1");

    const link = screen.getByText(`${window.location.origin}/play/ABCDE`);
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(`${window.location.origin}/play/ABCDE`);
  });

  it("offers the question set schema for copying from the lobby", () => {
    joinsAs({ players: [], totalQuestions: 0 });
    renderAt("s1");

    expect(screen.getByRole("button", { name: /Copy JSON schema/ })).toBeTruthy();
  });
});
