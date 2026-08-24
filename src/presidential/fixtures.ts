import type {
  CompetitionScenario,
  LinkState,
  PublicContext,
  RealDataSource,
  ResilientMessage,
} from "./model.js";

export const OFFICIAL_REPLAY_CAPTURED_AT = "2026-08-25T00:58:03+08:00";

export const PUBLIC_CONTEXT: PublicContext = {
  geography: "南投縣仁愛鄉",
  villages: 16,
  households: 4_953,
  population: 15_198,
  elderlyPopulation: 2_423,
  mobileBaseStationProxy: {
    observedPeriod: "1150731",
    fourG: 167,
    fiveG: 149,
  },
  agriculture: {
    year: "114",
    crop: "百合",
    plantedAreaHa: 141,
    productionKg: 1_931_178,
  },
};

export const DATA_SOURCES: readonly RealDataSource[] = [
  {
    sourceId: "MOI_VILLAGE_11507_RENAI",
    provider: "內政部戶政司",
    datasetName: "村里戶數、單一年齡人口（新增區域代碼）",
    sourceUrl: "https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/11507?page=3",
    fetchedAt: OFFICIAL_REPLAY_CAPTURED_AT,
    observedAt: "2026-07-31T23:59:59+08:00",
    freshness: "MONTHLY_STRUCTURAL",
    status: "REPLAY_FIXED",
    dataQuality: "OFFICIAL_AGGREGATE_16_VILLAGES",
    classification: "PUBLIC",
    license: "政府資料開放授權條款－第1版",
    limitation: "戶籍人口不是事件當下實際暴露人口；65 歲以上人數由單一年齡欄位加總。",
  },
  {
    sourceId: "NCC_TOWNSHIP_1150731_RENAI",
    provider: "國家通訊傳播委員會",
    datasetName: "行動通信業務基地臺統計（區分鄉鎮）",
    sourceUrl: "https://data.gov.tw/dataset/41256",
    fetchedAt: OFFICIAL_REPLAY_CAPTURED_AT,
    observedAt: "2026-07-31T23:59:59+08:00",
    freshness: "MONTHLY_STRUCTURAL",
    status: "REPLAY_FIXED",
    dataQuality: "OFFICIAL_TOWNSHIP_COUNT",
    classification: "PUBLIC",
    license: "政府資料開放授權條款－第1版",
    limitation: "鄉鎮基地臺數僅是冗餘 proxy，不是精確座標、即時可用率或涵蓋證明。",
  },
  {
    sourceId: "MOA_TOWN_CROP_114_RENAI",
    provider: "農業部",
    datasetName: "農情調查",
    sourceUrl: "https://data.gov.tw/dataset/7302",
    fetchedAt: OFFICIAL_REPLAY_CAPTURED_AT,
    observedAt: "2025-12-31T23:59:59+08:00",
    freshness: "ANNUAL_STRUCTURAL",
    status: "REPLAY_FIXED",
    dataQuality: "OFFICIAL_TOWNSHIP_CROP_STATISTIC",
    classification: "PUBLIC",
    license: "政府資料開放授權條款－第1版",
    limitation: "年度作物統計只建立農業脈絡，不代表災時損失、受災面積或產值。",
  },
  {
    sourceId: "CWA_O_A0002_001",
    provider: "交通部中央氣象署",
    datasetName: "O-A0002-001 雨量觀測站雨量資料",
    sourceUrl: "https://opendata.cwa.gov.tw/dataset/observation/O-A0002-001",
    fetchedAt: OFFICIAL_REPLAY_CAPTURED_AT,
    observedAt: "NOT_FETCHED",
    freshness: "10_MINUTES_WHEN_CONNECTED",
    status: "REQUIRES_CREDENTIALS",
    dataQuality: "SCHEMA_AND_TERMS_VERIFIED_NO_RECORD_FETCHED",
    classification: "PUBLIC",
    license: "氣象資料開放平臺使用規範；須顯名",
    limitation: "本部署未設定 CWA 授權碼；雨量情境值不得標為 LIVE 或 OBSERVED。",
  },
  {
    sourceId: "TDX_ROAD_EVENT_V1",
    provider: "交通部運輸資料流通服務",
    datasetName: "道路事件 v1",
    sourceUrl: "https://tdx.transportdata.tw/api-service/swagger/basic/60abfa19-ffe3-4eef-a4b1-0539435dfca9",
    fetchedAt: OFFICIAL_REPLAY_CAPTURED_AT,
    observedAt: "NOT_FETCHED",
    freshness: "PROVIDER_EVENT_CADENCE_WHEN_CONNECTED",
    status: "REQUIRES_CREDENTIALS",
    dataQuality: "OAS_AND_AUTH_REQUIREMENT_VERIFIED_NO_RECORD_FETCHED",
    classification: "PUBLIC",
    license: "TDX Terms of Service",
    limitation: "本部署未設定 TDX Client ID/Secret；道路中斷為情境注入。",
  },
] as const;

const BASE_LINKS: readonly LinkState[] = [
  { linkId: "cellular-4g", label: "4G / LTE", type: "CELLULAR", available: true, simulated: true, latencyMs: 54, packetLoss: 0.04, estimatedBandwidthMbps: 22, reliability: 0.86, energyCost: 0.3, monetaryCost: 0.18, coverage: 0.88, congestion: 0.38, hazardExposure: 0.72, deliveryProbability: 0.88, maxPayloadKb: 12_000 },
  { linkId: "ridge-mesh", label: "稜線 Wi-Fi Mesh", type: "WIFI_MESH", available: true, simulated: true, latencyMs: 82, packetLoss: 0.08, estimatedBandwidthMbps: 8, reliability: 0.78, energyCost: 0.42, monetaryCost: 0.12, coverage: 0.72, congestion: 0.26, hazardExposure: 0.42, deliveryProbability: 0.81, maxPayloadKb: 8_000 },
  { linkId: "lora-gateway", label: "LoRa Gateway", type: "LORA", available: true, simulated: true, latencyMs: 210, packetLoss: 0.06, estimatedBandwidthMbps: 0.05, reliability: 0.9, energyCost: 0.08, monetaryCost: 0.05, coverage: 0.9, congestion: 0.2, hazardExposure: 0.25, deliveryProbability: 0.91, maxPayloadKb: 32 },
  { linkId: "satellite-uplink", label: "Satellite Uplink", type: "SATELLITE", available: true, simulated: true, latencyMs: 640, packetLoss: 0.03, estimatedBandwidthMbps: 4, reliability: 0.94, energyCost: 0.82, monetaryCost: 0.92, coverage: 0.98, congestion: 0.12, hazardExposure: 0.08, deliveryProbability: 0.95, maxPayloadKb: 4_000 },
  { linkId: "drone-relay", label: "Drone Relay", type: "DRONE_RELAY", available: true, simulated: true, latencyMs: 115, packetLoss: 0.07, estimatedBandwidthMbps: 12, reliability: 0.82, energyCost: 0.72, monetaryCost: 0.55, coverage: 0.84, congestion: 0.1, hazardExposure: 0.34, deliveryProbability: 0.86, maxPayloadKb: 10_000 },
] as const;

function links(overrides: Readonly<Record<string, Partial<LinkState>>>): readonly LinkState[] {
  return BASE_LINKS.map((link) => ({ ...link, ...(overrides[link.linkId] ?? {}) }));
}

function message(input: Omit<ResilientMessage, "status" | "routeHistory" | "retryCount">): ResilientMessage {
  return { ...input, status: "CREATED", routeHistory: [], retryCount: 0 };
}

export const COMPETITION_SCENARIOS: readonly CompetitionScenario[] = [
  {
    id: "SCENARIO_01",
    title: "山區豪雨 + 基地台失效",
    objective: "豪雨與基地台故障後，選擇可驗證替代路徑，並讓低頻寬農務訊息在斷網期間進入佇列。",
    startedAt: "2026-08-24T10:00:00+08:00",
    dataMode: "SIMULATION",
    state: {
      scenarioId: "SCENARIO_01",
      at: "2026-08-24T10:00:00+08:00",
      environment: { rainfall1hMm: 78.4, hazardLevel: "SEVERE", roadAccessibility: "CLOSED", terrainConstraints: ["RIDGE_SHADOW", "DEBRIS_FLOW_ZONE"], provenance: "SIMULATED" },
      infrastructure: { towersOperational: 0, towersFailed: 1, nodesOperational: 3, failedLinkIds: ["cellular-4g"], powerAvailable: true },
      communication: links({ "cellular-4g": { available: false, reliability: 0.05, deliveryProbability: 0.02 }, "ridge-mesh": { hazardExposure: 0.78, deliveryProbability: 0.58 } }),
      demand: { demandIds: ["msg-01-medical", "msg-01-crop"], agriculturalDemandIds: ["msg-01-crop"], affectedVillages: ["力行村", "翠華村"] },
      resources: { relayTeamsAvailable: 1, droneRelaysAvailable: 1, energyReserve: 0.74 },
    },
    messages: [
      message({ id: "msg-01-medical", createdAt: "2026-08-24T10:00:04+08:00", location: "力行村", demandType: "MEDICAL", priority: 5, payloadSizeKb: 18 }),
      message({ id: "msg-01-crop", createdAt: "2026-08-24T10:00:08+08:00", location: "翠華村", demandType: "AGRICULTURAL_PRODUCTION", priority: 3, payloadSizeKb: 1_600 }),
    ],
    injections: [
      { type: "DEBRIS_FLOW", label: "土石流", description: "封閉山區道路並提高地面鏈路風險。" },
      { type: "TOWER_FAILURE", label: "基地台失效", targetLinkId: "cellular-4g", description: "移除 4G / LTE 候選。" },
    ],
    executionFailureLinkIds: [],
    recoveryLinkIds: [],
  },
  {
    id: "SCENARIO_02",
    title: "農村多點需求同時出現",
    objective: "醫療、孤立家戶、農業生產與道路阻斷同時進入系統，驗證 priority allocation 與 store-and-forward。",
    startedAt: "2026-08-24T11:00:00+08:00",
    dataMode: "SIMULATION",
    state: {
      scenarioId: "SCENARIO_02",
      at: "2026-08-24T11:00:00+08:00",
      environment: { rainfall1hMm: 61.2, hazardLevel: "ELEVATED", roadAccessibility: "RESTRICTED", terrainConstraints: ["DISPERSED_SETTLEMENTS"], provenance: "SIMULATED" },
      infrastructure: { towersOperational: 1, towersFailed: 0, nodesOperational: 4, failedLinkIds: [], powerAvailable: true },
      communication: links({ "cellular-4g": { congestion: 0.9, packetLoss: 0.28, deliveryProbability: 0.52 }, "drone-relay": { available: false, maxPayloadKb: 16_000 } }),
      demand: { demandIds: ["msg-02-medical", "msg-02-household", "msg-02-agriculture", "msg-02-road"], agriculturalDemandIds: ["msg-02-agriculture"], affectedVillages: ["法治村", "親愛村", "精英村", "翠華村"] },
      resources: { relayTeamsAvailable: 1, droneRelaysAvailable: 1, energyReserve: 0.63 },
    },
    messages: [
      message({ id: "msg-02-medical", createdAt: "2026-08-24T11:00:01+08:00", location: "法治村", demandType: "MEDICAL", priority: 5, payloadSizeKb: 20 }),
      message({ id: "msg-02-household", createdAt: "2026-08-24T11:00:02+08:00", location: "親愛村", demandType: "ISOLATED_HOUSEHOLD", priority: 4, payloadSizeKb: 12 }),
      message({ id: "msg-02-agriculture", createdAt: "2026-08-24T11:00:03+08:00", location: "精英村", demandType: "AGRICULTURAL_PRODUCTION", priority: 3, payloadSizeKb: 13_000 }),
      message({ id: "msg-02-road", createdAt: "2026-08-24T11:00:04+08:00", location: "翠華村", demandType: "ROAD_OBSTRUCTION", priority: 4, payloadSizeKb: 2_400 }),
    ],
    injections: [
      { type: "PACKET_LOSS", label: "封包遺失", targetLinkId: "cellular-4g", description: "行動網路壅塞與封包遺失提高。" },
      { type: "BANDWIDTH_COLLAPSE", label: "頻寬崩落", targetLinkId: "lora-gateway", description: "大型農務 payload 不能走 LoRa。" },
    ],
    executionFailureLinkIds: [],
    recoveryLinkIds: ["drone-relay"],
  },
  {
    id: "SCENARIO_03",
    title: "Secondary failure / 二次故障",
    objective: "第一次 route selection 後再讓已選鏈路失效，必須 invalidate、recalculate、replan 並重新驗證 ACK。",
    startedAt: "2026-08-24T12:00:00+08:00",
    dataMode: "SIMULATION",
    state: {
      scenarioId: "SCENARIO_03",
      at: "2026-08-24T12:00:00+08:00",
      environment: { rainfall1hMm: 49.6, hazardLevel: "ELEVATED", roadAccessibility: "RESTRICTED", terrainConstraints: ["RIDGE_SHADOW"], provenance: "SIMULATED" },
      infrastructure: { towersOperational: 0, towersFailed: 1, nodesOperational: 4, failedLinkIds: ["cellular-4g"], powerAvailable: false },
      communication: links({ "cellular-4g": { available: false }, "satellite-uplink": { reliability: 0.98, deliveryProbability: 0.98 }, "lora-gateway": { available: false }, "ridge-mesh": { reliability: 0.88, deliveryProbability: 0.9 } }),
      demand: { demandIds: ["msg-03-rescue"], agriculturalDemandIds: [], affectedVillages: ["發祥村"] },
      resources: { relayTeamsAvailable: 1, droneRelaysAvailable: 1, energyReserve: 0.48 },
    },
    messages: [message({ id: "msg-03-rescue", createdAt: "2026-08-24T12:00:03+08:00", location: "發祥村", demandType: "RESCUE", priority: 5, payloadSizeKb: 64 })],
    injections: [
      { type: "POWER_LOSS", label: "電力中斷", targetLinkId: "cellular-4g", description: "地面基地台不可用。" },
      { type: "NODE_ISOLATION", label: "二次節點孤立", targetLinkId: "ridge-mesh", description: "第一次決策後讓已選定的稜線 Mesh 節點孤立。" },
    ],
    executionFailureLinkIds: ["ridge-mesh"],
    recoveryLinkIds: [],
  },
] as const;

export function scenarioById(id: CompetitionScenario["id"]): CompetitionScenario {
  const scenario = COMPETITION_SCENARIOS.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`Unknown competition scenario: ${id}`);
  return scenario;
}
