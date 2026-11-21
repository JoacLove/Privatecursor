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
  velocity?: number;
  online?: boolean;
  objectType?: string;
  posType?: string;
  onProject?: boolean;
  ageH?: string;
  gpsTimeH?: string;
};

export type FleetPayload = {
  source: DataSource;
  fetchedAt: string;
  companyName?: string;
  projects: ProjectRow[];
  vessels: VesselFeature[];
  projectCount: number;
  vesselCount: number;
};
