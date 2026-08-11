// Question set upload (.json or .zip) and "start hosting" entry point.
// File handling + zip-slip-safe extraction is added by the question set
// import pipeline issue; this is a placeholder screen for now.
export function AdminView() {
  return (
    <div className="screen">
      <span className="material-symbols-rounded" style={{ fontSize: "3rem" }}>
        upload_file
      </span>
      <h1>Upload a question set</h1>
      <p>Coming soon.</p>
    </div>
  );
}
