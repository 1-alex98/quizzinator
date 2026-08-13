import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminView } from "../views/AdminView.js";

const fetchMock = vi.fn();

// The screen loads the published question set schema on mount, for the
// "have an AI write it" links. It isn't part of any flow tested here, so it
// is answered separately rather than eating a queued response.
const SCHEMA_STUB = { properties: { questions: { items: { anyOf: [] } } }, examples: [] };

function stubFetch(...responses: unknown[]) {
  const queue = [...responses];
  fetchMock.mockImplementation((url: string) => {
    if (String(url).startsWith("/api/question-set-schema")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(SCHEMA_STUB) });
    }
    return Promise.resolve(queue.shift() ?? { ok: false, json: () => Promise.resolve(null) });
  });
}

/** The requests the flow under test made, with the mount-time schema load filtered out. */
function apiCalls() {
  return fetchMock.mock.calls.filter(([url]) => !String(url).startsWith("/api/question-set-schema"));
}

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
    stubFetch(
      { ok: true, json: () => Promise.resolve({ id: "s1", code: "ABCDE", hostToken: "secret-1" }) },
      { ok: true, json: () => Promise.resolve({ ok: true }) },
    );

    renderAdmin();
    fireEvent.click(screen.getByText("Start quiz with test data"));

    await waitFor(() => expect(screen.getByText("Host screen")).toBeTruthy());

    expect(apiCalls()[0]).toEqual(["/api/sessions", { method: "POST" }]);
    const [url, options] = apiCalls()[1];
    expect(url).toBe("/api/sessions/s1/question-set");
    expect(options.method).toBe("PUT");

    const body = JSON.parse(options.body);
    expect(body.questions.map((q: { type: string }) => q.type)).toEqual([
      "multiple-choice",
      "number",
      "geo",
      "fuzzy-text",
    ]);

    // The host secret is kept in sessionStorage, not the URL - HostView
    // reads it from here to prove it's the session's creator.
    expect(sessionStorage.getItem("quizzinator:host-token:s1")).toBe("secret-1");
  });

  it("shows an error if the session can't be created", async () => {
    stubFetch({ ok: false });

    renderAdmin();
    fireEvent.click(screen.getByText("Start quiz with test data"));

    await waitFor(() => expect(screen.getByText("Could not create the session.")).toBeTruthy());
    expect(apiCalls()).toHaveLength(1);
  });

  it("shows an error if attaching the question set fails", async () => {
    stubFetch(
      { ok: true, json: () => Promise.resolve({ id: "s1", code: "ABCDE", hostToken: "secret-1" }) },
      { ok: false, json: () => Promise.resolve(null) },
    );

    renderAdmin();
    fireEvent.click(screen.getByText("Start quiz with test data"));

    await waitFor(() => expect(screen.getByText("Could not attach the question set.")).toBeTruthy());
  });

  it("uploads a chosen file, then creates and attaches a session from the parsed result", async () => {
    const parsedSet = { id: "uploaded", title: "Uploaded", questions: [{ id: "q1", type: "number" }] };
    stubFetch(
      { ok: true, json: () => Promise.resolve(parsedSet) },
      { ok: true, json: () => Promise.resolve({ id: "s1", code: "ABCDE", hostToken: "secret-1" }) },
      { ok: true, json: () => Promise.resolve({ ok: true }) },
    );

    renderAdmin();
    const file = new File(["{}"], "set.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Question set file"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Host screen")).toBeTruthy());

    expect(apiCalls()[0]).toEqual(["/api/question-sets", expect.objectContaining({ method: "POST" })]);
    expect(apiCalls()[1]).toEqual(["/api/sessions", { method: "POST" }]);
    const [url, options] = apiCalls()[2];
    expect(url).toBe("/api/sessions/s1/question-set");
    expect(JSON.parse(options.body)).toEqual(parsedSet);
  });

  it("shows the server's error message when the uploaded file is rejected", async () => {
    stubFetch({
      ok: false,
      json: () => Promise.resolve({ error: "invalid_question_set", message: "Question set failed validation." }),
    });

    renderAdmin();
    const file = new File(["{ not json"], "set.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Question set file"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Question set failed validation.")).toBeTruthy());
  });

  it("starts a quiz from JSON pasted into the dialog", async () => {
    const pastedSet = { id: "pasted", title: "Pasted", questions: [{ id: "q1", type: "number" }] };
    stubFetch(
      { ok: true, json: () => Promise.resolve({ id: "s1", code: "ABCDE", hostToken: "secret-1" }) },
      { ok: true, json: () => Promise.resolve({ ok: true }) },
    );

    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Paste JSON" }));
    fireEvent.change(await screen.findByPlaceholderText(/"id": "my-quiz"/), {
      target: { value: JSON.stringify(pastedSet) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start quiz" }));

    await waitFor(() => expect(screen.getByText("Host screen")).toBeTruthy());

    // Pasted JSON goes straight to the session's question-set endpoint - it
    // has no file to upload, and that endpoint validates it just the same.
    expect(apiCalls()[0]).toEqual(["/api/sessions", { method: "POST" }]);
    expect(JSON.parse(apiCalls()[1][1].body)).toEqual(pastedSet);
  });

  // Chat UIs wrap JSON in code fences; the parse error a browser gives for
  // that ("Unexpected token `") tells the host nothing useful.
  it("explains what to paste when the text isn't JSON", async () => {
    stubFetch();

    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Paste JSON" }));
    fireEvent.change(await screen.findByPlaceholderText(/"id": "my-quiz"/), {
      target: { value: "```json\n{}\n```" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start quiz" }));

    await waitFor(() => expect(screen.getByText(/isn't valid JSON/)).toBeTruthy());
    expect(apiCalls()).toHaveLength(0);
  });

  it("surfaces the server's field-level complaint about a pasted set", async () => {
    stubFetch(
      { ok: true, json: () => Promise.resolve({ id: "s1", code: "ABCDE", hostToken: "secret-1" }) },
      {
        ok: false,
        json: () =>
          Promise.resolve({
            error: "invalid_question_set",
            message: "Question set failed validation: questions.0.correctIndex: must be between 0 and 1",
          }),
      },
    );

    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: "Paste JSON" }));
    fireEvent.change(await screen.findByPlaceholderText(/"id": "my-quiz"/), {
      target: { value: '{"id":"x","title":"x","questions":[]}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start quiz" }));

    await waitFor(() => expect(screen.getByText(/questions.0.correctIndex/)).toBeTruthy());
  });
});
