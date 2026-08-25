# Deployment identity

This repository has one production deployment identity:

| Repository | Vercel project | Project ID | Production |
| --- | --- | --- | --- |
| `Autonomous-Resilient-Communication-Intelligence` | `arci-presidential` | `prj_UIevY4Ux5uwAs4yrSgHDtPfsNiVz` | `https://arci-presidential.vercel.app` |

Do not deploy this repository to either of these separate products:

| Product | Vercel project | Project ID |
| --- | --- | --- |
| StarryLink | `starrylink-demo` | `prj_9gbZV88mDsjjLV9YSIXlDqwefVr9` |
| ARCI SEA | `arci-sea` | `prj_am3sArj5F9QPeHJHuoa7vroAuhvg` |

## Production preflight

Before every production deployment, inspect `.vercel/project.json` and fail closed unless all of the following are true:

```text
projectName = arci-presidential
projectId = prj_UIevY4Ux5uwAs4yrSgHDtPfsNiVz
orgId = team_NeJ9lhAjDaMt817az9FVxe6y
```

If the project name or ID is `starrylink-demo`, stop and report:

```text
DEPLOYMENT_IDENTITY_MISMATCH
```

Relinking this repository must only change its local Vercel association. Never delete or reuse the StarryLink or ARCI SEA remote projects as a workaround.
