import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
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
  return (
    <MapContainer
      className="geo-reveal__map"
      center={[correctLat, correctLng]}
      zoom={3}
      attributionControl={false}
      dragging
      scrollWheelZoom={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[correctLat, correctLng]} icon={correctIcon}>
        <Popup>Correct location</Popup>
      </Marker>
      {results.map((result) => {
        const guess = result.value as { lat?: unknown; lng?: unknown } | null;
        const lat = typeof guess?.lat === "number" ? guess.lat : undefined;
        const lng = typeof guess?.lng === "number" ? guess.lng : undefined;
        if (lat === undefined || lng === undefined) return null;
        return (
          <CircleMarker
            key={result.playerId}
            center={[lat, lng]}
            radius={8}
            pathOptions={{ color: result.correct ? "#2e7d32" : "#ffab00" }}
          >
            <Popup>
              {playerNames.get(result.playerId) ?? "Player"}
              {result.distanceKm !== undefined && ` — ${result.distanceKm.toFixed(1)} km off`}
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
