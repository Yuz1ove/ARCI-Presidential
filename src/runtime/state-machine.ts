import type { RuntimeLifecycle } from "./model.js";

const VALID_TRANSITIONS: Readonly<Record<RuntimeLifecycle, readonly RuntimeLifecycle[]>> = {
  IDLE: ["OBSERVING", "FAILED"],
  OBSERVING: ["UNDERSTANDING", "FAILED"],
  UNDERSTANDING: ["PLANNING", "ADAPTING", "FAILED"],
  PLANNING: ["EXECUTING", "ADAPTING", "FAILED"],
  EXECUTING: ["VERIFYING", "ADAPTING", "FAILED"],
  VERIFYING: ["COMPLETED", "ADAPTING", "FAILED"],
  ADAPTING: ["OBSERVING", "PLANNING", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export class InvalidRuntimeTransitionError extends Error {
  public constructor(
    public readonly from: RuntimeLifecycle,
    public readonly to: RuntimeLifecycle,
  ) {
    super(`invalid runtime transition: ${from} -> ${to}`);
    this.name = "InvalidRuntimeTransitionError";
  }
}

export function assertRuntimeTransition(from: RuntimeLifecycle, to: RuntimeLifecycle): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidRuntimeTransitionError(from, to);
  }
}

export function validRuntimeTransitions(from: RuntimeLifecycle): readonly RuntimeLifecycle[] {
  return [...VALID_TRANSITIONS[from]];
}
