export type DataSource = "live" | "sample";

export type ProjectRow = {
  projectId: number;
  name: string;
  statusId?: number;
  statusName?: string;
  lmt?: boolean;
  progress?: number;
  progressTimeStamp?: string;
};

export type VesselFeature = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  course?: number;
  /** True heading in degrees when provided by Havian; preferred over course for marker rotation. */
  heading?: number;
  velocity?: number;
  online?: boolean;
  objectType?: string;
  posType?: string;
  onProject?: boolean;
  ageH?: string;
  gpsTimeH?: string;
};

export type EndpointStatus = {
  function: string;
  action: string;
  ok: boolean;
  status: number | null;
  error?: string;
  authHeader: string;
};

export type ConnectionStatus = {
  ok: boolean;
  mode: DataSource;
  authHeader: string;
  configPresent: boolean;
  endpoints: EndpointStatus[];
  message: string;
};

export type FleetPayload = {
  source: DataSource;
  fetchedAt: string;
  companyName?: string;
  projects: ProjectRow[];
  vessels: VesselFeature[];
  projectCount: number;
  vesselCount: number;
  connection: ConnectionStatus;
  /** Redacted raw Havian JSON for debugging in the UI (no secrets). */
  raw: {
    projects: unknown;
    vessels: unknown;
  };
};
