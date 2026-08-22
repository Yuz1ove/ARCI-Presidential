import { useMemo, useState, type FormEvent } from "react";
import { runtimeScenarioNameSchema } from "../simulation/runtime/schema.js";
import type {
  DashboardActionResult,
  DashboardFailure,
  DashboardMission,
  DashboardScenario,
  DashboardSnapshot,
  Phase4BScenarioName,
} from "./contracts.js";
import { PHASE_4B_SCENARIOS } from "./contracts.js";
import {
  missionStatusPresentation,
  reviewStatusPresentation,
  timelineCategory,
} from "./presentation.js";

interface OperatorDashboardProps {
  readonly initialScenario: DashboardScenario;
  readonly loadScenario: (name: Phase4BScenarioName) => Promise<DashboardScenario>;
}

const METRIC_COPY = [
  ["totalMissions", "Total missions"],
  ["activeMissions", "Active"],
  ["verifiedDeliveredMissions", "Verified delivered"],
  ["failedMissions", "Failed"],
  ["pendingReviews", "Pending reviews"],
  ["activeIncidents", "Incident signals"],
] as const;

const SCENARIO_LABELS: Readonly<Record<Phase4BScenarioName, string>> = {
  "normal-success": "Normal success",
  "cellular-to-lora-recovery": "Cellular → LoRa",
  "ambiguous-proposal": "Ambiguous proposal",
  "prompt-injection": "Prompt injection",
  "reviewed-priority-escalation": "Approved escalation",
  "rejected-update": "Rejected update",
  "pending-review": "Pending review",
  "forged-delivery-claim": "Forged delivery",
  "forged-ack": "Forged ACK",
  "stale-ack": "Stale ACK",
  "wrong-execution-ack": "Wrong-execution ACK",
  "late-valid-ack": "Late valid ACK",
  "no-available-route": "No available route",
  "provider-failure-fallback": "Provider fallback",
  "persistence-failure": "Persistence failure",
  "restart-reconstruction": "Restart reconstruction",
  "conflicting-persistence": "Conflicting history",
  "unsupported-cancellation": "Unsupported cancellation",
};

function ToneBadge({ label, tone }: { readonly label: string; readonly tone: string }) {
  return <span className={`badge badge--${tone}`}>{label}</span>;
}

function ProvenanceBadge({ label }: { readonly label: string }) {
  const className = label.toLowerCase().replaceAll(" ", "-");
  return <span className={`provenance provenance--${className}`}>{label}</span>;
}

function MissionRow({
  mission,
  selected,
  onSelect,
}: {
  readonly mission: DashboardMission;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const status = missionStatusPresentation(mission.projection);
  const route = mission.projection.routeHistory.at(-1);
  return (
    <button
      className={`mission-row${selected ? " mission-row--selected" : ""}`}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="mission-row__top">
        <span className="mission-row__id">{mission.projection.missionId}</span>
        {mission.incidents.length > 0 && <span className="incident-dot" aria-label="Active incident" />}
      </span>
      <span className="mission-row__meta">
        {mission.projection.missionType ?? "Type unresolved"} · {route ?? "No route"}
      </span>
      <ToneBadge label={status.label} tone={status.tone} />
    </button>
  );
}

function MissionDetail({ mission }: { readonly mission: DashboardMission }) {
  const status = missionStatusPresentation(mission.projection);
  return (
    <section className="panel mission-detail" aria-labelledby="mission-detail-title">
      <div className="panel__heading panel__heading--split">
        <div>
          <span className="eyebrow">Mission detail · projected</span>
          <h2 id="mission-detail-title">{mission.projection.missionId}</h2>
        </div>
        <ToneBadge label={status.label} tone={status.tone} />
      </div>

      <div className="detail-grid">
        <div className="detail-item">
          <span>Mission type</span>
          <strong>{mission.projection.missionType ?? "Awaiting resolution"}</strong>
        </div>
        <div className="detail-item">
          <span>Priority</span>
          <strong>Not projected</strong>
        </div>
        <div className="detail-item">
          <span>Execution identity</span>
          <strong>{mission.projection.currentExecutionId ?? "Not issued"}</strong>
        </div>
        <div className="detail-item">
          <span>ACK verification</span>
          <strong>{mission.projection.verifiedAckId ?? "No verified ACK"}</strong>
        </div>
        <div className="detail-item">
          <span>Terminal state</span>
          <strong>{mission.projection.terminalState ?? "Non-terminal"}</strong>
        </div>
        <div className="detail-item">
          <span>Terminal reason</span>
          <strong>{mission.projection.terminalReason ?? "None"}</strong>
        </div>
      </div>

      <div className="evidence-strip">
        <div>
          <ProvenanceBadge label="OBSERVED" />
          <span>Runtime evidence is simulated and query-derived.</span>
        </div>
        <div>
          <ProvenanceBadge label="PROJECTED" />
          <span>Sequence {mission.projection.lastSequence} read model.</span>
        </div>
      </div>

      <div className="detail-sections">
        <section>
          <h3>Route & adaptation history</h3>
          {mission.projection.routeHistory.length === 0 ? (
            <p className="empty-copy">No route selected.</p>
          ) : (
            <ol className="route-chain">
              {mission.projection.routeHistory.map((route, index) => (
                <li key={`${route}:${index.toString()}`}>
                  <span>{(index + 1).toString().padStart(2, "0")}</span>
                  <strong>{route}</strong>
                </li>
              ))}
            </ol>
          )}
          {mission.projection.adaptationHistory.map((adaptation) => (
            <p className="adaptation" key={adaptation}>{adaptation}</p>
          ))}
        </section>

        <section>
          <h3>Incidents</h3>
          {mission.incidents.length === 0 ? (
            <p className="empty-copy">No incident signals projected.</p>
          ) : mission.incidents.map((incident) => (
            <article className="signal-card" key={incident}>
              <ProvenanceBadge label="OBSERVED" />
              <strong>{incident}</strong>
              <span>Observed runtime signal; root cause not asserted.</span>
            </article>
          ))}
        </section>

        <section>
          <h3>Explanations</h3>
          {mission.explanations.length === 0 ? (
            <p className="empty-copy">No explanation projected.</p>
          ) : mission.explanations.map((explanation) => (
            <article className="signal-card" key={explanation}>
              <ProvenanceBadge label="PROJECTED" />
              <strong>{explanation}</strong>
              <span>Derived explanation; not an observed fact.</span>
            </article>
          ))}
        </section>

        <section>
          <h3>Recommendations</h3>
          {mission.recommendations.length === 0 ? (
            <p className="empty-copy">No recommendation projected.</p>
          ) : mission.recommendations.map((recommendation, index) => (
            <article className="signal-card signal-card--recommendation" key={`${recommendation}:${index.toString()}`}>
              <ProvenanceBadge label="RECOMMENDED" />
              <strong>{recommendation}</strong>
              <span>Advice only; accepting prose does not mutate runtime state.</span>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}

function EventTimeline({ snapshot, missionId }: { readonly snapshot: DashboardSnapshot; readonly missionId?: string }) {
  const events = missionId === undefined
    ? snapshot.timeline
    : snapshot.timeline.filter((event) => event.missionId === missionId);
  return (
    <section className="panel timeline" aria-labelledby="timeline-title">
      <div className="panel__heading panel__heading--split">
        <div>
          <span className="eyebrow">Append-only public history</span>
          <h2 id="timeline-title">Event timeline</h2>
        </div>
        <span className="sequence-label">{events.length} records</span>
      </div>
      <ol className="timeline-list">
        {events.map((event) => (
          <li key={event.eventId}>
            <span className="timeline-sequence">{event.sequence.toString().padStart(3, "0")}</span>
            <span className="timeline-marker" />
            <div>
              <div className="timeline-event__top">
                <strong>{event.eventType}</strong>
                <ProvenanceBadge label={timelineCategory(event)} />
              </div>
              <span>{event.source} · {event.timestamp}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function OperatorDashboard({ initialScenario, loadScenario }: OperatorDashboardProps) {
  const initialSnapshot = initialScenario.result.ok
    ? initialScenario.result.snapshot
    : initialScenario.result.snapshot;
  const [scenario, setScenario] = useState(initialScenario);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | undefined>(initialSnapshot);
  const [failure, setFailure] = useState<DashboardFailure | undefined>(
    initialScenario.result.ok ? undefined : initialScenario.result.failure,
  );
  const [selectedMissionId, setSelectedMissionId] = useState(
    initialSnapshot?.missions[0]?.projection.missionId,
  );
  const [busy, setBusy] = useState(false);
  const [proposalId, setProposalId] = useState("operator:mission:new");
  const [proposalText, setProposalText] = useState("Need urgent medical assistance.");
  const [proposalFixture, setProposalFixture] = useState("medical-emergency-low-battery");
  const [updateText, setUpdateText] = useState("Need urgent medical assistance.");
  const [updateFixture, setUpdateFixture] = useState("mission-priority-change");

  const selectedMission = useMemo(
    () => snapshot?.missions.find(({ projection }) => projection.missionId === selectedMissionId)
      ?? snapshot?.missions[0],
    [selectedMissionId, snapshot],
  );

  function applyResult(result: DashboardActionResult): void {
    if (result.ok) {
      setSnapshot(result.snapshot);
      setFailure(undefined);
      setSelectedMissionId((current) =>
        result.snapshot.missions.some(({ projection }) => projection.missionId === current)
          ? current
          : result.snapshot.missions[0]?.projection.missionId,
      );
      return;
    }
    if (result.snapshot !== undefined) setSnapshot(result.snapshot);
    setFailure(result.failure);
  }

  async function act(action: () => Promise<DashboardActionResult>): Promise<void> {
    setBusy(true);
    try {
      applyResult(await action());
    } finally {
      setBusy(false);
    }
  }

  async function switchScenario(name: Phase4BScenarioName): Promise<void> {
    setBusy(true);
    try {
      const loaded = await loadScenario(name);
      setScenario(loaded);
      const nextSnapshot = loaded.result.ok ? loaded.result.snapshot : loaded.result.snapshot;
      setSnapshot(nextSnapshot);
      setFailure(loaded.result.ok ? undefined : loaded.result.failure);
      setSelectedMissionId(nextSnapshot?.missions[0]?.projection.missionId);
    } finally {
      setBusy(false);
    }
  }

  function submitProposal(event: FormEvent): void {
    event.preventDefault();
    void act(() => scenario.client.proposeMission({
      missionId: proposalId,
      text: proposalText,
      simulationScenario: runtimeScenarioNameSchema.parse(proposalFixture),
    }));
  }

  function submitUpdate(event: FormEvent): void {
    event.preventDefault();
    if (selectedMission === undefined) return;
    void act(() => scenario.client.requestMissionUpdate({
      missionId: selectedMission.projection.missionId,
      text: updateText,
      simulationScenario: runtimeScenarioNameSchema.parse(updateFixture),
    }));
  }

  return (
    <div className="operator-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">SL</span>
          <div>
            <strong>StarryLink</strong>
            <span>Resilient communications control</span>
          </div>
        </div>
        <div className="topbar__status">
          <span className="simulation-pill"><span /> SIMULATION</span>
          <span className="runtime-state">
            Runtime {snapshot === undefined ? "unavailable" : "operational"}
          </span>
        </div>
        <label className="scenario-select">
          <span>Simulation case</span>
          <select
            value={scenario.name}
            disabled={busy}
            onChange={(event) => void switchScenario(event.target.value as Phase4BScenarioName)}
          >
            {PHASE_4B_SCENARIOS.map((name) => (
              <option key={name} value={name}>{SCENARIO_LABELS[name]}</option>
            ))}
          </select>
        </label>
      </header>

      <main>
        <section className="workspace-heading">
          <div>
            <span className="eyebrow">Operator workspace · Phase 4B</span>
            <h1>Communication operations</h1>
            <p>{scenario.description}</p>
          </div>
          <div className="health-cluster" aria-label="Runtime health">
            <div><span>Projection</span><strong>{snapshot?.projectionHealth ?? "FAILED"}</strong></div>
            <div><span>Replay</span><strong>{snapshot?.replayHealth ?? "FAILED"}</strong></div>
            <div><span>Persistence</span><strong>{snapshot?.runtime.persistence ?? "FAILED"}</strong></div>
          </div>
        </section>

        {failure !== undefined && (
          <section className="failure-banner" role="alert">
            <div>
              <span className="eyebrow">Command / projection failed closed</span>
              <strong>{failure.code}</strong>
              <p>{failure.message}</p>
            </div>
            <button type="button" onClick={() => setFailure(undefined)}>Dismiss</button>
          </section>
        )}

        {snapshot === undefined ? (
          <section className="unavailable-panel">
            <span className="eyebrow">No authoritative projection available</span>
            <h2>Runtime history cannot be rendered safely.</h2>
            <p>Select another deterministic scenario or resolve the persistence/replay failure.</p>
          </section>
        ) : (
          <>
            <section className="metrics-grid" aria-label="Runtime overview">
              {METRIC_COPY.map(([key, label]) => (
                <article className="metric-card" key={key}>
                  <span>{label}</span>
                  <strong>{snapshot.overview[key]}</strong>
                  <small>Projected</small>
                </article>
              ))}
            </section>

            <div className="workspace-grid">
              <aside className="mission-rail panel" aria-label="Mission list">
                <div className="panel__heading panel__heading--split">
                  <div><span className="eyebrow">Deterministic order</span><h2>Missions</h2></div>
                  <span className="count-chip">{snapshot.missions.length}</span>
                </div>
                <div className="mission-list">
                  {snapshot.missions.map((mission) => (
                    <MissionRow
                      key={mission.projection.missionId}
                      mission={mission}
                      selected={selectedMission?.projection.missionId === mission.projection.missionId}
                      onSelect={() => setSelectedMissionId(mission.projection.missionId)}
                    />
                  ))}
                </div>
              </aside>

              <div className="primary-column">
                {selectedMission === undefined ? (
                  <section className="panel empty-panel"><p>No mission projection is available.</p></section>
                ) : (
                  <>
                    <MissionDetail mission={selectedMission} />
                    <EventTimeline snapshot={snapshot} missionId={selectedMission.projection.missionId} />
                  </>
                )}
              </div>

              <aside className="action-column">
                <section className="panel review-panel" aria-labelledby="review-queue-title">
                  <div className="panel__heading panel__heading--split">
                    <div><span className="eyebrow">Explicit authority</span><h2 id="review-queue-title">Review queue</h2></div>
                    <span className="count-chip">{snapshot.overview.pendingReviews}</span>
                  </div>
                  {snapshot.reviews.length === 0 ? (
                    <p className="empty-copy">No operator reviews in this session.</p>
                  ) : snapshot.reviews.map((review) => {
                    const status = reviewStatusPresentation(review);
                    return (
                      <article className="review-card" key={review.reviewId}>
                        <ToneBadge label={status.label} tone={status.tone} />
                        <strong>{review.proposedMissionType ?? "Unresolved mission type"}</strong>
                        <span>{review.missionId}</span>
                        <p>{review.reason}</p>
                        {review.ambiguities.length > 0 && (
                          <div className="ambiguities">{review.ambiguities.join(" · ")}</div>
                        )}
                        {review.status === "PENDING_OPERATOR_REVIEW" && (
                          <div className="review-actions">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void act(() => scenario.client.decideReview({
                                missionId: review.missionId,
                                reviewId: review.reviewId,
                                decision: "APPROVED",
                              }))}
                            >Approve resolved change</button>
                            <button
                              className="button--secondary"
                              type="button"
                              disabled={busy}
                              onClick={() => void act(() => scenario.client.decideReview({
                                missionId: review.missionId,
                                reviewId: review.reviewId,
                                decision: "REJECTED",
                              }))}
                            >Reject</button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                  <p className="limitation-note">No wall-clock auto-expiry is added in Phase 4B.</p>
                </section>

                <section className="panel command-panel" aria-labelledby="command-panel-title">
                  <div className="panel__heading">
                    <span className="eyebrow">Typed commands only</span>
                    <h2 id="command-panel-title">Operator command panel</h2>
                  </div>

                  <details open>
                    <summary>Propose mission</summary>
                    <form onSubmit={submitProposal}>
                      <label>Mission ID<input value={proposalId} onChange={(event) => setProposalId(event.target.value)} required /></label>
                      <label>Mission request<textarea value={proposalText} onChange={(event) => setProposalText(event.target.value)} maxLength={4000} required /></label>
                      <label>Simulation fixture<select value={proposalFixture} onChange={(event) => setProposalFixture(event.target.value)}>
                        {runtimeScenarioNameSchema.options.map((name) => <option key={name}>{name}</option>)}
                      </select></label>
                      <button type="submit" disabled={busy}>Submit proposal</button>
                    </form>
                  </details>

                  <details>
                    <summary>Update selected mission</summary>
                    <form onSubmit={submitUpdate}>
                      <label>Requested change<textarea value={updateText} onChange={(event) => setUpdateText(event.target.value)} maxLength={4000} required /></label>
                      <label>Simulation fixture<select value={updateFixture} onChange={(event) => setUpdateFixture(event.target.value)}>
                        {runtimeScenarioNameSchema.options.map((name) => <option key={name}>{name}</option>)}
                      </select></label>
                      <button type="submit" disabled={busy || selectedMission === undefined}>Submit for review</button>
                    </form>
                  </details>

                  <div className="command-shortcuts">
                    <button
                      type="button"
                      disabled={busy || selectedMission === undefined}
                      onClick={() => selectedMission === undefined ? undefined : void act(
                        () => scenario.client.requestFreshObservation(selectedMission.projection.missionId),
                      )}
                    >Request fresh observation</button>
                    <button
                      className="button--danger"
                      type="button"
                      disabled={busy || selectedMission === undefined}
                      onClick={() => selectedMission === undefined ? undefined : void act(
                        () => scenario.client.requestCancellation(
                          selectedMission.projection.missionId,
                          "operator dashboard request",
                        ),
                      )}
                    >Request cancellation</button>
                  </div>
                  <p className="limitation-note">Cancellation remains unsupported by the sealed runtime and will fail explicitly.</p>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>
      <footer>
        <span>Phase 4B simulation operator interface</span>
        <span>No live transport · No real ACK delivery · No production persistence</span>
      </footer>
    </div>
  );
}
