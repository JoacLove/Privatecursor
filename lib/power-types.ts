import type { DataSource } from "./types";

/** TGS Ramforms + known Høglund ship_id (from pgsfleet-live). */
export const RAMFORM_SHIPS = [
  { match: "atlas", name: "Ramform Atlas", shipId: 27 },
  { match: "hyperion", name: "Ramform Hyperion", shipId: 31 },
  { match: "tethys", name: "Ramform Tethys", shipId: 30 },
  { match: "titan", name: "Ramform Titan", shipId: 66 },
  { match: "sovereign", name: "Ramform Sovereign", shipId: 141 },
  { match: "vanguard", name: "Ramform Vanguard", shipId: 191 },
  { match: "victory", name: "Ramform Victory", shipId: 217 },
] as const;

export type RamformMatch = (typeof RAMFORM_SHIPS)[number]["match"];

export type VesselPower = {
  match: RamformMatch;
  name: string;
  shipId: number;
  propulsionKw: number | null;
  compressorKw: number | null;
  /** PEM Port / Center / Stbd when available. */
  pemPKw: number | null;
  pemCKw: number | null;
  pemSKw: number | null;
  /** CP1 / CP2 / CP3 when available. */
  cp1Kw: number | null;
  cp2Kw: number | null;
  cp3Kw: number | null;
  sampleAt: string | null;
  error?: string;
};

export type FleetPowerPayload = {
  source: DataSource;
  fetchedAt: string;
  vessels: VesselPower[];
  message: string;
  error?: string;
};

/** Match a Havian vessel name to a Ramform power row key. */
export function ramformMatchFromName(name: string): RamformMatch | null {
  const n = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (!n || /\bcable\b|\bstreamer\b/.test(n)) return null;
  for (const ship of RAMFORM_SHIPS) {
    if (new RegExp(`\\b${ship.match}\\b`).test(n)) return ship.match;
  }
  if (/\bsoverign\b/.test(n)) return "sovereign";
  return null;
}
