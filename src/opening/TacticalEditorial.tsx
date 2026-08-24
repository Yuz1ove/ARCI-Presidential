import type { CSSProperties, ReactElement } from "react";
import { NEED_SIGNALS, ACTIVE_WEIGHTS, ROUTES, SCENARIO_META, SENSING_SIGNALS, TARGET_SCORES } from "./data/scenario.js";
import { sourceById } from "./data/sources.js";
import { SectionHeading, SignalLine, SystemIdentificationStrip } from "./SystemPrimitives.js";

type IndexedStyle = CSSProperties & { readonly "--i": number };
type RouteStyle = CSSProperties & { readonly "--route-progress": string };
type WeightStyle = IndexedStyle & { readonly "--active-weight": string };

const LOCKED_ROUTE = ROUTES.find((route) => route.decision === "LOCKED") ?? ROUTES[0]!;
const SELECTED_TARGET = TARGET_SCORES[0]!;

function ParticleLanguage(): ReactElement {
  return (
    <div className="system-particles" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <i className="ambient-dust" key={`dust-${index}`} style={{ "--i": index } as IndexedStyle} />)}
      {Array.from({ length: 4 }, (_, index) => <i className="data-particle" key={`data-${index}`} style={{ "--i": index } as IndexedStyle} />)}
      {Array.from({ length: 3 }, (_, index) => <i className="decision-particle" key={`decision-${index}`} style={{ "--i": index } as IndexedStyle} />)}
    </div>
  );
}

function OutageScene(): ReactElement {
  return (
    <section className="tactical-section tactical-section--outage" aria-label="01 通訊中斷">
      <SectionHeading number="01" titleLead="通訊" titleTail="中斷" subtitle="事件已發生，訊號歸零" meta="SIGNAL LOSS" progress="var(--outage-pulse)" intensity={0.62} state="offline" stateChinese="訊號失聯" stateEnglish="OFFLINE" />
      <div className="outage-instrument" aria-label="通訊失聯狀態">
        <svg viewBox="0 0 760 260" aria-hidden="true">
          <SignalLine className="outage-baseline" d="M28 132h164l28-28 34 57 38-82 41 53h85" />
          <SignalLine className="outage-loss" d="M418 132h98l16 0h30l12 0h158" />
          <g className="outage-break"><path d="m405 104 20 22-22 17 20 22" /><circle cx="414" cy="134" r="35" /></g>
        </svg>
        <div className="outage-readout"><span>基地台狀態</span><strong>OFFLINE</strong><em>回傳訊號 0%</em></div>
        <p>等待感知層接管分散事件來源</p>
      </div>
    </section>
  );
}

function TerrainScan(): ReactElement {
  return (
    <svg className="terrain-scan" viewBox="0 0 900 620" aria-hidden="true">
      <defs>
        <linearGradient id="terrain-scan-stroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff3dd" stopOpacity=".05" />
          <stop offset=".58" stopColor="#ff8a1f" stopOpacity=".55" />
          <stop offset="1" stopColor="#ffc46b" stopOpacity=".08" />
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
      <g className="terrain-grid" fill="none"><path d="M0 103h900M0 206h900M0 309h900M0 412h900M0 515h900M150 0v620M300 0v620M450 0v620M600 0v620M750 0v620" /></g>
      <g className="scan-crosshair"><circle cx="557" cy="310" r="68" /><circle cx="557" cy="310" r="4" /><path d="M463 310h188M557 216v188" /></g>
      <path className="scan-sweep" d="M70 538 823 118" pathLength="1" />
    </svg>
  );
}

function SensingScene(): ReactElement {
  return (
    <section className="tactical-section tactical-section--sensing" aria-label="02 感知災情">
      <div className="tactical-copy-column">
        <SectionHeading number="02" titleLead="感知" titleTail="災情" subtitle="多源感知，即時彙集" meta="SITUATION SENSING" progress="var(--sensing-capture)" intensity={0.82} state="sense" stateChinese="多源感知" stateEnglish="SENSING" />
        <p className="tactical-lede">雨量、道路、通訊與人口依序被捕捉，匯入同一座標框架。ARCI 先確認資料層級，再開始判斷。</p>
        <p className="provenance-warning">情境注入 · 官方資料介接尚未連線</p>
      </div>
      <div className="terrain-stage"><TerrainScan /><span className="terrain-caption">感知匯流排 / SOURCE BUS 07</span></div>
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
            <h3>{signal.label}</h3>
            <strong>{signal.displayValue}<small>{signal.unit}</small></strong>
            <footer><span>{signal.id}</span><span>{signal.status}</span></footer>
          </article>
        );
      })}
      <svg className="token-conduit" viewBox="0 0 1000 180" preserveAspectRatio="none" aria-hidden="true"><SignalLine className="token-conduit__bed" d="M20 24h260l82 67h506" /><SignalLine className="token-conduit__active" d="M20 24h260l82 67h506" /></svg>
      <div className="sensing-ingest"><span>ARCI</span><strong>資料匯流</strong><em>INGEST / VERIFY</em></div>
    </div>
  );
}

function DemandResolver(): ReactElement {
  return (
    <div className="demand-resolver" aria-label="原始訊號轉換為結構化需求">
      <p className="resolver-axis resolver-axis--input">RAW SIGNALS</p><p className="resolver-axis resolver-axis--output">DECISION OBJECTS</p>
      <div className="resolver-inputs"><span>雨量</span><span>道路</span><span>通訊</span><span>人口</span></div>
      <svg viewBox="0 0 1000 360" preserveAspectRatio="none" aria-hidden="true">
        <g className="resolver-paths resolver-paths--input"><path d="M32 62C210 62 255 166 436 178" /><path d="M32 140C220 140 282 177 436 178" /><path d="M32 220C220 220 282 182 436 178" /><path d="M32 298C210 298 255 194 436 178" /></g>
        <g className="resolver-paths resolver-paths--output"><path d="M566 178C690 178 714 36 970 36" /><path d="M566 178C710 178 728 108 970 108" /><path d="M566 178H970" /><path d="M566 178C710 178 728 250 970 250" /><path d="M566 178C690 178 714 322 970 322" /></g>
      </svg>
      <div className="resolver-core"><span>ARCI</span><strong>需求解析</strong><em>NORMALIZE</em></div>
      <div className="resolver-outputs">{NEED_SIGNALS.map((need, index) => <span key={need.id} style={{ "--i": index } as IndexedStyle}>{need.label}</span>)}</div>
    </div>
  );
}

function InventoryScene(): ReactElement {
  return (
    <section className="tactical-section tactical-section--inventory" aria-label="03 盤點需求">
      <SectionHeading number="03" titleLead="盤點" titleTail="需求" subtitle="原始訊號，轉為決策物件" meta="NEED RESOLUTION" progress="var(--inventory-parse)" intensity={0.86} state="resolve" stateChinese="需求解析" stateEnglish="RESOLVING" />
      <p className="inventory-note">每個需求保留來源 ID，經解析、分類後成為可回查的決策物件。</p>
      <DemandResolver />
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
      <div className="weighting-title"><SectionHeading number="04" titleLead="建立" titleTail="權重" subtitle="有限通訊資源，必須先流向最需要的人與地" meta="ADAPTIVE WEIGHT" progress="var(--weighting-calibrate)" intensity={0.9} state="weight" stateChinese="權重校準" stateEnglish="WEIGHTING" /></div>
      <div className="weight-formula" aria-label="動態權重公式"><span>wᵢ(t)</span><strong>=</strong><span>bᵢ × mᵢ(t)</span><i /><span>Σ(bⱼ × mⱼ(t))</span><p>基準政策 × 事件乘數 → 正規化動態權重</p></div>
    </section>
  );
}

function WeightModules(): ReactElement {
  return (
    <div className="weight-modules" aria-label="動態權重">
      {ACTIVE_WEIGHTS.map((factor, index) => (
        <article className="weight-module" key={factor.id} style={{ "--i": index, "--active-weight": `${factor.active * 100}%` } as WeightStyle}>
          <header><span>{factor.code}</span><span>{factor.id}</span></header>
          <h3>{factor.label}</h3>
          <div className="weight-equation"><span>{Math.round(factor.baseline * 100)}</span><i>× {factor.multiplier.toFixed(2)}</i><b>→</b><strong>{(factor.active * 100).toFixed(1)}</strong></div>
          <div className="weight-bar"><i /></div>
          <footer><span>初始%</span><span>事件乘數</span><span>動態%</span></footer>
        </article>
      ))}
    </div>
  );
}

function ComputationScene(): ReactElement {
  return (
    <section className="tactical-section tactical-section--computation" aria-label="05 數值運算">
      <SectionHeading number="05" titleLead="數值" titleTail="運算" subtitle="每一次相乘，都留下可回查軌跡" meta="TRACEABLE COMPUTE" progress="var(--computation-rows)" intensity={1} state="compute" stateChinese="軌跡運算" stateEnglish="COMPUTING" />
      <p className="computation-equation">Score = 100 × Σ ( active weight × normalized feature )</p>
      <div className="computation-board">
        {TARGET_SCORES.map((target, targetIndex) => (
          <article className={`target-board target-board--${targetIndex === 0 ? "selected" : "alternate"}`} key={target.id}>
            <header><span><b>方案 {targetIndex === 0 ? "A" : "B"}</b><em>｜{target.label}</em></span><span>{target.provenance}</span></header>
            <div className="target-columns"><span>因子</span><span>動態權重</span><span>特徵值</span><span>貢獻</span><span>累加器</span></div>
            <div className="target-rows">
              {target.values.map((value, index) => (
                <div className="target-row" key={ACTIVE_WEIGHTS[index]!.id} style={{ "--i": index } as IndexedStyle}>
                  <span><b>{ACTIVE_WEIGHTS[index]!.code}</b><em>{ACTIVE_WEIGHTS[index]!.label}</em></span><strong>{ACTIVE_WEIGHTS[index]!.active.toFixed(3)}</strong><i>× {value.toFixed(3)}</i><em>→ {target.contributions[index]!.toFixed(3)}</em><b>Σ {target.accumulator[index]!.toFixed(3)}</b>
                </div>
              ))}
            </div>
            <footer><span>累加分數</span><div className="score-sequence">{target.accumulator.map((value, index) => <i key={index} style={{ "--i": index } as IndexedStyle}>{(value * 100).toFixed(1)}</i>)}</div></footer>
          </article>
        ))}
        <div className="priority-lock"><p>計算完成</p><strong>方案 A 優先</strong><span>{SELECTED_TARGET.label}</span><em>DERIVED / TRACEABLE</em></div>
      </div>
    </section>
  );
}

function RouteTerrain(): ReactElement {
  const paths = ["M104 458C225 395 270 430 357 329S542 194 765 214", "M104 458C235 454 303 372 399 381S566 329 765 214", "M104 458C216 514 344 499 454 433S628 303 765 214"] as const;
  return (
    <svg className="route-terrain" viewBox="0 0 860 560" aria-hidden="true">
      <defs><filter id="route-warm-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <g className="route-contours" fill="none"><path d="M34 485c118-94 238-51 306-153 80-120 202-193 466-149" /><path d="M43 525c143-83 244-36 333-145 76-92 190-148 425-112" /><path d="M95 407c84-76 174-49 237-132 62-81 165-132 347-106" /><path d="M175 347c57-51 126-37 173-95 51-63 122-92 249-75" /></g>
      <g className="route-road"><path d="M65 500C190 528 291 474 395 447S604 340 806 287" /></g>
      <g className="route-hazard"><path d="M276 312c54-46 113-30 143 14 24 36 13 83-31 104-57 27-124 2-140-48-9-28 2-51 28-70Z" /><text x="316" y="368">中斷區域</text></g>
      <g className="route-lines" fill="none">{paths.map((path, index) => <path key={path} className={`route-line route-line--${String.fromCharCode(97 + index)}`} d={path} pathLength="1" style={{ "--route-progress": `var(--route-${String.fromCharCode(97 + index)})` } as RouteStyle} />)}</g>
      <g className="route-node route-node--settlement"><circle cx="104" cy="458" r="9" /><text x="68" y="490">農業聚落</text></g>
      <g className="route-node route-node--road"><circle cx="399" cy="381" r="6" /><text x="365" y="410">道路節點</text></g>
      <g className="route-node route-node--relay"><circle cx="557" cy="326" r="6" /><text x="524" y="355">中繼節點</text></g>
      <g className="route-node route-node--tower"><circle cx="765" cy="214" r="11" /><path d="M751 244h28m-22 0 8-24 8 24" /><text x="733" y="184">基地台</text></g>
      <g className="candidate-node"><path d="m356 324 8 14h-16Z" /><path d="m451 426 8 14h-16Z" /><text x="330" y="305">候選部署點</text></g>
      <g className="locked-flow" filter="url(#route-warm-glow)"><circle cx="104" cy="458" r="3" /><circle cx="260" cy="428" r="3" /><circle cx="399" cy="381" r="3" /><circle cx="568" cy="326" r="3" /><circle cx="765" cy="214" r="3" /></g>
    </svg>
  );
}

function RoutingScene(): ReactElement {
  return (
    <section className="tactical-section tactical-section--routing" aria-label="06 比對節點與路徑">
      <SectionHeading number="06" titleLead="比對節點" titleTail="與路徑" subtitle="把分數放回真實拓樸，確認方案能否執行" meta="ROUTE SELECTION" progress="max(var(--terrain-build), var(--route-lock))" intensity={0.96} state="route" stateChinese="方案鎖定" stateEnglish="ROUTE LOCKED" />
      <div className="route-sequence" aria-label="路徑決策順序"><span>候選路徑</span><i>→</i><span>效用評分</span><i>→</i><span>方案比較</span><i>→</i><strong>鎖定</strong></div>
      <div className="route-stage"><RouteTerrain /><span className="decision-origin">{(SELECTED_TARGET.score * 100).toFixed(1)}<small>決策輸入分數</small></span></div>
      <div className="route-metrics">
        {ROUTES.map((route) => (
          <article className={route.decision === "LOCKED" ? "route-card route-card--locked" : "route-card"} key={route.id}>
            <header><strong>{route.label}</strong><span>{route.decision === "LOCKED" ? "方案鎖定" : "候選"}</span></header><p>{route.id}</p>
            <dl><div><dt>覆蓋</dt><dd>{Math.round(route.reachability * 100)}</dd></div><div><dt>穩定</dt><dd>{Math.round(route.stability * 100)}</dd></div><div><dt>風險</dt><dd>{Math.round(route.risk * 100)}</dd></div><div><dt>延遲</dt><dd>{route.latencyMs}<small>ms</small></dd></div></dl>
            <footer><span>成功率 {Math.round(route.successRate * 100)}%</span><strong>效用 {(route.utility * 100).toFixed(1)}</strong></footer>
          </article>
        ))}
      </div>
      <div className="route-lock"><span>方案鎖定</span><strong>{LOCKED_ROUTE.label}</strong><em>LOCKED</em></div>
    </section>
  );
}

function ProvenanceRail(): ReactElement {
  return <aside className="provenance-rail"><span>{SCENARIO_META.id}</span><strong>SCENARIO INJECTION</strong><span>NO LIVE CONNECTION</span></aside>;
}

export function TacticalEditorial(): ReactElement {
  return (
    <div className="tactical-editorial">
      <div className="tactical-blackout" aria-hidden="true" /><div className="scan-grid" aria-hidden="true" /><ParticleLanguage /><SystemIdentificationStrip scenario="SCENARIO / UNCONNECTED" coordinate="TWN / MOUNTAIN AGRI / 23.5°N" />
      <OutageScene /><SensingScene /><SignalTokens /><InventoryScene /><NeedTokens /><WeightingScene /><WeightModules /><ComputationScene /><RoutingScene /><ProvenanceRail />
    </div>
  );
}
