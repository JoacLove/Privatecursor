import type {
  ConnectionStatus,
  EndpointStatus,
  FleetPayload,
  ProjectRow,
  VesselFeature,
} from "./types";
import { sampleFleet } from "./sample";

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
    if (secret) out = out.split(secret).join("***");
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

async function havianGet(fn: string, action: string): Promise<HavianResult> {
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

function extractVessels(body: unknown): VesselFeature[] {
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
    vessels.push({
      id: String(props.id ?? `${lon},${lat}`),
      name: String(props.name ?? "Unknown"),
      lat,
      lon,
      course: typeof props.course === "number" ? props.course : undefined,
      heading: typeof props.heading === "number" ? props.heading : undefined,
      velocity: typeof props.velocity === "number" ? props.velocity : undefined,
      online: props.online === 1 || props.online === true,
      objectType: props.objectType ? String(props.objectType) : undefined,
      posType: props.posType ? String(props.posType) : undefined,
      onProject: Boolean(props.onProject),
      ageH: props.ageH ? String(props.ageH) : undefined,
      gpsTimeH: props.gpsTimeH ? String(props.gpsTimeH) : undefined,
    });
  }
  return vessels;
}

function companyNameFrom(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const report = (body as { report?: { companyName?: string } }).report;
  return report?.companyName;
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
      },
    };
  }

  const [projectsRes, vesselsRes] = await Promise.all([
    havianGet("project", "getProjects"),
    havianGet("vessel", "getVesselLocations"),
  ]);

  const endpoints: EndpointStatus[] = [
    {
      function: "project",
      action: "getProjects",
      ok: projectsRes.ok,
      status: projectsRes.status,
      error: projectsRes.error,
      authHeader: header,
    },
    {
      function: "vessel",
      action: "getVesselLocations",
      ok: vesselsRes.ok,
      status: vesselsRes.status,
      error: vesselsRes.error,
      authHeader: header,
    },
  ];

  const ok = projectsRes.ok && vesselsRes.ok;
  const projects = projectsRes.ok ? extractProjects(projectsRes.body) : [];
  const vessels = vesselsRes.ok ? extractVessels(vesselsRes.body) : [];

  const connection: ConnectionStatus = {
    ok,
    mode: ok ? "live" : "sample",
    authHeader: header,
    configPresent: true,
    endpoints,
    message: ok
      ? `Connected to Havian with header ${header}`
      : `Havian request failed (header ${header})`,
  };

  if (!ok) {
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
    projectCount: projects.length,
    vesselCount: vessels.length,
    connection,
    raw: {
      projects: redactJson(projectsRes.body),
      vessels: redactJson(vesselsRes.body),
    },
  };
}
