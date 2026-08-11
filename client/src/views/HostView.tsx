import { useParams } from "react-router-dom";

// The TV/laptop screen everyone in the room watches: lobby with a join
// link/QR + code, the live question, a countdown, and the leaderboard.
// Full state machine wiring lands with the realtime quiz engine.
export function HostView() {
  const { sessionId } = useParams();

  return (
    <div className="screen">
      <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
        cast
      </span>
      <h1>Host screen</h1>
      <p>Session: {sessionId}</p>
    </div>
  );
}
