import { useEffect } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import type { AnswerResult } from "../lib/protocol.js";

const correctIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

/** How many guesses get a name on the map rather than only a dot. */
const LABELLED = 3;
/** Nobody clicks a popup on a TV, so the map has to zoom itself to the story. */
const FALLBACK_ZOOM = 5;
const MAX_FIT_ZOOM = 6;

type Guess = {
  playerId: string;
  name: string;
  lat: number;
  lng: number;
  distanceKm?: number;
  correct: boolean;
};

function toGuess(result: AnswerResult, playerNames: Map<string, string>): Guess | null {
  const value = result.value as { lat?: unknown; lng?: unknown } | null;
  if (typeof value?.lat !== "number" || typeof value?.lng !== "number") return null;
  return {
    playerId: result.playerId,
    name: playerNames.get(result.playerId) ?? "Player",
    lat: value.lat,
    lng: value.lng,
    distanceKm: result.distanceKm,
    correct: result.correct,
  };
}

function label(guess: Guess, rank: number) {
  const distance = guess.distanceKm === undefined ? "" : ` · ${guess.distanceKm.toFixed(0)} km`;
  return `${rank}. ${guess.name}${distance}`;
}

/**
 * Frames the correct pin and the named guesses. A fixed zoom either wasted
 * most of the screen on empty ocean or cut the winners out of frame, and the
 * *whole* field can't drive the bounds either - one guess in the wrong
 * hemisphere would zoom the reveal back out to the world map.
 */
function FitToStory({ points }: { points: [number, number][] }) {
  const map = useMap();
  // Positions are rebuilt every render, so key the effect on their values.
  const fingerprint = points.map(([lat, lng]) => `${lat},${lng}`).join("|");
  useEffect(() => {
    if (points.length < 2) {
      map.setView(points[0], FALLBACK_ZOOM);
      return;
    }
    map.fitBounds(points, { padding: [56, 56], maxZoom: MAX_FIT_ZOOM });
  }, [map, fingerprint]);
  return null;
}

export function GeoRevealMap({
  correctLat,
  correctLng,
  results,
  playerNames,
}: {
  correctLat: number;
  correctLng: number;
  results: AnswerResult[];
  playerNames: Map<string, string>;
}) {
  const guesses = results
    .map((result) => toGuess(result, playerNames))
    .filter((guess): guess is Guess => guess !== null);
  // The reveal's headline is who got closest, so that is what gets named.
  const ranked = [...guesses].sort(
    (a, b) => (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY),
  );
  const named = new Map(ranked.slice(0, LABELLED).map((guess, index) => [guess.playerId, index + 1]));

  return (
    <MapContainer
      className="geo-reveal__map"
      center={[correctLat, correctLng]}
      zoom={FALLBACK_ZOOM}
      attributionControl={false}
      dragging
      scrollWheelZoom={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitToStory
        points={[
          [correctLat, correctLng],
          ...ranked.slice(0, LABELLED).map((guess): [number, number] => [guess.lat, guess.lng]),
        ]}
      />
      <Marker position={[correctLat, correctLng]} icon={correctIcon}>
        <Popup>Correct location</Popup>
      </Marker>
      {guesses.map((guess) => {
        const rank = named.get(guess.playerId);
        return (
          <CircleMarker
            key={guess.playerId}
            center={[guess.lat, guess.lng]}
            radius={rank ? 10 : 7}
            pathOptions={{
              color: guess.correct ? "#2e7d32" : "#ffab00",
              weight: rank ? 3 : 2,
            }}
          >
            {rank && (
              <Tooltip permanent direction="top" offset={[0, -8]} className="geo-reveal__label">
                {label(guess, rank)}
              </Tooltip>
            )}
            <Popup>
              {guess.name}
              {guess.distanceKm !== undefined && ` — ${guess.distanceKm.toFixed(1)} km off`}
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
