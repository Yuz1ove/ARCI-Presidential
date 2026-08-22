import { describe, expect, it } from "vitest";
import {
  InvalidRuntimeTransitionError,
  assertRuntimeTransition,
  validRuntimeTransitions,
} from "../../src/runtime/state-machine.js";

describe("StarryRuntime state machine", () => {
  it("accepts the canonical success path", () => {
    const path = [
      "IDLE",
      "OBSERVING",
      "UNDERSTANDING",
      "PLANNING",
      "EXECUTING",
      "VERIFYING",
      "COMPLETED",
    ] as const;
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index];
      const to = path[index + 1];
      if (from === undefined || to === undefined) throw new Error("invalid test path");
      expect(() => assertRuntimeTransition(from, to)).not.toThrow();
    }
  });

  it("accepts adaptation recovery", () => {
    expect(validRuntimeTransitions("EXECUTING")).toContain("ADAPTING");
    expect(validRuntimeTransitions("VERIFYING")).toContain("ADAPTING");
    expect(validRuntimeTransitions("ADAPTING")).toContain("OBSERVING");
  });

  it("rejects invalid and terminal transitions", () => {
    expect(() => assertRuntimeTransition("IDLE", "COMPLETED")).toThrow(
      InvalidRuntimeTransitionError,
    );
    expect(() => assertRuntimeTransition("COMPLETED", "OBSERVING")).toThrow(
      "invalid runtime transition",
    );
    expect(() => assertRuntimeTransition("FAILED", "PLANNING")).toThrow(
      "invalid runtime transition",
    );
  });
});
