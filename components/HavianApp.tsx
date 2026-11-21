"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [statusFilter, setStatusFilter] = useState<"all" | "Active" | "Finished">(
    "all",
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [showTracks, setShowTracks] = useState(true);
  const [showAreas, setShowAreas] = useState(true);

  const load = useCallback(async () => {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const focusVessel = useCallback((id: string) => {
    setFocusId(id);
    setFocusNonce((n) => n + 1);
    setView("map");
  }, []);

  const projects = useMemo(() => {
    const rows = data?.projects ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter((p) => {
      if (statusFilter !== "all" && p.statusName !== statusFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) || String(p.projectId).includes(q)
      );
    });
  }, [data, query, statusFilter]);

  const vessels = useMemo(() => {
    const rows = data?.vessels ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.id.toLowerCase().includes(q) ||
        (v.objectType || "").toLowerCase().includes(q),
    );
  }, [data, query]);

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
          <strong>{activeProjects || data?.projectCount || 0}</strong>
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
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | "Active" | "Finished")
            }
          >
            <option value="all">All projects</option>
            <option value="Active">Active</option>
            <option value="Finished">Finished</option>
          </select>
        </label>
        <label className="search">
          <span className="sr-only">Søk</span>
          <input
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
      </section>

      <main className="stage">
        {loading && !data ? (
          <div className="state">Henter Havian-data…</div>
        ) : error ? (
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
                        <span className={`dot ${v.online ? "on" : "off"}`} />
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

        {data?.raw && (
          <section className="raw-json">
            <details>
              <summary>Raw Havian JSON (secrets redacted)</summary>
              <details>
                <summary>project/getProjects</summary>
                <pre>{JSON.stringify(data.raw.projects, null, 2)}</pre>
              </details>
              <details>
                <summary>vessel/getVesselLocations</summary>
                <pre>{JSON.stringify(data.raw.vessels, null, 2)}</pre>
              </details>
              <details>
                <summary>map/getTracks</summary>
                <pre>{JSON.stringify(data.raw.tracks ?? null, null, 2)}</pre>
              </details>
              <details>
                <summary>map/getProjectArea</summary>
                <pre>
                  {JSON.stringify(data.raw.projectAreas ?? null, null, 2)}
                </pre>
              </details>
              <details>
                <summary>weather/getObservations</summary>
                <pre>
                  {JSON.stringify(data.raw.observations ?? null, null, 2)}
                </pre>
              </details>
              <details>
                <summary>weather/getForecast</summary>
                <pre>
                  {JSON.stringify(data.raw.forecast ?? null, null, 2)}
                </pre>
              </details>
            </details>
          </section>
        )}
      </main>
    </div>
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
      <h2>Projects ({rows.length})</h2>
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
