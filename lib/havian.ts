import type {
  BackgroundTarget,
  BackgroundTargetKind,
  ConnectionStatus,
  EndpointStatus,
  FleetPayload,
  ProjectAreaFeature,
  ProjectRow,
  TrackFeature,
  VesselFeature,
  WeatherForecastRow,
  WeatherObservation,
  WeatherPayload,
} from "./types";
import { sampleFleet } from "./sample";

/** TGS Ramform seismic vessels of interest (name match + known IMOs). */
const TGS_RAMFORM = [
  { match: "titan", imo: 9629885 },
  { match: "atlas", imo: 9629897 },
  { match: "vanguard", imo: 9188714 },
  { match: "hyperion", imo: 9676890 },
  { match: "tethys", imo: 9676888 },
  { match: "sovereign", imo: 9390460 },
  { match: "victory", imo: 9178630 },
] as const;

const MAX_AREA_PROJECTS = 14;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function authHeaderName(): string {
  return env("HAVIAN_AUTH_HEADER") || "AUTHTOKEN";
}

function hasLiveConfig(): boolean {
  return Boolean(env("HAVIAN_ENDPOINT") && env("HAVIAN_API_KEY") && env("HAVIAN_AUTH_KEY"));
}

function redactSecrets(text: string): string {
  let out = text;
  for (const name of ["HAVIAN_API_KEY", "HAVIAN_AUTH_KEY"] as const) {
    const secret = env(name);
    if (!secret) continue;
    // Upstream bodies may echo the key URL-encoded or with JSON-escaped slashes.
    const variants = new Set([
      secret,
      encodeURIComponent(secret),
      secret.replace(/\//g, "\\/"),
      JSON.stringify(secret).slice(1, -1),
    ]);
    for (const v of variants) {
      if (v) out = out.split(v).join("***");
    }
  }
  return out;
}

function redactJson(value: unknown): unknown {
  return JSON.parse(redactSecrets(JSON.stringify(value ?? null)));
}

type HavianResult = {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
};

type QueryValue = string | number | Array<string | number> | undefined;

async function havianGet(
  fn: string,
  action: string,
  params?: Record<string, QueryValue>,
): Promise<HavianResult> {
  const endpoint = env("HAVIAN_ENDPOINT")!.replace(/\/$/, "");
  const apiKey = env("HAVIAN_API_KEY")!;
  const authKey = env("HAVIAN_AUTH_KEY")!;
  const authHeader = authHeaderName();
  const version = env("HAVIAN_VERSION") || "v1";

  const url = new URL(`${endpoint}/${version}/`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("function", fn);
  url.searchParams.set("action", action);
  url.searchParams.set("format", "json");

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      [authHeader]: authKey,
    },
    cache: "no-store",
  });

  const text = await response.text();
  const safeText = redactSecrets(text);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body: null,
      error: `HTTP ${response.status}: ${safeText.slice(0, 300)}`,
    };
  }

  try {
    return { ok: true, status: response.status, body: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      status: response.status,
      body: null,
      error: `Non-JSON response: ${safeText.slice(0, 300)}`,
    };
  }
}

function extractProjects(body: unknown): ProjectRow[] {
  const queue: unknown[] = [body];
  while (queue.length) {
    const cur = queue.shift();
    if (
      Array.isArray(cur) &&
      cur.length > 0 &&
      typeof cur[0] === "object" &&
      cur[0] !== null &&
      "projectId" in (cur[0] as object)
    ) {
      return cur as ProjectRow[];
    }
    if (cur && typeof cur === "object") {
      queue.push(...Object.values(cur as Record<string, unknown>));
    }
  }
  return [];
}

function parseImoFromId(id: string): number | undefined {
  const m = /^imo_(\d+)$/i.exec(id);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function isTgsRamformName(name: string): boolean {
  const n = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (!n || /\bcable\b|\bstreamer\b/.test(n)) return false;
  const short = TGS_RAMFORM.map((x) => x.match).join("|");
  const ramformLike = new RegExp(
    `^(?:ramform|rform|r)\\s+(?:${short}|soverign)\\b|\\bramform\\b.*\\b(?:${short}|soverign)\\b`,
  );
  return ramformLike.test(n);
}

function extractVessels(
  body: unknown,
  background?: BackgroundTarget[],
): VesselFeature[] {
  const report =
    body && typeof body === "object" && "report" in body
      ? (body as { report?: { geojson?: { features?: unknown[] } } }).report
      : undefined;
  const features = report?.geojson?.features;
  if (!Array.isArray(features)) return [];

  const vessels: VesselFeature[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const f = feature as {
      geometry?: { coordinates?: number[] };
      properties?: Record<string, unknown>;
    };
    const coords = f.geometry?.coordinates;
    const props = f.properties || {};
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const name = String(props.name ?? "Unknown");
    const objectType = props.objectType ? String(props.objectType) : undefined;
    const posType = props.posType ? String(props.posType) : undefined;
    const online = props.online === 1 || props.online === true;
    const onProject = Boolean(props.onProject);
    const id = String(props.id ?? `${lon},${lat}`);
    const ageH = props.ageH ? String(props.ageH) : undefined;
    const toBackground = (kind: BackgroundTargetKind) =>
      background?.push({ id, name, lat, lon, kind, objectType, ageH });

    // Drop AIS noise: ATON/base stations, cables, unnamed MMSI-only tracks
    const typeLower = (objectType || "").toLowerCase();
    if (
      typeLower === "aton" ||
      typeLower === "base station" ||
      typeLower === "sar aircraft"
    ) {
      toBackground("aton");
      continue;
    }
    const nameUpper = name.toUpperCase();
    if (nameUpper.includes("CABLE") || nameUpper.startsWith("SUBMERGED")) {
      toBackground("cable");
      continue;
    }
    if (nameUpper.startsWith("MMSI:") || nameUpper.startsWith("V/")) {
      toBackground("ais");
      continue;
    }
    // Prefer fleet-relevant tracks (online, on project, or Havian tracker)
    const posLower = (posType || "").toLowerCase();
    const havianTracker =
      posLower.includes("havian tracker") && !posLower.includes("ais");
    if (!online && !onProject && !havianTracker) {
      toBackground("ais");
      continue;
    }

    vessels.push({
      id,
      name,
      lat,
      lon,
      course: typeof props.course === "number" ? props.course : undefined,
      heading: typeof props.heading === "number" ? props.heading : undefined,
      velocity: typeof props.velocity === "number" ? props.velocity : undefined,
      online,
      objectType,
      posType,
      onProject,
      ageH: props.ageH ? String(props.ageH) : undefined,
      gpsTimeH: props.gpsTimeH ? String(props.gpsTimeH) : undefined,
      imo: parseImoFromId(id),
    });
  }

  vessels.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
  return vessels;
}

function companyNameFrom(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const report = (body as { report?: { companyName?: string } }).report;
  return report?.companyName;
}

function collectGeoFeatures(body: unknown): Array<{
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
}> {
  const out: Array<{
    geometry?: { type?: string; coordinates?: unknown };
    properties?: Record<string, unknown>;
  }> = [];
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.features)) {
      for (const f of obj.features) {
        if (f && typeof f === "object") {
          out.push(f as (typeof out)[number]);
        }
      }
      return;
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(body);
  return out;
}

function extractTracks(body: unknown): TrackFeature[] {
  const tracks: TrackFeature[] = [];
  for (const feature of collectGeoFeatures(body)) {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates)) {
      continue;
    }
    const positions: [number, number][] = [];
    for (const pair of geom.coordinates as unknown[]) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const lon = Number(pair[0]);
      const lat = Number(pair[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      positions.push([lat, lon]);
    }
    if (positions.length < 2) continue;
    const projectIds = Array.isArray(props.projectIds)
      ? (props.projectIds as unknown[])
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n))
      : undefined;
    tracks.push({
      vessel: String(props.vessel ?? props.name ?? "Unknown"),
      vesselIMO:
        typeof props.vesselIMO === "number"
          ? props.vesselIMO
          : Number.isFinite(Number(props.vesselIMO))
            ? Number(props.vesselIMO)
            : undefined,
      mmsi: typeof props.mmsi === "number" ? props.mmsi : undefined,
      projectIds,
      firstFix: props.firstFix ? String(props.firstFix) : undefined,
      lastFix: props.lastFix ? String(props.lastFix) : undefined,
      points: typeof props.points === "number" ? props.points : positions.length,
      positions,
    });
  }
  return tracks;
}

function extractProjectAreas(
  body: unknown,
  projectId: number,
  projectName?: string,
): ProjectAreaFeature[] {
  const areas: ProjectAreaFeature[] = [];
  for (const feature of collectGeoFeatures(body)) {
    const geom = feature.geometry;
    if (!geom?.type || !geom.coordinates) continue;
    if (!/polygon|multipolygon/i.test(geom.type)) continue;
    const props = feature.properties || {};
    areas.push({
      projectId,
      projectName,
      name: String(props.name ?? props.block ?? `Area ${projectId}`),
      kind: props.kind ? String(props.kind) : undefined,
      areaKm2: typeof props.areaKm2 === "number" ? props.areaKm2 : undefined,
      geometry: {
        type: String(geom.type),
        coordinates: geom.coordinates,
      },
    });
  }
  return areas;
}

function extractObservations(body: unknown): {
  rows: WeatherObservation[];
  total?: number;
} {
  const report =
    body && typeof body === "object"
      ? (body as { report?: { weatherData?: Record<string, unknown> } }).report
      : undefined;
  const wd = report?.weatherData;
  if (!wd) return { rows: [] };
  const rawRows = Array.isArray(wd.rows) ? wd.rows : [];
  const rows: WeatherObservation[] = [];
  for (const row of rawRows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    rows.push({
      projectId: Number(r.projectId) || 0,
      projectName: r.projectName ? String(r.projectName) : undefined,
      vessel: String(r.vessel ?? "—"),
      vesselIMO:
        typeof r.vesselIMO === "number"
          ? r.vesselIMO
          : Number.isFinite(Number(r.vesselIMO))
            ? Number(r.vesselIMO)
            : undefined,
      time: String(r.time ?? ""),
      windSpeedKnots:
        typeof r.windSpeedKnots === "number" ? r.windSpeedKnots : undefined,
      beaufort: typeof r.beaufort === "number" ? r.beaufort : undefined,
      beaufortName: r.beaufortName ? String(r.beaufortName) : undefined,
      windFrom: r.windFrom ? String(r.windFrom) : undefined,
      waveHeightM: typeof r.waveHeightM === "number" ? r.waveHeightM : undefined,
      seaState: r.seaState ? String(r.seaState) : undefined,
      swellHeightM:
        typeof r.swellHeightM === "number" || typeof r.swellHeightM === "string"
          ? (r.swellHeightM as number | string)
          : undefined,
      pressureMbar:
        typeof r.pressureMbar === "number" ? r.pressureMbar : undefined,
      visibility: r.visibility ? String(r.visibility) : undefined,
    });
  }
  const total =
    typeof wd.rowsTotal === "number" ? wd.rowsTotal : undefined;
  return { rows, total };
}

function extractForecast(body: unknown): {
  rows: WeatherForecastRow[];
  total?: number;
} {
  const report =
    body && typeof body === "object"
      ? (body as { report?: { weatherData?: Record<string, unknown> } }).report
      : undefined;
  const wd = report?.weatherData;
  if (!wd) return { rows: [] };
  const rawRows = Array.isArray(wd.rows) ? wd.rows : [];
  const rows: WeatherForecastRow[] = [];
  for (const row of rawRows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    rows.push({
      projectId: Number(r.projectId) || 0,
      projectName: r.projectName ? String(r.projectName) : undefined,
      location: r.location ? String(r.location) : undefined,
      day: r.day ? String(r.day) : undefined,
      hours: typeof r.hours === "number" ? r.hours : undefined,
      windSpeedKnotsMean:
        typeof r.windSpeedKnotsMean === "number"
          ? r.windSpeedKnotsMean
          : undefined,
      windSpeedKnotsMax:
        typeof r.windSpeedKnotsMax === "number"
          ? r.windSpeedKnotsMax
          : undefined,
      beaufortMaxName: r.beaufortMaxName
        ? String(r.beaufortMaxName)
        : undefined,
      gustKnotsMax:
        typeof r.gustKnotsMax === "number" ? r.gustKnotsMax : undefined,
      waveHeightMMax:
        typeof r.waveHeightMMax === "number" ? r.waveHeightMMax : undefined,
      seaStateMax: r.seaStateMax ? String(r.seaStateMax) : undefined,
      airTempCMax:
        typeof r.airTempCMax === "number" ? r.airTempCMax : undefined,
      airTempCMin:
        typeof r.airTempCMin === "number" ? r.airTempCMin : undefined,
      precipMm: typeof r.precipMm === "number" ? r.precipMm : undefined,
    });
  }
  const total =
    typeof wd.rowsTotal === "number" ? wd.rowsTotal : undefined;
  return { rows, total };
}

function tgsImosFromVessels(vessels: VesselFeature[]): number[] {
  const found = new Set<number>();
  for (const v of vessels) {
    if (!isTgsRamformName(v.name)) continue;
    if (v.imo) found.add(v.imo);
  }
  // Always include the known fleet IMOs so tracks/weather work even if AIS aliases clutter names.
  for (const ship of TGS_RAMFORM) found.add(ship.imo);
  return [...found];
}

function areaCandidateProjects(projects: ProjectRow[]): ProjectRow[] {
  const skip =
    /\bstandby\b|\bmaintenance\b|\btransit\b|\blidar\b|\bpit\s*stop\b|\bcovering time\b/i;
  const active = projects.filter((p) => p.statusName === "Active");
  const preferred = active.filter((p) => !skip.test(p.name));
  const pool = preferred.length ? preferred : active;
  // Prefer acquisition / survey sounding names, then highest ids (newest).
  return [...pool]
    .sort((a, b) => {
      const score = (p: ProjectRow) =>
        (/\bACQ\b|\bOBN\b|\bSTR\b|\bUHR\b|\b4D\b/i.test(p.name) ? 2 : 0) +
        (/\bMC\b/i.test(p.name) ? -1 : 0);
      return score(b) - score(a) || b.projectId - a.projectId;
    })
    .slice(0, MAX_AREA_PROJECTS);
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function endpointStatus(
  header: string,
  fn: string,
  action: string,
  res: HavianResult,
): EndpointStatus {
  return {
    function: fn,
    action,
    ok: res.ok,
    status: res.status,
    error: res.error,
    authHeader: header,
  };
}

function emptyWeather(message?: string): WeatherPayload {
  return {
    observations: [],
    forecast: [],
    message: message || "No weather data",
  };
}

export async function loadFleet(): Promise<FleetPayload> {
  const header = authHeaderName();

  if (!hasLiveConfig()) {
    const sample = sampleFleet();
    return {
      ...sample,
      connection: {
        ok: false,
        mode: "sample",
        authHeader: header,
        configPresent: false,
        endpoints: [],
        message:
          "Missing HAVIAN_ENDPOINT / HAVIAN_API_KEY / HAVIAN_AUTH_KEY — showing sample data",
      },
      raw: {
        projects: { note: "sample mode — no live Havian response" },
        vessels: { note: "sample mode — no live Havian response" },
        tracks: { note: "sample mode" },
        projectAreas: { note: "sample mode" },
        observations: { note: "sample mode" },
        forecast: { note: "sample mode" },
      },
    };
  }

  const [projectsRes, vesselsRes] = await Promise.all([
    havianGet("project", "getProjects"),
    havianGet("vessel", "getVesselLocations"),
  ]);

  const endpoints: EndpointStatus[] = [
    endpointStatus(header, "project", "getProjects", projectsRes),
    endpointStatus(header, "vessel", "getVesselLocations", vesselsRes),
  ];

  const coreOk = projectsRes.ok && vesselsRes.ok;
  const projects = projectsRes.ok ? extractProjects(projectsRes.body) : [];
  const otherVessels: BackgroundTarget[] = [];
  const vessels = vesselsRes.ok
    ? extractVessels(vesselsRes.body, otherVessels)
    : [];

  let tracks: TrackFeature[] = [];
  let projectAreas: ProjectAreaFeature[] = [];
  let weather: WeatherPayload = emptyWeather();
  let tracksRaw: unknown = { skipped: true };
  let areasRaw: unknown = { skipped: true };
  let obsRaw: unknown = { skipped: true };
  let forecastRaw: unknown = { skipped: true };

  if (coreOk) {
    const imos = tgsImosFromVessels(vessels);
    const areaProjects = areaCandidateProjects(projects);
    const startObs = isoDateDaysAgo(-2);
    const endObs = isoDateDaysAgo(0);
    const startFc = isoDateDaysAgo(-1);
    const endFc = isoDateDaysAgo(3);

    const tracksPromise = havianGet("map", "getTracks", {
      vesselIMO: imos.join(","),
      maxPoints: 4000,
      source: "auto",
    });

    const areaPromises = areaProjects.map((p) =>
      havianGet("map", "getProjectArea", { projectId: p.projectId }).then(
        (res) => ({ project: p, res }),
      ),
    );

    const obsPromise = havianGet("weather", "getObservations", {
      vesselIMO: imos.join(","),
      start: startObs,
      end: endObs,
      page: "0:80",
      groupBy: "observations",
    });

    // Forecast needs projects[]; use area candidates (TGS ACQ projects).
    const forecastProjectIds = areaProjects
      .slice(0, 8)
      .map((p) => p.projectId);
    const forecastPromise =
      forecastProjectIds.length > 0
        ? havianGet("weather", "getForecast", {
            "projects[]": forecastProjectIds,
            start: startFc,
            end: endFc,
            groupBy: "daily",
            page: "0:40",
          })
        : Promise.resolve({
            ok: false,
            status: 0,
            body: null,
            error: "No active projects for forecast",
          } satisfies HavianResult);

    const [tracksRes, areaResults, obsRes, forecastRes] = await Promise.all([
      tracksPromise,
      Promise.all(areaPromises),
      obsPromise,
      forecastPromise,
    ]);

    endpoints.push(endpointStatus(header, "map", "getTracks", tracksRes));
    if (tracksRes.ok) {
      tracks = extractTracks(tracksRes.body);
      // Keep raw lean: full LineString coords bloat the fleet payload.
      tracksRaw = {
        summary: tracks.map((t) => ({
          vessel: t.vessel,
          vesselIMO: t.vesselIMO,
          points: t.points,
          firstFix: t.firstFix,
          lastFix: t.lastFix,
        })),
        note: "coordinates omitted from raw debug payload",
      };
    } else {
      tracksRaw = { error: tracksRes.error };
    }

    const areaBodies: Record<string, unknown> = {};
    let areasOk = 0;
    let areasFail = 0;
    for (const { project, res } of areaResults) {
      const key = String(project.projectId);
      if (res.ok) {
        areasOk += 1;
        areaBodies[key] = redactJson(res.body);
        projectAreas.push(
          ...extractProjectAreas(res.body, project.projectId, project.name),
        );
      } else {
        areasFail += 1;
        areaBodies[key] = { error: res.error };
      }
    }
    endpoints.push({
      function: "map",
      action: "getProjectArea",
      ok: areasOk > 0 || areaResults.length === 0,
      status: areasOk > 0 ? 200 : areasFail > 0 ? 502 : null,
      error:
        areasFail > 0
          ? `${areasOk} ok / ${areasFail} failed of ${areaResults.length}`
          : areasOk === 0 && areaResults.length > 0
            ? "No project areas returned"
            : undefined,
      authHeader: header,
    });
    areasRaw = areaBodies;

    endpoints.push(
      endpointStatus(header, "weather", "getObservations", obsRes),
    );
    endpoints.push(
      endpointStatus(header, "weather", "getForecast", forecastRes),
    );

    const obs = obsRes.ok
      ? extractObservations(obsRes.body)
      : { rows: [] as WeatherObservation[], total: undefined };
    const fc = forecastRes.ok
      ? extractForecast(forecastRes.body)
      : { rows: [] as WeatherForecastRow[], total: undefined };

    if (obsRes.ok) {
      const wd =
        obsRes.body && typeof obsRes.body === "object"
          ? (
              obsRes.body as {
                report?: { weatherData?: Record<string, unknown> };
              }
            ).report?.weatherData
          : undefined;
      obsRaw = redactJson({
        rowsTotal: wd?.rowsTotal,
        rowsReturned: wd?.rowsReturned,
        start: wd?.start,
        end: wd?.end,
        rows: (obs.rows || []).slice(0, 20),
      });
    } else {
      obsRaw = { error: obsRes.error };
    }
    if (forecastRes.ok) {
      const wd =
        forecastRes.body && typeof forecastRes.body === "object"
          ? (
              forecastRes.body as {
                report?: { weatherData?: Record<string, unknown> };
              }
            ).report?.weatherData
          : undefined;
      forecastRaw = redactJson({
        rowsTotal: wd?.rowsTotal,
        rowsReturned: wd?.rowsReturned,
        start: wd?.start,
        end: wd?.end,
        rows: (fc.rows || []).slice(0, 20),
      });
    } else {
      forecastRaw = { error: forecastRes.error };
    }

    const parts: string[] = [];
    if (!tracksRes.ok) parts.push("tracks unavailable");
    if (areasOk === 0 && areaResults.length > 0) parts.push("project areas empty");
    if (!obsRes.ok) parts.push("observations unavailable");
    else if (obs.rows.length === 0) parts.push("no recent observations");
    if (!forecastRes.ok) parts.push("forecast unavailable");
    else if (fc.rows.length === 0) parts.push("no forecast rows");

    weather = {
      observations: obs.rows,
      forecast: fc.rows,
      observationsTotal: obs.total,
      forecastTotal: fc.total,
      message: parts.length ? parts.join(" · ") : undefined,
    };
  }

  const connection: ConnectionStatus = {
    ok: coreOk,
    mode: coreOk ? "live" : "sample",
    authHeader: header,
    configPresent: true,
    endpoints,
    message: coreOk
      ? `Connected to Havian with header ${header}`
      : `Havian request failed (header ${header})`,
  };

  if (!coreOk) {
    const sample = sampleFleet();
    return {
      ...sample,
      source: "sample",
      connection,
      raw: {
        projects: projectsRes.ok
          ? redactJson(projectsRes.body)
          : { error: projectsRes.error },
        vessels: vesselsRes.ok
          ? redactJson(vesselsRes.body)
          : { error: vesselsRes.error },
        tracks: tracksRaw,
        projectAreas: areasRaw,
        observations: obsRaw,
        forecast: forecastRaw,
      },
    };
  }

  return {
    source: "live",
    fetchedAt: new Date().toISOString(),
    companyName:
      companyNameFrom(vesselsRes.body) || companyNameFrom(projectsRes.body),
    projects,
    vessels,
    otherVessels,
    tracks,
    projectAreas,
    weather,
    projectCount: projects.length,
    vesselCount: vessels.length,
    connection,
    raw: {
      projects: redactJson(projectsRes.body),
      vessels: redactJson(vesselsRes.body),
      tracks: tracksRaw,
      projectAreas: areasRaw,
      observations: obsRaw,
      forecast: forecastRaw,
    },
  };
}
