# Repository identity

| Field | Identity |
| --- | --- |
| Repository | `Yuz1ove/ARCI-Presidential` |
| Role | ARCI Presidential Hackathon Competition Product |
| Vercel project | `arci-presidential` |
| Vercel project ID | `prj_UIevY4Ux5uwAs4yrSgHDtPfsNiVz` |
| Production | `https://arci-presidential.vercel.app` |
| Upstream Core | `Yuz1ove/Autonomous-Resilient-Communication-Intelligence` |

## Deployment boundary

This repository must only be linked to the `arci-presidential` Vercel project.
Before any deployment, inspect `.vercel/project.json` and fail closed unless its
project name and project ID match the values above.

Do not deploy, link, promote, or reconnect this repository to:

- `starrylink-demo`
- `arci-sea`

`upstream-core` is a reference remote only. Changes from it must not be merged or
rebased automatically.
