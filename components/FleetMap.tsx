"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import type { Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import type { VesselFeature } from "@/lib/types";

type Props = {
  vessels: VesselFeature[];
  focusId: string | null;
  focusNonce?: number;
};

/** Prefer heading when present, else course (degrees, 0 = north). */
function bearingDegrees(vessel: VesselFeature): number | undefined {
  const raw =
    typeof vessel.heading === "number"
      ? vessel.heading
      : typeof vessel.course === "number"
        ? vessel.course
        : undefined;
  if (raw == null || !Number.isFinite(raw)) return undefined;
  // Normalize into [0, 360)
  return ((raw % 360) + 360) % 360;
}

function vesselIcon(online: boolean, active: boolean, bearing?: number) {
  const hasBearing = bearing != null;
  const courseStyle = hasBearing
    ? `style="--course:${bearing}deg"`
    : "";
  const shape = hasBearing
    ? `<div class="hull arrow" ${courseStyle}><svg viewBox="0 0 24 28" aria-hidden="true"><path d="M12 1.5 L21.5 26.5 L12 21 L2.5 26.5 Z"/></svg></div>`
    : `<div class="hull neutral"></div>`;

  return L.divIcon({
    className: `vessel-marker${online ? " online" : " offline"}${active ? " active" : ""}${hasBearing ? " has-course" : " no-course"}`,
    html: shape,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function FitVessels({ vessels, focusId, focusNonce = 0 }: Props) {
  const map = useMap();

  useEffect(() => {
    if (focusId) {
      const hit = vessels.find((v) => v.id === focusId);
      if (hit) {
        map.flyTo([hit.lat, hit.lon], Math.max(map.getZoom(), 5), {
          duration: 0.8,
        });
      }
      return;
    }
    if (vessels.length === 0) {
      map.setView([20, 0], 2);
      return;
    }
    if (vessels.length === 1) {
      map.setView([vessels[0].lat, vessels[0].lon], 5);
      return;
    }
    const bounds = L.latLngBounds(vessels.map((v) => [v.lat, v.lon] as [number, number]));
    if (!bounds.isValid()) {
      map.setView([20, 0], 2);
      return;
    }
    map.fitBounds(bounds.pad(0.25), {
      animate: true,
      duration: 0.7,
      maxZoom: 8,
      padding: [36, 36],
    });
  }, [vessels, focusId, focusNonce, map]);

  return null;
}

function VesselMarker({
  vessel,
  active,
  focusNonce = 0,
}: {
  vessel: VesselFeature;
  active: boolean;
  focusNonce?: number;
}) {
  const markerRef = useRef<LeafletMarker | null>(null);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      markerRef.current?.openPopup();
    }, 320);
    return () => window.clearTimeout(timer);
  }, [active, focusNonce]);

  const bearing = bearingDegrees(vessel);
  const icon = useMemo(
    () => vesselIcon(Boolean(vessel.online), active, bearing),
    [vessel.online, active, bearing],
  );

  return (
    <Marker
      ref={markerRef}
      position={[vessel.lat, vessel.lon]}
      icon={icon}
    >
      <Popup>
        <div className="popup-title">{vessel.name}</div>
        <dl className="popup-grid">
          <dt>Type</dt>
          <dd>{vessel.objectType || "—"}</dd>
          <dt>Status</dt>
          <dd>{vessel.online ? "Online" : "Offline"}</dd>
          <dt>SOG</dt>
          <dd>
            {vessel.velocity != null ? `${vessel.velocity.toFixed(1)} kn` : "—"}
          </dd>
          <dt>Kurs</dt>
          <dd>
            {vessel.course != null ? `${Math.round(vessel.course)}°` : "—"}
          </dd>
          <dt>Alder</dt>
          <dd>{vessel.ageH || "—"}</dd>
        </dl>
      </Popup>
    </Marker>
  );
}

export default function FleetMap({ vessels, focusId, focusNonce = 0 }: Props) {
  const plotted = useMemo(() => vessels.slice(0, 400), [vessels]);

  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      className="map-root"
      zoomControl
      worldCopyJump
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <FitVessels vessels={plotted} focusId={focusId} focusNonce={focusNonce} />
      {plotted.map((vessel) => (
        <VesselMarker
          key={vessel.id}
          vessel={vessel}
          active={focusId === vessel.id}
          focusNonce={focusNonce}
        />
      ))}
    </MapContainer>
  );
}
