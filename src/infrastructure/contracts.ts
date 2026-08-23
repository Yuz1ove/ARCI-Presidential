import { negotiateCapabilities } from "./capabilities.js";
import {
  ADAPTER_CAPABILITY_SETS,
  ADAPTER_CLASS_BY_TYPE,
  type AdapterDescriptor,
  type InfrastructureOperationEvidence,
  type InfrastructureOperationRequest,
  type StagingAdapterType,
} from "./model.js";

export interface StagingInfrastructureAdapter {
  describe(): AdapterDescriptor;
  execute(request: InfrastructureOperationRequest): InfrastructureOperationEvidence;
}

export class InfrastructureAdapterError extends Error {
  public constructor(public readonly code:
    | "INFRASTRUCTURE_BACKEND_UNAVAILABLE"
    | "INFRASTRUCTURE_GENERATION_STALE"
    | "INFRASTRUCTURE_GENERATION_AHEAD"
    | "INFRASTRUCTURE_CAPABILITY_UNKNOWN"
    | "INFRASTRUCTURE_CAPABILITY_UNSUPPORTED") {
    super(code);
    this.name = "InfrastructureAdapterError";
  }
}

/**
 * Phase 4G contract adapter. It never opens a socket and is unavailable until a later phase
 * supplies an explicitly configured implementation. There is no local fallback path.
 */
export class DisconnectedStagingAdapter implements StagingInfrastructureAdapter {
  private readonly descriptor: AdapterDescriptor;

  public constructor(
    adapterType: StagingAdapterType,
    backendIdentity: string,
    generation: number,
    evidenceIdentity: string,
  ) {
    this.descriptor = {
      adapterClass: ADAPTER_CLASS_BY_TYPE[adapterType], adapterType, backendIdentity, generation,
      health: "UNAVAILABLE", capabilities: ADAPTER_CAPABILITY_SETS[adapterType], evidenceIdentity,
    };
  }

  public describe(): AdapterDescriptor {
    return structuredClone(this.descriptor);
  }

  public execute(request: InfrastructureOperationRequest): InfrastructureOperationEvidence {
    if (request.generation < this.descriptor.generation) {
      throw new InfrastructureAdapterError("INFRASTRUCTURE_GENERATION_STALE");
    }
    if (request.generation > this.descriptor.generation) {
      throw new InfrastructureAdapterError("INFRASTRUCTURE_GENERATION_AHEAD");
    }
    const capability = negotiateCapabilities(this.descriptor.adapterType, request.requiredCapabilities);
    if (!capability.compatible) {
      throw new InfrastructureAdapterError(capability.code === "CAPABILITY_UNKNOWN"
        ? "INFRASTRUCTURE_CAPABILITY_UNKNOWN"
        : "INFRASTRUCTURE_CAPABILITY_UNSUPPORTED");
    }
    return {
      adapterClass: this.descriptor.adapterClass,
      backendIdentity: this.descriptor.backendIdentity,
      generation: this.descriptor.generation,
      health: "UNAVAILABLE",
      operationId: request.operationId,
      code: "INFRASTRUCTURE_BACKEND_UNAVAILABLE",
      retry: "NEVER",
      timeout: "NOT_STARTED",
      auditEvidenceId: `audit:${request.operationId}:unavailable`,
      observabilityEvidenceId: `health:${this.descriptor.backendIdentity}:${this.descriptor.generation}`,
      authoritativeDelivery: false,
    };
  }
}

export interface InfrastructureHealthEvidence {
  readonly backendIdentity: string;
  readonly generation: number;
  readonly health: "UNAVAILABLE" | "DEGRADED" | "AVAILABLE";
  readonly observedAtTick: number;
  readonly authority: "OBSERVATIONAL";
  readonly authoritativeDelivery: false;
}

export function observeAdapterHealth(
  descriptor: AdapterDescriptor,
  observedAtTick: number,
): InfrastructureHealthEvidence {
  return {
    backendIdentity: descriptor.backendIdentity,
    generation: descriptor.generation,
    health: descriptor.health,
    observedAtTick,
    authority: "OBSERVATIONAL",
    authoritativeDelivery: false,
  };
}
