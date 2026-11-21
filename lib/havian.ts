import type { FleetPayload, ProjectRow, VesselFeature } from "./types";
import { sampleFleet } from "./sample";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
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

async function havianGet(fn: string, action: string): Promise<unknown> {
  const endpoint = env("HAVIAN_ENDPOINT")!.replace(/\/$/, "");
  const apiKey = env("HAVIAN_API_KEY")!;
  const authKey = env("HAVIAN_AUTH_KEY")!;
  const authHeader = env("HAVIAN_AUTH_HEADER") || "AUTHTOKEN";
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
  if (!response.ok) {
    throw new Error(
      `Havian ${fn}/${action} failed: ${response.status} ${redactSecrets(text).slice(0, 200)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Havian ${fn}/${action} returned non-JSON`);
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
      ? (body as { report?: { geojson?: { features?: unknown[] }; companyName?: string } }).report
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

    // Drop AIS noise: ATON/base stations, cables, unnamed MMSI-only tracks
    const typeLower = (objectType || "").toLowerCase();
    if (
      typeLower === "aton" ||
      typeLower === "base station" ||
      typeLower === "sar aircraft"
    ) {
      continue;
    }
    const nameUpper = name.toUpperCase();
    if (
      nameUpper.startsWith("MMSI:") ||
      nameUpper.includes("CABLE") ||
      nameUpper.startsWith("V/") ||
      nameUpper.startsWith("SUBMERGED")
    ) {
      continue;
    }
    // Prefer fleet-relevant tracks (online, on project, or Havian tracker)
    const posLower = (posType || "").toLowerCase();
    const havianTracker =
      posLower.includes("havian tracker") && !posLower.includes("ais");
    if (!online && !onProject && !havianTracker) continue;

    vessels.push({
      id: String(props.id ?? `${lon},${lat}`),
      name,
      lat,
      lon,
      course: typeof props.course === "number" ? props.course : undefined,
      velocity: typeof props.velocity === "number" ? props.velocity : undefined,
      online,
      objectType,
      posType,
      onProject,
      ageH: props.ageH ? String(props.ageH) : undefined,
      gpsTimeH: props.gpsTimeH ? String(props.gpsTimeH) : undefined,
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

export async function loadFleet(): Promise<FleetPayload> {
  if (!hasLiveConfig()) {
    return sampleFleet();
  }

  try {
    const [projectsBody, vesselsBody] = await Promise.all([
      havianGet("project", "getProjects"),
      havianGet("vessel", "getVesselLocations"),
    ]);

    const projects = extractProjects(projectsBody);
    const vessels = extractVessels(vesselsBody);

    return {
      source: "live",
      fetchedAt: new Date().toISOString(),
      companyName: companyNameFrom(vesselsBody) || companyNameFrom(projectsBody),
      projects,
      vessels,
      projectCount: projects.length,
      vesselCount: vessels.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Havian request failed";
    return { ...sampleFleet(), error: message };
  }
}
