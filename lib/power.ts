import { hoglundAuthHeader, hoglundHttpError } from "./hoglund-auth";
import {
  RAMFORM_SHIPS,
  type FleetPowerPayload,
  type VesselPower,
} from "./power-types";

export type {
  FleetPowerPayload,
  RamformMatch,
  VesselPower,
} from "./power-types";
export { RAMFORM_SHIPS, ramformMatchFromName } from "./power-types";

const BASE = "https://api.hoglund.no/v2";

/** LiveData tags for propulsion (PEM) and compressor (CP) power — same family as pgsfleet-live. */
const LIVE_TAGS = [
  "PEMPTOTALPOWER",
  "PEMCTOTALPOWER",
  "PEMSTOTALPOWER",
  "SPM_MP1.POW",
  "SPM_MP2.POW",
  "SPM_MP3.POW",
  "CP1.POW",
  "CP2.POW",
  "CP3.POW",
  "CP1TOTALPOWER",
  "CP2TOTALPOWER",
  "CP3TOTALPOWER",
  "CPTOTALPOWER",
  "SPM_CP1.POW",
  "SPM_CP2.POW",
  "SPM_CP3.POW",
].join(",");

function asFinite(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Math.abs(v) > 1e15) return null;
    return v;
  }
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    const n = Number(v);
    if (Math.abs(n) > 1e15) return null;
    return n;
  }
  return null;
}

function pickTimestamp(row: Record<string, unknown>): string | null {
  for (const key of ["Modified", "Created", "Inserted"] as const) {
    const c = row[key];
    if (c && typeof c === "object" && "$date" in c) {
      const d = (c as { $date?: string }).$date;
      if (d) return d;
    }
    if (typeof c === "string") return c;
  }
  return null;
}

/** Read a leaf value from nested LiveData objects (VALUE or plain number). */
function readPath(row: Record<string, unknown>, path: string): number | null {
  const parts = path.split(".");
  let cur: unknown = row;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur == null) return null;
  if (typeof cur === "object") {
    const obj = cur as Record<string, unknown>;
    return asFinite(obj.VALUE ?? obj.Value ?? obj.value ?? obj.VALUE2);
  }
  return asFinite(cur);
}

function firstNumber(
  row: Record<string, unknown>,
  paths: string[],
): number | null {
  for (const path of paths) {
    const v = readPath(row, path);
    if (v != null) return v;
  }
  return null;
}

function sumNullable(parts: Array<number | null>): number | null {
  const nums = parts.filter((v): v is number => v != null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

function parseLivePower(
  ship: (typeof RAMFORM_SHIPS)[number],
  live: Record<string, unknown> | null,
  error?: string,
): VesselPower {
  if (!live) {
    return {
      match: ship.match,
      name: ship.name,
      shipId: ship.shipId,
      propulsionKw: null,
      compressorKw: null,
      pemPKw: null,
      pemCKw: null,
      pemSKw: null,
      cp1Kw: null,
      cp2Kw: null,
      cp3Kw: null,
      sampleAt: null,
      error: error || "Ingen LiveData",
    };
  }

  const pemPKw = firstNumber(live, ["PEMPTOTALPOWER", "SPM_MP1.POW"]);
  const pemCKw = firstNumber(live, ["PEMCTOTALPOWER", "SPM_MP2.POW"]);
  const pemSKw = firstNumber(live, ["PEMSTOTALPOWER", "SPM_MP3.POW"]);
  const propulsionKw = sumNullable([pemPKw, pemCKw, pemSKw]);

  const cp1Kw = firstNumber(live, ["CP1.POW", "CP1TOTALPOWER", "SPM_CP1.POW"]);
  const cp2Kw = firstNumber(live, ["CP2.POW", "CP2TOTALPOWER", "SPM_CP2.POW"]);
  const cp3Kw = firstNumber(live, ["CP3.POW", "CP3TOTALPOWER", "SPM_CP3.POW"]);
  const compressorKw =
    firstNumber(live, ["CPTOTALPOWER"]) ?? sumNullable([cp1Kw, cp2Kw, cp3Kw]);

  return {
    match: ship.match,
    name: ship.name,
    shipId: ship.shipId,
    propulsionKw,
    compressorKw,
    pemPKw,
    pemCKw,
    pemSKw,
    cp1Kw,
    cp2Kw,
    cp3Kw,
    sampleAt: pickTimestamp(live),
    error,
  };
}

async function fetchLive(
  auth: HeadersInit,
  shipId: number,
): Promise<Record<string, unknown> | null> {
  const url = `${BASE}/data/${shipId}/?report_type=LiveData&latest=1&tags=${encodeURIComponent(LIVE_TAGS)}`;
  const res = await fetch(url, { headers: auth, cache: "no-store" });
  if (!res.ok) throw hoglundHttpError(`LiveData ${shipId}`, res.status);
  const json = (await res.json()) as { data?: Record<string, unknown>[] };
  return json.data?.[0] ?? null;
}

/** Sample propulsion / compressor kW when HOGLUND_TOKEN is unset. */
export function sampleFleetPower(): FleetPowerPayload {
  const base = [
    { match: "titan" as const, propulsion: 7420, compressor: 3180 },
    { match: "atlas" as const, propulsion: 6980, compressor: 2950 },
    { match: "vanguard" as const, propulsion: 410, compressor: 120 },
    { match: "hyperion" as const, propulsion: 7440, compressor: 3020 },
    { match: "tethys" as const, propulsion: 7210, compressor: 2880 },
    { match: "sovereign" as const, propulsion: 6550, compressor: 2710 },
    { match: "victory" as const, propulsion: 6890, compressor: 2800 },
  ];

  const vessels: VesselPower[] = base.map((row) => {
    const ship = RAMFORM_SHIPS.find((s) => s.match === row.match)!;
    const third = Math.round(row.propulsion / 3);
    const cp = Math.round(row.compressor / 3);
    return {
      match: ship.match,
      name: ship.name,
      shipId: ship.shipId,
      propulsionKw: row.propulsion,
      compressorKw: row.compressor,
      pemPKw: third,
      pemCKw: third,
      pemSKw: row.propulsion - 2 * third,
      cp1Kw: cp,
      cp2Kw: cp,
      cp3Kw: row.compressor - 2 * cp,
      sampleAt: new Date().toISOString(),
    };
  });

  return {
    source: "sample",
    fetchedAt: new Date().toISOString(),
    vessels,
    message:
      "Sample data — sett HOGLUND_TOKEN for live Propulsion / Compressor power fra Høglund Connect",
  };
}

export async function loadFleetPower(): Promise<FleetPowerPayload> {
  if (!process.env.HOGLUND_TOKEN?.trim()) {
    return sampleFleetPower();
  }

  try {
    const auth = (await hoglundAuthHeader())!;
    const vessels = await Promise.all(
      RAMFORM_SHIPS.map(async (ship) => {
        try {
          const live = await fetchLive(auth, ship.shipId);
          return parseLivePower(ship, live);
        } catch (err) {
          return parseLivePower(
            ship,
            null,
            err instanceof Error ? err.message : "Hentefeil",
          );
        }
      }),
    );

    return {
      source: "live",
      fetchedAt: new Date().toISOString(),
      vessels,
      message: "Live effekt fra Høglund Connect",
    };
  } catch (err) {
    const sample = sampleFleetPower();
    return {
      ...sample,
      error:
        err instanceof Error ? err.message : "Kunne ikke hente effektdata",
      message: `Sample data · Høglund-feil: ${
        err instanceof Error ? err.message : "ukjent"
      }`,
    };
  }
}
