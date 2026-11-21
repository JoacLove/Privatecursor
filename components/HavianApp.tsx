"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FleetPayload,
  ProjectRow,
  VesselFeature,
  WeatherForecastRow,
  WeatherObservation,
} from "@/lib/types";
const FleetMap = dynamic(() => import("./FleetMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Laster kart…</div>,
});

type ViewMode = "map" | "table";

const REFRESH_MS = 60_000;

const TGS_RAMFORM_RE =
  /\bramform\s+(titan|atlas|vanguard|hyperion|tethys|sovereign|victory)\b/i;

const berlinTime = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatBerlin(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : berlinTime.format(d);
}

function latestObservationPerVessel(
  rows: WeatherObservation[],
): WeatherObservation[] {
  const best = new Map<string, WeatherObservation>();
  for (const row of rows) {
    const key = row.vesselIMO
      ? `imo:${row.vesselIMO}`
      : `name:${row.vessel.toLowerCase()}`;
    const prev = best.get(key);
    if (!prev || String(row.time) > String(prev.time)) {
      best.set(key, row);
    }
  }
  return [...best.values()].sort((a, b) =>
    a.vessel.localeCompare(b.vessel),
  );
}

function compactForecast(rows: WeatherForecastRow[]): WeatherForecastRow[] {
  // One row per project+day, prefer locations that mention Ramform.
  const best = new Map<string, WeatherForecastRow>();
  for (const row of rows) {
    if (!row.day) continue;
    const key = `${row.projectId}:${row.day}`;
    const prev = best.get(key);
    const score = (r: WeatherForecastRow) =>
      /ramform/i.test(r.location || "") ? 2 : 1;
    if (!prev || score(row) > score(prev)) best.set(key, row);
  }
  return [...best.values()]
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .slice(0, 8);
}

export default function HavianApp() {
  const [data, setData] = useState<FleetPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("map");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [showTracks, setShowTracks] = useState(true);
  const [showAreas, setShowAreas] = useState(true);
  const [showOther, setShowOther] = useState(false);
  const inflightRef = useRef(false);
  const lastLoadRef = useRef(0);

  const load = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fleet", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as FleetPayload;
      setData(json);
      lastLoadRef.current = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente data");
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      if (Date.now() - lastLoadRef.current >= REFRESH_MS - 1000) void load();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  const focusVessel = useCallback((id: string) => {
    setFocusId(id);
    setFocusNonce((n) => n + 1);
    setView("map");
  }, []);

  const projects = useMemo(() => {
    const rows = data?.projects ?? [];
    const q = query.trim().toLowerCase();
    return rows
      .filter((p) => {
        if (statusFilter !== "all" && p.statusName !== statusFilter) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) || String(p.projectId).includes(q)
        );
      })
      .sort(
        (a, b) =>
          Number(b.statusName === "Active") - Number(a.statusName === "Active") ||
          b.projectId - a.projectId,
      );
  }, [data, query, statusFilter]);

  const statusOptions = useMemo(() => {
    const names = new Set<string>();
    for (const p of data?.projects ?? []) if (p.statusName) names.add(p.statusName);
    return [...names].sort();
  }, [data]);

  const otherVessels = useMemo(() => {
    const rows = data?.otherVessels ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.objectType || "").toLowerCase().includes(q),
    );
  }, [data, query]);

  const updatedAt = formatBerlin(data?.fetchedAt);

  const fleetVessels = useMemo(() => {
    const rows = data?.vessels ?? [];
    const isRamform = (v: VesselFeature) => (TGS_RAMFORM_RE.test(v.name) ? 1 : 0);
    // Stable sort keeps the server's online/name order within each group.
    return [...rows].sort((a, b) => isRamform(b) - isRamform(a));
  }, [data]);

  const vessels = useMemo(() => {
    const rows = fleetVessels;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.id.toLowerCase().includes(q) ||
        (v.objectType || "").toLowerCase().includes(q),
    );
  }, [fleetVessels, query]);

  useEffect(() => {
    if (focusId && !vessels.some((v) => v.id === focusId)) {
      setFocusId(null);
    }
  }, [vessels, focusId]);

  const activeProjects = useMemo(
    () => (data?.projects ?? []).filter((p) => p.statusName === "Active").length,
    [data],
  );

  const obsLatest = useMemo(
    () => latestObservationPerVessel(data?.weather?.observations ?? []),
    [data],
  );
  const forecastRows = useMemo(
    () => compactForecast(data?.weather?.forecast ?? []),
    [data],
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">TGS · Global Manager</p>
          <h1 className="brand">Havian</h1>
        </div>
        <nav className="nav-links" aria-label="Hovedmeny">
          <span className="nav-active" aria-current="page">
            Dashboards
          </span>
          <span
            className="nav-disabled"
            title="Kun i Havian Global Manager — ikke tilgjengelig her"
            aria-disabled="true"
          >
            Events
          </span>
          <span
            className="nav-disabled"
            title="Kun i Havian Global Manager — ikke tilgjengelig her"
            aria-disabled="true"
          >
            Tools
          </span>
          <span
            className="nav-disabled"
            title="Kun i Havian Global Manager — ikke tilgjengelig her"
            aria-disabled="true"
          >
            Vessel Reports
          </span>
        </nav>
        <div className="top-actions">
          <div className="view-toggle" role="group" aria-label="Visning">
            <button
              type="button"
              className={view === "map" ? "on" : ""}
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
            >
              Map
            </button>
            <button
              type="button"
              className={view === "table" ? "on" : ""}
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
            >
              Table
            </button>
          </div>
          <button
            type="button"
            className="refresh"
            onClick={() => void load()}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "Oppdaterer…" : "Oppdater"}
          </button>
        </div>
      </header>

      <section className="toolbar">
        <div className="chip strong">
          Active projects
          <strong>{activeProjects}</strong>
        </div>
        <div className="chip">
          Vessels
          <strong>{query ? vessels.length : (data?.vesselCount ?? 0)}</strong>
        </div>
        <div className="chip">
          Tracks
          <strong>{data?.tracks?.length ?? 0}</strong>
        </div>
        <div className="chip">
          Areas
          <strong>{data?.projectAreas?.length ?? 0}</strong>
        </div>
        <label className="filter">
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All projects</option>
            {(statusOptions.length ? statusOptions : ["Active", "Finished"]).map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="search">
          <span className="sr-only">Søk</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Søk prosjekt eller fartøy"
          />
        </label>
        {data?.connection?.ok ? (
          <div className="live-badge">
            API connected · header {data.connection.authHeader}
          </div>
        ) : (
          <div className="sample-badge">
            {data?.connection?.message || "API not connected"}
          </div>
        )}
        {updatedAt ? (
          <div
            className="chip updated"
            title={`Auto-oppdateres hvert ${REFRESH_MS / 1000}. sekund mens fanen er synlig`}
          >
            Oppdatert
            <strong>
              <time dateTime={data?.fetchedAt}>{updatedAt}</time>
            </strong>
            <span className="tz">Berlin</span>
          </div>
        ) : null}
      </section>

      <main className="stage">
        {error && data ? (
          <div className="refresh-error" role="alert">
            Oppdatering feilet: {error} — viser data fra {updatedAt ?? "forrige henting"}.
            <button type="button" onClick={() => void load()} disabled={loading}>
              Prøv igjen
            </button>
          </div>
        ) : null}
        {loading && !data ? (
          <div className="state" role="status">
            Henter Havian-data…
          </div>
        ) : error && !data ? (
          <div className="state error">
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>
              Prøv igjen
            </button>
          </div>
        ) : view === "map" ? (
          <div
            className="map-pane"
            role="region"
            aria-label="Verdenskart med fartøy"
          >
            <div className="map-stack">
              <FleetMap
                vessels={vessels}
                tracks={data?.tracks ?? []}
                projectAreas={data?.projectAreas ?? []}
                showTracks={showTracks}
                showAreas={showAreas}
                otherVessels={otherVessels}
                showOther={showOther}
                focusId={focusId}
                focusNonce={focusNonce}
              />
              <div className="map-layer-toggles" role="group" aria-label="Kartlag">
                <label>
                  <input
                    type="checkbox"
                    checked={showTracks}
                    onChange={(e) => setShowTracks(e.target.checked)}
                  />
                  Spor ({data?.tracks?.length ?? 0})
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showAreas}
                    onChange={(e) => setShowAreas(e.target.checked)}
                  />
                  Prosjektområder ({data?.projectAreas?.length ?? 0})
                </label>
                {(data?.otherVessels?.length ?? 0) > 0 ? (
                  <label title="Øvrig AIS-trafikk, ATON/basestasjoner og kabler som ikke er fartøy i flåten">
                    <input
                      type="checkbox"
                      checked={showOther}
                      onChange={(e) => setShowOther(e.target.checked)}
                    />
                    Øvrig AIS ({otherVessels.length})
                  </label>
                ) : null}
              </div>
            </div>
            <aside className="side-column">
              <div className="side-list">
                <h2>Fartøy ({vessels.length})</h2>
                <ul>
                  {vessels.slice(0, 80).map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        className={focusId === v.id ? "active" : ""}
                        onClick={() => focusVessel(v.id)}
                      >
                        <span className="name">{v.name}</span>
                        <span
                          className={`dot ${v.online ? "on" : "off"}`}
                          role="img"
                          aria-label={v.online ? "Online" : "Offline"}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <WeatherPanel
                observations={obsLatest}
                forecast={forecastRows}
                statusMessage={data?.weather?.message}
                loading={loading}
              />
            </aside>
          </div>
        ) : (
          <div className="tables">
            <WeatherPanel
              observations={obsLatest}
              forecast={forecastRows}
              statusMessage={data?.weather?.message}
              loading={loading}
              wide
            />
            <ProjectTable rows={projects} />
            <VesselTable rows={vessels} onFocus={focusVessel} />
          </div>
        )}

        {data?.connection && (
          <section className="api-status" aria-live="polite">
            <details>
              <summary>
                <span
                  className={`api-pill ${data.connection.ok ? "ok" : "bad"}`}
                >
                  {data.connection.ok ? "Havian API: OK" : "Havian API: FAIL"}
                </span>
                <span className="api-msg">{data.connection.message}</span>
              </summary>
              <ul className="api-endpoints">
                {data.connection.endpoints.map((ep) => (
                  <li key={`${ep.function}/${ep.action}`}>
                    <code>
                      {ep.function}/{ep.action}
                    </code>
                    <span className={ep.ok ? "ok" : "bad"}>
                      {ep.ok
                        ? `HTTP ${ep.status}`
                        : ep.error || `HTTP ${ep.status}`}
                    </span>
                    <span className="hdr">header: {ep.authHeader}</span>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        )}

        {data && <RawJsonPanel />}
      </main>
    </div>
  );
}

const RAW_SECTIONS: { key: keyof NonNullable<FleetPayload["raw"]>; label: string }[] = [
  { key: "projects", label: "project/getProjects" },
  { key: "vessels", label: "vessel/getVesselLocations" },
  { key: "tracks", label: "map/getTracks" },
  { key: "projectAreas", label: "map/getProjectArea" },
  { key: "observations", label: "weather/getObservations" },
  { key: "forecast", label: "weather/getForecast" },
];

/** Raw JSON is ~0.5 MB, so it is fetched (`?debug=1`) and stringified only when opened. */
function RawJsonPanel() {
  const [raw, setRaw] = useState<FleetPayload["raw"] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const fetchRaw = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/fleet?debug=1", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as FleetPayload;
      setRaw(json.raw ?? { projects: null, vessels: null });
      setState("idle");
    } catch {
      setState("error");
    }
  }, []);

  return (
    <section className="raw-json">
      <details
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open && !raw) void fetchRaw();
        }}
      >
        <summary>Raw Havian JSON (secrets redacted)</summary>
        {state === "loading" ? <p>Henter rå JSON…</p> : null}
        {state === "error" ? (
          <p>
            Kunne ikke hente rå JSON.{" "}
            <button type="button" onClick={() => void fetchRaw()}>
              Prøv igjen
            </button>
          </p>
        ) : null}
        {raw ? (
          <>
            <button type="button" onClick={() => void fetchRaw()}>
              Hent på nytt
            </button>
            {RAW_SECTIONS.map(({ key, label }) => (
              <RawBlock key={key} label={label} value={raw[key]} />
            ))}
          </>
        ) : null}
      </details>
    </section>
  );
}

function RawBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(
    () => (open ? JSON.stringify(value ?? null, null, 2) : ""),
    [open, value],
  );
  return (
    <details onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{label}</summary>
      {open ? <pre>{text}</pre> : null}
    </details>
  );
}

function WeatherPanel({
  observations,
  forecast,
  statusMessage,
  loading,
  wide,
}: {
  observations: WeatherObservation[];
  forecast: WeatherForecastRow[];
  statusMessage?: string;
  loading?: boolean;
  wide?: boolean;
}) {
  const empty = observations.length === 0 && forecast.length === 0;

  return (
    <section
      className={`weather-panel${wide ? " wide" : ""}`}
      aria-label="Vær"
    >
      <header className="weather-head">
        <h2>Vær</h2>
        {statusMessage ? (
          <p className="weather-status warn">{statusMessage}</p>
        ) : empty && !loading ? (
          <p className="weather-status muted">Ingen værdata tilgjengelig</p>
        ) : (
          <p className="weather-status ok">Observasjoner + prognose</p>
        )}
      </header>

      {empty ? (
        <p className="weather-empty">
          {loading
            ? "Henter vær…"
            : "Ingen observasjoner eller prognose for TGS-fartøyene akkurat nå."}
        </p>
      ) : (
        <div className="weather-body">
          {observations.length > 0 ? (
            <div className="weather-block">
              <h3>Siste observasjoner</h3>
              <ul className="weather-list">
                {observations.slice(0, 7).map((o) => (
                  <li key={`${o.vesselIMO ?? o.vessel}-${o.time}`}>
                    <div className="wx-title">
                      <strong>{o.vessel.replace(/^Ramform\s+/i, "")}</strong>
                      <span>{o.time}</span>
                    </div>
                    <div className="wx-meta">
                      {o.windSpeedKnots != null
                        ? `${o.windSpeedKnots.toFixed(0)} kn`
                        : "—"}
                      {o.windFrom ? ` ${o.windFrom}` : ""}
                      {o.beaufortName ? ` · ${o.beaufortName}` : ""}
                      {o.waveHeightM != null
                        ? ` · Hs ${o.waveHeightM.toFixed(1)} m`
                        : ""}
                      {o.seaState ? ` · ${o.seaState}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="weather-empty subtle">Ingen observasjoner</p>
          )}

          {forecast.length > 0 ? (
            <div className="weather-block">
              <h3>Prognose</h3>
              <ul className="weather-list">
                {forecast.map((f) => (
                  <li key={`${f.projectId}-${f.day}-${f.location}`}>
                    <div className="wx-title">
                      <strong>{f.day}</strong>
                      <span className="wx-proj">
                        {(f.projectName || `P${f.projectId}`).slice(0, 42)}
                        {(f.projectName || "").length > 42 ? "…" : ""}
                      </span>
                    </div>
                    <div className="wx-meta">
                      {f.windSpeedKnotsMax != null
                        ? `maks ${f.windSpeedKnotsMax.toFixed(0)} kn`
                        : "—"}
                      {f.beaufortMaxName ? ` · ${f.beaufortMaxName}` : ""}
                      {f.gustKnotsMax != null
                        ? ` · gust ${f.gustKnotsMax.toFixed(0)}`
                        : ""}
                      {f.waveHeightMMax != null
                        ? ` · Hs ${f.waveHeightMMax.toFixed(1)} m`
                        : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="weather-empty subtle">Ingen prognose</p>
          )}
        </div>
      )}
    </section>
  );
}

function ProjectTable({ rows }: { rows: ProjectRow[] }) {
  return (
    <section className="table-card">
      <h2>
        Projects ({rows.length})
        {rows.length > 100 ? (
          <span className="table-note"> · viser 100 første (aktive først) — bruk søk/status</span>
        ) : null}
      </h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((p) => (
              <tr key={p.projectId}>
                <td>{p.projectId}</td>
                <td>{p.name}</td>
                <td>{p.statusName || "—"}</td>
                <td>{p.progress != null ? `${p.progress}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VesselTable({
  rows,
  onFocus,
}: {
  rows: VesselFeature[];
  onFocus: (id: string) => void;
}) {
  return (
    <section className="table-card">
      <h2>Vessels ({rows.length})</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Online</th>
              <th>Position</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((v) => (
              <tr key={v.id}>
                <td>
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => onFocus(v.id)}
                  >
                    {v.name}
                  </button>
                </td>
                <td>{v.objectType || "—"}</td>
                <td>{v.online ? "Online" : "Offline"}</td>
                <td>
                  {v.lat.toFixed(2)}, {v.lon.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
