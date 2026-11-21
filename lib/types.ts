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
  /** IMO when id is like `imo_9178630`. */
  imo?: number;
};

export type TrackFeature = {
  vessel: string;
  vesselIMO?: number;
  mmsi?: number;
  projectIds?: number[];
  firstFix?: string;
  lastFix?: string;
  points?: number;
  /** [lat, lon] pairs for Leaflet polylines. */
  positions: [number, number][];
};

export type ProjectAreaFeature = {
  projectId: number;
  projectName?: string;
  name: string;
  kind?: string;
  areaKm2?: number;
  /** GeoJSON geometry (Polygon / MultiPolygon / etc.). */
  geometry: GeoJsonGeometry;
};

export type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

export type WeatherObservation = {
  projectId: number;
  projectName?: string;
  vessel: string;
  vesselIMO?: number;
  time: string;
  windSpeedKnots?: number;
  beaufort?: number;
  beaufortName?: string;
  windFrom?: string;
  waveHeightM?: number;
  seaState?: string;
  swellHeightM?: string | number;
  pressureMbar?: number;
  visibility?: string;
};

export type WeatherForecastRow = {
  projectId: number;
  projectName?: string;
  location?: string;
  day?: string;
  hours?: number;
  windSpeedKnotsMean?: number;
  windSpeedKnotsMax?: number;
  beaufortMaxName?: string;
  gustKnotsMax?: number;
  waveHeightMMax?: number;
  seaStateMax?: string;
  airTempCMax?: number;
  airTempCMin?: number;
  precipMm?: number;
};

export type WeatherPayload = {
  observations: WeatherObservation[];
  forecast: WeatherForecastRow[];
  observationsTotal?: number;
  forecastTotal?: number;
  message?: string;
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
  tracks: TrackFeature[];
  projectAreas: ProjectAreaFeature[];
  weather: WeatherPayload;
  projectCount: number;
  vesselCount: number;
  connection: ConnectionStatus;
  /** Redacted raw Havian JSON for debugging in the UI (no secrets). */
  raw: {
    projects: unknown;
    vessels: unknown;
    tracks?: unknown;
    projectAreas?: unknown;
    observations?: unknown;
    forecast?: unknown;
  };
};
