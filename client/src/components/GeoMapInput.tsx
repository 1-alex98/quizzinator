import { useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import type { PublicQuestion } from "../lib/protocol.js";
import { QuestionPrompt } from "./QuestionPrompt.js";

type GeoQuestion = Extract<PublicQuestion, { type: "geo" }>;
export type GeoGuess = { lat: number; lng: number };

// Leaflet's default marker icon URLs resolve relative to the CSS file when
// left unconfigured, which breaks under Vite's bundling — point them at the
// hashed asset URLs Vite gives us instead.
const pinIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function ClickCapture({ onPick }: { onPick: (guess: GeoGuess) => void }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export function GeoMapInput({
  question,
  remainingSec,
  pin,
  onPick,
  onSubmit,
}: {
  question: GeoQuestion;
  remainingSec: number | null;
  pin: GeoGuess | null;
  onPick: (guess: GeoGuess) => void;
  onSubmit: () => void;
}) {
  const [promptOpen, setPromptOpen] = useState(false);

  return (
    <div className="geo-screen">
      <div className="geo-screen__header">
        <span className="card geo-screen__timer">{remainingSec}s</span>
        <button
          type="button"
          className="btn geo-screen__prompt-toggle"
          onClick={() => setPromptOpen((open) => !open)}
        >
          <span className="material-symbols-rounded">{promptOpen ? "expand_less" : "help"}</span>
          {promptOpen ? "Hide question" : "Show question"}
        </button>
      </div>
      {promptOpen && (
        <div className="geo-screen__prompt card">
          <QuestionPrompt question={question} />
        </div>
      )}
      <MapContainer
        className="geo-screen__map"
        center={[20, 0]}
        zoom={2}
        worldCopyJump
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <ClickCapture onPick={onPick} />
        {pin && <Marker position={[pin.lat, pin.lng]} icon={pinIcon} />}
      </MapContainer>
      <button type="button" className="btn geo-screen__submit" onClick={onSubmit} disabled={!pin}>
        <span className="material-symbols-rounded">check</span>
        Confirm pin
      </button>
    </div>
  );
}
