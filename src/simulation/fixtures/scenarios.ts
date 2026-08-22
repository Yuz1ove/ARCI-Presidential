import type { EnvironmentStateInput } from "../../domain/environment/model.js";
import type { NetworkGraphInput } from "../../domain/network/model.js";
import {
  scenarioFixtureSchema,
  type ScenarioFixture,
  type ScenarioFixtureInput,
  type ScenarioName,
} from "../scenarios/schema.js";

const START = "2030-01-01T00:00:00.000Z";

const baseEnvironment: EnvironmentStateInput = {
  schemaVersion: 1,
  timestamp: START,
  weatherRisk: 0.1,
  regionalCongestion: 0.1,
  relayAvailability: 1,
  infrastructureStatus: "HEALTHY",
  channels: [
    {
      medium: "CELLULAR",
      available: true,
      signalStrength: 1,
      latencyMs: 80,
      packetLoss: 0.01,
      bandwidthKbps: 20_000,
      energyCost: 0.3,
      monetaryCost: 0.12,
    },
    {
      medium: "WIFI",
      available: true,
      signalStrength: 0.9,
      latencyMs: 180,
      packetLoss: 0.03,
      bandwidthKbps: 12_000,
      energyCost: 0.35,
      monetaryCost: 0.1,
    },
    {
      medium: "LORA",
      available: true,
      signalStrength: 0.85,
      latencyMs: 900,
      packetLoss: 0.04,
      bandwidthKbps: 50,
      energyCost: 0.08,
      monetaryCost: 0.03,
    },
    {
      medium: "SATELLITE",
      available: true,
      signalStrength: 1,
      latencyMs: 600,
      packetLoss: 0.01,
      bandwidthKbps: 2_000,
      energyCost: 0.85,
      monetaryCost: 0.95,
    },
  ],
};

const baseGraph: NetworkGraphInput = {
  schemaVersion: 1,
  graphVersion: 1,
  nodes: [
    { nodeId: "node:field", type: "FIELD_DEVICE", available: true },
    { nodeId: "node:cell", type: "CELL_TOWER", available: true },
    { nodeId: "node:wifi", type: "WIFI_AP", available: true },
    { nodeId: "node:lora", type: "LORA_RELAY", available: true },
    { nodeId: "node:drone", type: "DRONE_RELAY", available: true },
    { nodeId: "node:satellite", type: "SATELLITE", available: true },
    { nodeId: "node:command", type: "COMMAND_CENTER", available: true },
  ],
  edges: [
    {
      edgeId: "edge:cellular-access",
      from: "node:field",
      to: "node:cell",
      medium: "CELLULAR",
      available: true,
      signalStrength: 1,
      latencyMs: 80,
      packetLoss: 0.01,
      bandwidthKbps: 20_000,
      energyCost: 0.3,
      monetaryCost: 0.12,
    },
    {
      edgeId: "edge:cellular-backhaul",
      from: "node:cell",
      to: "node:command",
      medium: "RELAY_LINK",
      available: true,
      signalStrength: 1,
      latencyMs: 20,
      packetLoss: 0.01,
      bandwidthKbps: 50_000,
      energyCost: 0.02,
      monetaryCost: 0.02,
    },
    {
      edgeId: "edge:wifi-access",
      from: "node:field",
      to: "node:wifi",
      medium: "WIFI",
      available: true,
      signalStrength: 0.9,
      latencyMs: 180,
      packetLoss: 0.03,
      bandwidthKbps: 12_000,
      energyCost: 0.35,
      monetaryCost: 0.1,
    },
    {
      edgeId: "edge:wifi-backhaul",
      from: "node:wifi",
      to: "node:command",
      medium: "RELAY_LINK",
      available: true,
      signalStrength: 1,
      latencyMs: 25,
      packetLoss: 0.01,
      bandwidthKbps: 25_000,
      energyCost: 0.03,
      monetaryCost: 0.01,
    },
    {
      edgeId: "edge:lora-access",
      from: "node:field",
      to: "node:lora",
      medium: "LORA",
      available: true,
      signalStrength: 0.85,
      latencyMs: 900,
      packetLoss: 0.04,
      bandwidthKbps: 50,
      energyCost: 0.08,
      monetaryCost: 0.03,
    },
    {
      edgeId: "edge:lora-backhaul",
      from: "node:lora",
      to: "node:command",
      medium: "RELAY_LINK",
      available: true,
      signalStrength: 1,
      latencyMs: 200,
      packetLoss: 0.005,
      bandwidthKbps: 250,
      energyCost: 0.02,
      monetaryCost: 0.01,
    },
    {
      edgeId: "edge:drone-access",
      from: "node:field",
      to: "node:drone",
      medium: "MESH",
      available: true,
      signalStrength: 0.8,
      latencyMs: 260,
      packetLoss: 0.08,
      bandwidthKbps: 800,
      energyCost: 0.42,
      monetaryCost: 0.35,
    },
    {
      edgeId: "edge:drone-backhaul",
      from: "node:drone",
      to: "node:command",
      medium: "RELAY_LINK",
      available: true,
      signalStrength: 0.9,
      latencyMs: 220,
      packetLoss: 0.04,
      bandwidthKbps: 1_000,
      energyCost: 0.25,
      monetaryCost: 0.25,
    },
    {
      edgeId: "edge:satellite-uplink",
      from: "node:field",
      to: "node:satellite",
      medium: "SATELLITE",
      available: true,
      signalStrength: 1,
      latencyMs: 600,
      packetLoss: 0.01,
      bandwidthKbps: 2_000,
      energyCost: 0.85,
      monetaryCost: 0.95,
    },
    {
      edgeId: "edge:satellite-downlink",
      from: "node:satellite",
      to: "node:command",
      medium: "RELAY_LINK",
      available: true,
      signalStrength: 1,
      latencyMs: 80,
      packetLoss: 0.005,
      bandwidthKbps: 10_000,
      energyCost: 0.05,
      monetaryCost: 0.02,
    },
  ],
};

const baseFixture: Omit<ScenarioFixtureInput, "scenarioId" | "name" | "title" | "timeline"> = {
  schemaVersion: 1,
  randomSeed: 42,
  initialEnvironment: baseEnvironment,
  initialDevice: {
    schemaVersion: 1,
    deviceId: "device:field-alpha",
    batteryPercent: 81,
    availableInterfaces: ["CELLULAR", "WIFI", "LORA", "SATELLITE"],
    estimatedRuntimeMinutes: 460,
  },
  initialMission: {
    schemaVersion: 1,
    missionId: "mission:phase1",
    type: "GENERAL",
    originNodeId: "node:field",
    destinationNodeId: "node:command",
  },
  networkGraph: baseGraph,
  expectedInvariants: [
    "DETERMINISTIC_REPLAY",
    "ZERO_EXECUTED_POLICY_VIOLATIONS",
    "ROUTE_FROM_CANDIDATE_SET",
    "VERIFIED_OR_EXPLICIT_FAILURE",
  ],
};

function fixture(input: ScenarioFixtureInput): ScenarioFixture {
  return scenarioFixtureSchema.parse(input);
}

const fixtures: Readonly<Record<ScenarioName, ScenarioFixture>> = {
  normal: fixture({
    ...baseFixture,
    scenarioId: "scenario:normal",
    name: "normal",
    title: "Normal",
    timeline: [],
  }),
  "cellular-failure": fixture({
    ...baseFixture,
    scenarioId: "scenario:cellular-failure",
    name: "cellular-failure",
    title: "Cellular Failure",
    timeline: [
      {
        eventId: "scenario-event:cellular-degraded",
        atMs: 5_000,
        phase: "BEFORE_DECISION",
        target: "ENVIRONMENT",
        patch: {
          timestamp: "2030-01-01T00:00:05.000Z",
          regionalCongestion: 0.5,
          infrastructureStatus: "DEGRADED",
          channel: {
            medium: "CELLULAR",
            signalStrength: 0.18,
            packetLoss: 0.68,
            latencyMs: 1_400,
            bandwidthKbps: 250,
          },
        },
      },
      {
        eventId: "scenario-event:wifi-lost-after-cellular",
        atMs: 7_000,
        phase: "BEFORE_DECISION",
        target: "ENVIRONMENT",
        patch: {
          channel: { medium: "WIFI", available: false, signalStrength: 0 },
        },
      },
    ],
  }),
  "infrastructure-collapse": fixture({
    ...baseFixture,
    scenarioId: "scenario:infrastructure-collapse",
    name: "infrastructure-collapse",
    title: "Infrastructure Collapse",
    timeline: [
      {
        eventId: "scenario-event:cellular-unavailable",
        atMs: 4_000,
        phase: "BEFORE_DECISION",
        target: "ENVIRONMENT",
        patch: { channel: { medium: "CELLULAR", available: false, signalStrength: 0 } },
      },
      {
        eventId: "scenario-event:wifi-unavailable",
        atMs: 5_000,
        phase: "BEFORE_DECISION",
        target: "ENVIRONMENT",
        patch: { channel: { medium: "WIFI", available: false, signalStrength: 0 } },
      },
      {
        eventId: "scenario-event:lora-unavailable",
        atMs: 6_000,
        phase: "BEFORE_DECISION",
        target: "ENVIRONMENT",
        patch: {
          infrastructureStatus: "COLLAPSED",
          relayAvailability: 0.2,
          channel: { medium: "LORA", available: false, signalStrength: 0 },
        },
      },
    ],
  }),
  "low-battery": fixture({
    ...baseFixture,
    scenarioId: "scenario:low-battery",
    name: "low-battery",
    title: "Low Battery",
    timeline: [
      {
        eventId: "scenario-event:battery-low",
        atMs: 3_000,
        phase: "BEFORE_DECISION",
        target: "DEVICE",
        patch: { batteryPercent: 7, estimatedRuntimeMinutes: 18 },
      },
    ],
  }),
  "medical-emergency": fixture({
    ...baseFixture,
    scenarioId: "scenario:medical-emergency",
    name: "medical-emergency",
    title: "Medical Emergency",
    initialEnvironment: {
      ...baseEnvironment,
      channels: baseEnvironment.channels.map((channel) =>
        channel.medium === "CELLULAR"
          ? { ...channel, signalStrength: 0.99, packetLoss: 0.04 }
          : channel,
      ),
    },
    initialDevice: { ...baseFixture.initialDevice, batteryPercent: 7, estimatedRuntimeMinutes: 18 },
    initialMission: { ...baseFixture.initialMission, type: "MEDICAL_EMERGENCY" },
    timeline: [],
  }),
  "relay-failure-after-selection": fixture({
    ...baseFixture,
    scenarioId: "scenario:relay-failure-after-selection",
    name: "relay-failure-after-selection",
    title: "Relay Failure After Selection",
    initialEnvironment: {
      ...baseEnvironment,
      infrastructureStatus: "DEGRADED",
      channels: baseEnvironment.channels.map((channel) =>
        channel.medium === "CELLULAR" || channel.medium === "WIFI"
          ? { ...channel, available: false, signalStrength: 0 }
          : channel,
      ),
    },
    timeline: [
      {
        eventId: "scenario-event:lora-relay-fails",
        atMs: 50,
        phase: "AFTER_EXECUTION_STARTED",
        target: "GRAPH_EDGE",
        patch: { edgeId: "edge:lora-access", available: false },
      },
    ],
  }),
};

export function getScenarioFixture(name: ScenarioName): ScenarioFixture {
  return scenarioFixtureSchema.parse(fixtures[name]);
}

export function allScenarioFixtures(): readonly ScenarioFixture[] {
  return Object.values(fixtures).map((item) => scenarioFixtureSchema.parse(item));
}
