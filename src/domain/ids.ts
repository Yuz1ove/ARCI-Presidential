import { z } from "zod";

export type AckId = string;
export type DecisionId = string;
export type DeviceId = string;
export type EdgeId = string;
export type EventId = string;
export type ExecutionId = string;
export type MessageId = string;
export type MissionId = string;
export type NodeId = string;
export type RouteId = string;
export type RunId = string;
export type ScenarioId = string;

export const domainIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/, "invalid domain ID");

export interface IdSource {
  next(prefix: string): string;
}

export class SequentialIdSource implements IdSource {
  private sequence = 0;

  public constructor(private readonly namespace = "sim") {}

  public next(prefix: string): string {
    this.sequence += 1;
    return `${this.namespace}:${prefix}:${this.sequence.toString().padStart(4, "0")}`;
  }
}
