import { describe, expect, it } from "vitest";
import { operatorReviewSchema } from "../../src/control-plane/schemas.js";
import { reviewStatusPresentation, timelineCategory } from "../../src/dashboard/presentation.js";
import { publicHistoryRecordSchema } from "../../src/control-plane/schemas.js";

describe("Phase 4B status semantics", () => {
  it("renders expired reviews distinctly without adding a timer", () => {
    const review = operatorReviewSchema.parse({
      reviewId: "phase4b:expired:review",
      missionId: "phase4b:expired:mission",
      commandId: "phase4b:expired:command",
      requestedAt: "2030-01-01T00:00:00.000Z",
      status: "EXPIRED",
      reason: "Expired by an authoritative future control-plane record.",
      ambiguities: [],
    });
    expect(reviewStatusPresentation(review)).toEqual({ label: "Expired", tone: "neutral" });
  });

  it("keeps recommendation history separate from observed runtime evidence", () => {
    const recommendation = publicHistoryRecordSchema.parse({
      eventId: "phase4b:recommendation:event",
      missionId: "phase4b:recommendation:mission",
      eventType: "recommendation.generated",
      correlationId: "phase4b:recommendation:correlation",
      sequence: 1,
      timestamp: "2030-01-01T00:00:00.000Z",
      source: "INTELLIGENCE",
      provenance: "DERIVED",
      summary: "recommendation.generated",
    });
    expect(timelineCategory(recommendation)).toBe("RECOMMENDED");
  });
});
