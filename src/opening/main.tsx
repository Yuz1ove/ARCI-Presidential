import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OpeningCinematic } from "./OpeningCinematic.js";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("opening root is missing");

createRoot(container).render(
  <StrictMode>
    <OpeningCinematic />
  </StrictMode>,
);
