import type { AdapterStatus } from "./model.js";
import { OFFICIAL_SOURCES } from "./sources.js";

export interface AdapterContract {
  readonly id: string;
  readonly sourceId: string;
  readonly status: AdapterStatus;
  readonly outputFields: readonly string[];
  readonly activationRequirement: string;
}

export const ADAPTER_CONTRACTS: readonly AdapterContract[] = [
  { id: "CwaRainfallAdapter", sourceId: "CWA_RAIN", status: "READY_FOR_CREDENTIALS", outputFields: ["stationId", "lat", "lon", "observedAt", "rain10m", "rain1h", "rain3h", "rain6h", "rain24h"], activationRequirement: "CWA authorization key plus a recorded dataset response and missing-value policy" },
  { id: "TdxRoadEventAdapter", sourceId: "TDX_ROAD", status: "READY_FOR_CREDENTIALS", outputFields: ["eventId", "roadName", "position", "severity", "restriction", "updatedAt"], activationRequirement: "TDX credentials, event taxonomy mapping and spatial join validation" },
  { id: "NccTownshipRedundancyAdapter", sourceId: "NCC_TOWNSHIP", status: "PUBLIC_DOWNLOAD", outputFields: ["county", "township", "period", "radioClass", "licensedStationCount"], activationRequirement: "version-pinned public file, township code join and disclosure that counts are only a redundancy proxy" },
  { id: "MoiVillagePopulationAdapter", sourceId: "MOI_VILLAGE", status: "PUBLIC_DOWNLOAD", outputFields: ["period", "villageCode", "village", "population", "elderlyPopulation"], activationRequirement: "version-pinned monthly file and age-field aggregation test" },
  { id: "MoaAgricultureAdapter", sourceId: "MOA_SURVEY", status: "PUBLIC_DOWNLOAD", outputFields: ["year", "season", "county", "township", "crop", "plantedAreaHa", "harvestedAreaHa", "productionKg"], activationRequirement: "year/season selection, crop taxonomy and township normalization" },
  { id: "NlscTerrainAdapter", sourceId: "NLSC_DTM", status: "UNCONNECTED", outputFields: ["rasterVersion", "elevationM", "slopeDeg", "obstruction", "lineOfSight"], activationRequirement: "licensed/versioned raster, CRS declaration and reproducible terrain-processing pipeline" },
] as const;

export function validateAdapterRegistry(): void {
  const sourceIds = new Set(OFFICIAL_SOURCES.map((source) => source.id));
  const adapterSourceIds = new Set<string>();
  for (const adapter of ADAPTER_CONTRACTS) {
    if (!sourceIds.has(adapter.sourceId)) throw new Error(`Adapter ${adapter.id} references unknown source ${adapter.sourceId}`);
    if (adapterSourceIds.has(adapter.sourceId)) throw new Error(`Duplicate adapter for source ${adapter.sourceId}`);
    adapterSourceIds.add(adapter.sourceId);
  }
  if (adapterSourceIds.size !== sourceIds.size) throw new Error("Every official source must have exactly one adapter contract");
}
