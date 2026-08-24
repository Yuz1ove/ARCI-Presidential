import { useEffect, useMemo, useState, type ReactElement } from "react";
import { runBenchmark } from "./benchmark.js";
import { injectFailure, runAdaptiveScenario } from "./engine.js";
import { COMPETITION_SCENARIOS, scenarioById } from "./fixtures.js";
import { createDataSnapshot, loadRealData } from "./real-data.js";
import type {
  BenchmarkResult,
  CompetitionScenario,
  DataMode,
  DecisionTrace,
  FailureType,
  RealDataSnapshot,
  WeightKey,
} from "./model.js";

const PIPELINE = [
  "REAL WORLD DATA",
  "NORMALIZATION",
  "DISASTER STATE",
  "NETWORK STATE",
  "CONSTRAINT ENGINE",
  "CANDIDATE GENERATION",
  "ADAPTIVE POLICY",
  "SCORING",
  "ACTION SELECTION",
  "EXECUTION SIMULATION",
  "ACK / FAILURE",
  "OUTCOME VALIDATION",
  "RE-PLAN + AUDIT",
] as const;

const MODES: readonly DataMode[] = ["LIVE", "REPLAY", "SIMULATION"];

const FAILURE_TYPES: readonly FailureType[] = [
  "TOWER_FAILURE",
  "PACKET_LOSS",
  "LATENCY_SPIKE",
  "BANDWIDTH_COLLAPSE",
  "ROAD_CLOSURE",
  "DEBRIS_FLOW",
  "POWER_LOSS",
  "NODE_ISOLATION",
];

const WEIGHT_KEYS: readonly WeightKey[] = [
  "reliability",
  "latency",
  "coverage",
  "priority",
  "energy",
  "cost",
  "congestion",
  "hazard",
  "deliveryProbability",
  "bandwidth",
];

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function score(value: number | null): string {
  return value === null ? "HARD REJECT" : value.toFixed(4);
}

function shortTimestamp(value: string): string {
  return value === "NOT_FETCHED" ? value : value.replace("T", " ").replace(/([+-]\d{2}:\d{2}|Z)$/, "");
}

function TracePanel({ trace }: { readonly trace: DecisionTrace }): ReactElement {
  return (
    <article className="presidential-trace" aria-label={`Decision trace ${trace.decisionId}`}>
      <header>
        <div>
          <span className="presidential-kicker">DECISION TRACE · CYCLE {trace.cycle}</span>
          <h3>{trace.message.location} / {trace.message.demandType}</h3>
        </div>
        <strong data-outcome={trace.outcome}>{trace.outcome}</strong>
      </header>

      <div className="presidential-weight-flow" aria-label="Base, context and effective weights">
        {WEIGHT_KEYS.map((key) => (
          <div key={key}>
            <span>{key}</span>
            <code>{trace.weights.base[key].toFixed(3)}</code>
            <i aria-hidden="true">→</i>
            <code>{trace.weights.adjustments[key] >= 0 ? "+" : ""}{trace.weights.adjustments[key].toFixed(3)}</code>
            <i aria-hidden="true">→</i>
            <strong>{trace.weights.effective[key].toFixed(3)}</strong>
          </div>
        ))}
      </div>
      <p className="presidential-note">{trace.weights.reasons.join(" · ") || "BASE WEIGHTS — no contextual adjustment required"}</p>

      <div className="presidential-candidates">
        {trace.candidates
          .slice()
          .sort((left, right) => (right.score ?? -1) - (left.score ?? -1) || left.linkId.localeCompare(right.linkId))
          .map((candidate) => {
            const rejected = candidate.constraints.filter(({ passed }) => !passed).map(({ code }) => code);
            return (
              <div key={candidate.linkId} data-eligibility={candidate.eligibility}>
                <span>{candidate.label}</span>
                <strong>{score(candidate.score)}</strong>
                <small>{rejected.length === 0 ? "ELIGIBLE · SIMULATED LINK" : rejected.join(" · ")}</small>
              </div>
            );
          })}
      </div>

      <footer>
        <span>SELECTED</span>
        <strong>{trace.selectedAction?.label ?? "STORE AND FORWARD"}</strong>
        <span>EXECUTION</span>
        <strong>{trace.execution[0]?.evidence ?? "LOCAL QUEUE — no eligible route"}</strong>
        {trace.replanReason === undefined ? null : <p>RE-PLAN · {trace.replanReason}</p>}
      </footer>
    </article>
  );
}

function BenchmarkPanel({ result }: { readonly result: BenchmarkResult | null }): ReactElement {
  if (result === null) {
    return <p className="presidential-empty">尚未執行。按下 RUN N=100 後，表格才會顯示此裝置實際跑出的結果。</p>;
  }
  return (
    <div className="presidential-benchmark-result">
      <div className="presidential-table-wrap">
        <table>
          <caption>{result.runId} · {result.scenarioCount} deterministic fixtures</caption>
          <thead><tr><th>Metric</th><th>Static</th><th>ARCI adaptive</th><th>Delta</th><th>Class</th></tr></thead>
          <tbody>
            {result.metrics.map((metric) => (
              <tr key={metric.id}>
                <th>{metric.label}<small>{metric.unit}</small></th>
                <td>{metric.staticPolicy}</td>
                <td>{metric.adaptivePolicy}</td>
                <td>{metric.delta > 0 ? "+" : ""}{metric.delta}</td>
                <td><span className="presidential-classification">{metric.classification}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="presidential-latency">
        <span>DECISION LATENCY · MEASURED</span>
        <strong>STATIC p95 {result.decisionLatency.staticPolicy.p95} ms</strong>
        <strong>ADAPTIVE p95 {result.decisionLatency.adaptivePolicy.p95} ms</strong>
        <small>Failure rate {percent(result.decisionLatency.staticPolicy.failureRate)} / {percent(result.decisionLatency.adaptivePolicy.failureRate)}</small>
      </div>
      <p className="presidential-note">{result.disclosure}</p>
    </div>
  );
}

export function PresidentialLab(): ReactElement {
  const [snapshot, setSnapshot] = useState<RealDataSnapshot>(() => createDataSnapshot("REPLAY"));
  const [loadingMode, setLoadingMode] = useState<DataMode | null>(null);
  const [scenario, setScenario] = useState<CompetitionScenario>(() => scenarioById("SCENARIO_01"));
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [benchmark, setBenchmark] = useState<BenchmarkResult | null>(null);
  const run = useMemo(() => runAdaptiveScenario(scenario), [scenario]);
  const latestTrace = run.traces.at(-1)!;

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      setStage((current) => {
        if (current >= PIPELINE.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 720);
    return () => window.clearInterval(timer);
  }, [playing]);

  async function selectMode(mode: DataMode): Promise<void> {
    setLoadingMode(mode);
    const next = await loadRealData(mode);
    setSnapshot(next);
    setLoadingMode(null);
  }

  function selectScenario(id: CompetitionScenario["id"]): void {
    setScenario(scenarioById(id));
    setStage(0);
    setPlaying(false);
  }

  function start(): void {
    setStage(0);
    setPlaying(true);
  }

  return (
    <section className="presidential-lab" id="presidential-hardening" aria-labelledby="presidential-title">
      <header className="presidential-hero">
        <span className="presidential-kicker">ARCI PRESIDENTIAL HARDENING V1</span>
        <h2 id="presidential-title">不是「AI 決策中」<br /><em>是每一步都能被檢查的韌性決策。</em></h2>
        <p>官方公開資料提供地區脈絡；事件狀態與鏈路表現清楚標為模擬。硬限制先行，分數可重算，執行結果必須有匹配 ACK，失敗則重新規劃。</p>
        <div className="presidential-statusline">
          <span>ENGINE <strong>DETERMINISTIC</strong></span>
          <span>LINKS <strong>SIMULATED</strong></span>
          <span>DATA <strong>{snapshot.effectiveMode}</strong></span>
        </div>
      </header>

      <nav className="presidential-modebar" aria-label="Real data mode">
        <div><span className="presidential-kicker">REAL DATA LAYER</span><strong>Requested {snapshot.requestedMode} · Effective {snapshot.effectiveMode}</strong></div>
        <div className="presidential-buttons">
          {MODES.map((mode) => (
            <button key={mode} type="button" aria-pressed={snapshot.requestedMode === mode} disabled={loadingMode !== null} onClick={() => void selectMode(mode)}>
              {loadingMode === mode ? "LOADING" : mode}
            </button>
          ))}
        </div>
      </nav>
      {snapshot.degradedReason === undefined ? null : <p className="presidential-degraded" role="status">{snapshot.degradedReason}</p>}

      <section className="presidential-source-band" aria-labelledby="source-heading">
        <header><span className="presidential-index">01</span><div><span className="presidential-kicker">PROVENANCE BEFORE CLAIMS</span><h3 id="source-heading">Official context, explicit limits</h3></div></header>
        <div className="presidential-context-numbers">
          <div><span>仁愛鄉戶籍人口</span><strong>{snapshot.context.population.toLocaleString()}</strong><small>PUBLIC · MOI monthly</small></div>
          <div><span>65+ 戶籍人口</span><strong>{snapshot.context.elderlyPopulation.toLocaleString()}</strong><small>PUBLIC · DERIVED SUM</small></div>
          <div><span>4G / 5G 基地臺 proxy</span><strong>{snapshot.context.mobileBaseStationProxy.fourG} / {snapshot.context.mobileBaseStationProxy.fiveG}</strong><small>PUBLIC · NCC 1150731</small></div>
          <div><span>仁愛鄉百合年產量</span><strong>{snapshot.context.agriculture.productionKg.toLocaleString()} kg</strong><small>PUBLIC · MOA 114 年</small></div>
        </div>
        <div className="presidential-sources">
          {snapshot.sources.map((source) => (
            <article key={source.sourceId}>
              <div><span>{source.provider}</span><strong>{source.status}</strong></div>
              <h4>{source.datasetName}</h4>
              <dl><div><dt>OBSERVED</dt><dd>{shortTimestamp(source.observedAt)}</dd></div><div><dt>FRESHNESS</dt><dd>{source.freshness}</dd></div><div><dt>CLASS</dt><dd>{source.classification}</dd></div></dl>
              <p>{source.limitation}</p>
              <a href={source.sourceUrl} target="_blank" rel="noreferrer">OFFICIAL SOURCE ↗</a>
            </article>
          ))}
        </div>
      </section>

      <section className="presidential-control" aria-labelledby="control-heading">
        <header><span className="presidential-index">02</span><div><span className="presidential-kicker">COMPETITION DEMO MODE</span><h3 id="control-heading">Scenario Control</h3></div></header>
        <div className="presidential-scenario-tabs" role="group" aria-label="Competition scenario">
          {COMPETITION_SCENARIOS.map((candidate) => (
            <button key={candidate.id} type="button" aria-pressed={candidate.id === scenario.id} onClick={() => selectScenario(candidate.id)}>
              <span>{candidate.id.replace("SCENARIO_", "S")}</span>{candidate.title}
            </button>
          ))}
        </div>
        <div className="presidential-demo-controls">
          <button type="button" onClick={start}>START SCENARIO</button>
          <button type="button" onClick={() => setPlaying(false)} disabled={!playing}>PAUSE</button>
          <button type="button" onClick={() => setPlaying(true)} disabled={playing || stage >= PIPELINE.length - 1}>RESUME</button>
          <button type="button" onClick={() => { setPlaying(false); setStage(0); }}>RESET</button>
          <button type="button" onClick={start}>REPLAY</button>
        </div>
        <ol className="presidential-pipeline" aria-label="Decision pipeline">
          {PIPELINE.map((label, index) => <li key={label} data-state={index < stage ? "complete" : index === stage ? "active" : "pending"}><span>{String(index + 1).padStart(2, "0")}</span>{label}</li>)}
        </ol>
        <p className="presidential-objective"><span>NOW</span><strong>{PIPELINE[stage]}</strong>{scenario.objective}</p>
      </section>

      <section className="presidential-twin" aria-labelledby="twin-heading">
        <header><span className="presidential-index">03</span><div><span className="presidential-kicker">SIMULATION · DISASTER DIGITAL TWIN</span><h3 id="twin-heading">One state, five operational dimensions</h3></div></header>
        <div className="presidential-twin-grid">
          <article><span>ENVIRONMENT</span><strong>{scenario.state.environment.rainfall1hMm} mm/h</strong><p>{scenario.state.environment.hazardLevel} hazard · road {scenario.state.environment.roadAccessibility}</p></article>
          <article><span>INFRASTRUCTURE</span><strong>{scenario.state.infrastructure.nodesOperational} nodes</strong><p>{scenario.state.infrastructure.towersFailed} tower failed · power {scenario.state.infrastructure.powerAvailable ? "available" : "lost"}</p></article>
          <article><span>COMMUNICATION</span><strong>{scenario.state.communication.filter(({ available }) => available).length} / {scenario.state.communication.length}</strong><p>available links · all links SIMULATED</p></article>
          <article><span>DEMAND</span><strong>{scenario.messages.length}</strong><p>{scenario.state.demand.agriculturalDemandIds.length} agricultural · {scenario.state.demand.affectedVillages.length} villages</p></article>
          <article><span>RESOURCE</span><strong>{percent(scenario.state.resources.energyReserve)}</strong><p>{scenario.state.resources.droneRelaysAvailable} drone relay · {scenario.state.resources.relayTeamsAvailable} team</p></article>
        </div>
      </section>

      <section className="presidential-failure" aria-labelledby="failure-heading">
        <header><span className="presidential-index">04</span><div><span className="presidential-kicker">CRISIS INJECTION · SIMULATION ONLY</span><h3 id="failure-heading">Failure Injection</h3></div></header>
        <div className="presidential-failure-buttons">
          {FAILURE_TYPES.map((type) => <button key={type} type="button" onClick={() => { setScenario((current) => injectFailure(current, type)); setStage(0); setPlaying(false); }}>{type.replaceAll("_", " ")}</button>)}
        </div>
        <p>{scenario.injections.at(-1)?.description} · Active injections: {scenario.injections.map(({ label }) => label).join(" / ")}</p>
      </section>

      <section className="presidential-decision" aria-labelledby="decision-heading">
        <header><span className="presidential-index">05</span><div><span className="presidential-kicker">RUNTIME OUTPUT · NO UI SCORE CONSTANTS</span><h3 id="decision-heading">Explainable Decision</h3></div></header>
        <TracePanel trace={latestTrace} />
        <details><summary>Inspect all {run.traces.length} decision cycles</summary>{run.traces.map((trace) => <TracePanel key={trace.decisionId} trace={trace} />)}</details>
      </section>

      <section className="presidential-delivery" aria-labelledby="delivery-heading">
        <header><span className="presidential-index">06</span><div><span className="presidential-kicker">LOCAL STORE → QUEUE → FORWARD → MATCHED ACK</span><h3 id="delivery-heading">Resilient Message Ledger</h3></div></header>
        <div className="presidential-table-wrap">
          <table>
            <thead><tr><th>Priority / demand</th><th>Location</th><th>Payload</th><th>Route history</th><th>Retries</th><th>Outcome</th></tr></thead>
            <tbody>{run.messages.map((message) => <tr key={message.id}><th>P{message.priority} · {message.demandType}</th><td>{message.location}</td><td>{message.payloadSizeKb.toLocaleString()} KB</td><td>{message.routeHistory.join(" → ")}</td><td>{message.retryCount}</td><td>{message.status}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="presidential-metrics">
          <div><span>DELIVERY</span><strong>{percent(run.metrics.messageDeliveryRate)}</strong></div>
          <div><span>PRIORITY DELIVERY</span><strong>{percent(run.metrics.priorityMessageDeliveryRate)}</strong></div>
          <div><span>COVERAGE RESTORED</span><strong>{percent(run.metrics.coverageRestored)}</strong></div>
          <div><span>RE-PLAN</span><strong>{run.metrics.replanCount}</strong></div>
          <div><span>FINAL QUEUE</span><strong>{run.metrics.queueDepthFinal}</strong></div>
        </div>
      </section>

      <section className="presidential-benchmark" aria-labelledby="benchmark-heading">
        <header><span className="presidential-index">07</span><div><span className="presidential-kicker">REAL HARNESS · NO DISPLAY FIXTURES</span><h3 id="benchmark-heading">Static Policy vs ARCI Adaptive Policy</h3></div><button type="button" onClick={() => setBenchmark(runBenchmark(100))}>RUN N=100</button></header>
        <BenchmarkPanel result={benchmark} />
      </section>

      <section className="presidential-governance" aria-labelledby="governance-heading">
        <header><span className="presidential-index">08</span><div><span className="presidential-kicker">DATA GOVERNANCE</span><h3 id="governance-heading">Useful evidence, bounded claims</h3></div></header>
        <div>
          <article><span>PROVENANCE</span><h4>Source + time + terms</h4><p>External records retain provider, dataset, URL, fetch/observation time, freshness, quality, classification, license and limitation.</p></article>
          <article><span>PRIVACY</span><h4>No unnecessary identity</h4><p>Demo demand uses village-level fictional message IDs. No name, phone number, exact household address or precise personal identity is collected.</p></article>
          <article><span>RETENTION</span><h4>Session memory only</h4><p>The browser demo keeps simulation state in React memory and clears it on reload. No demand record is sent to a backend.</p></article>
          <article><span>AUDITABILITY</span><h4>{run.auditTrail.length} records in this run</h4><p>Decision IDs connect inputs, constraints, weights, candidates, action, execution evidence, outcome and re-plan reason.</p></article>
        </div>
        <footer><strong>AUTHORITY BOUNDARY</strong> LLM MAY EXPLAIN · DETERMINISTIC ENGINE DECIDES · MATCHED ACK OWNS DELIVERY TRUTH</footer>
      </section>
    </section>
  );
}
