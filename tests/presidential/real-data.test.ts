import { describe, expect, it, vi } from "vitest";
import { createDataSnapshot, loadLiveData } from "../../src/presidential/real-data.js";

function moiRows(period = "11507"): readonly Record<string, string>[] {
  return Array.from({ length: 16 }, (_, index) => ({
    statistic_yyymm: period,
    district_code: `100080${String(index).padStart(2, "0")}`,
    site_id: "南投縣仁愛鄉",
    village: `測試村${index + 1}`,
    household_no: "10",
    people_total: "30",
    people_age_065_m: "2",
    people_age_065_f: "3",
  }));
}

function response(rows: readonly Record<string, string>[], responseCode = "OD-0101-S"): Response {
  return new Response(JSON.stringify({ responseCode, responseMessage: "success", page: "3", responseData: rows }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Presidential real-data governance", () => {
  it("creates fixed replay and simulation snapshots with provenance", () => {
    for (const mode of ["REPLAY", "SIMULATION"] as const) {
      const snapshot = createDataSnapshot(mode);
      expect(snapshot.requestedMode).toBe(mode);
      expect(snapshot.effectiveMode).toBe(mode);
      expect(snapshot.sources).toHaveLength(5);
      expect(snapshot.sources.every(({ provider, sourceUrl, license, limitation }) => provider && sourceUrl && license && limitation)).toBe(true);
    }
  });

  it("accepts a current, schema-valid 16-village MOI response as partial LIVE", async () => {
    const fetcher = vi.fn(() => Promise.resolve(response(moiRows()))) as unknown as typeof fetch;
    const snapshot = await loadLiveData({ fetcher, loadedAt: "2026-08-25T01:00:00+08:00" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(snapshot.effectiveMode).toBe("LIVE");
    expect(snapshot.context).toMatchObject({ villages: 16, households: 160, population: 480, elderlyPopulation: 80 });
    expect(snapshot.sources.find(({ sourceId }) => sourceId.startsWith("MOI_"))?.status).toBe("AVAILABLE");
    expect(snapshot.degradedReason).toContain("CWA and TDX remain credential-blocked");
  });

  it("fails closed to REPLAY on API failure", async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error("network offline"))) as unknown as typeof fetch;
    const snapshot = await loadLiveData({ fetcher, loadedAt: "2026-08-25T01:00:00+08:00" });
    expect(snapshot.requestedMode).toBe("LIVE");
    expect(snapshot.effectiveMode).toBe("REPLAY");
    expect(snapshot.degradedReason).toContain("DATA SOURCE DEGRADED");
  });

  it("rejects invalid provider data instead of normalizing it", async () => {
    const rows = moiRows().map((row, index) => index === 0 ? { ...row, household_no: "not-a-number" } : row);
    const fetcher = vi.fn(() => Promise.resolve(response(rows))) as unknown as typeof fetch;
    const snapshot = await loadLiveData({ fetcher, loadedAt: "2026-08-25T01:00:00+08:00" });
    expect(snapshot.effectiveMode).toBe("REPLAY");
    expect(snapshot.degradedReason).toContain("schema");
  });

  it("marks stale source data and fails closed to REPLAY", async () => {
    const fetcher = vi.fn(() => Promise.resolve(response(moiRows("11401")))) as unknown as typeof fetch;
    const snapshot = await loadLiveData({ fetcher, loadedAt: "2026-08-25T01:00:00+08:00" });
    expect(snapshot.effectiveMode).toBe("REPLAY");
    expect(snapshot.sources[0]?.status).toBe("STALE");
    expect(snapshot.degradedReason).toContain("DATA SOURCE STALE");
  });
});
