"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  CircleMarker,
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

function vesselIcon(online: boolean, active: boolean) {
  return L.divIcon({
    className: `vessel-marker${online ? " online" : " offline"}${active ? " active" : ""}`,
    html: '<div class="hull"></div>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
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

  return (
    <Marker
      ref={markerRef}
      position={[vessel.lat, vessel.lon]}
      icon={vesselIcon(Boolean(vessel.online), active)}
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
        <CircleMarker
          key={`pin-${vessel.id}`}
          center={[vessel.lat, vessel.lon]}
          radius={focusId === vessel.id ? 9 : 7}
          pathOptions={{
            color: focusId === vessel.id ? "#0b3d91" : "#0f5132",
            fillColor: vessel.online
              ? focusId === vessel.id
                ? "#1d4f91"
                : "#1f7a4d"
              : "#64748b",
            fillOpacity: 0.95,
            weight: 2,
            opacity: 0.95,
          }}
        />
      ))}
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
