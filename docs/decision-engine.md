# Deterministic Decision Engine

## Decision contract

Each message produces a `DecisionTrace` containing the input state, base/context/effective weights, constraint results, candidate features and contributions, selected action, rejected alternatives, execution evidence, outcome, and optional re-plan reason. The canonical scenario signature excludes wall-clock benchmark timing, so the same fixture is byte-for-byte replayable.

## Hard constraints

A candidate is `INELIGIBLE` and receives `score = null` when any of these fail:

1. current availability and execution invalidation;
2. payload limit;
3. minimum coverage for the message priority;
4. energy feasibility against reserve;
5. minimum simulated delivery probability.

An infeasible candidate cannot win by receiving a merely low score.

## Adaptive scoring

The engine projects normalized features for reliability, latency, coverage, priority, energy, cost, congestion, hazard exposure, delivery probability, and bandwidth. A weighted sum is used only after hard constraints pass. Medical/rescue demand increases reliability, latency, priority, and verified-delivery emphasis. Agriculture increases bandwidth, energy sustainability, and coverage. Severe hazards and long-duration power constraints apply separate deterministic adjustments. The trace stores all three weight states and the reasons.

## Execution and re-planning

Execution is simulation-only. A correlated receipt produces `ACK_VERIFIED`. An injected selected-link failure produces `FAILED`, excludes that link, recomputes all candidates, and executes the next eligible route. If none exists, the original payload remains locally queued. When a configured recovery link becomes available, the queue is evaluated again and forwarded only after a matched simulated ACK.
