import { z } from "zod";
import { DATA_SOURCES, OFFICIAL_REPLAY_CAPTURED_AT, PUBLIC_CONTEXT } from "./fixtures.js";
import type { DataMode, PublicContext, RealDataSnapshot, RealDataSource } from "./model.js";

const moiRecordSchema = z.object({
  statistic_yyymm: z.string(),
  district_code: z.string(),
  site_id: z.string(),
  village: z.string(),
  household_no: z.string().regex(/^\d+$/),
  people_total: z.string().regex(/^\d+$/),
}).catchall(z.unknown());

const moiResponseSchema = z.object({
  responseCode: z.string(),
  responseMessage: z.string(),
  page: z.string(),
  responseData: z.array(moiRecordSchema),
});

export class LiveDataUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LiveDataUnavailableError";
  }
}

export class StaleDataError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StaleDataError";
  }
}

function observationEndOfMonth(rocYearMonth: string): number {
  if (!/^\d{5}$/.test(rocYearMonth)) throw new LiveDataUnavailableError("MOI statistic period is invalid");
  const year = Number(rocYearMonth.slice(0, 3)) + 1911;
  const month = Number(rocYearMonth.slice(3, 5));
  if (month < 1 || month > 12) throw new LiveDataUnavailableError("MOI statistic month is invalid");
  return Date.UTC(year, month, 0, 23, 59, 59);
}

function elderlyPopulation(record: z.infer<typeof moiRecordSchema>): number {
  return Object.entries(record).reduce((sum, [key, raw]) => {
    if (!/^people_age_(06[5-9]|0[7-9][0-9]|100)_(m|f)$/.test(key)) return sum;
    const value = typeof raw === "string" ? Number(raw) : Number.NaN;
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function replaySources(status: RealDataSource["status"] = "REPLAY_FIXED"): readonly RealDataSource[] {
  return DATA_SOURCES.map((source) => source.status === "REQUIRES_CREDENTIALS" ? source : { ...source, status });
}

export function createDataSnapshot(mode: Exclude<DataMode, "LIVE">): RealDataSnapshot {
  return {
    requestedMode: mode,
    effectiveMode: mode,
    loadedAt: OFFICIAL_REPLAY_CAPTURED_AT,
    sources: replaySources(),
    context: PUBLIC_CONTEXT,
  };
}

export interface LiveDataOptions {
  readonly fetcher?: typeof fetch;
  readonly loadedAt?: string;
  readonly endpoint?: string;
}

export async function loadLiveData(options: LiveDataOptions = {}): Promise<RealDataSnapshot> {
  const fetcher = options.fetcher ?? fetch;
  const loadedAt = options.loadedAt ?? new Date().toISOString();
  const endpoint = options.endpoint ?? DATA_SOURCES[0]!.sourceUrl;
  try {
    const response = await fetcher(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new LiveDataUnavailableError(`MOI request returned HTTP ${response.status}`);
    const parsed = moiResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.responseCode !== "OD-0101-S") {
      throw new LiveDataUnavailableError("MOI response failed schema or provider status validation");
    }
    const records = parsed.data.responseData.filter(({ site_id: siteId }) => siteId === "南投縣仁愛鄉");
    if (records.length !== 16) {
      throw new LiveDataUnavailableError(`Expected 16 Renai village rows, received ${records.length}`);
    }
    const periods = new Set(records.map(({ statistic_yyymm: period }) => period));
    if (periods.size !== 1) throw new LiveDataUnavailableError("MOI records contain inconsistent statistic periods");
    const period = records[0]!.statistic_yyymm;
    const loadedAtMs = Date.parse(loadedAt);
    if (!Number.isFinite(loadedAtMs)) throw new LiveDataUnavailableError("Loaded timestamp is invalid");
    const ageDays = (loadedAtMs - observationEndOfMonth(period)) / 86_400_000;
    if (ageDays > 62) throw new StaleDataError(`MOI statistic period ${period} is ${Math.floor(ageDays)} days old`);
    const context: PublicContext = {
      ...PUBLIC_CONTEXT,
      villages: records.length,
      households: records.reduce((sum, record) => sum + Number(record.household_no), 0),
      population: records.reduce((sum, record) => sum + Number(record.people_total), 0),
      elderlyPopulation: records.reduce((sum, record) => sum + elderlyPopulation(record), 0),
    };
    const sources = DATA_SOURCES.map((source): RealDataSource => source.sourceId === "MOI_VILLAGE_11507_RENAI"
      ? {
          ...source,
          fetchedAt: loadedAt,
          status: "AVAILABLE",
          dataQuality: "LIVE_FETCH_SCHEMA_VALIDATED_16_VILLAGES",
        }
      : source);
    return {
      requestedMode: "LIVE",
      effectiveMode: "LIVE",
      loadedAt,
      sources,
      context,
      degradedReason: "LIVE includes the current fetch of the verified MOI publication only; CWA and TDX remain credential-blocked, while NCC/MOA stay pinned replay records.",
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown live source failure";
    const status = error instanceof StaleDataError ? "STALE" : "DEGRADED";
    return {
      requestedMode: "LIVE",
      effectiveMode: "REPLAY",
      loadedAt,
      sources: replaySources(status),
      context: PUBLIC_CONTEXT,
      degradedReason: `DATA SOURCE ${status} — ${reason}; fail-closed to fixed REPLAY context`,
    };
  }
}

export async function loadRealData(mode: DataMode, options: LiveDataOptions = {}): Promise<RealDataSnapshot> {
  return mode === "LIVE" ? loadLiveData(options) : createDataSnapshot(mode);
}
