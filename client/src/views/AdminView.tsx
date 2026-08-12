import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TEST_QUESTION_SET } from "../lib/testQuestionSet.js";

// Picks or uploads a question set, then immediately creates a session,
// attaches the set, and redirects to the host lobby - one click from the
// front page through to a shareable /play/:code link, no intermediate
// "session created, now what" step (see CLAUDE.md -> "Entry flow").
export function AdminView() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const hostWithQuestionSet = async (questionSet: unknown) => {
    const sessionRes = await fetch("/api/sessions", { method: "POST" });
    if (!sessionRes.ok) throw new Error("Could not create the session.");
    const session = (await sessionRes.json()) as { id: string };

    const setRes = await fetch(`/api/sessions/${session.id}/question-set`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(questionSet),
    });
    if (!setRes.ok) throw new Error("Could not attach the question set.");

    navigate(`/host/${session.id}`);
  };

  const startTestQuiz = async () => {
    setError(null);
    setStarting(true);
    try {
      await hostWithQuestionSet(TEST_QUESTION_SET);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStarting(false);
    }
  };

  const onFileChosen = async (file: File) => {
    setError(null);
    setStarting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/question-sets", { method: "POST", body: formData });
      const uploadBody = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) {
        throw new Error(uploadBody?.message ?? "Could not read that question set.");
      }
      await hostWithQuestionSet(uploadBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStarting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="screen">
      <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
        upload_file
      </span>
      <h1>Host a quiz</h1>
      <p>Upload a question set (.json or .zip) to start hosting.</p>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.zip"
        disabled={starting}
        aria-label="Question set file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileChosen(file);
        }}
      />
      <p>or</p>
      <button className="btn" disabled={starting} onClick={startTestQuiz}>
        <span className="material-symbols-rounded">science</span>
        {starting ? "Starting…" : "Start quiz with test data"}
      </button>
      {error && <p className="card">{error}</p>}
    </div>
  );
}

