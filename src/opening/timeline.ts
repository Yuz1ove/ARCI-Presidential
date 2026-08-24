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
  readonly sensing: number;
  readonly sensingCompact: number;
  readonly inventory: number;
  readonly inventoryCompact: number;
  readonly weighting: number;
  readonly weightsAlign: number;
  readonly computation: number;
  readonly computationRows: number;
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

export const OPENING_END = 0.36;
export const TACTICAL_START = 0.36;

export const SCENES: readonly SceneDefinition[] = [
  { id: "calm", label: "晴朗農村", range: [0, 0.0522] },
  { id: "incoming", label: "烏雲匯聚", range: [0.0522, 0.099] },
  { id: "downpour", label: "暴雨落下", range: [0.099, 0.1674] },
  { id: "landslide", label: "土石流形成", range: [0.1674, 0.2178] },
  { id: "tower-failure", label: "基地台因土石流失聯", range: [0.2178, 0.2484] },
  { id: "need-pause", label: "安全生產的通訊需求仍在", range: [0.2484, 0.3024] },
  { id: "dark-gap", label: "需求與系統介入之間的純黑停頓", range: [0.3024, 0.3082] },
  { id: "arci-warmth", label: "ARCI 暖色光暈建立", range: [0.3082, 0.3197] },
  { id: "arci-construction", label: "ARCI 結構描繪", range: [0.3197, 0.3398] },
  { id: "arci-ignition", label: "農脈 AgriPulse 系統登場", range: [0.3398, 0.4] },
  { id: "sensing", label: "02 感知災情", range: [0.4, 0.52] },
  { id: "inventory", label: "03 盤點需求", range: [0.52, 0.64] },
  { id: "weighting", label: "04 建立權重", range: [0.64, 0.76] },
  { id: "computation", label: "05 數值運算", range: [0.76, 0.88] },
  { id: "routing", label: "06 比對節點與路徑", range: [0.88, 1] },
] as const;

const NARRATIVE_WINDOWS = {
  calm: { enter: [0.04, 0.07], exit: [0.115, 0.145] },
  weather: { enter: [0.155, 0.19], exit: [0.245, 0.275] },
  rain: { enter: [0.29, 0.325], exit: [0.455, 0.49] },
  failure: { enter: [0.61, 0.64], exit: [0.675, 0.7] },
} as const satisfies Record<Exclude<keyof NarrativeState, "need">, RevealWindow>;

export const NEED_RANGE = [0.69, 0.84] as const;
export const BRAND_RANGE = [0.84, 1] as const;

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
    need: revealWindow(needProgress, { enter: [0.35, 0.5], exit: [0.78, 0.92] }),
  };
}

export function brandRevealAt(rawProgress: number): BrandRevealState {
  const progress = openingProgress(rawProgress);
  const brandProgress = phase(progress, BRAND_RANGE[0], BRAND_RANGE[1]);

  return {
    progress: brandProgress,
    sceneDim: easedPhase(progress, 0.69, 0.72),
    visibility: easedPhase(brandProgress, 0.1, 0.16),
    ghost: easedPhase(brandProgress, 0.28, 0.4),
    trace: easedPhase(brandProgress, 0.3, 0.65),
    secondary: easedPhase(brandProgress, 0.42, 0.65),
    core: easedPhase(brandProgress, 0.52, 0.65),
    subtitle: easedPhase(brandProgress, 0.75, 1),
    travel: easedPhase(brandProgress, 0.3, 0.65),
    bloom: easedPhase(brandProgress, 0.6, 0.85),
    environment: easedPhase(brandProgress, 0.1, 0.3),
    particles: easedPhase(brandProgress, 0.65, 1),
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
    slopeSaturation: easedPhase(progress, 0.43, 0.53),
    surfaceRunoff: easedPhase(progress, 0.47, 0.57),
    slopeFracture: easedPhase(progress, 0.51, 0.59),
    landslide: easedPhase(progress, 0.55, 0.66),
    debrisImpact: easedPhase(progress, 0.61, 0.69),
    towerDamage: easedPhase(progress, 0.57, 0.675),
    towerImpact: easedPhase(progress, 0.58, 0.63),
    towerLean: easedPhase(progress, 0.61, 0.66),
    towerCollapse: easedPhase(progress, 0.63, 0.675),
    towerBreak: easedPhase(progress, 0.64, 0.675),
    signalStress: easedPhase(progress, 0.6, 0.67),
    signalFailure: easedPhase(progress, 0.64, 0.69),
    darkness: easedPhase(progress, 0.5, 0.69),
  };
}

export function tacticalAt(rawProgress: number): TacticalState {
  const progress = clamp01(rawProgress);
  return {
    progress,
    systemProgress: phase(progress, TACTICAL_START, 1),
    brandHold: revealWindow(progress, { enter: [0.345, 0.36], exit: [0.985, 1] }),
    brandDock: easedPhase(progress, 0.375, 0.43),
    scanGrid: easedPhase(progress, 0.385, 0.455),
    sensing: revealWindow(progress, { enter: [0.4, 0.435], exit: [0.5, 0.54] }),
    sensingCompact: easedPhase(progress, 0.49, 0.55),
    inventory: revealWindow(progress, { enter: [0.515, 0.55], exit: [0.62, 0.66] }),
    inventoryCompact: easedPhase(progress, 0.61, 0.67),
    weighting: revealWindow(progress, { enter: [0.635, 0.67], exit: [0.74, 0.78] }),
    weightsAlign: easedPhase(progress, 0.725, 0.79),
    computation: revealWindow(progress, { enter: [0.755, 0.79], exit: [0.86, 0.9] }),
    computationRows: easedPhase(progress, 0.785, 0.845),
    decisionSelect: easedPhase(progress, 0.835, 0.89),
    routing: easedPhase(progress, 0.875, 0.91),
    terrainBuild: easedPhase(progress, 0.88, 0.935),
    routeA: easedPhase(progress, 0.905, 0.94),
    routeB: easedPhase(progress, 0.925, 0.96),
    routeC: easedPhase(progress, 0.94, 0.972),
    routeLock: easedPhase(progress, 0.965, 0.995),
  };
}

export function activeScene(progress: number): SceneDefinition {
  const normalized = clamp01(progress);
  return SCENES.find(({ range: [, end] }) => normalized < end) ?? SCENES[SCENES.length - 1]!;
}
