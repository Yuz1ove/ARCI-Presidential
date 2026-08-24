import { useRef, type CSSProperties, type ReactElement } from "react";
import { PresidentialLab } from "../presidential/PresidentialLab.js";
import { TacticalEditorial } from "./TacticalEditorial.js";
import { useScrollProgress } from "./useScrollProgress.js";

const MASTER_SCENE_DESKTOP = "/assets/opening/golden-morning-v2.webp";
const MASTER_SCENE_MOBILE = "/assets/opening/golden-morning-v2-mobile.webp";
const LANDSLIDE_TEXTURE_DESKTOP = "/assets/opening/master-scene-landslide-texture-v1.webp";
const LANDSLIDE_TEXTURE_MOBILE = "/assets/opening/master-scene-landslide-texture-v1-mobile.webp";

type RainDepth = "distant" | "midground" | "foreground";

interface RainStreak {
  readonly left: string;
  readonly top: string;
  readonly height: string;
  readonly width: string;
  readonly opacity: number;
  readonly angle: string;
}

type RainStyle = CSSProperties & {
  readonly "--rain-angle": string;
};

function deterministicSample(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function rainStreaks(count: number, depth: RainDepth): readonly RainStreak[] {
  const depthIndex = depth === "distant" ? 0 : depth === "midground" ? 1 : 2;
  const profiles = [
    { minHeight: 6, heightRange: 13, minWidth: 0.42, widthRange: 0.36, minOpacity: 0.12, opacityRange: 0.26 },
    { minHeight: 22, heightRange: 48, minWidth: 0.66, widthRange: 0.8, minOpacity: 0.22, opacityRange: 0.42 },
    { minHeight: 72, heightRange: 92, minWidth: 1.15, widthRange: 1.35, minOpacity: 0.28, opacityRange: 0.38 },
  ] as const;
  const profile = profiles[depthIndex];

  return Array.from({ length: count }, (_, index) => ({
    left: `${-3 + deterministicSample(index, depthIndex * 11 + 1) * 106}%`,
    top: `${-19 + deterministicSample(index, depthIndex * 11 + 2) * 123}%`,
    height: `${profile.minHeight + deterministicSample(index, depthIndex * 11 + 3) * profile.heightRange}px`,
    width: `${profile.minWidth + deterministicSample(index, depthIndex * 11 + 4) * profile.widthRange}px`,
    opacity: profile.minOpacity + deterministicSample(index, depthIndex * 11 + 5) * profile.opacityRange,
    angle: `${5 + deterministicSample(index, depthIndex * 11 + 6) * 7}deg`,
  }));
}

const RAIN_STREAKS: Readonly<Record<RainDepth, readonly RainStreak[]>> = {
  distant: rainStreaks(32, "distant"),
  midground: rainStreaks(20, "midground"),
  foreground: rainStreaks(8, "foreground"),
};

const BRAND_PARTICLES = Array.from({ length: 14 }, (_, index) => ({
  left: `${18 + ((index * 41) % 66)}%`,
  top: `${23 + ((index * 29) % 54)}%`,
  size: `${1 + (index % 3) * 0.45}px`,
}));

function MasterScene(): ReactElement {
  return (
    <picture
      className="master-scene"
      data-master-scene="golden-morning-v2"
      data-visual-source-of-truth="true"
    >
      <source media="(max-width: 760px)" srcSet={MASTER_SCENE_MOBILE} type="image/webp" />
      <img
        src={MASTER_SCENE_DESKTOP}
        alt=""
        width="1586"
        height="892"
        decoding="sync"
        fetchPriority="high"
      />
    </picture>
  );
}

function RainLayer({ depth }: { readonly depth: RainDepth }): ReactElement {
  return (
    <div className={`rain-field rain-field--${depth}`} data-rain-depth={depth}>
      {RAIN_STREAKS[depth].map((streak, index) => (
        <i
          key={`${depth}-${index}`}
          style={{
            left: streak.left,
            top: streak.top,
            height: streak.height,
            width: streak.width,
            opacity: streak.opacity,
            "--rain-angle": streak.angle,
          } as RainStyle}
        />
      ))}
    </div>
  );
}

function WeatherDegradation(): ReactElement {
  return (
    <div className="weather-degradation" data-layer="master-scene-weather">
      <div className="incoming-clouds" aria-hidden="true">
        <span className="incoming-cloud incoming-cloud--high" />
        <span className="incoming-cloud incoming-cloud--low" />
      </div>
      <div className="mountain-moisture" aria-hidden="true" />
      <div className="distant-rain-curtain" aria-hidden="true" />
      <RainLayer depth="distant" />
      <div className="rain-haze" aria-hidden="true" />
      <RainLayer depth="midground" />
      <div className="field-wetness" aria-hidden="true" />
      <div className="river-ripples" aria-hidden="true" />
      <RainLayer depth="foreground" />
      <div className="lens-water" aria-hidden="true" />
    </div>
  );
}

function DesktopSlopeDegradation(): ReactElement {
  return (
    <svg className="slope-degradation slope-degradation--desktop" viewBox="0 0 1586 892" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id="erosion-edge-desktop" x="-30%" y="-20%" width="160%" height="150%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <mask id="landslide-path-desktop" maskUnits="userSpaceOnUse" x="820" y="230" width="390" height="390">
          <path fill="white" filter="url(#erosion-edge-desktop)" d="M1119 269c42 44 47 95 21 139-29 50-72 86-117 119-46 34-94 51-147 37 5-41 37-69 66-99 33-34 55-73 77-114 22-40 52-69 100-82Z" />
        </mask>
        <filter id="eroded-source-desktop" x="-20%" y="-15%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency=".018 .055" numOctaves="3" seed="17" result="erosionNoise" />
          <feDisplacementMap in="SourceGraphic" in2="erosionNoise" scale="9" xChannelSelector="R" yChannelSelector="B" result="eroded" />
          <feColorMatrix in="eroded" type="saturate" values=".62" result="muted" />
          <feComponentTransfer in="muted">
            <feFuncR type="linear" slope=".74" />
            <feFuncG type="linear" slope=".77" />
            <feFuncB type="linear" slope=".8" />
          </feComponentTransfer>
        </filter>
        <filter id="slope-mist-desktop" x="-80%" y="-80%" width="260%" height="260%">
          <feTurbulence type="fractalNoise" baseFrequency=".025" numOctaves="2" seed="9" result="mistNoise" />
          <feDisplacementMap in="SourceGraphic" in2="mistNoise" scale="22" />
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id="tower-cover-blur-desktop" x="-30%" y="-20%" width="160%" height="140%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <mask id="tower-cover-mask-desktop" maskUnits="userSpaceOnUse" x="826" y="309" width="110" height="250">
          <path fill="white" filter="url(#tower-cover-blur-desktop)" d="M850 328c23-15 52-14 70 3l-3 200c-22 18-57 19-78 1Z" />
        </mask>
      </defs>

      <path className="slope-saturation" d="M1017 326c42 20 68 58 64 100-4 44-37 81-74 111-38 30-91 35-132 12-19-35 5-70 31-99 29-32 31-77 54-102 14-16 32-22 57-22Z" />

      <g className="surface-runoff">
        <path d="M1019 345c-6 35-27 69-57 98-26 26-43 56-55 91" />
        <path d="M1046 369c-15 39-38 68-69 95-24 21-40 48-50 76" />
        <path d="M986 361c-11 34-30 63-54 87" />
      </g>

      <g className="slope-fractures">
        <path d="M979 354l18 4 12-7 17 11" />
        <path d="M953 409l14 3 10-6 14 9" />
      </g>

      <g className="landslide-body">
        <path className="landslide-mass" d="M1114 286c22 43 20 84-2 124-24 43-62 79-103 112-39 32-82 47-132 43 29-32 58-62 81-99 25-39 38-83 65-121 24-34 52-53 91-59Z" />
        <path className="landslide-channel" d="M1084 329c-8 45-37 81-68 115-35 38-69 74-113 102" />
        <path className="landslide-channel landslide-channel--fine" d="M1046 350c-13 48-44 86-78 122-20 21-39 41-63 57" />
        <g className="landslide-debris">
          <circle cx="967" cy="500" r="9" /><circle cx="932" cy="533" r="6" /><circle cx="991" cy="476" r="5" /><circle cx="899" cy="551" r="8" />
        </g>
      </g>

      <image
        className="eroded-source"
        href={LANDSLIDE_TEXTURE_DESKTOP}
        x="0"
        y="0"
        width="1586"
        height="892"
        preserveAspectRatio="xMidYMid slice"
        mask="url(#landslide-path-desktop)"
      />
      <path className="debris-mist" d="M835 524c57-30 135-25 173 10 21 19 17 42-5 57-49 34-143 25-184-15-18-18-10-36 16-52Z" />

      <g className="tower-failure tower-failure--desktop" data-tower-layer="svg-damage-overlay">
        <image
          className="tower-source-cover"
          href={MASTER_SCENE_DESKTOP}
          x="-54"
          y="0"
          width="1586"
          height="892"
          preserveAspectRatio="xMidYMid slice"
          mask="url(#tower-cover-mask-desktop)"
        />

        <path className="tower-impact-flow" d="M1010 493c-31 13-58 31-83 47-20 13-43 16-67 10 24-21 49-36 79-48 22-9 46-16 71-9Z" />
        <path className="tower-foundation-mud" d="M835 527c24-12 58-13 81-2 17 8 20 20 9 30-22 18-70 18-93-2-10-9-8-18 3-26Z" />

        <g className="tower-replacement tower-replacement--desktop">
          <g className="tower-lower tower-lower--desktop">
            <g className="tower-structure">
              <path d="M857 533 873 430M897 533 882 430M857 533h40M862 503h31M866 474h22M870 447h15" />
              <path d="m858 531 35-28-27-29 19-27-12-17m24 101-35-28 26-29-18-27 12-17" />
            </g>

            <g className="tower-upper tower-upper--desktop">
              <g className="tower-structure tower-structure--upper">
                <path d="M873 430 876 350M882 430 879 350M873 430h9M874 406h7M875 382h5M876 362h4" />
                <path d="m873 429 8-23-6-24 5-20-4-12m9 79-11-23 7-24-6-20 5-12" />
              </g>
              <g className="tower-antenna tower-antenna--desktop">
                <path className="tower-spine" d="M878 350v-28" />
                <path d="M862 344h12v20h-12zM882 340h13v22h-13zM868 323h8v18h-8zM881 320h7v17h-7z" />
                <path className="tower-crossarm" d="M858 351h41M864 330h29" />
              </g>
            </g>

            <g className="tower-break-marks" aria-hidden="true">
              <path d="m870 428 7 7 8-9M866 437l8 3M884 437l8-5" />
            </g>
          </g>
        </g>

        <g className="tower-debris" aria-hidden="true">
          <path d="M874 533l-13 10M884 530l8 13M896 526l18 5M865 522l-14-3" />
          <circle cx="848" cy="541" r="2.6" />
          <circle cx="916" cy="546" r="2" />
          <circle cx="928" cy="535" r="1.7" />
        </g>
      </g>

      <g className="tower-signal tower-signal--desktop">
        <path className="signal-ring signal-ring--outer" d="M850 342q26-22 53 0" />
        <path className="signal-ring signal-ring--middle" d="M857 350q19-15 38 0" />
        <path className="signal-ring signal-ring--inner" d="M864 358q12-9 24 0" />
      </g>
    </svg>
  );
}

function MobileSlopeDegradation(): ReactElement {
  return (
    <svg className="slope-degradation slope-degradation--mobile" viewBox="0 0 853 1844" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id="erosion-edge-mobile" x="-30%" y="-20%" width="160%" height="150%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <mask id="landslide-path-mobile" maskUnits="userSpaceOnUse" x="430" y="925" width="290" height="340">
          <path fill="white" filter="url(#erosion-edge-mobile)" d="M619 976c30 15 47 42 42 69-5 31-34 53-51 80-18 29-29 63-58 84-23 17-52 14-71-4 10-31 31-56 48-82 17-25 26-57 40-85 12-27 27-50 50-62Z" />
        </mask>
        <filter id="eroded-source-mobile" x="-20%" y="-15%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency=".021 .05" numOctaves="3" seed="17" result="erosionNoise" />
          <feDisplacementMap in="SourceGraphic" in2="erosionNoise" scale="8" xChannelSelector="R" yChannelSelector="B" result="eroded" />
          <feColorMatrix in="eroded" type="saturate" values=".62" result="muted" />
          <feComponentTransfer in="muted">
            <feFuncR type="linear" slope=".74" />
            <feFuncG type="linear" slope=".77" />
            <feFuncB type="linear" slope=".8" />
          </feComponentTransfer>
        </filter>
        <filter id="slope-mist-mobile" x="-80%" y="-80%" width="260%" height="260%">
          <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="9" result="mistNoise" />
          <feDisplacementMap in="SourceGraphic" in2="mistNoise" scale="17" />
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <filter id="tower-cover-blur-mobile" x="-30%" y="-20%" width="160%" height="140%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <mask id="tower-cover-mask-mobile" maskUnits="userSpaceOnUse" x="468" y="1015" width="84" height="184">
          <path fill="white" filter="url(#tower-cover-blur-mobile)" d="M486 1031c17-11 39-10 53 2l-2 145c-17 14-43 15-59 1Z" />
        </mask>
      </defs>

      <path className="slope-saturation" d="M614 969c43 20 69 58 65 101-4 43-33 82-67 113-34 31-81 39-118 17-21-32-2-68 24-99 27-34 35-73 56-100 12-16 24-25 40-32Z" />
      <g className="surface-runoff">
        <path d="M622 991c-9 42-31 77-61 108-24 25-38 52-46 87" />
        <path d="M650 1017c-17 39-39 68-67 95-22 22-36 48-45 76" />
        <path d="M589 1008c-14 38-35 67-58 91" />
      </g>
      <g className="slope-fractures">
        <path d="M581 1005l16 4 10-6 15 10" />
        <path d="M555 1059l13 3 9-5 13 8" />
      </g>
      <g className="landslide-body">
        <path className="landslide-mass" d="M620 977c20 32 20 65 4 99-17 36-47 65-74 94-20 22-41 39-70 45 14-30 37-54 53-84 18-33 24-72 43-105 12-22 25-39 44-49Z" />
        <path className="landslide-channel" d="M606 1004c-8 38-29 69-51 99-20 28-38 57-66 81" />
        <path className="landslide-channel landslide-channel--fine" d="M580 1026c-10 41-31 73-53 104-13 19-27 36-44 50" />
        <g className="landslide-debris">
          <circle cx="548" cy="1115" r="7" /><circle cx="518" cy="1155" r="5" /><circle cx="566" cy="1088" r="4" /><circle cx="492" cy="1184" r="7" />
        </g>
      </g>
      <image
        className="eroded-source"
        href={LANDSLIDE_TEXTURE_MOBILE}
        x="0"
        y="0"
        width="853"
        height="1844"
        preserveAspectRatio="xMidYMid slice"
        mask="url(#landslide-path-mobile)"
      />
      <path className="debris-mist" d="M456 1177c51-27 119-22 154 11 19 17 15 39-5 53-44 30-126 22-162-14-16-16-9-32 13-50Z" />

      <g className="tower-failure tower-failure--mobile" data-tower-layer="svg-damage-overlay">
        <image
          className="tower-source-cover"
          href={MASTER_SCENE_MOBILE}
          x="-34"
          y="0"
          width="853"
          height="1844"
          preserveAspectRatio="xMidYMid slice"
          mask="url(#tower-cover-mask-mobile)"
        />

        <path className="tower-impact-flow" d="M606 1129c-24 11-43 25-61 38-15 10-32 12-51 7 18-17 37-28 59-38 17-7 35-12 53-7Z" />
        <path className="tower-foundation-mud" d="M475 1169c19-9 45-9 63-1 13 6 15 16 7 23-17 14-54 14-71-1-8-7-6-14 1-21Z" />

        <g className="tower-replacement tower-replacement--mobile">
          <g className="tower-lower tower-lower--mobile">
            <g className="tower-structure">
              <path d="m493 1180 13-69m30 69-22-69m-21 69h43m-38-23h31m-27-23h21m-17-23h8" />
              <path d="m493 1179 36-22-27-23 12-23m22 68-38-22 25-23-17-23" />
            </g>

            <g className="tower-upper tower-upper--mobile">
              <g className="tower-structure tower-structure--upper">
                <path d="m506 1111 3-63m5 63-1-63m-7 63h8m-7-21h7m-6-20h5m-4-15h4" />
                <path d="m506 1111 8-21-6-20 5-15-4-7m8 63-10-21 7-20-6-15 5-7" />
              </g>
              <g className="tower-antenna tower-antenna--mobile">
                <path className="tower-spine" d="M511 1048v-22" />
                <path d="M499 1043h9v16h-9zM514 1040h10v17h-10zM504 1027h6v14h-6zM513 1025h6v13h-6z" />
                <path className="tower-crossarm" d="M496 1049h31M501 1032h22" />
              </g>
            </g>

            <g className="tower-break-marks" aria-hidden="true">
              <path d="m503 1110 6 6 7-7M500 1117l7 3M516 1118l7-5" />
            </g>
          </g>
        </g>

        <g className="tower-debris" aria-hidden="true">
          <path d="m507 1179-11 8m20-10 7 11m8-14 14 4m-44-8-11-2" />
          <circle cx="488" cy="1188" r="2.2" />
          <circle cx="547" cy="1190" r="1.8" />
          <circle cx="557" cy="1180" r="1.5" />
        </g>
      </g>

      <g className="tower-signal tower-signal--mobile">
        <path className="signal-ring signal-ring--outer" d="M486 1030q25-22 51 0" />
        <path className="signal-ring signal-ring--middle" d="M493 1039q18-15 37 0" />
        <path className="signal-ring signal-ring--inner" d="M500 1047q11-9 23 0" />
      </g>
    </svg>
  );
}

function SlopeDegradation(): ReactElement {
  return (
    <div className="terrain-degradation" data-layer="master-mountain-degradation">
      <DesktopSlopeDegradation />
      <MobileSlopeDegradation />
    </div>
  );
}

function ArciBrandReveal(): ReactElement {
  return (
    <section className="arci-reveal" data-layer="arci-brand-reveal" aria-label="ARCI 農脈 AgriPulse 守護安全生產">
      <div className="environmental-warmth" aria-hidden="true" />
      <div className="arci-lockup">
        <svg className="arci-wordmark" viewBox="0 0 1200 500" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="arci-warm-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ff6a00" />
            <stop offset=".36" stopColor="#ff9500" />
            <stop offset=".67" stopColor="#ffc247" />
            <stop offset="1" stopColor="#ff7a00" />
          </linearGradient>
          <linearGradient id="arci-core-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ff9500" />
            <stop offset=".48" stopColor="#ffe0a3" />
            <stop offset=".75" stopColor="#ffd27a" />
            <stop offset="1" stopColor="#ff7a00" />
          </linearGradient>
          <filter id="arci-soft-bloom" x="-24%" y="-55%" width="148%" height="210%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feColorMatrix in="blur" values="1 0 0 0 .12  0 .58 0 0 .03  0 0 .12 0 0  0 0 0 .72 0" />
          </filter>
        </defs>

        <g className="arci-construction">
          <rect x="164" y="87" width="872" height="326" />
          <rect x="186" y="106" width="828" height="288" />
          <path d="M124 250h952M600 55v390M164 72v40m0-20h40M1036 72v40m0-20h-40M164 428v-40m0 20h40M1036 428v-40m0 20h-40" />
          <path className="arci-construction__ticks" d="M260 77v20m86-20v20m86-20v20m86-20v20m86-20v20m86-20v20m86-20v20m86-20v20M260 403v20m86-20v20m86-20v20m86-20v20m86-20v20m86-20v20m86-20v20m86-20v20" />
        </g>

        <g className="arci-ghost-geometry">
          <text className="arci-ghost arci-ghost--far" x="600" y="350" textAnchor="middle">ARCI</text>
          <text className="arci-ghost arci-ghost--near" x="600" y="350" textAnchor="middle">ARCI</text>
        </g>

        <g className="arci-bloom" filter="url(#arci-soft-bloom)">
          <text x="600" y="350" textAnchor="middle">ARCI</text>
        </g>

        <g className="arci-secondary-outline">
          <text className="arci-secondary arci-secondary--offset" x="600" y="350" textAnchor="middle">ARCI</text>
          <text className="arci-secondary" x="600" y="350" textAnchor="middle">ARCI</text>
        </g>

        <text className="arci-primary-outline" pathLength="1" x="600" y="350" textAnchor="middle">ARCI</text>
        <text className="arci-core" pathLength="1" x="600" y="350" textAnchor="middle">ARCI</text>

        <g className="arci-energy-travel" aria-hidden="true">
          <text x="600" y="350" textAnchor="middle">
            <tspan>A</tspan><tspan>R</tspan><tspan>C</tspan><tspan>I</tspan>
          </text>
        </g>
        </svg>

        <p className="arci-subtitle">農脈 AgriPulse｜守護安全生產</p>
      </div>

      <div className="arci-particles" aria-hidden="true">
        {BRAND_PARTICLES.map((particle, index) => (
          <i key={index} style={{ left: particle.left, top: particle.top, width: particle.size, height: particle.size }} />
        ))}
      </div>
    </section>
  );
}

function NarrativeLayer(): ReactElement {
  return (
    <div className="narrative-layer">
      <section className="narrative-beat narrative-beat--calm" aria-label="平靜農村">
        <h2 className="narrative-copy narrative-copy--split n-calm"><span>這片土地</span><span>一直與世界保持連線</span></h2>
      </section>
      <section className="narrative-beat narrative-beat--weather" aria-label="烏雲匯聚">
        <h2 className="narrative-copy n-weather">隨著烏雲匯聚</h2>
      </section>
      <section className="narrative-beat narrative-beat--rain" aria-label="暴雨落下">
        <h2 className="narrative-copy n-rain">暴雨傾然落下</h2>
      </section>
      <section className="narrative-beat narrative-beat--failure" aria-label="基地台因土石流失聯">
        <h2 className="narrative-copy n-failure">基地台因土石流失去信號</h2>
      </section>
      <section className="narrative-beat narrative-beat--need" aria-label="需求仍然存在">
        <div className="need-pause">
          <h2 className="narrative-copy narrative-need n-need">但需求沒有消失...</h2>
          <p className="need-pause__detail">山區基地台失聯，通訊需求仍持續存在，安全與永續都不能中斷</p>
        </div>
      </section>
    </div>
  );
}

export function OpeningCinematic(): ReactElement {
  const trackRef = useRef<HTMLElement>(null);
  useScrollProgress(trackRef);

  return (
    <main className="opening-shell">
      <section
        className="opening-track"
        ref={trackRef}
        data-scene="calm"
        data-progress="0.000"
        aria-label="ARCI 韌性通訊開場敘事"
      >
        <div className="cinematic-viewport">
          <div className="scene" aria-hidden="true">
            <MasterScene />
            <div className="master-color-grade" />
            <WeatherDegradation />
            <SlopeDegradation />
            <div className="storm-wash" />
            <div className="paper-grain" />
          </div>

          <div className="scene-darkener" aria-hidden="true" />
          <ArciBrandReveal />
          <TacticalEditorial />

          <header className="minimal-brand">
            <span className="brand-mark">ARCI</span>
            <span>總統盃黑客松 · 安全社會 · 農業韌性</span>
          </header>

          <NarrativeLayer />

          <div className="scroll-cue">
            <span>向下探索</span>
            <i />
          </div>
        </div>
      </section>
      <PresidentialLab />
    </main>
  );
}
