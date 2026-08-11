import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomeView } from "./views/HomeView.js";
import { HostView } from "./views/HostView.js";
import { PlayView } from "./views/PlayView.js";
import { AdminView } from "./views/AdminView.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeView />} />
        {/* TV/laptop screen everyone in the room watches. */}
        <Route path="/host/:sessionId" element={<HostView />} />
        {/* Mobile participant app, joined via the host's shared code/link. */}
        <Route path="/play/:code" element={<PlayView />} />
        {/* Question set upload (json/zip). */}
        <Route path="/admin" element={<AdminView />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
