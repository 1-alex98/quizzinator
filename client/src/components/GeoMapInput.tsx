import { useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import type { PublicQuestion } from "../lib/protocol.js";
import { AppIcon } from "./AppIcon.js";
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

// Leaflet's own panes sit at z-index 400-700, so every control floating over
// the map has to clear that.
const OVER_MAP = 1000;

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
    <Box
      sx={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
      }}
    >
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

      <Stack
        direction="row"
        alignItems="center"
        gap={1}
        sx={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: OVER_MAP }}
      >
        {remainingSec !== null && (
          <Chip
            color="secondary"
            icon={<AppIcon name="timer" fontSize="small" />}
            label={`${remainingSec}s`}
          />
        )}
        <Button
          size="small"
          onClick={() => setPromptOpen((open) => !open)}
          startIcon={<AppIcon name={promptOpen ? "expand_less" : "help"} fontSize="small" />}
          sx={{ ml: "auto", minHeight: 40, py: 0.5, fontSize: "0.9rem" }}
        >
          {promptOpen ? "Hide question" : "Show question"}
        </Button>
      </Stack>

      {promptOpen && (
        <Paper
          elevation={12}
          sx={{
            position: "absolute",
            top: 64,
            left: 12,
            right: 12,
            zIndex: OVER_MAP,
            p: 2,
            maxHeight: "60vh",
            overflow: "auto",
            textAlign: "center",
          }}
        >
          {/* `panel`, not the usual mobile screen: this card floats over the
              map the player has to tap, so it hugs its image instead of
              filling the space - and "Hide image" shrinks it back to a line of
              text, leaving the map clear without closing the question. */}
          <QuestionPrompt question={question} variant="panel" />
        </Paper>
      )}

      <Button
        color="secondary"
        onClick={onSubmit}
        disabled={!pin}
        startIcon={<AppIcon name="check" />}
        sx={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: OVER_MAP,
          // MUI's translucent disabled fill vanishes against pale map tiles;
          // keep it opaque so "place a pin first" still reads as a button.
          "&.Mui-disabled": { bgcolor: "background.paper", color: "text.secondary" },
        }}
      >
        Confirm pin
      </Button>
    </Box>
  );
}
