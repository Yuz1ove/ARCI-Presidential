import { rmSync } from "node:fs";
import { resolve } from "node:path";

const dashboardOutput = resolve(import.meta.dirname, "../../dist/dashboard");

for (const relativeTarget of ["assets", "index.html", "dashboard.html"]) {
  rmSync(resolve(dashboardOutput, relativeTarget), { recursive: true, force: true });
}
