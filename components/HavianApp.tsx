"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FleetPayload, ProjectRow, VesselFeature } from "@/lib/types";

const FleetMap = dynamic(() => import("./FleetMap"), {
  ssr: false,
  loading: () => <div className="map-loading">Laster kart…</div>,
});

type ViewMode = "map" | "table";

export default function HavianApp() {
  const [data, setData] = useState<FleetPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("map");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "Active" | "Finished">(
    "all"
  );
  const [focusId, setFocusId] = useState<string | null>(null);

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

  const projects = useMemo(() => {
    const rows = data?.projects ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter((p) => {
      if (statusFilter !== "all" && p.statusName !== statusFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        String(p.projectId).includes(q)
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
        (v.objectType || "").toLowerCase().includes(q)
    );
  }, [data, query]);

  const activeProjects = useMemo(
    () => (data?.projects ?? []).filter((p) => p.statusName === "Active").length,
    [data]
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">TGS · Global Manager</p>
          <h1 className="brand">Havian</h1>
        </div>
        <nav className="nav-links" aria-label="Hovedmeny">
          <span className="nav-active">Dashboards</span>
          <span>Events</span>
          <span>Tools</span>
          <span>Vessel Reports</span>
        </nav>
        <div className="top-actions">
          <div className="view-toggle" role="group" aria-label="Visning">
            <button
              type="button"
              className={view === "map" ? "on" : ""}
              onClick={() => setView("map")}
            >
              Map
            </button>
            <button
              type="button"
              className={view === "table" ? "on" : ""}
              onClick={() => setView("table")}
            >
              Table
            </button>
          </div>
          <button type="button" className="refresh" onClick={() => void load()}>
            Oppdater
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
          <strong>{data?.vesselCount ?? 0}</strong>
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
        {data?.source === "sample" ? (
          <div className="sample-badge">Sample data — bind Havian-secrets for live</div>
        ) : (
          <div className="live-badge">Live · {data?.companyName || "Havian"}</div>
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
          <div className="map-pane">
            <FleetMap vessels={vessels} focusId={focusId} />
            <aside className="side-list">
              <h2>Fartøy ({vessels.length})</h2>
              <ul>
                {vessels.slice(0, 80).map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      className={focusId === v.id ? "active" : ""}
                      onClick={() => setFocusId(v.id)}
                    >
                      <span className="name">{v.name}</span>
                      <span className={`dot ${v.online ? "on" : "off"}`} />
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        ) : (
          <div className="tables">
            <ProjectTable rows={projects} />
            <VesselTable
              rows={vessels}
              onFocus={(id) => {
                setFocusId(id);
                setView("map");
              }}
            />
          </div>
        )}
      </main>
    </div>
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
                  <button type="button" className="linkish" onClick={() => onFocus(v.id)}>
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
