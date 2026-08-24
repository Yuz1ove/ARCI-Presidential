import type { CandidateScenario } from "./model.js";

export const CANDIDATE_SCENARIOS: readonly CandidateScenario[] = [
  {
    rank: 1,
    place: "南投縣仁愛鄉",
    agriculture: "高山蔬果與茶業候選",
    fit: "山區聚落、長距離道路與農業生產同時受通訊中斷影響，適合驗證多節點中繼與道路替代路徑。",
    dataAvailable: ["CWA station rainfall", "NCC township count", "MOI village population", "MOA township crop survey"],
    missing: ["event-time coverage", "precise relay coordinates", "replay-aligned road history", "DTM-derived LOS"],
    status: "PRELIMINARY_EVIDENCE_SHORTLIST",
  },
  {
    rank: 2,
    place: "嘉義縣阿里山鄉",
    agriculture: "茶業與山區農產候選",
    fit: "地形遮蔽、觀光與農產運輸共用道路，適合呈現人口、農務與路徑可靠度的權衡。",
    dataAvailable: ["CWA station rainfall", "NCC township count", "MOI village population", "MOA township crop survey"],
    missing: ["event-time exposure", "historical TDX completeness", "DTM raster processing"],
    status: "PRELIMINARY_EVIDENCE_SHORTLIST",
  },
  {
    rank: 3,
    place: "臺中市和平區",
    agriculture: "高山果樹與蔬菜候選",
    fit: "聚落分散且主要道路穿越複雜地形，適合多路徑與通訊冗餘場景。",
    dataAvailable: ["CWA station rainfall", "NCC township count", "MOI village population", "MOA township crop survey"],
    missing: ["village-to-road exposure join", "base-station operational status", "terrain obstruction model"],
    status: "PRELIMINARY_EVIDENCE_SHORTLIST",
  },
  {
    rank: 4,
    place: "桃園市復興區",
    agriculture: "山區果樹候選",
    fit: "人口與農業活動沿山區道路分布，適合測試道路事件、地形與需求節點的整合。",
    dataAvailable: ["CWA station rainfall", "NCC township count", "MOI village population", "MOA township crop survey"],
    missing: ["crop-season replay", "relay asset inventory", "DTM-derived route cost"],
    status: "PRELIMINARY_EVIDENCE_SHORTLIST",
  },
  {
    rank: 5,
    place: "高雄市那瑪夏區",
    agriculture: "山區農產與歷史災害 replay 候選",
    fit: "偏遠聚落與高地形複雜度適合韌性通訊敘事，但必須先補齊農業與道路歷史資料。",
    dataAvailable: ["CWA station rainfall", "NCC township count", "MOI village population", "MOA township crop survey"],
    missing: ["validated historical replay window", "road-event archive", "DTM/LOS processing", "communications outage evidence"],
    status: "PRELIMINARY_EVIDENCE_SHORTLIST",
  },
] as const;
