"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Tooltip,
  Polyline,
  GeoJSON,
  useMap,
} from "react-leaflet";
import type { Marker as LeafletMarker } from "leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type {
  BackgroundTarget,
  BackgroundTargetKind,
  ProjectAreaFeature,
  TrackFeature,
  VesselFeature,
} from "@/lib/types";
type Props = {
  vessels: VesselFeature[];
  tracks?: TrackFeature[];
  projectAreas?: ProjectAreaFeature[];
  showTracks?: boolean;
  showAreas?: boolean;
  otherVessels?: BackgroundTarget[];
  showOther?: boolean;
  focusId: string | null;
  focusNonce?: number;
};

/** Leaflet bindPopup takes raw HTML; Havian strings must not be interpreted as markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Short display labels for the TGS Ramform seismic vessels. */
const TGS_RAMFORM_LABELS: { match: string; label: string }[] = [
  { match: "titan", label: "TITAN" },
  { match: "atlas", label: "ATLAS" },
  { match: "vanguard", label: "Vanguard" },
  { match: "hyperion", label: "Hyperion" },
  { match: "tethys", label: "Tethys" },
  { match: "sovereign", label: "Sovereign" },
  { match: "victory", label: "Victory" },
];

const TRACK_COLORS = [
  "#0c6b6b",
  "#1d4f91",
  "#9a3412",
  "#166534",
  "#7c3aed",
  "#b45309",
  "#0e7490",
];

/**
 * Permanent map label for known TGS Ramform vessels.
 * Matches case-insensitively with "Ramform …" / "R …" prefixes;
 * skips streamer cables and unrelated AIS targets that only share a word.
 */
function tgsRamformLabel(name: string): string | null {
  const n = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (/\bcable\b|\bstreamer\b/.test(n)) return null;

  const short = TGS_RAMFORM_LABELS.map((x) => x.match).join("|");
  const ramformLike = new RegExp(
    `^(?:ramform|rform|r)\\s+(?:${short}|soverign)\\b|\\bramform\\b.*\\b(?:${short}|soverign)\\b`,
  );
  if (!ramformLike.test(n)) return null;

  for (const { match, label } of TGS_RAMFORM_LABELS) {
    if (new RegExp(`\\b${match}\\b`).test(n)) return label;
  }
  if (/\bsoverign\b/.test(n)) return "Sovereign";
  return null;
}

/** Prefer heading when present, else course (degrees, 0 = north). */
function bearingDegrees(vessel: VesselFeature): number | undefined {
  const raw =
    typeof vessel.heading === "number"
      ? vessel.heading
      : typeof vessel.course === "number"
        ? vessel.course
        : undefined;
  if (raw == null || !Number.isFinite(raw)) return undefined;
  return ((raw % 360) + 360) % 360;
}

function vesselIcon(online: boolean, active: boolean, bearing?: number) {
  const hasBearing = bearing != null;
  const courseStyle = hasBearing ? `style="--course:${bearing}deg"` : "";
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

/** Leaflet often mounts before the pane has its final size — force a redraw. */
function InvalidateSize() {
  const map = useMap();

  useEffect(() => {
    const refresh = () => map.invalidateSize({ animate: false });
    refresh();
    const t1 = window.setTimeout(refresh, 50);
    const t2 = window.setTimeout(refresh, 250);
    const t3 = window.setTimeout(refresh, 600);
    window.addEventListener("resize", refresh);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener("resize", refresh);
    };
  }, [map]);

  return null;
}

function FitVessels({ vessels, focusId, focusNonce = 0 }: Props) {
  const map = useMap();
  const vesselsRef = useRef(vessels);
  vesselsRef.current = vessels;

  // Refit only when the set of vessels changes (search/filter), not when a
  // periodic refresh moves positions — that would keep resetting the user's view.
  const fitKey = useMemo(
    () => vessels.map((v) => v.id).sort().join("|"),
    [vessels],
  );

  useEffect(() => {
    if (!focusId) return;
    const hit = vesselsRef.current.find((v) => v.id === focusId);
    if (hit) {
      map.flyTo([hit.lat, hit.lon], Math.max(map.getZoom(), 5), {
        duration: 0.8,
      });
    }
  }, [focusId, focusNonce, map]);

  useEffect(() => {
    const vessels = vesselsRef.current;
    map.invalidateSize({ animate: false });
    if (vessels.length === 0) {
      map.setView([20, 0], 2);
      return;
    }
    if (vessels.length === 1) {
      map.setView([vessels[0].lat, vessels[0].lon], 5);
      return;
    }
    const bounds = L.latLngBounds(
      vessels.map((v) => [v.lat, v.lon] as [number, number]),
    );
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
  }, [fitKey, map]);

  return null;
}

const VesselMarker = memo(function VesselMarker({
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
  const nameLabel = useMemo(() => tgsRamformLabel(vessel.name), [vessel.name]);

  return (
    <Marker
      ref={markerRef}
      position={[vessel.lat, vessel.lon]}
      icon={icon}
      zIndexOffset={nameLabel ? 400 : 0}
    >
      {nameLabel ? (
        <Tooltip
          permanent
          direction="top"
          offset={[0, -16]}
          opacity={1}
          className="vessel-name-label"
        >
          {nameLabel}
        </Tooltip>
      ) : null}
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
});

const BACKGROUND_STYLE: Record<BackgroundTargetKind, { color: string; label: string }> = {
  ais: { color: "#64748b", label: "AIS" },
  aton: { color: "#b45309", label: "ATON / base" },
  cable: { color: "#7c3aed", label: "Kabel" },
};

/** Hundreds of non-fleet AIS targets: drawn imperatively on one canvas, not as React/DOM markers. */
function BackgroundTargetsLayer({ targets }: { targets: BackgroundTarget[] }) {
  const map = useMap();

  useEffect(() => {
    const renderer = L.canvas({ padding: 0.5 });
    const group = L.layerGroup();
    for (const t of targets) {
      const style = BACKGROUND_STYLE[t.kind];
      L.circleMarker([t.lat, t.lon], {
        renderer,
        radius: 3,
        weight: 1,
        color: style.color,
        fillColor: style.color,
        fillOpacity: 0.55,
        opacity: 0.8,
      })
        .bindTooltip(
          `${escapeHtml(t.name)}<br><small>${style.label}${t.objectType ? ` · ${escapeHtml(t.objectType)}` : ""}${t.ageH ? ` · ${escapeHtml(t.ageH)}` : ""}</small>`,
          { direction: "top", offset: [0, -4] },
        )
        .addTo(group);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [targets, map]);

  return null;
}

function TrackLayers({ tracks }: { tracks: TrackFeature[] }) {
  return (
    <>
      {tracks.map((track, i) => (
        <Polyline
          key={`${track.vesselIMO ?? track.vessel}-${i}`}
          positions={track.positions}
          pathOptions={{
            color: TRACK_COLORS[i % TRACK_COLORS.length],
            weight: 3,
            opacity: 0.85,
            lineCap: "round",
            lineJoin: "round",
          }}
        >
          <Popup>
            <div className="popup-title">{track.vessel}</div>
            <dl className="popup-grid">
              <dt>Punkter</dt>
              <dd>{track.points ?? track.positions.length}</dd>
              <dt>Fra</dt>
              <dd>{track.firstFix || "—"}</dd>
              <dt>Til</dt>
              <dd>{track.lastFix || "—"}</dd>
            </dl>
          </Popup>
        </Polyline>
      ))}
    </>
  );
}

function AreaLayers({ areas }: { areas: ProjectAreaFeature[] }) {
  const collection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: areas.map((area, i) => ({
        type: "Feature" as const,
        id: `${area.projectId}-${i}`,
        properties: {
          name: area.name,
          projectId: area.projectId,
          projectName: area.projectName,
          kind: area.kind,
          areaKm2: area.areaKm2,
        },
        geometry: area.geometry as GeoJSON.Geometry,
      })),
    }),
    [areas],
  );

  if (areas.length === 0) return null;

  return (
    <GeoJSON
      key={areas.map((a) => `${a.projectId}:${a.name}`).join("|")}
      data={collection as GeoJSON.FeatureCollection}
      style={() => ({
        color: "#084f54",
        weight: 1.5,
        opacity: 0.9,
        fillColor: "#0c6b6b",
        fillOpacity: 0.18,
      })}
      onEachFeature={(feature, layer) => {
        const props = feature.properties || {};
        const title = escapeHtml(String(props.name || "Project area"));
        const project = props.projectName
          ? `<div class="popup-sub">${escapeHtml(String(props.projectName))}</div>`
          : "";
        const km =
          props.areaKm2 != null
            ? `<div>${Number(props.areaKm2).toFixed(0)} km²</div>`
            : "";
        layer.bindPopup(
          `<div class="popup-title">${title}</div>${project}${km}`,
        );
      }}
    />
  );
}

const EMPTY_TARGETS: BackgroundTarget[] = [];

export default function FleetMap({
  vessels,
  tracks = [],
  projectAreas = [],
  showTracks = true,
  showAreas = true,
  otherVessels = EMPTY_TARGETS,
  showOther = false,
  focusId,
  focusNonce = 0,
}: Props) {
  const plotted = useMemo(() => {
    const labeled: VesselFeature[] = [];
    const rest: VesselFeature[] = [];
    for (const v of vessels) {
      if (tgsRamformLabel(v.name)) labeled.push(v);
      else rest.push(v);
    }
    return [...labeled, ...rest].slice(0, 400);
  }, [vessels]);

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
      <InvalidateSize />
      <FitVessels vessels={plotted} focusId={focusId} focusNonce={focusNonce} />
      {showAreas ? <AreaLayers areas={projectAreas} /> : null}
      {showOther && otherVessels.length > 0 ? (
        <BackgroundTargetsLayer targets={otherVessels} />
      ) : null}
      {showTracks ? <TrackLayers tracks={tracks} /> : null}
      {plotted.map((vessel) => (
        <VesselMarker
          key={vessel.id}
          vessel={vessel}
          active={focusId === vessel.id}
          focusNonce={focusId === vessel.id ? focusNonce : 0}
        />
      ))}
    </MapContainer>
  );
}
