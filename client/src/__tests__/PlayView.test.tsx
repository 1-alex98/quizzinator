import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PlayView } from "../views/PlayView.js";

const socketMock = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock("../lib/socket.js", () => ({
  getSocket: () => socketMock,
}));

// react-leaflet needs real layout/DOM measurement that jsdom doesn't provide;
// stub it with plain elements and expose the click handler GeoMapInput
// registers via useMapEvents so tests can simulate a tap on the map.
let mapClickHandler: ((e: { latlng: { lat: number; lng: number } }) => void) | undefined;

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ position }: { position: [number, number] }) => (
    <div data-testid="pin">{position.join(",")}</div>
  ),
  useMapEvents: (handlers: { click: (e: { latlng: { lat: number; lng: number } }) => void }) => {
    mapClickHandler = handlers.click;
    return null;
  },
}));

function renderAt(code: string) {
  return render(
    <MemoryRouter initialEntries={[`/play/${code}`]}>
      <Routes>
        <Route path="/play/:code" element={<PlayView />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Registers the socket.on handlers and returns a way to fire them. */
function captureSocketHandlers() {
  const handlers = new Map<string, (payload: unknown) => void>();
  socketMock.on.mockImplementation((event: string, handler: (payload: unknown) => void) => {
    handlers.set(event, handler);
  });
  return {
    fire(event: string, payload: unknown) {
      handlers.get(event)?.(payload);
    },
  };
}

function joinAndReachAnswering(code: string, question: unknown) {
  socketMock.emit.mockImplementation((event, _payload, ack) => {
    if (event === "player:join") {
      ack({ ok: true, data: { playerId: "p1", sessionId: "s1", state: "lobby" } });
    }
  });
  const handlers = captureSocketHandlers();
  renderAt(code);
  fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alice" } });
  fireEvent.click(screen.getByText("Join"));

  act(() => {
    handlers.fire("question:show", {
      question,
      index: 0,
      total: 1,
      endsAt: Date.now() + 30_000,
      timeLimitSec: 30,
    });
  });
}

describe("PlayView", () => {
  beforeEach(() => {
    socketMock.emit.mockReset();
    socketMock.on.mockReset();
    socketMock.off.mockReset();
    localStorage.clear();
    mapClickHandler = undefined;
  });

  afterEach(cleanup);

  it("shows a join form for the code in the URL", () => {
    renderAt("ABCDE");
    expect(screen.getByText("Join code: ABCDE")).toBeTruthy();
    expect(screen.getByPlaceholderText("Your name")).toBeTruthy();
  });

  it("emits player:join with the entered name and no persisted id on first join", () => {
    renderAt("ABCDE");
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Join"));

    expect(socketMock.emit).toHaveBeenCalledWith(
      "player:join",
      { code: "ABCDE", name: "Alice", playerId: undefined },
      expect.any(Function),
    );
  });

  it("reuses a persisted player id from a previous join", () => {
    localStorage.setItem("quizzinator:player:ABCDE", "player-42");
    renderAt("ABCDE");
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Join"));

    expect(socketMock.emit).toHaveBeenCalledWith(
      "player:join",
      { code: "ABCDE", name: "Alice", playerId: "player-42" },
      expect.any(Function),
    );
  });

  it("moves to the waiting screen once the join ack resolves", () => {
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "player:join") {
        ack({ ok: true, data: { playerId: "p1", sessionId: "s1", state: "lobby" } });
      }
    });

    renderAt("ABCDE");
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Join"));

    expect(screen.getByText("Waiting for the host to start…")).toBeTruthy();
  });

  it("renders a slider with the live value for a number question and submits it", () => {
    joinAndReachAnswering("ABCDE", {
      id: "q1",
      type: "number",
      prompt: "How many?",
      points: 100,
      min: 0,
      max: 100,
      step: 1,
    });

    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("100");

    fireEvent.change(slider, { target: { value: "42" } });
    expect(screen.getByText("42")).toBeTruthy();

    fireEvent.click(screen.getByText("Submit"));
    expect(socketMock.emit).toHaveBeenCalledWith(
      "answer:submit",
      { sessionId: "s1", playerId: "p1", value: 42 },
      expect.any(Function),
    );
  });

  it("renders a full-screen map for a geo question and only allows submit after a pin is placed", () => {
    joinAndReachAnswering("ABCDE", {
      id: "q2",
      type: "geo",
      prompt: "Where?",
      points: 100,
      maxDistanceKm: 100,
    });

    const confirm = screen.getByText("Confirm pin").closest("button") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(screen.queryByTestId("pin")).toBeNull();

    act(() => {
      mapClickHandler?.({ latlng: { lat: 12.5, lng: -3.2 } });
    });

    expect(screen.getByTestId("pin")).toBeTruthy();
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);
    expect(socketMock.emit).toHaveBeenCalledWith(
      "answer:submit",
      { sessionId: "s1", playerId: "p1", value: { lat: 12.5, lng: -3.2 } },
      expect.any(Function),
    );
  });

  it("renders a text input for a fuzzy-text question and disables submit until non-empty", () => {
    joinAndReachAnswering("ABCDE", {
      id: "q3",
      type: "fuzzy-text",
      prompt: "Who?",
      points: 100,
    });

    const submit = screen.getByText("Submit").closest("button") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const input = screen.getByPlaceholderText("Type your answer…");
    fireEvent.change(input, { target: { value: "Marie Curie" } });
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(socketMock.emit).toHaveBeenCalledWith(
      "answer:submit",
      { sessionId: "s1", playerId: "p1", value: "Marie Curie" },
      expect.any(Function),
    );
  });

  it("submits a fuzzy-text answer on Enter", () => {
    joinAndReachAnswering("ABCDE", {
      id: "q3",
      type: "fuzzy-text",
      prompt: "Who?",
      points: 100,
    });

    const input = screen.getByPlaceholderText("Type your answer…");
    fireEvent.change(input, { target: { value: "Marie Curie" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(socketMock.emit).toHaveBeenCalledWith(
      "answer:submit",
      { sessionId: "s1", playerId: "p1", value: "Marie Curie" },
      expect.any(Function),
    );
  });

  it("toggles the prompt overlay on the geo screen without leaving the map", () => {
    joinAndReachAnswering("ABCDE", {
      id: "q2",
      type: "geo",
      prompt: "Where is this?",
      points: 100,
      maxDistanceKm: 100,
    });

    expect(screen.queryByText("Where is this?")).toBeNull();
    fireEvent.click(screen.getByText("Show question"));
    expect(screen.getByText("Where is this?")).toBeTruthy();
  });

  it("shows the player's rank after a question reveal", () => {
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "player:join") {
        ack({ ok: true, data: { playerId: "p1", sessionId: "s1", state: "lobby" } });
      }
    });
    const handlers = captureSocketHandlers();
    renderAt("ABCDE");
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Join"));

    act(() => {
      handlers.fire("question:revealed", {
        index: 0,
        correctAnswer: { correctValue: 50 },
        results: [{ playerId: "p1", value: 42, score: 80, correct: false, totalScore: 80 }],
        leaderboard: [
          { id: "p2", name: "Bob", connected: true, score: 120 },
          { id: "p1", name: "Alice", connected: true, score: 80 },
        ],
      });
    });

    expect(screen.getByText("+80 points")).toBeTruthy();
    expect(screen.getByText("Rank #2 of 2")).toBeTruthy();
  });

  it("shows the player's final rank on the ended screen", () => {
    socketMock.emit.mockImplementation((event, _payload, ack) => {
      if (event === "player:join") {
        ack({ ok: true, data: { playerId: "p1", sessionId: "s1", state: "lobby" } });
      }
    });
    const handlers = captureSocketHandlers();
    renderAt("ABCDE");
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Join"));

    act(() => {
      handlers.fire("session:ended", {
        players: [
          { id: "p2", name: "Bob", connected: true, score: 200 },
          { id: "p1", name: "Alice", connected: true, score: 150 },
        ],
      });
    });

    expect(screen.getByText("Final score: 150")).toBeTruthy();
    expect(screen.getByText("Rank #2 of 2")).toBeTruthy();
  });
});
