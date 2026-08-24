import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TacticalEditorial } from "../../src/opening/TacticalEditorial.js";

describe("ARCI chapter number and typography system", () => {
  const html = renderToStaticMarkup(<TacticalEditorial />);

  it("renders one shared flowing-light vector instrument for every tactical chapter", () => {
    for (const index of ["01", "02", "03", "04", "05", "06"]) {
      expect(html).toContain(`aria-label="階段 ${index}，`);
      expect(html).toContain(`stage-number-${index}-`);
    }
    expect(html.match(/class="stage-number stage-number--/gu)).toHaveLength(6);
  });

  it("maps each real chapter to a distinct semantic light-flow state", () => {
    for (const state of ["offline", "sense", "resolve", "weight", "compute", "route"]) {
      expect(html).toContain(`stage-number--${state}`);
    }
    expect(html).toContain("--stage-progress:var(--outage-pulse)");
    expect(html).toContain("--stage-progress:var(--computation-rows)");
    expect(html).not.toContain("number-artifact__depth");
  });

  it("keeps English subordinate to Chinese chapter and system-state labels", () => {
    expect(html).not.toContain("ARCI / DECISION ENGINE");
    expect(html).toContain("階段 01");
    expect(html).toContain("訊號失聯");
    expect(html).toContain("OFFLINE");
    expect(html).toContain("方案鎖定");
    expect(html).toContain("ROUTE LOCKED");
  });
});
