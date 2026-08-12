import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TEST_QUESTION_SET } from "../lib/testQuestionSet.js";

// Question set upload (.json or .zip) lands with the question-set import
// issue (#4). Until then, this screen offers a single button that spins up
// a session with a built-in test set covering every question type, so the
// rest of the app (realtime engine, question types, screen polish) can be
// exercised end to end without a real upload pipeline.
export function AdminView() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const startTestQuiz = async () => {
    setError(null);
    setStarting(true);
    try {
      const sessionRes = await fetch("/api/sessions", { method: "POST" });
      if (!sessionRes.ok) throw new Error("Could not create the session.");
      const session = (await sessionRes.json()) as { id: string };

      const setRes = await fetch(`/api/sessions/${session.id}/question-set`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(TEST_QUESTION_SET),
      });
      if (!setRes.ok) throw new Error("Could not attach the test question set.");

      navigate(`/host/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStarting(false);
    }
  };

  return (
    <div className="screen">
      <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
        upload_file
      </span>
      <h1>Host a quiz</h1>
      <p>Question set upload is coming soon. For now, start with a built-in test set.</p>
      <button className="btn" disabled={starting} onClick={startTestQuiz}>
        <span className="material-symbols-rounded">science</span>
        {starting ? "Starting…" : "Start quiz with test data"}
      </button>
      {error && <p className="card">{error}</p>}
    </div>
  );
}
