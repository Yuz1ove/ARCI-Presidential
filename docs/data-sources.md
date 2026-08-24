# Presidential Data Sources

All connected facts are structural public context. None represents incident-time exposure, field damage, carrier availability, crop loss, or a hardware result.

| Source | Used record | Cadence / status | Attribution and limitation |
|---|---|---|---|
| Ministry of the Interior household registration, ODRP014 | ROC 11507, Renai Township, 16 villages: 4,953 households, 15,198 people, 2,423 age 65+ | Monthly; fixed replay and optional validated public LIVE fetch | Government Data Open License 1.0. Registered population is not actual incident exposure. |
| NCC mobile base-station statistics | Period 1150731, Renai Township: 167 4G and 149 5G records | Monthly; fixed replay | Government Data Open License 1.0. Counts are a redundancy proxy, not coordinates, coverage, or live availability. |
| Ministry of Agriculture agricultural survey | ROC year 114, Renai Township lilies: 141 ha planted, 1,931,178 kg production | Annual; fixed replay | Government Data Open License 1.0. It provides agricultural context and is not a loss estimate. |
| CWA O-A0002-001 rainfall observations | Schema, cadence, authorization, and attribution checked; no record fetched | 10-minute publication when authorized; credential-blocked | CWA open-data use rules require attribution and an authorization code. Scenario rainfall remains SIMULATED. |
| TDX Road Event v1 | Swagger/auth contract checked; no record fetched | Provider event cadence; credential-blocked | TDX Client ID/Secret required for an operational adapter. Road failures remain SIMULATED. |

LIVE mode validates provider status, schema, 16 Renai village rows, consistent statistic period, numeric population fields, and a 62-day freshness ceiling. Any error or stale period falls back to fixed replay context and visibly reports `DEGRADED` or `STALE`.

The UI links directly to each official source and displays observation period, freshness, classification, status, and limitation.
