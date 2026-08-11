import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

function renderAt(sessionId: string) {
  return render(
    <MemoryRouter initialEntries={[`/host/${sessionId}`]}>
      <Routes>
        <Route path="/host/:sessionId" element={<HostView />} />
      </Routes>
    </MemoryRouter>,
  );
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
});
