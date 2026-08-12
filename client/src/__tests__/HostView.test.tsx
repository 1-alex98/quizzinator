import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HostView } from "../views/HostView.js";

const socketMock = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock("../lib/socket.js", () => ({
  getSocket: () => socketMock,
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
  });

  afterEach(cleanup);

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

    expect(screen.getByText("Code: ABCDE")).toBeTruthy();
    expect(screen.getByText("1 player joined")).toBeTruthy();
    expect(screen.getByText("Start quiz")).toBeTruthy();
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
});
