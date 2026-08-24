import { describe, expect, it } from "vitest";
import { OPENING_END, activeScene, brandRevealAt, getSceneProgress, narrativeAt, phase, stateAt, tacticalAt } from "../../src/opening/timeline.js";

const opening = (progress: number): number => progress * OPENING_END;

describe("opening cinematic timeline", () => {
  it("clamps progress and preserves deterministic reversible states", () => {
    expect(stateAt(-1).progress).toBe(0);
    expect(stateAt(2).progress).toBe(1);
    expect(stateAt(opening(0.535))).toEqual(stateAt(opening(0.535)));
    expect(narrativeAt(opening(0.58))).toEqual(narrativeAt(opening(0.58)));
    expect(brandRevealAt(opening(0.97))).toEqual(brandRevealAt(opening(0.97)));
  });

  it("maps one master scene through the ordered degradation phases", () => {
    expect(stateAt(opening(0.2)).weather).toBeGreaterThan(0);
    expect(stateAt(opening(0.32)).rain).toBeGreaterThan(0);
    expect(stateAt(opening(0.4)).downpour).toBeGreaterThan(0.6);
    expect(stateAt(opening(0.48)).slopeSaturation).toBeGreaterThan(0);
    expect(stateAt(opening(0.52)).surfaceRunoff).toBeGreaterThan(0);
    expect(stateAt(opening(0.55)).slopeFracture).toBeGreaterThan(0);
    expect(stateAt(opening(0.6)).landslide).toBeGreaterThan(0);
    expect(stateAt(opening(0.68)).debrisImpact).toBeGreaterThan(0);
    expect(stateAt(opening(0.6)).towerDamage).toBe(0);
    expect(stateAt(opening(0.68)).towerImpact).toBeGreaterThan(0.75);
    expect(stateAt(opening(0.72)).towerLean).toBeGreaterThan(0);
    expect(stateAt(opening(0.76)).towerCollapse).toBeGreaterThan(0);
    expect(stateAt(opening(0.78)).towerBreak).toBeGreaterThan(0);
    expect(stateAt(opening(0.82)).towerDamage).toBe(1);
    expect(stateAt(opening(0.82)).towerCollapse).toBe(1);
    expect(stateAt(opening(0.82)).towerBreak).toBe(1);
    expect(stateAt(opening(0.8)).signalFailure).toBeGreaterThan(0);
  });

  it("reverses tower damage from the same scroll progress without retained state", () => {
    const beforeImpact = stateAt(opening(0.6));
    const damaged = stateAt(opening(0.82));
    const restored = stateAt(opening(0.6));

    expect(damaged.towerDamage).toBeGreaterThan(beforeImpact.towerDamage);
    expect(restored.towerDamage).toBe(beforeImpact.towerDamage);
    expect(restored.towerImpact).toBe(beforeImpact.towerImpact);
    expect(restored.towerCollapse).toBe(beforeImpact.towerCollapse);
    expect(restored.towerBreak).toBe(beforeImpact.towerBreak);
  });

  it("keeps the first screen quiet and reveals canonical beats in order", () => {
    expect(Object.values(narrativeAt(opening(0.04))).every((value) => value === 0)).toBe(true);
    expect(narrativeAt(opening(0.07)).calm).toBeGreaterThan(0);
    expect(narrativeAt(opening(0.18)).weather).toBeGreaterThan(0);
    expect(narrativeAt(opening(0.31)).rain).toBeGreaterThan(0);
    expect(narrativeAt(opening(0.78)).failure).toBeGreaterThan(0);
    expect(narrativeAt(opening(0.82)).need).toBe(0);
    expect(narrativeAt(opening(0.85)).need).toBeGreaterThan(0);
    expect(narrativeAt(opening(0.86)).need).toBe(1);
    expect(narrativeAt(opening(0.88)).need).toBeGreaterThan(0);
    expect(narrativeAt(opening(0.9)).need).toBe(0);
  });

  it("fully resolves the need statement before the independent ARCI reveal", () => {
    expect(brandRevealAt(opening(0.89)).progress).toBeCloseTo(0, 12);
    expect(narrativeAt(opening(0.86)).need).toBe(1);

    const darkGap = brandRevealAt(opening(0.91));
    expect(darkGap.sceneDim).toBe(1);
    expect(darkGap.visibility).toBe(0);
    expect(darkGap.environment).toBe(0);
    expect(darkGap.ghost).toBe(0);
    expect(darkGap.core).toBe(0);

    expect(brandRevealAt(opening(0.92)).visibility).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.92)).environment).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.92)).ghost).toBe(0);
    expect(brandRevealAt(opening(0.94)).ghost).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.94)).trace).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.96)).secondary).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.98)).core).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.98)).subtitle).toBeGreaterThan(0);
    expect(brandRevealAt(OPENING_END).subtitle).toBe(1);

    const ignited = brandRevealAt(opening(0.98));
    const rewound = brandRevealAt(opening(0.91));
    expect(ignited.core).toBeGreaterThan(rewound.core);
    expect(rewound).toEqual(brandRevealAt(opening(0.91)));
  });

  it("never crossfades ARCI while the need statement is visible", () => {
    for (let index = 0; index <= 1000; index += 1) {
      const progress = opening(index / 1000);
      if (narrativeAt(progress).need > 0) {
        expect(brandRevealAt(progress).visibility).toBe(0);
      }
    }
  });

  it("returns canonical scenes and safe zero-length phases", () => {
    expect(activeScene(opening(0.04)).id).toBe("calm");
    expect(activeScene(opening(0.4)).id).toBe("downpour");
    expect(activeScene(opening(0.55)).id).toBe("landslide");
    expect(activeScene(opening(0.65)).id).toBe("tower-failure");
    expect(activeScene(opening(0.8)).id).toBe("tower-failure");
    expect(activeScene(opening(0.86)).id).toBe("need-pause");
    expect(activeScene(opening(0.9)).id).toBe("dark-gap");
    expect(activeScene(opening(0.92)).id).toBe("arci-warmth");
    expect(activeScene(opening(0.95)).id).toBe("arci-construction");
    expect(activeScene(opening(0.98)).id).toBe("arci-ignition");
    expect(activeScene(0.42).id).toBe("outage");
    expect(activeScene(0.5).id).toBe("sensing");
    expect(activeScene(0.62).id).toBe("inventory");
    expect(activeScene(0.73).id).toBe("weighting");
    expect(activeScene(0.84).id).toBe("computation");
    expect(activeScene(1).id).toBe("routing");
    expect(phase(0.5, 0.5, 0.5)).toBe(1);
    expect(getSceneProgress(0.1, 0.2, 0.15)).toBeCloseTo(0.5);
  });

  it("maps tactical scenes to deterministic reversible continuity states", () => {
    expect(tacticalAt(0.4).systemProgress).toBe(0);
    expect(tacticalAt(0.415).outage).toBe(0);
    expect(tacticalAt(0.42).brandDock).toBeGreaterThan(0);
    expect(tacticalAt(0.44).brandDock).toBeGreaterThan(tacticalAt(0.42).brandDock);
    expect(tacticalAt(0.44).outage).toBeGreaterThan(0);
    expect(tacticalAt(0.45).outage).toBeGreaterThan(tacticalAt(0.44).outage);
    expect(tacticalAt(0.46).outage).toBe(1);
    expect(tacticalAt(0.55).sensingCapture).toBe(1);
    expect(tacticalAt(0.65).inventoryParse).toBeGreaterThan(0);
    expect(tacticalAt(0.76).weightingCalibrate).toBeGreaterThan(0);
    expect(tacticalAt(0.87).computationRows).toBeGreaterThan(0);
    expect(tacticalAt(0.9).computationComplete).toBe(1);
    expect(tacticalAt(0.96).routeA).toBe(1);
    expect(tacticalAt(0.98).routeB).toBe(1);
    expect(tacticalAt(0.98).routeC).toBe(1);
    expect(tacticalAt(1).routeLock).toBe(1);
    expect(tacticalAt(0.65)).toEqual(tacticalAt(0.65));
    expect(tacticalAt(0.55).sensing).toBeGreaterThan(tacticalAt(0.65).sensing);
  });
});
