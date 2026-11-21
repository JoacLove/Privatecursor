"use client";

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  CircleMarker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { VesselFeature } from "@/lib/types";

type Props = {
  vessels: VesselFeature[];
  focusId: string | null;
};

function vesselIcon(online: boolean, active: boolean) {
  return L.divIcon({
    className: `vessel-marker${online ? " online" : " offline"}${active ? " active" : ""}`,
    html: '<div class="hull"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function FitVessels({ vessels, focusId }: Props) {
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
      map.setView([vessels[0].lat, vessels[0].lon], 4);
      return;
    }
    const bounds = L.latLngBounds(vessels.map((v) => [v.lat, v.lon]));
    map.fitBounds(bounds.pad(0.18), { animate: true, duration: 0.7 });
  }, [vessels, focusId, map]);

  return null;
}

export default function FleetMap({ vessels, focusId }: Props) {
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
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={19}
      />
      <FitVessels vessels={plotted} focusId={focusId} />
      {plotted.map((vessel) => (
        <CircleMarker
          key={`pin-${vessel.id}`}
          center={[vessel.lat, vessel.lon]}
          radius={5}
          pathOptions={{
            color: "#1f7a4d",
            fillColor: "#2f9e66",
            fillOpacity: 0.9,
            weight: 1.5,
          }}
        />
      ))}
      {plotted.map((vessel) => (
        <Marker
          key={vessel.id}
          position={[vessel.lat, vessel.lon]}
          icon={vesselIcon(Boolean(vessel.online), focusId === vessel.id)}
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
      ))}
    </MapContainer>
  );
}
