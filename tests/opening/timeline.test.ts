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
    expect(stateAt(opening(0.64)).debrisImpact).toBeGreaterThan(0);
    expect(stateAt(opening(0.56)).towerDamage).toBe(0);
    expect(stateAt(opening(0.62)).towerImpact).toBeGreaterThan(0.75);
    expect(stateAt(opening(0.64)).towerLean).toBeGreaterThan(0);
    expect(stateAt(opening(0.65)).towerCollapse).toBeGreaterThan(0);
    expect(stateAt(opening(0.65)).towerBreak).toBeGreaterThan(0);
    expect(stateAt(opening(0.675)).towerDamage).toBe(1);
    expect(stateAt(opening(0.675)).towerCollapse).toBe(1);
    expect(stateAt(opening(0.675)).towerBreak).toBe(1);
    expect(stateAt(opening(0.67)).signalFailure).toBeGreaterThan(0);
  });

  it("reverses tower damage from the same scroll progress without retained state", () => {
    const beforeImpact = stateAt(opening(0.56));
    const damaged = stateAt(opening(0.675));
    const restored = stateAt(opening(0.56));

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
    expect(narrativeAt(opening(0.63)).failure).toBeGreaterThan(0);
    expect(narrativeAt(opening(0.72)).need).toBe(0);
    expect(narrativeAt(opening(0.75)).need).toBeGreaterThan(0);
    expect(narrativeAt(opening(0.765)).need).toBe(1);
    expect(narrativeAt(opening(0.8)).need).toBe(1);
    expect(narrativeAt(opening(0.82)).need).toBeGreaterThan(0);
    expect(narrativeAt(opening(0.828)).need).toBe(0);
    expect(narrativeAt(opening(0.84)).need).toBe(0);
  });

  it("fully resolves the need statement before the independent ARCI reveal", () => {
    expect(brandRevealAt(opening(0.84)).progress).toBeCloseTo(0, 12);
    expect(narrativeAt(opening(0.8)).need).toBe(1);

    const darkGap = brandRevealAt(opening(0.85));
    expect(darkGap.sceneDim).toBe(1);
    expect(darkGap.visibility).toBe(0);
    expect(darkGap.environment).toBe(0);
    expect(darkGap.ghost).toBe(0);
    expect(darkGap.core).toBe(0);

    expect(brandRevealAt(opening(0.86)).visibility).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.86)).environment).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.86)).ghost).toBe(0);
    expect(brandRevealAt(opening(0.89)).ghost).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.89)).trace).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.91)).secondary).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.93)).core).toBeGreaterThan(0);
    expect(brandRevealAt(opening(0.945)).core).toBe(1);
    expect(brandRevealAt(opening(0.945)).subtitle).toBe(0);
    expect(brandRevealAt(opening(0.97)).subtitle).toBeGreaterThan(0);
    expect(brandRevealAt(OPENING_END).subtitle).toBe(1);

    const ignited = brandRevealAt(opening(0.97));
    const rewound = brandRevealAt(opening(0.85));
    expect(ignited.core).toBeGreaterThan(rewound.core);
    expect(rewound).toEqual(brandRevealAt(opening(0.85)));
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
    expect(activeScene(opening(0.75)).id).toBe("need-pause");
    expect(activeScene(opening(0.85)).id).toBe("dark-gap");
    expect(activeScene(opening(0.87)).id).toBe("arci-warmth");
    expect(activeScene(opening(0.91)).id).toBe("arci-construction");
    expect(activeScene(opening(0.97)).id).toBe("arci-ignition");
    expect(activeScene(0.46).id).toBe("sensing");
    expect(activeScene(0.58).id).toBe("inventory");
    expect(activeScene(0.7).id).toBe("weighting");
    expect(activeScene(0.82).id).toBe("computation");
    expect(activeScene(1).id).toBe("routing");
    expect(phase(0.5, 0.5, 0.5)).toBe(1);
    expect(getSceneProgress(0.1, 0.2, 0.15)).toBeCloseTo(0.5);
  });

  it("maps tactical scenes to deterministic reversible continuity states", () => {
    expect(tacticalAt(0.36).systemProgress).toBe(0);
    expect(tacticalAt(0.42).brandDock).toBeGreaterThan(0);
    expect(tacticalAt(0.46).sensing).toBe(1);
    expect(tacticalAt(0.54).sensingCompact).toBeGreaterThan(0);
    expect(tacticalAt(0.58).inventory).toBe(1);
    expect(tacticalAt(0.7).weighting).toBe(1);
    expect(tacticalAt(0.82).computationRows).toBeGreaterThan(0);
    expect(tacticalAt(0.88).decisionSelect).toBeGreaterThan(0);
    expect(tacticalAt(0.94).routeA).toBe(1);
    expect(tacticalAt(0.96).routeB).toBe(1);
    expect(tacticalAt(0.98).routeC).toBe(1);
    expect(tacticalAt(1).routeLock).toBe(1);
    expect(tacticalAt(0.58)).toEqual(tacticalAt(0.58));
    expect(tacticalAt(0.46).sensing).toBeGreaterThan(tacticalAt(0.58).sensing);
  });
});
