import { useParams } from "react-router-dom";

// Mobile participant app: one screen per phase (waiting / answering /
// waiting-for-others / reveal), no scrolling, icon-forward. The three
// question-type answer widgets (slider, map pin, fuzzy text) are added by
// their respective issues.
export function PlayView() {
  const { code } = useParams();

  return (
    <div className="screen">
      <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
        smartphone
      </span>
      <h1>Join code: {code}</h1>
    </div>
  );
}
