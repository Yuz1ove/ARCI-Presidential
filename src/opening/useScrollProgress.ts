import { useEffect, type RefObject } from "react";
import { activeScene, brandRevealAt, clamp01, narrativeAt, stateAt, tacticalAt } from "./timeline.js";

function setNumberProperty(track: HTMLElement, property: string, value: number): void {
  const nextValue = value.toFixed(4);
  if (track.style.getPropertyValue(property) !== nextValue) track.style.setProperty(property, nextValue);
}

function renderProgress(track: HTMLElement, progress: number): void {
  const state = stateAt(progress);
  const narrative = narrativeAt(progress);
  const brand = brandRevealAt(progress);
  const tactical = tacticalAt(progress);

  setNumberProperty(track, "--progress", state.progress);
  setNumberProperty(track, "--weather", state.weather);
  setNumberProperty(track, "--cloud-gather", state.cloudGather);
  setNumberProperty(track, "--rain", state.rain);
  setNumberProperty(track, "--downpour", state.downpour);
  setNumberProperty(track, "--slope-saturation", state.slopeSaturation);
  setNumberProperty(track, "--surface-runoff", state.surfaceRunoff);
  setNumberProperty(track, "--slope-fracture", state.slopeFracture);
  setNumberProperty(track, "--landslide", state.landslide);
  setNumberProperty(track, "--debris-impact", state.debrisImpact);
  setNumberProperty(track, "--tower-damage", state.towerDamage);
  setNumberProperty(track, "--tower-impact", state.towerImpact);
  setNumberProperty(track, "--tower-lean", state.towerLean);
  setNumberProperty(track, "--tower-collapse", state.towerCollapse);
  setNumberProperty(track, "--tower-break", state.towerBreak);
  setNumberProperty(track, "--signal-stress", state.signalStress);
  setNumberProperty(track, "--signal-failure", state.signalFailure);
  setNumberProperty(track, "--darkness", state.darkness);
  setNumberProperty(track, "--n-calm", narrative.calm);
  setNumberProperty(track, "--n-weather", narrative.weather);
  setNumberProperty(track, "--n-rain", narrative.rain);
  setNumberProperty(track, "--n-failure", narrative.failure);
  setNumberProperty(track, "--n-need", narrative.need);
  setNumberProperty(track, "--brand-progress", brand.progress);
  setNumberProperty(track, "--scene-dim", brand.sceneDim);
  setNumberProperty(track, "--brand-visibility", brand.visibility);
  setNumberProperty(track, "--brand-ghost", brand.ghost);
  setNumberProperty(track, "--brand-trace", brand.trace);
  setNumberProperty(track, "--brand-secondary", brand.secondary);
  setNumberProperty(track, "--brand-core", brand.core);
  setNumberProperty(track, "--brand-subtitle", brand.subtitle);
  setNumberProperty(track, "--brand-travel", brand.travel);
  setNumberProperty(track, "--brand-bloom", brand.bloom);
  setNumberProperty(track, "--brand-environment", brand.environment);
  setNumberProperty(track, "--brand-particles", brand.particles);
  setNumberProperty(track, "--system-progress", tactical.systemProgress);
  setNumberProperty(track, "--brand-hold", tactical.brandHold);
  setNumberProperty(track, "--brand-dock", tactical.brandDock);
  setNumberProperty(track, "--scan-grid", tactical.scanGrid);
  setNumberProperty(track, "--outage", tactical.outage);
  setNumberProperty(track, "--outage-pulse", tactical.outagePulse);
  setNumberProperty(track, "--sensing", tactical.sensing);
  setNumberProperty(track, "--sensing-capture", tactical.sensingCapture);
  setNumberProperty(track, "--sensing-compact", tactical.sensingCompact);
  setNumberProperty(track, "--inventory", tactical.inventory);
  setNumberProperty(track, "--inventory-parse", tactical.inventoryParse);
  setNumberProperty(track, "--inventory-compact", tactical.inventoryCompact);
  setNumberProperty(track, "--weighting", tactical.weighting);
  setNumberProperty(track, "--weighting-calibrate", tactical.weightingCalibrate);
  setNumberProperty(track, "--weights-align", tactical.weightsAlign);
  setNumberProperty(track, "--computation", tactical.computation);
  setNumberProperty(track, "--computation-rows", tactical.computationRows);
  setNumberProperty(track, "--computation-complete", tactical.computationComplete);
  setNumberProperty(track, "--decision-select", tactical.decisionSelect);
  setNumberProperty(track, "--routing", tactical.routing);
  setNumberProperty(track, "--terrain-build", tactical.terrainBuild);
  setNumberProperty(track, "--route-a", tactical.routeA);
  setNumberProperty(track, "--route-b", tactical.routeB);
  setNumberProperty(track, "--route-c", tactical.routeC);
  setNumberProperty(track, "--route-lock", tactical.routeLock);

  const scene = activeScene(progress);
  if (track.dataset.scene !== scene.id) track.dataset.scene = scene.id;
  track.dataset.progress = progress.toFixed(3);
}

export function useScrollProgress(trackRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let frame = 0;
    let start = 0;
    let range = 1;

    const measure = (): void => {
      const track = trackRef.current;
      if (track === null) return;
      start = track.getBoundingClientRect().top + window.scrollY;
      range = Math.max(1, track.offsetHeight - window.innerHeight);
    };

    const update = (): void => {
      frame = 0;
      const track = trackRef.current;
      if (track === null) return;
      renderProgress(track, clamp01((window.scrollY - start) / range));
    };

    const requestUpdate = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(update);
    };

    const handleResize = (): void => {
      measure();
      requestUpdate();
    };

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    measure();
    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", handleResize);
    reducedMotion.addEventListener("change", handleResize);

    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", handleResize);
      reducedMotion.removeEventListener("change", handleResize);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [trackRef]);
}
