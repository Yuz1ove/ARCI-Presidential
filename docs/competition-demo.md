# Competition Demo Runbook

## Local start

```bash
npm ci
npm run build
npm run dashboard:preview -- --host 127.0.0.1 --port 4174
```

Open `/` for the cinematic and Presidential Hardening lab. `/dashboard.html` remains the existing operator dashboard.

## Five-minute sequence

1. Scroll through the existing calm-to-outage cinematic. The scene is still scroll-driven and reversible.
2. In the hardening lab, point out the current requested/effective data mode. Use `REPLAY` for the most reliable deterministic judging path. `LIVE` may fetch the verified public MOI publication and will visibly fail closed if unavailable.
3. Select Scenario 01 and press `START SCENARIO` to advance the inspectable pipeline. Show the digital twin, hard rejects, weight contributions, selected link, and matched ACK.
4. Select Scenario 02. The 13 MB agricultural payload has no initially eligible route, enters local store-and-forward, then uses the recovered simulated drone relay.
5. Select Scenario 03. The first selected Mesh link fails without ACK; ARCI invalidates it, recalculates, chooses a different link, and verifies the alternate ACK.
6. Press any `Failure Injection` control. Each button mutates a deterministic simulation state; no live network or field device is affected.
7. Press `RUN N=100`. Explain that outcome metrics are simulated and process latency is measured on this device. Do not claim field validation.
8. Finish at Data Governance and state the authority boundary: LLM may explain; the deterministic engine decides; matched ACK owns delivery truth.

## Controls

`START SCENARIO`, `PAUSE`, `RESUME`, `RESET`, and `REPLAY` affect only the presentation stage. Scenario selection and failure injection recompute the actual engine result. Keyboard focus and semantic button state are supported; reduced-motion preferences suppress decorative transitions.

## Known demo boundaries

- All communication media and incident values are simulation.
- CWA and TDX are not connected without a future server-side credential adapter.
- MOI/NCC/MOA values are public context, not live disaster measurements.
- There is no field hardware, carrier, emergency-agency, or production backend validation.
