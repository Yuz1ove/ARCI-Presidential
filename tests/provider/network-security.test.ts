import { describe, expect, it } from "vitest";
import { LoopbackProviderHttpClient, ProviderBoundaryError } from "../../src/provider/index.js";
import { runPhase4EScenario } from "../../src/simulation/provider/phase4e-scenarios.js";

const CONFIG = { requestBytes: 1024, responseBytes: 1024, callbackBytes: 1024, timeoutMs: 25, maximumRetries: 1 } as const;

describe("Phase 4E loopback-only network boundary", () => {
  it.each([
    "http://8.8.8.8:80", "http://10.0.0.1:80", "http://192.168.1.1:80",
    "http://169.254.169.254:80", "https://127.0.0.1:443", "http://example.invalid:80",
    "ftp://127.0.0.1:21", "http://user:password@127.0.0.1:80",
  ])("rejects unsafe endpoint %s before network access", async (endpoint) => {
    await expect(LoopbackProviderHttpClient.connect({ ...CONFIG, endpoint }))
      .rejects.toBeInstanceOf(ProviderBoundaryError);
  });

  it("accepts verified localhost resolution and communicates only over loopback", async () => {
    expect(await runPhase4EScenario("localhost-resolved-loopback"))
      .toMatchObject({ sendCode: "PROVIDER_ACCEPTED", authoritativeDelivery: false });
  });

  it("rejects redirects and oversized responses/callbacks with stable codes", async () => {
    expect(await runPhase4EScenario("redirect-attempt")).toMatchObject({ sendCode: "PROVIDER_REDIRECT_REJECTED" });
    expect(await runPhase4EScenario("oversized-provider-response")).toMatchObject({ sendCode: "PROVIDER_RESPONSE_TOO_LARGE" });
    expect(await runPhase4EScenario("oversized-response-callback"))
      .toMatchObject({ callbackFailures: ["PROVIDER_CALLBACK_TOO_LARGE"], authoritativeDelivery: false });
  });
});
