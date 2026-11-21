import { requireIdentity } from "../../../cursor/identity";
import { loadFleet } from "@/lib/havian";
import type { FleetPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const TTL_OK_MS = 30_000;
const TTL_FAIL_MS = 5_000;

// One upstream refresh fans out to ~20 Havian calls; share it across viewers and tabs.
let cached: { at: number; ttl: number; fleet: FleetPayload } | null = null;
let inflight: Promise<FleetPayload> | null = null;

async function getFleet(): Promise<FleetPayload> {
  if (cached && Date.now() - cached.at < cached.ttl) return cached.fleet;
  if (!inflight) {
    inflight = loadFleet()
      .then((fleet) => {
        cached = {
          at: Date.now(),
          ttl: fleet.connection?.ok ? TTL_OK_MS : TTL_FAIL_MS,
          fleet,
        };
        return fleet;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function GET(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  const debug = new URL(request.url).searchParams.get("debug") === "1";

  try {
    const fleet = await getFleet();
    const body: FleetPayload = debug ? fleet : { ...fleet, raw: undefined };
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    console.error("fleet load failed:", err instanceof Error ? err.name : "unknown");
    return Response.json(
      { error: "Kunne ikke hente fleet-data fra Havian" },
      { status: 502, headers: NO_STORE },
    );
  }
}
