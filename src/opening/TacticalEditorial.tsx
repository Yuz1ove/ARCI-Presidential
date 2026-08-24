import type { CSSProperties, ReactElement } from "react";
import { NEED_SIGNALS, ACTIVE_WEIGHTS, ROUTES, SCENARIO_META, SENSING_SIGNALS, TARGET_SCORES } from "./data/scenario.js";
import { sourceById } from "./data/sources.js";

type IndexedStyle = CSSProperties & { readonly "--i": number };
type RouteStyle = CSSProperties & { readonly "--route-progress": string };

function SectionHeader({ number, title, subtitle, code }: { readonly number: string; readonly title: string; readonly subtitle: string; readonly code: string }): ReactElement {
  return (
    <header className="tactical-section__header">
      <p className="tactical-kicker"><span>{code}</span><span>ARCI / DECISION ENGINE</span></p>
      <div className="tactical-title-row">
        <span className="tactical-number" aria-hidden="true">{number}</span>
        <div><h2>{title}</h2><p>{subtitle}</p></div>
      </div>
    </header>
  );
}

function TacticalChrome(): ReactElement {
  return (
    <div className="tactical-chrome" aria-hidden="true">
      <div className="tactical-identity"><strong>ARCI</strong><span>/</span><span>AGRIPULSE</span></div>
      <div className="tactical-status"><i /><span>ACTIVE</span><span>SCENARIO / UNCONNECTED</span></div>
      <div className="tactical-progress"><i /></div>
      <span className="tactical-coordinate">TWN / MOUNTAIN AGRI / 23.5°N</span>
    </div>
  );
}

function TerrainScan(): ReactElement {
  return (
    <svg className="terrain-scan" viewBox="0 0 900 620" aria-hidden="true">
      <defs>
        <linearGradient id="terrain-scan-stroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f5f5f3" stopOpacity=".08" />
          <stop offset=".58" stopColor="#ff7a00" stopOpacity=".48" />
          <stop offset="1" stopColor="#ffb347" stopOpacity=".08" />
        </linearGradient>
      </defs>
      <g className="terrain-contours" fill="none" stroke="url(#terrain-scan-stroke)">
        <path d="M39 504c99-85 178-87 248-42 81 52 142 44 218-46 74-87 165-105 357-40" />
        <path d="M31 468c97-75 177-76 251-32 79 47 147 35 219-50 76-88 171-104 370-26" />
        <path d="M48 425c84-59 163-61 238-19 83 46 151 29 219-51 70-83 160-99 344-33" />
        <path d="M95 374c70-45 135-49 198-15 75 41 139 25 198-45 61-71 139-87 293-36" />
        <path d="M155 324c50-31 103-32 153-7 66 33 118 20 169-38 49-56 113-70 237-31" />
        <path d="M237 270c30-17 61-17 94-2 47 23 85 14 121-27 36-41 82-52 168-26" />
      </g>
      <g className="terrain-grid" fill="none">
        <path d="M0 103h900M0 206h900M0 309h900M0 412h900M0 515h900M150 0v620M300 0v620M450 0v620M600 0v620M750 0v620" />
      </g>
      <g className="scan-crosshair"><circle cx="557" cy="310" r="68" /><circle cx="557" cy="310" r="4" /><path d="M463 310h188M557 216v188" /></g>
      <path className="scan-sweep" d="M70 538 823 118" />
    </svg>
  );
}

function SensingScene(): ReactElement {
  return (
    <section className="tactical-section tactical-section--sensing" aria-label="02 感知災情">
      <div className="tactical-copy-column">
        <SectionHeader number="02" title="感知災情" subtitle="多源感知，即時蒐集" code="SENSING / MULTI-SOURCE" />
        <p className="tactical-lede">雨量、道路、通訊與人口在同一座標框架內交會。ARCI 先確認資料層級，再開始判斷。</p>
        <p className="provenance-warning">SCENARIO INJECTION · OFFICIAL ADAPTERS UNCONNECTED</p>
      </div>
      <div className="terrain-stage"><TerrainScan /><span className="terrain-caption">CONTOUR / SCAN PLANE 07</span></div>
    </section>
  );
}

function SignalTokens(): ReactElement {
  return (
    <div className="signal-tokens" aria-label="災情感知資料">
      {SENSING_SIGNALS.map((signal, index) => {
        const source = sourceById(signal.adapterId);
        return (
          <article className="signal-token" key={signal.id} style={{ "--i": index } as IndexedStyle}>
            <span className="signal-token__node" aria-hidden="true" />
            <p><span>{signal.provenance}</span><span>SOURCE / {source.agency}</span></p>
            <h3>{signal.id}</h3>
            <strong>{signal.displayValue}<small>{signal.unit}</small></strong>
            <footer><span>{signal.label}</span><span>{signal.status}</span></footer>
          </article>
        );
      })}
      <svg className="token-conduit" viewBox="0 0 1000 180" preserveAspectRatio="none" aria-hidden="true"><path d="M20 24h260l82 67h596" /></svg>
    </div>
  );
}

function InventoryScene(): ReactElement {
  return (
    <section className="tactical-section tactical-section--inventory" aria-label="03 盤點需求">
      <SectionHeader number="03" title="盤點需求" subtitle="人・物・地・事，逐層整理" code="INVENTORY / NORMALIZE" />
      <p className="inventory-note">輸入訊號不被丟棄；每個需求保留來源 ID，供後續權重與決策 trace 回查。</p>
    </section>
  );
}

function NeedTokens(): ReactElement {
  return (
    <div className="need-tokens" aria-label="需求分類">
      {NEED_SIGNALS.map((need, index) => (
        <article className="need-token" key={need.id} style={{ "--i": index } as IndexedStyle}>
          <span className="need-token__index">0{index + 1}</span>
          <div><p>CATEGORY / {need.id}</p><h3>{need.label}</h3></div>
          <strong>{need.value}<small>{need.unit}</small></strong>
          <footer><span>{need.provenance}</span><span>SOURCE / {need.sourceSignalIds.join("+")}</span></footer>
        </article>
      ))}
    </div>
  );
}

function WeightingScene(): ReactElement {
  return (
    <section className="tactical-section tactical-section--weighting" aria-label="04 建立權重">
      <div className="weighting-title">
        <SectionHeader number="04" title="建立權重" subtitle="有限通訊資源，必須先流向最需要的人與地" code="WEIGHT / ADAPTIVE POLICY" />
      </div>
      <div className="weight-formula" aria-label="動態權重公式">
        <span>wᵢ(t)</span><strong>=</strong><span>bᵢ × mᵢ(t)</span><i /><span>Σ(bⱼ × mⱼ(t))</span>
        <p>BASELINE POLICY × EVENT MULTIPLIER → NORMALIZED ACTIVE WEIGHT</p>
      </div>
    </section>
  );
}

function WeightModules(): ReactElement {
  return (
    <div className="weight-modules" aria-label="動態權重">
      {ACTIVE_WEIGHTS.map((factor, index) => (
        <article className="weight-module" key={factor.id} style={{ "--i": index } as IndexedStyle}>
          <header><span>{factor.code}</span><span>{factor.id}</span></header>
          <h3>{factor.label}</h3>
          <div className="weight-equation"><span>{Math.round(factor.baseline * 100)}%</span><i>×{factor.multiplier.toFixed(2)}</i><strong>{(factor.active * 100).toFixed(1)}%</strong></div>
          <div className="weight-bar"><i style={{ width: `${factor.active * 100}%` }} /></div>
          <footer><span>BASELINE</span><span>EVENT</span><span>ACTIVE</span></footer>
        </article>
      ))}
    </div>
  );
}

function ComputationScene(): ReactElement {
  return (
    <section className="tactical-section tactical-section--computation" aria-label="05 數值運算">
      <SectionHeader number="05" title="數值運算" subtitle="不是直覺選擇，而是可被驗證的加權判斷" code="COMPUTE / TRACEABLE" />
      <div className="computation-board">
        {TARGET_SCORES.map((target, targetIndex) => (
          <article className={`target-board target-board--${targetIndex === 0 ? "selected" : "alternate"}`} key={target.id}>
            <header><span>{target.id}</span><span>{target.provenance}</span></header>
            <div className="target-rows">
              {target.values.map((value, index) => (
                <div className="target-row" key={ACTIVE_WEIGHTS[index]!.id} style={{ "--i": index } as IndexedStyle}>
                  <span>{ACTIVE_WEIGHTS[index]!.code}</span>
                  <strong>{value.toFixed(3)}</strong>
                  <i>×</i>
                  <span>{ACTIVE_WEIGHTS[index]!.active.toFixed(3)}</span>
                  <em>{(value * ACTIVE_WEIGHTS[index]!.active).toFixed(3)}</em>
                </div>
              ))}
            </div>
            <footer><span>SCORE</span><strong>{(target.score * 100).toFixed(1)}</strong></footer>
          </article>
        ))}
        <div className="priority-lock"><p>PRIORITY</p><strong>{TARGET_SCORES[0]!.label} &gt; {TARGET_SCORES[1]!.label}</strong><span>DERIVED / TRACEABLE</span></div>
      </div>
    </section>
  );
}

function RouteTerrain(): ReactElement {
  const paths = [
    "M104 458C225 395 270 430 357 329S542 194 765 214",
    "M104 458C235 454 303 372 399 381S566 329 765 214",
    "M104 458C216 514 344 499 454 433S628 303 765 214",
  ] as const;
  return (
    <svg className="route-terrain" viewBox="0 0 860 560" aria-hidden="true">
      <g className="route-contours" fill="none"><path d="M34 485c118-94 238-51 306-153 80-120 202-193 466-149" /><path d="M43 525c143-83 244-36 333-145 76-92 190-148 425-112" /><path d="M95 407c84-76 174-49 237-132 62-81 165-132 347-106" /><path d="M175 347c57-51 126-37 173-95 51-63 122-92 249-75" /></g>
      <g className="route-lines" fill="none">
        {paths.map((path, index) => <path key={path} className={`route-line route-line--${String.fromCharCode(97 + index)}`} d={path} pathLength="1" style={{ "--route-progress": `var(--route-${String.fromCharCode(97 + index)})` } as RouteStyle} />)}
      </g>
      <g className="route-nodes"><circle cx="104" cy="458" r="8" /><circle cx="765" cy="214" r="10" /><circle cx="399" cy="381" r="5" /><path d="M82 458h44M104 436v44M741 214h48M765 190v48" /></g>
    </svg>
  );
}

function RoutingScene(): ReactElement {
  return (
    <section className="tactical-section tactical-section--routing" aria-label="06 比對節點與路徑">
      <SectionHeader number="06" title="比對節點與路徑" subtitle="在風險、可達性與回傳效率之間取得平衡" code="ROUTE / NODE TRACE" />
      <div className="route-stage"><RouteTerrain /><span className="decision-origin">73.7<small>DECISION ORIGIN</small></span></div>
      <div className="route-metrics">
        {ROUTES.map((route) => (
          <article className={route.decision === "LOCKED" ? "route-card route-card--locked" : "route-card"} key={route.id}>
            <header><strong>{route.id}</strong><span>{route.decision}</span></header>
            <dl><div><dt>REACH</dt><dd>{Math.round(route.reachability * 100)}</dd></div><div><dt>STABLE</dt><dd>{Math.round(route.stability * 100)}</dd></div><div><dt>RISK</dt><dd>{Math.round(route.risk * 100)}</dd></div><div><dt>LATENCY</dt><dd>{Math.round(route.latency * 100)}</dd></div></dl>
            <footer><span>SUCCESS RATE</span><strong>{Math.round(route.successRate * 100)}%</strong></footer>
          </article>
        ))}
      </div>
      <div className="route-lock"><span>DECISION</span><strong>ROUTE_B</strong><em>LOCKED</em></div>
    </section>
  );
}

function ProvenanceRail(): ReactElement {
  return (
    <aside className="provenance-rail">
      <span>{SCENARIO_META.id}</span><strong>SCENARIO INJECTION</strong><span>NO LIVE CONNECTION</span>
    </aside>
  );
}

export function TacticalEditorial(): ReactElement {
  return (
    <div className="tactical-editorial">
      <div className="tactical-blackout" aria-hidden="true" />
      <div className="scan-grid" aria-hidden="true" />
      <TacticalChrome />
      <SensingScene />
      <SignalTokens />
      <InventoryScene />
      <NeedTokens />
      <WeightingScene />
      <WeightModules />
      <ComputationScene />
      <RoutingScene />
      <ProvenanceRail />
    </div>
  );
}
