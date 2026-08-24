import type { ReactElement } from "react";
import { StageNumber, type StageNumberVariant } from "./NumberArtifact.js";

export type ArciStageNumber = `0${1 | 2 | 3 | 4 | 5 | 6}`;

interface SectionHeadingProps {
  readonly number: ArciStageNumber;
  readonly titleLead: string;
  readonly titleTail: string;
  readonly subtitle: string;
  readonly meta: string;
  readonly progress: string;
  readonly intensity?: number;
  readonly state: StageNumberVariant;
  readonly stateEnglish: string;
  readonly stateChinese: string;
}

export function SectionHeading({ number, titleLead, titleTail, subtitle, meta, progress, intensity, state, stateEnglish, stateChinese }: SectionHeadingProps): ReactElement {
  return (
    <header className="tactical-section__header">
      <div className="chapter-metadata">
        <p><span>階段 {number}</span><i /><span>{meta}</span></p>
        <div className="chapter-state"><span>{stateChinese}</span><strong>{stateEnglish}</strong></div>
      </div>
      <div className="tactical-title-row">
        <StageNumber number={number} progress={progress} intensity={intensity} phase={stateChinese} active variant={state} />
        <div className="tactical-heading">
          <h2><span>{titleLead}</span><span>{titleTail}</span></h2>
          <p>{subtitle}</p>
        </div>
      </div>
    </header>
  );
}

interface SystemIdentificationStripProps {
  readonly scenario: string;
  readonly coordinate: string;
}

export function SystemIdentificationStrip({ scenario, coordinate }: SystemIdentificationStripProps): ReactElement {
  return (
    <div className="tactical-chrome" aria-hidden="true">
      <div className="tactical-identity"><strong>ARCI</strong><span>/</span><span>AGRIPULSE</span></div>
      <div className="tactical-status"><i /><span>系統運作中</span><span>{scenario}</span></div>
      <div className="tactical-progress"><i /></div>
      <span className="tactical-coordinate">{coordinate}</span>
    </div>
  );
}

interface SignalLineProps {
  readonly className: string;
  readonly d: string;
}

export function SignalLine({ className, d }: SignalLineProps): ReactElement {
  return <path className={className} d={d} pathLength="1" />;
}
