import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminView } from "../views/AdminView.js";

const fetchMock = vi.fn();

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route path="/admin" element={<AdminView />} />
        <Route path="/host/:sessionId" element={<div>Host screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AdminView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    cleanup();
  });

  it("creates a session, attaches the built-in test set, and navigates to the host screen", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: "s1", code: "ABCDE", hostToken: "secret-1" }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    renderAdmin();
    fireEvent.click(screen.getByText("Start quiz with test data"));

    await waitFor(() => expect(screen.getByText("Host screen")).toBeTruthy());

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/sessions", { method: "POST" });
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/sessions/s1/question-set");
    expect(options.method).toBe("PUT");

    const body = JSON.parse(options.body);
    expect(body.questions.map((q: { type: string }) => q.type)).toEqual(["number", "geo", "fuzzy-text"]);

    // The host secret is kept in sessionStorage, not the URL - HostView
    // reads it from here to prove it's the session's creator.
    expect(sessionStorage.getItem("quizzinator:host-token:s1")).toBe("secret-1");
  });

  it("shows an error if the session can't be created", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    renderAdmin();
    fireEvent.click(screen.getByText("Start quiz with test data"));

    await waitFor(() => expect(screen.getByText("Could not create the session.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error if attaching the question set fails", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: "s1", code: "ABCDE", hostToken: "secret-1" }) })
      .mockResolvedValueOnce({ ok: false });

    renderAdmin();
    fireEvent.click(screen.getByText("Start quiz with test data"));

    await waitFor(() => expect(screen.getByText("Could not attach the question set.")).toBeTruthy());
  });

  it("uploads a chosen file, then creates and attaches a session from the parsed result", async () => {
    const parsedSet = { id: "uploaded", title: "Uploaded", questions: [{ id: "q1", type: "number" }] };
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(parsedSet) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: "s1", code: "ABCDE", hostToken: "secret-1" }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    renderAdmin();
    const file = new File(["{}"], "set.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Question set file"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Host screen")).toBeTruthy());

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/question-sets", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/sessions", { method: "POST" });
    const [url, options] = fetchMock.mock.calls[2];
    expect(url).toBe("/api/sessions/s1/question-set");
    expect(JSON.parse(options.body)).toEqual(parsedSet);
  });

  it("shows the server's error message when the uploaded file is rejected", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "invalid_question_set", message: "Question set failed validation." }),
    });

    renderAdmin();
    const file = new File(["{ not json"], "set.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Question set file"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Question set failed validation.")).toBeTruthy());
  });
});
