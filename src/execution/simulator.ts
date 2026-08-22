import type { EnvironmentState } from "../domain/environment/model.js";
import {
  executionResultSchema,
  type ExecutionResult,
  type Message,
} from "../domain/execution/model.js";
import type { IdSource } from "../domain/ids.js";
import { edgeById, nodeById, type NetworkGraph } from "../domain/network/model.js";
import type { ExecutionCapability } from "../domain/policy/model.js";
import type { Acknowledgement } from "../domain/verification/model.js";
import { acknowledgementSchema } from "../domain/verification/model.js";
import type { RandomSource } from "../simulation/random.js";

export interface ExecutionInput {
  readonly capability: ExecutionCapability;
  readonly message: Message;
  readonly environment: EnvironmentState;
  readonly graph: NetworkGraph;
  readonly random: RandomSource;
  readonly startedAt: string;
  readonly attempt: number;
}

function finishTime(startedAt: string, latencyMs: number): string {
  return new Date(Date.parse(startedAt) + latencyMs).toISOString();
}

export class SimulatedExecutor {
  public constructor(private readonly ids: IdSource) {}

  public execute(input: ExecutionInput): ExecutionResult {
    const executionId = this.ids.next("execution");
    const base = {
      executionId,
      messageId: input.message.messageId,
      routeId: input.capability.route.routeId,
      startedAt: input.startedAt,
      attempt: input.attempt,
    };

    if (input.capability.missionId !== input.message.missionId) {
      return executionResultSchema.parse({
        ...base,
        finishedAt: input.startedAt,
        status: "BLOCKED",
        latencyMs: 0,
        failureReason: "POLICY_BLOCKED",
      });
    }

    let latencyMs = 0;
    for (const routeEdge of input.capability.route.edges) {
      const currentEdge = edgeById(input.graph, routeEdge.edgeId);
      if (currentEdge === undefined) {
        return executionResultSchema.parse({
          ...base,
          finishedAt: finishTime(input.startedAt, latencyMs),
          status: "FAILED",
          latencyMs,
          failedEdgeId: routeEdge.edgeId,
          failureReason: "INVALID_ROUTE",
        });
      }
      if (!currentEdge.available) {
        return executionResultSchema.parse({
          ...base,
          finishedAt: finishTime(input.startedAt, latencyMs),
          status: "FAILED",
          latencyMs,
          failedEdgeId: currentEdge.edgeId,
          failureReason: "EDGE_UNAVAILABLE",
        });
      }
      if (
        nodeById(input.graph, currentEdge.from)?.available !== true ||
        nodeById(input.graph, currentEdge.to)?.available !== true
      ) {
        return executionResultSchema.parse({
          ...base,
          finishedAt: finishTime(input.startedAt, latencyMs),
          status: "FAILED",
          latencyMs,
          failedEdgeId: currentEdge.edgeId,
          failureReason: "NODE_UNREACHABLE",
        });
      }
      latencyMs += Math.round(currentEdge.latencyMs * (1 + input.environment.regionalCongestion * 0.2));
      if (input.random.next() >= currentEdge.reliability) {
        return executionResultSchema.parse({
          ...base,
          finishedAt: finishTime(input.startedAt, latencyMs),
          status: "FAILED",
          latencyMs,
          failedEdgeId: currentEdge.edgeId,
          failureReason: "PACKET_LOSS",
        });
      }
      if (latencyMs > input.message.timeoutMs) {
        return executionResultSchema.parse({
          ...base,
          finishedAt: finishTime(input.startedAt, input.message.timeoutMs),
          status: "TIMEOUT",
          latencyMs: input.message.timeoutMs,
          failedEdgeId: currentEdge.edgeId,
          failureReason: "TIMEOUT",
        });
      }
    }

    return executionResultSchema.parse({
      ...base,
      finishedAt: finishTime(input.startedAt, latencyMs),
      status: "DELIVERED",
      latencyMs,
    });
  }

  public createAcknowledgement(
    execution: ExecutionResult,
    sourceNodeId: string,
    receivedAt: string,
  ): Acknowledgement | undefined {
    if (execution.status !== "DELIVERED") return undefined;
    return acknowledgementSchema.parse({
      ackId: this.ids.next("ack"),
      messageId: execution.messageId,
      executionId: execution.executionId,
      routeId: execution.routeId,
      receivedAt,
      sourceNodeId,
    });
  }
}
