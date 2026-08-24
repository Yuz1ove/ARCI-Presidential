import type { CSSProperties, ReactElement } from "react";

export type StageNumberVariant = "offline" | "sense" | "resolve" | "weight" | "compute" | "route";

interface StageNumberProps {
  readonly number: `0${1 | 2 | 3 | 4 | 5 | 6}`;
  readonly progress: string;
  readonly intensity?: number | undefined;
  readonly phase: string;
  readonly active?: boolean;
  readonly variant: StageNumberVariant;
}

type StageNumberStyle = CSSProperties & {
  readonly "--stage-active": number;
  readonly "--stage-intensity": number;
  readonly "--stage-progress": string;
};

const DIGIT_PATHS = {
  0: "M42 18H198L232 52V368L198 402H42L8 368V52L42 18ZM78 82L70 90V330L78 338H162L170 330V90L162 82H78Z",
  1: "M108 96L48 144L12 94L110 18H198V334H248V402H42V334H116V112L108 96Z",
  2: "M38 18H202L238 54V184L84 334H246V402H14V318L176 158V92L166 82H78L68 92V148H8V54L38 18Z",
  3: "M38 18H204L240 54V177L210 207L240 237V366L204 402H36L6 370V298H68V328L78 338H166L178 326V258L166 246H92V178H166L178 166V94L166 82H78L68 92V122H8V54L38 18Z",
  4: "M154 18H230V238H258V306H230V402H154V306H4V230L118 18H154ZM76 238H154V96L76 238Z",
  5: "M22 18H236V82H88V160H202L238 196V366L202 402H38L6 370V298H70V328L80 338H164L176 326V236L164 224H22V18Z",
  6: "M42 18H212L238 48V116H174V90L166 82H80L70 92V164H202L238 200V366L202 402H42L8 368V52L42 18ZM80 228L70 238V328L80 338H164L176 326V240L164 228H80Z",
} as const;

const PHASE_DIGITS = { "01": 1, "02": 2, "03": 3, "04": 4, "05": 5, "06": 6 } as const;

const INTERNAL_CHANNELS: Record<StageNumberVariant, readonly string[]> = {
  offline: ["M-10 214H204L224 190L245 231L270 182L296 214H414", "M462 214H640"],
  sense: ["M-18 352C122 322 190 262 306 226S502 126 644 68", "M-12 308C154 290 234 232 342 198S516 144 642 116"],
  resolve: ["M-14 212C142 212 236 212 306 212", "M306 212C408 212 466 92 642 72", "M306 212C438 212 500 212 642 212", "M306 212C408 212 466 332 642 352"],
  weight: ["M-14 82C170 82 238 172 332 210", "M-14 166C178 166 248 192 332 210", "M-14 256C178 256 248 226 332 210", "M-14 342C170 342 238 250 332 210", "M332 210H642"],
  compute: ["M-18 344C82 326 148 286 214 302S336 232 402 220S524 112 642 78", "M-18 376C136 344 242 346 334 286S500 176 642 150"],
  route: ["M-16 348C120 320 198 350 302 276S482 118 640 108", "M-16 382C136 404 224 306 328 312S486 210 640 108", "M-16 366C122 350 216 336 320 278S480 164 640 108"],
};

const CHANNEL_NODES: Record<StageNumberVariant, readonly [number, number][]> = {
  offline: [[224, 190], [446, 214]],
  sense: [[150, 302], [306, 226], [516, 126]],
  resolve: [[306, 212], [466, 92], [500, 212], [466, 332]],
  weight: [[332, 210], [506, 210]],
  compute: [[214, 302], [402, 220], [524, 112]],
  route: [[302, 276], [480, 164], [610, 108]],
};

export function StageNumber({ number, progress, intensity = 1, phase, active = true, variant }: StageNumberProps): ReactElement {
  const id = `stage-number-${number}-${variant}`;
  const secondDigit = PHASE_DIGITS[number];
  const style = {
    "--stage-active": active ? 1 : 0,
    "--stage-intensity": intensity,
    "--stage-progress": progress,
  } as StageNumberStyle;

  return (
    <svg
      className={`stage-number stage-number--${variant}`}
      data-phase={phase}
      data-variant={variant}
      viewBox="0 0 620 420"
      role="img"
      aria-label={`階段 ${number}，${phase}`}
      focusable="false"
      style={style}
    >
      <defs>
        <path id={`${id}-digit-zero`} d={DIGIT_PATHS[0]} fillRule="evenodd" clipRule="evenodd" pathLength="1" />
        <path id={`${id}-digit-phase`} d={DIGIT_PATHS[secondDigit]} fillRule="evenodd" clipRule="evenodd" pathLength="1" />
        <g id={`${id}-shape`}>
          <use href={`#${id}-digit-zero`} x="22" />
          <use href={`#${id}-digit-phase`} x="334" />
        </g>
        <clipPath id={`${id}-clip`}><use href={`#${id}-shape`} /></clipPath>
        <linearGradient id={`${id}-base`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#130b05" />
          <stop offset=".48" stopColor="#211006" />
          <stop offset="1" stopColor="#070504" />
        </linearGradient>
        <linearGradient id={`${id}-channel`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff7914" stopOpacity=".18" />
          <stop offset=".48" stopColor="#ff9f2f" />
          <stop offset=".62" stopColor="#ffe0a3" />
          <stop offset="1" stopColor="#ff8a00" stopOpacity=".16" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-12%" y="-12%" width="124%" height="124%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <use className="stage-number__base" href={`#${id}-shape`} fill={`url(#${id}-base)`} />
      <use className="stage-number__inset" href={`#${id}-shape`} />
      <use className="stage-number__edge" href={`#${id}-shape`} />

      <g className="stage-number__channels" clipPath={`url(#${id}-clip)`}>
        {INTERNAL_CHANNELS[variant].map((path, index) => (
          <g key={path} style={{ "--channel-index": index } as CSSProperties}>
            <path className="stage-number__channel-bed" d={path} pathLength="1" />
            <path className="stage-number__channel-flow" d={path} pathLength="1" stroke={`url(#${id}-channel)`} filter={`url(#${id}-glow)`} />
          </g>
        ))}
      </g>

      <use className="stage-number__contour-flow stage-number__contour-flow--primary" href={`#${id}-digit-zero`} x="22" filter={`url(#${id}-glow)`} />
      <use className="stage-number__contour-flow stage-number__contour-flow--primary stage-number__contour-flow--delayed" href={`#${id}-digit-phase`} x="334" filter={`url(#${id}-glow)`} />
      <use className="stage-number__contour-flow stage-number__contour-flow--secondary" href={`#${id}-digit-zero`} x="22" />
      <use className="stage-number__contour-flow stage-number__contour-flow--secondary stage-number__contour-flow--delayed" href={`#${id}-digit-phase`} x="334" />

      <g className="stage-number__nodes" aria-hidden="true">
        {CHANNEL_NODES[variant].map(([cx, cy], index) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.4" style={{ "--node-index": index } as CSSProperties} />)}
      </g>

      {variant === "offline" ? <g className="stage-number__break" aria-hidden="true"><path d="M428 184L451 207L429 229L452 252" /><circle cx="441" cy="218" r="31" /></g> : null}
      <path className="stage-number__baseline" d="M8 410H612" pathLength="1" />
    </svg>
  );
}
