export interface ProviderKillSwitchDecision {
  readonly sequence: number;
  readonly attemptId: string;
  readonly generation: number;
  readonly enabled: boolean;
  readonly code: "PROVIDER_SEND_ALLOWED" | "PROVIDER_KILL_SWITCH_DISABLED";
}

export class ProviderKillSwitch {
  private enabled: boolean;
  private generation = 1;
  private readonly decisions: ProviderKillSwitchDecision[] = [];

  public constructor(initiallyEnabled = true) {
    this.enabled = initiallyEnabled;
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) {
      this.enabled = enabled;
      this.generation += 1;
    }
  }

  public checkBeforeAttempt(attemptId: string): ProviderKillSwitchDecision {
    const decision: ProviderKillSwitchDecision = {
      sequence: this.decisions.length + 1,
      attemptId,
      generation: this.generation,
      enabled: this.enabled,
      code: this.enabled ? "PROVIDER_SEND_ALLOWED" : "PROVIDER_KILL_SWITCH_DISABLED",
    };
    this.decisions.push(decision);
    return { ...decision };
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public auditLog(): readonly ProviderKillSwitchDecision[] {
    return this.decisions.map((decision) => ({ ...decision }));
  }
}
