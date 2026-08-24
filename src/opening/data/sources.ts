import type { SourceDescriptor } from "./model.js";

export const OFFICIAL_SOURCES: readonly SourceDescriptor[] = [
  {
    id: "CWA_RAIN",
    agency: "中央氣象署",
    dataset: "O-A0002-001 雨量觀測站逐 10 分鐘雨量",
    url: "https://opendata.cwa.gov.tw/dataset/observation/O-A0002-001",
    geography: "STATION",
    cadence: "10 minutes",
    status: "READY_FOR_CREDENTIALS",
    limitation: "Requires a CWA authorization key; a station observation is not a village-wide measurement.",
  },
  {
    id: "TDX_ROAD",
    agency: "交通部運輸資料流通服務",
    dataset: "道路事件 v1",
    url: "https://tdx.transportdata.tw/api-service/swagger/basic/60abfa19-ffe3-4eef-a4b1-0539435dfca9",
    geography: "ROAD_EVENT",
    cadence: "provider event cadence",
    status: "READY_FOR_CREDENTIALS",
    limitation: "Road events require spatial matching; absence of an event cannot prove a road is passable.",
  },
  {
    id: "NCC_TOWNSHIP",
    agency: "國家通訊傳播委員會",
    dataset: "行動通信業務基地臺統計（區分鄉鎮）",
    url: "https://data.gov.tw/dataset/41256",
    geography: "TOWNSHIP",
    cadence: "irregular",
    status: "PUBLIC_DOWNLOAD",
    limitation: "Township licence counts are a redundancy proxy, never precise base-station coordinates or live availability.",
  },
  {
    id: "MOI_VILLAGE",
    agency: "內政部戶政司",
    dataset: "村里戶數、單一年齡人口（新增區域代碼）",
    url: "https://data.gov.tw/dataset/77132",
    geography: "VILLAGE",
    cadence: "monthly files",
    status: "PUBLIC_DOWNLOAD",
    limitation: "Registered population is not the same as people physically exposed during an incident.",
  },
  {
    id: "MOA_SURVEY",
    agency: "農業部",
    dataset: "農情調查",
    url: "https://data.gov.tw/dataset/7302",
    geography: "TOWNSHIP",
    cadence: "annual / crop season",
    status: "PUBLIC_DOWNLOAD",
    limitation: "Agricultural production periods do not establish event-time crop damage.",
  },
  {
    id: "NLSC_DTM",
    agency: "內政部國土測繪中心",
    dataset: "數值地形模型成果",
    url: "https://www.nlsc.gov.tw/cp.aspx?n=1853",
    geography: "RASTER",
    cadence: "versioned release",
    status: "UNCONNECTED",
    limitation: "Terrain, slope, obstruction and line-of-sight require a documented raster version and reproducible geospatial processing.",
  },
] as const;

export function sourceById(id: string): SourceDescriptor {
  const source = OFFICIAL_SOURCES.find((candidate) => candidate.id === id);
  if (source === undefined) throw new Error(`Unknown official source: ${id}`);
  return source;
}
