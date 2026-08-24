export interface CinematicState {
  readonly progress: number;
  readonly weather: number;
  readonly cloudGather: number;
  readonly rain: number;
  readonly downpour: number;
  readonly slopeSaturation: number;
  readonly surfaceRunoff: number;
  readonly slopeFracture: number;
  readonly landslide: number;
  readonly debrisImpact: number;
  readonly towerDamage: number;
  readonly towerImpact: number;
  readonly towerLean: number;
  readonly towerCollapse: number;
  readonly towerBreak: number;
  readonly signalStress: number;
  readonly signalFailure: number;
  readonly darkness: number;
}

export interface BrandRevealState {
  readonly progress: number;
  readonly sceneDim: number;
  readonly visibility: number;
  readonly ghost: number;
  readonly trace: number;
  readonly secondary: number;
  readonly core: number;
  readonly subtitle: number;
  readonly travel: number;
  readonly bloom: number;
  readonly environment: number;
  readonly particles: number;
}

export interface NarrativeState {
  readonly calm: number;
  readonly weather: number;
  readonly rain: number;
  readonly failure: number;
  readonly need: number;
}

export interface SceneDefinition {
  readonly id: string;
  readonly label: string;
  readonly range: readonly [number, number];
}

export interface TacticalState {
  readonly progress: number;
  readonly systemProgress: number;
  readonly brandHold: number;
  readonly brandDock: number;
  readonly scanGrid: number;
  readonly outage: number;
  readonly outagePulse: number;
  readonly sensing: number;
  readonly sensingCapture: number;
  readonly sensingCompact: number;
  readonly inventory: number;
  readonly inventoryParse: number;
  readonly inventoryCompact: number;
  readonly weighting: number;
  readonly weightingCalibrate: number;
  readonly weightsAlign: number;
  readonly computation: number;
  readonly computationRows: number;
  readonly computationComplete: number;
  readonly decisionSelect: number;
  readonly routing: number;
  readonly terrainBuild: number;
  readonly routeA: number;
  readonly routeB: number;
  readonly routeC: number;
  readonly routeLock: number;
}

export interface RevealWindow {
  readonly enter: readonly [number, number];
  readonly exit: readonly [number, number];
}

export const OPENING_END = 0.4;
export const TACTICAL_START = 0.4;

export const SCENES: readonly SceneDefinition[] = [
  { id: "calm", label: "晴朗農村", range: [0, 0.0522] },
  { id: "incoming", label: "烏雲匯聚", range: [0.0522, 0.099] },
  { id: "downpour", label: "暴雨落下", range: [0.099, 0.1674] },
  { id: "landslide", label: "土石流形成", range: [0.1674, 0.24] },
  { id: "tower-failure", label: "基地台受到衝擊並失聯", range: [0.24, 0.328] },
  { id: "need-pause", label: "需求沒有消失", range: [0.328, 0.356] },
  { id: "dark-gap", label: "需求與系統介入之間的純黑停頓", range: [0.356, 0.368] },
  { id: "arci-warmth", label: "ARCI 暖色光暈建立", range: [0.368, 0.376] },
  { id: "arci-construction", label: "ARCI 結構描繪", range: [0.376, 0.388] },
  { id: "arci-ignition", label: "農脈 AgriPulse 系統登場", range: [0.388, 0.4] },
  { id: "outage", label: "01 通訊中斷", range: [0.4, 0.47] },
  { id: "sensing", label: "02 感知災情", range: [0.47, 0.58] },
  { id: "inventory", label: "03 盤點需求", range: [0.58, 0.69] },
  { id: "weighting", label: "04 建立權重", range: [0.69, 0.8] },
  { id: "computation", label: "05 數值運算", range: [0.8, 0.9] },
  { id: "routing", label: "06 比對節點與路徑", range: [0.9, 1] },
] as const;

const NARRATIVE_WINDOWS = {
  calm: { enter: [0.04, 0.07], exit: [0.115, 0.145] },
  weather: { enter: [0.155, 0.19], exit: [0.245, 0.275] },
  rain: { enter: [0.29, 0.325], exit: [0.455, 0.49] },
  failure: { enter: [0.77, 0.8], exit: [0.835, 0.855] },
} as const satisfies Record<Exclude<keyof NarrativeState, "need">, RevealWindow>;

export const NEED_RANGE = [0.82, 0.9] as const;
export const BRAND_RANGE = [0.9, 1] as const;

function openingProgress(rawProgress: number): number {
  return clamp01(rawProgress / OPENING_END);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function getSceneProgress(start: number, end: number, progress: number): number {
  if (end <= start) return progress >= end ? 1 : 0;
  return clamp01((progress - start) / (end - start));
}

export const phase = (progress: number, start: number, end: number): number =>
  getSceneProgress(start, end, progress);

export function easedPhase(progress: number, start: number, end: number): number {
  const value = getSceneProgress(start, end, progress);
  return value * value * (3 - 2 * value);
}

export function revealWindow(progress: number, window: RevealWindow): number {
  const enter = easedPhase(progress, window.enter[0], window.enter[1]);
  const exit = easedPhase(progress, window.exit[0], window.exit[1]);
  return clamp01(enter * (1 - exit));
}

export function narrativeAt(rawProgress: number): NarrativeState {
  const progress = openingProgress(rawProgress);
  const needProgress = phase(progress, NEED_RANGE[0], NEED_RANGE[1]);
  return {
    calm: revealWindow(progress, NARRATIVE_WINDOWS.calm),
    weather: revealWindow(progress, NARRATIVE_WINDOWS.weather),
    rain: revealWindow(progress, NARRATIVE_WINDOWS.rain),
    failure: revealWindow(progress, NARRATIVE_WINDOWS.failure),
    need: revealWindow(needProgress, { enter: [0.28, 0.42], exit: [0.72, 0.9] }),
  };
}

export function brandRevealAt(rawProgress: number): BrandRevealState {
  const progress = openingProgress(rawProgress);
  const brandProgress = phase(progress, BRAND_RANGE[0], BRAND_RANGE[1]);

  return {
    progress: brandProgress,
    sceneDim: easedPhase(progress, 0.82, 0.85),
    visibility: easedPhase(brandProgress, 0.16, 0.24),
    ghost: easedPhase(brandProgress, 0.32, 0.46),
    trace: easedPhase(brandProgress, 0.34, 0.66),
    secondary: easedPhase(brandProgress, 0.48, 0.68),
    core: easedPhase(brandProgress, 0.6, 0.72),
    subtitle: easedPhase(brandProgress, 0.78, 1),
    travel: easedPhase(brandProgress, 0.34, 0.68),
    bloom: easedPhase(brandProgress, 0.66, 0.88),
    environment: easedPhase(brandProgress, 0.12, 0.3),
    particles: easedPhase(brandProgress, 0.7, 1),
  };
}

export function stateAt(rawProgress: number): CinematicState {
  const raw = clamp01(rawProgress);
  const progress = openingProgress(raw);
  return {
    progress: raw,
    weather: easedPhase(progress, 0.13, 0.34),
    cloudGather: easedPhase(progress, 0.11, 0.26),
    rain: easedPhase(progress, 0.27, 0.41),
    downpour: easedPhase(progress, 0.32, 0.46),
    slopeSaturation: easedPhase(progress, 0.43, 0.56),
    surfaceRunoff: easedPhase(progress, 0.48, 0.62),
    slopeFracture: easedPhase(progress, 0.53, 0.66),
    landslide: easedPhase(progress, 0.57, 0.74),
    debrisImpact: easedPhase(progress, 0.65, 0.79),
    towerDamage: easedPhase(progress, 0.62, 0.82),
    towerImpact: easedPhase(progress, 0.63, 0.7),
    towerLean: easedPhase(progress, 0.68, 0.77),
    towerCollapse: easedPhase(progress, 0.72, 0.82),
    towerBreak: easedPhase(progress, 0.76, 0.82),
    signalStress: easedPhase(progress, 0.64, 0.79),
    signalFailure: easedPhase(progress, 0.76, 0.83),
    darkness: easedPhase(progress, 0.54, 0.84),
  };
}

export function tacticalAt(rawProgress: number): TacticalState {
  const progress = clamp01(rawProgress);
  return {
    progress,
    systemProgress: phase(progress, TACTICAL_START, 1),
    brandHold: revealWindow(progress, { enter: [0.385, 0.405], exit: [0.985, 1] }),
    brandDock: easedPhase(progress, 0.405, 0.455),
    scanGrid: easedPhase(progress, 0.4, 0.435),
    outage: revealWindow(progress, { enter: [0.438, 0.458], exit: [0.47, 0.5] }),
    outagePulse: easedPhase(progress, 0.415, 0.46),
    sensing: revealWindow(progress, { enter: [0.465, 0.495], exit: [0.56, 0.6] }),
    sensingCapture: easedPhase(progress, 0.49, 0.55),
    sensingCompact: easedPhase(progress, 0.555, 0.605),
    inventory: revealWindow(progress, { enter: [0.575, 0.605], exit: [0.67, 0.705] }),
    inventoryParse: easedPhase(progress, 0.6, 0.665),
    inventoryCompact: easedPhase(progress, 0.66, 0.71),
    weighting: revealWindow(progress, { enter: [0.685, 0.715], exit: [0.78, 0.815] }),
    weightingCalibrate: easedPhase(progress, 0.715, 0.775),
    weightsAlign: easedPhase(progress, 0.775, 0.82),
    computation: revealWindow(progress, { enter: [0.795, 0.825], exit: [0.89, 0.92] }),
    computationRows: easedPhase(progress, 0.82, 0.875),
    computationComplete: easedPhase(progress, 0.87, 0.9),
    decisionSelect: easedPhase(progress, 0.875, 0.915),
    routing: easedPhase(progress, 0.905, 0.93),
    terrainBuild: easedPhase(progress, 0.91, 0.95),
    routeA: easedPhase(progress, 0.93, 0.95),
    routeB: easedPhase(progress, 0.945, 0.968),
    routeC: easedPhase(progress, 0.958, 0.98),
    routeLock: easedPhase(progress, 0.975, 0.998),
  };
}

export function activeScene(progress: number): SceneDefinition {
  const normalized = clamp01(progress);
  return SCENES.find(({ range: [, end] }) => normalized < end) ?? SCENES[SCENES.length - 1]!;
}
