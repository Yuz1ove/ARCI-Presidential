import type { MissionReadModel, OperatorReview, PublicHistoryRecord } from "../control-plane/model.js";
import type { DashboardMission, DashboardOverview } from "./contracts.js";

export type SemanticCategory =
  | "OBSERVED"
  | "PROJECTED"
  | "REQUESTED"
  | "RECOMMENDED"
  | "PENDING HUMAN REVIEW";

export interface StatusPresentation {
  readonly label: string;
  readonly tone: "neutral" | "info" | "warning" | "danger" | "success";
}

export function missionStatusPresentation(mission: MissionReadModel): StatusPresentation {
  if (mission.deliveryStatus === "VERIFIED") return { label: "Verified delivery", tone: "success" };
  if (mission.status === "FAILED") return { label: "Failed — delivery unverified", tone: "danger" };
  if (mission.status === "PENDING_OPERATOR_REVIEW") {
    return { label: "Blocked — pending human review", tone: "warning" };
  }
  if (mission.status === "CANCELLATION_REQUESTED") {
    return { label: "Cancellation requested", tone: "warning" };
  }
  if (mission.currentExecutionId !== undefined) {
    return { label: "Execution completed — delivery unverified", tone: "info" };
  }
  return { label: "Active", tone: "neutral" };
}

export function reviewStatusPresentation(review: OperatorReview): StatusPresentation {
  switch (review.status) {
    case "PENDING_OPERATOR_REVIEW":
      return { label: "Pending human review", tone: "warning" };
    case "APPROVED":
      return { label: "Approved", tone: "success" };
    case "REJECTED":
      return { label: "Rejected", tone: "danger" };
    case "EXPIRED":
      return { label: "Expired", tone: "neutral" };
  }
}

export function timelineCategory(event: PublicHistoryRecord): SemanticCategory {
  if (event.source === "OPERATOR") return "REQUESTED";
  if (event.eventType === "recommendation.generated") return "RECOMMENDED";
  if (event.eventType === "control.operator_review_requested") return "PENDING HUMAN REVIEW";
  if (event.provenance === "OBSERVED" || event.source === "SIMULATED_RUNTIME") return "OBSERVED";
  return "PROJECTED";
}

export function sortMissions(missions: readonly DashboardMission[]): readonly DashboardMission[] {
  return [...missions].sort((left, right) =>
    left.projection.missionId.localeCompare(right.projection.missionId),
  );
}

export function sortReviews(reviews: readonly OperatorReview[]): readonly OperatorReview[] {
  return [...reviews].sort((left, right) =>
    left.requestedAt.localeCompare(right.requestedAt) || left.reviewId.localeCompare(right.reviewId),
  );
}

export function sortTimeline(events: readonly PublicHistoryRecord[]): readonly PublicHistoryRecord[] {
  return [...events].sort(
    (left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId),
  );
}

export function dashboardOverview(
  missions: readonly DashboardMission[],
  reviews: readonly OperatorReview[],
): DashboardOverview {
  return {
    totalMissions: missions.length,
    activeMissions: missions.filter(({ projection }) => projection.status === "ACTIVE").length,
    verifiedDeliveredMissions: missions.filter(
      ({ projection }) => projection.deliveryStatus === "VERIFIED",
    ).length,
    failedMissions: missions.filter(({ projection }) => projection.status === "FAILED").length,
    pendingMissions: missions.filter(
      ({ projection }) => projection.status === "PENDING_OPERATOR_REVIEW",
    ).length,
    pendingReviews: reviews.filter(({ status }) => status === "PENDING_OPERATOR_REVIEW").length,
    activeIncidents: missions.reduce((total, mission) => total + mission.incidents.length, 0),
    verifiedAcks: missions.filter(({ projection }) => projection.verifiedAckId !== undefined).length,
    unverifiedDeliveries: missions.filter(
      ({ projection }) => projection.deliveryStatus === "NOT_VERIFIED",
    ).length,
  };
}
