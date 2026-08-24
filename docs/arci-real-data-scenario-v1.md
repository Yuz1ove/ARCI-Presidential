# ARCI Real-Data Scenario Dataset v1

Status: `SCENARIO_ARCHITECTURE_READY / LIVE_DATA_UNCONNECTED`

This dataset contract supports the competition scrollytelling sequence from sensing through route selection. It does not claim that the current visual is connected to live public-sector systems. Every event value currently rendered in the opening is a visible `SCENARIO INJECTION`; computed weights, target scores and route selection are `DERIVED` or `DECISION` only from those disclosed inputs.

## Provenance contract

| Class | Meaning | Allowed use | Forbidden use |
| --- | --- | --- | --- |
| `OBSERVED` | A value extracted from an opened source record with dataset, locator, geography, unit and timestamp | Event sensing after adapter activation | Placeholder, cached example or scenario value |
| `DERIVED` | A reproducible formula over identified inputs | Exposure, normalized weights and scores | Calling a model result an official observation |
| `DECISION` | An ARCI selection over traceable derived values | Priority target or locked route | Calling a selection verified delivery or real-world impact |
| `SCENARIO` | A disclosed injected event condition | Demo and deterministic replay | `LIVE`, official observation or operational status |

## Official source and adapter matrix

| Adapter | Official dataset | Intended fields | Current status | Mandatory limitation |
| --- | --- | --- | --- | --- |
| `CwaRainfallAdapter` | [CWA O-A0002-001 rainfall observations](https://opendata.cwa.gov.tw/dataset/observation/O-A0002-001) | station, coordinate, time, 10m/1h/3h/6h/24h rainfall | `READY_FOR_CREDENTIALS` | Station values cannot be relabelled as village-wide observations. |
| `TdxRoadEventAdapter` | [TDX Road Event v1](https://tdx.transportdata.tw/api-service/swagger/basic/60abfa19-ffe3-4eef-a4b1-0539435dfca9) | event, road, position, severity, restriction, update time | `READY_FOR_CREDENTIALS` | No event does not prove a road is passable; spatial matching is required. |
| `NccTownshipRedundancyAdapter` | [NCC township base-station licence counts](https://data.gov.tw/dataset/41256) | county, township, period, radio class, count | `PUBLIC_DOWNLOAD` | Township counts are only a redundancy proxy, never precise coordinates or live availability. |
| `MoiVillagePopulationAdapter` | [MOI village and single-age population](https://data.gov.tw/dataset/77132) | period, village code, population, elderly population | `PUBLIC_DOWNLOAD` | Registered population is not event-time physical exposure. |
| `MoaAgricultureAdapter` | [MOA agricultural survey](https://data.gov.tw/dataset/7302) | year, season, township, crop, area, production | `PUBLIC_DOWNLOAD` | Annual or crop-season values do not prove event-time damage. |
| `NlscTerrainAdapter` | [NLSC digital terrain model repository](https://www.nlsc.gov.tw/cp.aspx?n=1853) | raster version, elevation, slope, obstruction, LOS | `UNCONNECTED` | Derived terrain values require a pinned raster, CRS and reproducible processing log. |

The runtime contracts are in `src/opening/data/adapters.ts`. No adapter is allowed to emit `OBSERVED` until its activation requirement is met and a reconstruction test covers the source record.

## Dynamic weight and computation record

Formula:

```text
w_i(t) = (b_i × m_i(t)) / Σ(b_j × m_j(t))
```

The current five baselines are policy demonstration values: 30%, 25%, 20%, 15% and 10%. Event multipliers are scenario inputs. The implementation normalizes active weights to exactly 1 and calculates both target scores from the same active-weight vector. Tests reproduce the displayed `73.7` and `72.2` rounded scores.

Allowed interpretation: given the disclosed scenario inputs and baseline policy, Target A receives a higher computed priority score than Target B.

Forbidden interpretation: Target A is a real village, the scenario values were observed by government systems, Route B is physically available, or the decision produced verified real-world impact.

## Candidate scenario Top 5

This is a preliminary evidence shortlist, not a quantitative official ranking. Rank order is a demo-research priority based on expected ability to join the six official data families; it must be recomputed after current extracts, terrain processing and historical road-event coverage are available.

| Rank | Candidate | Agricultural fit | Demo fit | Known data seams | Blocking evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 南投縣仁愛鄉 | High-mountain produce and tea candidate | Distributed settlements and long mountain-road paths suit relay and route comparison | CWA, NCC, MOI, MOA | Event-time coverage, precise relay assets, historical road events, DTM LOS |
| 2 | 嘉義縣阿里山鄉 | Tea and mountain agriculture candidate | Terrain obstruction and shared agricultural/visitor roads suit multi-factor prioritization | CWA, NCC, MOI, MOA | Event-time exposure, historical TDX completeness, DTM processing |
| 3 | 臺中市和平區 | High-mountain fruit and vegetable candidate | Dispersed settlements and complex primary-road access suit route redundancy | CWA, NCC, MOI, MOA | Village-road join, live cell status, terrain obstruction model |
| 4 | 桃園市復興區 | Mountain fruit candidate | Population and agricultural activity distributed along mountain roads | CWA, NCC, MOI, MOA | Crop-season replay, relay inventory, terrain route cost |
| 5 | 高雄市那瑪夏區 | Mountain agriculture and disaster-replay candidate | Remote settlements and terrain complexity fit resilient communications | CWA, NCC, MOI, MOA | Validated replay window, road archive, DTM/LOS, outage evidence |

The candidate list is encoded in `src/opening/data/candidates.ts` with each missing-evidence list preserved. No final demo case is selected in v1.
