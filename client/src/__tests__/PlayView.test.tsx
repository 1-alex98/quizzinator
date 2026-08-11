import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function renderAt(code: string) {
  return render(
    <MemoryRouter initialEntries={[`/play/${code}`]}>
      <Routes>
        <Route path="/play/:code" element={<PlayView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PlayView", () => {
  beforeEach(() => {
    socketMock.emit.mockReset();
    socketMock.on.mockReset();
    socketMock.off.mockReset();
    localStorage.clear();
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
});
