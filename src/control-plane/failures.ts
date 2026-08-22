import { z } from "zod";

export const controlPlaneFailureCodeSchema = z.enum([
  "INVALID_API_INPUT",
  "UNKNOWN_MISSION",
  "COMMAND_REJECTED",
  "OPERATOR_REVIEW_REQUIRED",
  "OPERATOR_REVIEW_REJECTED",
  "PERSISTENCE_FAILURE",
  "REPLAY_FAILURE",
  "PROJECTION_FAILURE",
  "CONFLICTING_STATE",
  "UNSUPPORTED_OPERATION",
]);
export type ControlPlaneFailureCode = z.infer<typeof controlPlaneFailureCodeSchema>;

export class ControlPlaneFailure extends Error {
  public constructor(
    public readonly code: ControlPlaneFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "ControlPlaneFailure";
  }
}

export interface FailureResponse {
  readonly code: ControlPlaneFailureCode;
  readonly message: string;
}

export type ControlPlaneResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: FailureResponse };

export function failureResponse(error: unknown): FailureResponse {
  if (error instanceof ControlPlaneFailure) {
    return { code: error.code, message: error.message };
  }
  return { code: "COMMAND_REJECTED", message: "The command failed without creating success." };
}
