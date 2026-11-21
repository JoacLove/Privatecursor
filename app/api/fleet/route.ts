import { requireIdentity } from "../../../cursor/identity";
import { loadFleet } from "@/lib/havian";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  try {
    const fleet = await loadFleet();
    return Response.json(fleet, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load fleet";
    return Response.json(
      { error: message },
      {
        status: 502,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      }
    );
  }
}
