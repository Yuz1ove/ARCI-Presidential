import type { AdministrativeAuthorization } from "./administration.js";
import { canonicalJson, sha256, type CanonicalValue } from "./canonical.js";

export type CallbackIngestionPolicy = "REJECT_ALL" | "AUTHENTICATED_EVIDENCE_ONLY";

export interface OperationalControlConfiguration {
  readonly generation: number;
  readonly globalKillSwitch: boolean;
  readonly disabledProviders: readonly string[];
  readonly disabledRoutes: readonly string[];
  readonly frozenMissions: readonly string[];
  readonly admissionFreeze: boolean;
  readonly callbackIngestionPolicy: CallbackIngestionPolicy;
}

export interface OperationalRequest {
  readonly providerId: string;
  readonly routeId: string;
  readonly missionId: string;
  readonly controlGeneration: number;
}

export type OperationalDecisionCode =
  | "GLOBAL_KILL_SWITCH"
  | "PROVIDER_DISABLED"
  | "ROUTE_DISABLED"
  | "MISSION_FROZEN"
  | "ADMISSION_FROZEN"
  | "EXECUTION_ALLOWED"
  | "CALLBACK_REJECTED"
  | "CALLBACK_ACCEPTED_AS_EVIDENCE_ONLY"
  | "CONTROL_GENERATION_STALE";

export interface OperationalDecision {
  readonly allowed: boolean;
  readonly code: OperationalDecisionCode;
  readonly generation: number;
  readonly authoritativeDelivery: false;
}

export class OperationalControlError extends Error {
  public constructor(public readonly code:
    | "CONTROL_CONFIGURATION_MALFORMED"
    | "CONTROL_GENERATION_STALE"
    | "CONTROL_GENERATION_CONFLICT"
    | "CONTROL_ACTOR_UNAUTHORIZED") {
    super(code);
    this.name = "OperationalControlError";
  }
}

function validate(config: OperationalControlConfiguration): void {
  const scopes = [config.disabledProviders, config.disabledRoutes, config.frozenMissions];
  if (!Number.isInteger(config.generation) || config.generation <= 0 ||
      scopes.some((values) => values.some((value) => value.length < 3 || value.length > 160) || new Set(values).size !== values.length)) {
    throw new OperationalControlError("CONTROL_CONFIGURATION_MALFORMED");
  }
}

function fingerprint(config: OperationalControlConfiguration): string {
  return sha256(canonicalJson(config as unknown as CanonicalValue));
}

/** Precedence: global > provider > route > mission > admission > execution. */
export class OperationalSafetyController {
  private configuration: OperationalControlConfiguration;
  private configurationFingerprint: string;

  public constructor(configuration: OperationalControlConfiguration) {
    validate(configuration);
    this.configuration = structuredClone(configuration);
    this.configurationFingerprint = fingerprint(configuration);
  }

  public apply(configuration: OperationalControlConfiguration, actor: AdministrativeAuthorization): void {
    if (!actor.authorized || actor.operation !== "controls.apply") {
      throw new OperationalControlError("CONTROL_ACTOR_UNAUTHORIZED");
    }
    validate(configuration);
    if (configuration.generation < this.configuration.generation) {
      throw new OperationalControlError("CONTROL_GENERATION_STALE");
    }
    const nextFingerprint = fingerprint(configuration);
    if (configuration.generation === this.configuration.generation) {
      if (nextFingerprint !== this.configurationFingerprint) {
        throw new OperationalControlError("CONTROL_GENERATION_CONFLICT");
      }
      return;
    }
    this.configuration = structuredClone(configuration);
    this.configurationFingerprint = nextFingerprint;
  }

  public evaluateSend(request: OperationalRequest): OperationalDecision {
    if (request.controlGeneration !== this.configuration.generation) return this.decision(false, "CONTROL_GENERATION_STALE");
    if (this.configuration.globalKillSwitch) return this.decision(false, "GLOBAL_KILL_SWITCH");
    if (this.configuration.disabledProviders.includes(request.providerId)) return this.decision(false, "PROVIDER_DISABLED");
    if (this.configuration.disabledRoutes.includes(request.routeId)) return this.decision(false, "ROUTE_DISABLED");
    if (this.configuration.frozenMissions.includes(request.missionId)) return this.decision(false, "MISSION_FROZEN");
    if (this.configuration.admissionFreeze) return this.decision(false, "ADMISSION_FROZEN");
    return this.decision(true, "EXECUTION_ALLOWED");
  }

  public evaluateCallback(authenticated: boolean): OperationalDecision {
    if (!authenticated || this.configuration.callbackIngestionPolicy === "REJECT_ALL") {
      return this.decision(false, "CALLBACK_REJECTED");
    }
    return this.decision(true, "CALLBACK_ACCEPTED_AS_EVIDENCE_ONLY");
  }

  public current(): OperationalControlConfiguration {
    return structuredClone(this.configuration);
  }

  private decision(allowed: boolean, code: OperationalDecisionCode): OperationalDecision {
    return { allowed, code, generation: this.configuration.generation, authoritativeDelivery: false };
  }
}
