import {
  environmentStateSchema,
  type ChannelMedium,
  type ChannelState,
  type EnvironmentState,
  type EnvironmentStateInput,
} from "../../domain/environment/model.js";
import { DEFAULT_RUNTIME_LIMITS } from "../../runtime/model.js";
import { getScenarioFixture } from "../fixtures/scenarios.js";
import {
  runtimeScenarioFixtureSchema,
  type RuntimeScenarioFixture,
  type RuntimeScenarioFixtureInput,
  type RuntimeScenarioName,
} from "./schema.js";

const DEADLINE = "2030-01-01T00:01:00.000Z";

function channelInput(channel: ChannelState): EnvironmentStateInput["channels"][number] {
  return {
    medium: channel.medium,
    available: channel.available,
    signalStrength: channel.signalStrength,
    latencyMs: channel.latencyMs,
    packetLoss: channel.packetLoss,
    bandwidthKbps: channel.bandwidthKbps,
    energyCost: channel.energyCost,
    monetaryCost: channel.monetaryCost,
  };
}

function environmentFor(options: {
  readonly unavailable?: readonly ChannelMedium[];
  readonly relayAvailability?: number;
} = {}): EnvironmentState {
  const base = getScenarioFixture("normal").initialEnvironment;
  const unavailable = new Set(options.unavailable ?? []);
  return environmentStateSchema.parse({
    schemaVersion: 1,
    timestamp: base.timestamp,
    weatherRisk: base.weatherRisk,
    regionalCongestion: base.regionalCongestion,
    relayAvailability: options.relayAvailability ?? base.relayAvailability,
    infrastructureStatus: base.infrastructureStatus,
    channels: base.channels.map((channel) => ({
      ...channelInput(channel),
      available: unavailable.has(channel.medium) ? false : channel.available,
      signalStrength: unavailable.has(channel.medium) ? 0 : channel.signalStrength,
    })),
  });
}

const phase1Normal = getScenarioFixture("normal");
const base: Omit<RuntimeScenarioFixtureInput, "scenarioId" | "name" | "title"> = {
  schemaVersion: 1,
  randomSeed: 42,
  initialEnvironment: phase1Normal.initialEnvironment,
  initialDevice: phase1Normal.initialDevice,
  initialMission: phase1Normal.initialMission,
  networkGraph: phase1Normal.networkGraph,
  missionDeadline: DEADLINE,
  limits: DEFAULT_RUNTIME_LIMITS,
  observations: [],
  ackBehaviors: ["MATCHED"],
  duplicateExecutionResultAttempts: [],
};

function fixture(input: RuntimeScenarioFixtureInput): RuntimeScenarioFixture {
  return runtimeScenarioFixtureSchema.parse(input);
}

const localFirstEnvironment = environmentFor({ unavailable: ["WIFI"], relayAvailability: 0 });

const fixtures: Readonly<Record<RuntimeScenarioName, RuntimeScenarioFixture>> = {
  "cellular-failure-after-selection": fixture({
    ...base,
    scenarioId: "runtime:cellular-failure-after-selection",
    name: "cellular-failure-after-selection",
    title: "Cellular Failure After Selection",
    initialEnvironment: localFirstEnvironment,
    observations: [
      {
        observationId: "runtime-observation:cellular-fails",
        iteration: 1,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 10,
        order: 0,
        target: "ENVIRONMENT",
        patch: { channel: { medium: "CELLULAR", available: false, signalStrength: 0 } },
      },
    ],
    duplicateExecutionResultAttempts: [1],
  }),
  "sequential-degradation": fixture({
    ...base,
    scenarioId: "runtime:sequential-degradation",
    name: "sequential-degradation",
    title: "Sequential Channel Degradation",
    initialEnvironment: localFirstEnvironment,
    observations: [
      {
        observationId: "runtime-observation:sequential-cellular-fails",
        iteration: 1,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 10,
        order: 0,
        target: "ENVIRONMENT",
        patch: { channel: { medium: "CELLULAR", available: false, signalStrength: 0 } },
      },
      {
        observationId: "runtime-observation:sequential-lora-fails",
        iteration: 2,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 1_200,
        order: 0,
        target: "ENVIRONMENT",
        patch: { channel: { medium: "LORA", available: false, signalStrength: 0 } },
      },
    ],
  }),
  "ack-lost": fixture({
    ...base,
    scenarioId: "runtime:ack-lost",
    name: "ack-lost",
    title: "ACK Lost",
    ackBehaviors: ["MISSING", "MATCHED"],
  }),
  "duplicate-ack": fixture({
    ...base,
    scenarioId: "runtime:duplicate-ack",
    name: "duplicate-ack",
    title: "Duplicate ACK",
    observations: [
      {
        observationId: "runtime-observation:duplicate-state",
        iteration: 1,
        phase: "BEFORE_PLAN",
        atMs: 1,
        order: 0,
        target: "DEVICE",
        patch: { estimatedRuntimeMinutes: 460 },
      },
      {
        observationId: "runtime-observation:duplicate-state",
        iteration: 1,
        phase: "BEFORE_PLAN",
        atMs: 1,
        order: 1,
        target: "DEVICE",
        patch: { estimatedRuntimeMinutes: 460 },
      },
    ],
    ackBehaviors: ["DUPLICATE"],
  }),
  "late-ack-after-replan": fixture({
    ...base,
    scenarioId: "runtime:late-ack-after-replan",
    name: "late-ack-after-replan",
    title: "Late ACK After Replan",
    initialEnvironment: localFirstEnvironment,
    limits: { ...DEFAULT_RUNTIME_LIMITS, maxAttemptsPerRoute: 1 },
    ackBehaviors: ["MISSING", "LATE_PREVIOUS_THEN_MATCHED"],
  }),
  "graph-change-during-mission": fixture({
    ...base,
    scenarioId: "runtime:graph-change-during-mission",
    name: "graph-change-during-mission",
    title: "Graph Change During Mission",
    initialEnvironment: localFirstEnvironment,
    observations: [
      {
        observationId: "runtime-observation:cell-edge-removed",
        iteration: 1,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 10,
        order: 0,
        target: "GRAPH_EDGE",
        patch: { edgeId: "edge:cellular-access", available: false },
      },
    ],
  }),
  "battery-drop": fixture({
    ...base,
    scenarioId: "runtime:battery-drop",
    name: "battery-drop",
    title: "Battery Drop",
    initialEnvironment: localFirstEnvironment,
    observations: [
      {
        observationId: "runtime-observation:battery-critical",
        iteration: 1,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 10,
        order: 0,
        target: "DEVICE",
        patch: { batteryPercent: 6, estimatedRuntimeMinutes: 16 },
      },
    ],
  }),
  "medical-emergency-low-battery": fixture({
    ...base,
    scenarioId: "runtime:medical-emergency-low-battery",
    name: "medical-emergency-low-battery",
    title: "Medical Emergency + Low Battery",
    initialDevice: getScenarioFixture("medical-emergency").initialDevice,
    initialMission: getScenarioFixture("medical-emergency").initialMission,
    initialEnvironment: getScenarioFixture("medical-emergency").initialEnvironment,
  }),
  "all-routes-fail": fixture({
    ...base,
    scenarioId: "runtime:all-routes-fail",
    name: "all-routes-fail",
    title: "All Routes Fail",
    initialEnvironment: localFirstEnvironment,
    limits: { ...DEFAULT_RUNTIME_LIMITS, maxReplans: 5 },
    observations: [
      {
        observationId: "runtime-observation:all-cellular-fails",
        iteration: 1,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 10,
        order: 0,
        target: "ENVIRONMENT",
        patch: { channel: { medium: "CELLULAR", available: false, signalStrength: 0 } },
      },
      {
        observationId: "runtime-observation:all-lora-fails",
        iteration: 2,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 1_200,
        order: 0,
        target: "ENVIRONMENT",
        patch: { channel: { medium: "LORA", available: false, signalStrength: 0 } },
      },
      {
        observationId: "runtime-observation:all-satellite-fails",
        iteration: 3,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 2_400,
        order: 0,
        target: "ENVIRONMENT",
        patch: { channel: { medium: "SATELLITE", available: false, signalStrength: 0 } },
      },
    ],
  }),
  "oscillating-topology": fixture({
    ...base,
    scenarioId: "runtime:oscillating-topology",
    name: "oscillating-topology",
    title: "Oscillating Topology",
    initialEnvironment: environmentFor({ unavailable: ["WIFI", "SATELLITE"], relayAvailability: 0 }),
    observations: [
      {
        observationId: "runtime-observation:osc-cell-off-1",
        iteration: 1,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 10,
        order: 0,
        target: "GRAPH_EDGE",
        patch: { edgeId: "edge:cellular-access", available: false },
      },
      {
        observationId: "runtime-observation:osc-cell-on-2",
        iteration: 2,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 1_200,
        order: 0,
        target: "GRAPH_EDGE",
        patch: { edgeId: "edge:cellular-access", available: true },
      },
      {
        observationId: "runtime-observation:osc-lora-off-2",
        iteration: 2,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 1_201,
        order: 1,
        target: "GRAPH_EDGE",
        patch: { edgeId: "edge:lora-access", available: false },
      },
      {
        observationId: "runtime-observation:osc-lora-on-3",
        iteration: 3,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 2_400,
        order: 0,
        target: "GRAPH_EDGE",
        patch: { edgeId: "edge:lora-access", available: true },
      },
      {
        observationId: "runtime-observation:osc-cell-off-3",
        iteration: 3,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 2_401,
        order: 1,
        target: "GRAPH_EDGE",
        patch: { edgeId: "edge:cellular-access", available: false },
      },
      {
        observationId: "runtime-observation:osc-cell-on-4",
        iteration: 4,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 3_600,
        order: 0,
        target: "GRAPH_EDGE",
        patch: { edgeId: "edge:cellular-access", available: true },
      },
      {
        observationId: "runtime-observation:osc-lora-off-4",
        iteration: 4,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 3_601,
        order: 1,
        target: "GRAPH_EDGE",
        patch: { edgeId: "edge:lora-access", available: false },
      },
    ],
  }),
  "mission-priority-change": fixture({
    ...base,
    scenarioId: "runtime:mission-priority-change",
    name: "mission-priority-change",
    title: "Mission Priority Change",
    initialEnvironment: getScenarioFixture("medical-emergency").initialEnvironment,
    initialDevice: { ...phase1Normal.initialDevice, batteryPercent: 7, estimatedRuntimeMinutes: 18 },
    observations: [
      {
        observationId: "runtime-observation:mission-medical",
        iteration: 1,
        phase: "AFTER_EXECUTION_STARTED",
        atMs: 10,
        order: 0,
        target: "MISSION",
        patch: { type: "MEDICAL_EMERGENCY" },
      },
    ],
  }),
};

export function getRuntimeScenarioFixture(name: RuntimeScenarioName): RuntimeScenarioFixture {
  return runtimeScenarioFixtureSchema.parse(fixtures[name]);
}

export function allRuntimeScenarioFixtures(): readonly RuntimeScenarioFixture[] {
  return Object.values(fixtures).map((item) => runtimeScenarioFixtureSchema.parse(item));
}
