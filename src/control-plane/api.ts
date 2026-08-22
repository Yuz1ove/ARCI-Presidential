import { ControlPlaneFailure, failureResponse, type ControlPlaneResult } from "./failures.js";
import type { CommandOutcome, ControlPlaneQuery } from "./model.js";
import type { OperatorControlPlane } from "./service.js";
import { controlPlaneQuerySchema } from "./schemas.js";

export type QueryOutcome =
  | ReturnType<OperatorControlPlane["missionStatus"]>
  | ReturnType<OperatorControlPlane["missionEvents"]>
  | ReturnType<OperatorControlPlane["missionIncidents"]>
  | ReturnType<OperatorControlPlane["runtimeStatus"]>;

export class ControlPlaneApi {
  public constructor(private readonly controlPlane: OperatorControlPlane) {}

  public executeCommand(raw: unknown): Promise<ControlPlaneResult<CommandOutcome>> {
    return this.controlPlane.execute(raw);
  }

  public executeQuery(raw: unknown): ControlPlaneResult<QueryOutcome> {
    const parsed = controlPlaneQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        failure: { code: "INVALID_API_INPUT", message: "API query failed strict schema validation." },
      };
    }
    try {
      return { ok: true, value: this.query(parsed.data) };
    } catch (error) {
      return { ok: false, failure: failureResponse(error) };
    }
  }

  private query(query: ControlPlaneQuery): QueryOutcome {
    switch (query.type) {
      case "GET_MISSION_STATUS":
        return this.controlPlane.missionStatus(query.missionId);
      case "GET_MISSION_EVENTS":
        return this.controlPlane.missionEvents(query.missionId);
      case "GET_MISSION_INCIDENTS":
        return this.controlPlane.missionIncidents(query.missionId);
      case "GET_MISSION_EXPLANATIONS":
        return this.controlPlane.missionExplanations(query.missionId);
      case "GET_MISSION_RECOMMENDATIONS":
        return this.controlPlane.missionRecommendations(query.missionId);
      case "GET_RUNTIME_STATUS":
        return this.controlPlane.runtimeStatus();
      default:
        throw new ControlPlaneFailure("UNSUPPORTED_OPERATION", "unsupported control-plane query");
    }
  }
}
