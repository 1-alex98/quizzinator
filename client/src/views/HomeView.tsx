import { useNavigate } from "react-router-dom";

export function HomeView() {
  const navigate = useNavigate();

  return (
    <div className="screen">
      <span className="material-symbols-rounded" style={{ fontSize: "4rem" }}>
        quiz
      </span>
      <h1>Quizzinator</h1>
      <button className="btn" onClick={() => navigate("/admin")}>
        <span className="material-symbols-rounded">upload_file</span>
        Host a quiz
      </button>
    </div>
  );
}
