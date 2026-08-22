import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OperatorDashboard } from "./OperatorDashboard.js";
import { createOperatorWorkspace, createPhase4BScenario } from "./simulation.js";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("dashboard root is missing");

const workspace = await createOperatorWorkspace();

createRoot(container).render(
  <StrictMode>
    <OperatorDashboard initialScenario={workspace} loadScenario={createPhase4BScenario} />
  </StrictMode>,
);
