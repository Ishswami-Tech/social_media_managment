# Enterprise Agent Council Plan

**Product frame:** Agents are the product. Model providers are infrastructure.  
**Team:** seven named agents. **Width:** how many models sit behind a council decision (default 3, max 5).

## Seven agents

| # | Name | Role | Stage |
| --- | --- | --- | --- |
| 1 | Scout | Researcher | RESEARCHING |
| 2 | Compass | Strategist | STRATEGIZING |
| 3–5 | Quill | Writers (always 3) | DRAFTING |
| 6 | Lens | Reviewer | REVIEWING |
| 7 | Verdict | Judge | JUDGING |
| — | Polish | Editor | ADAPTING |
| — | You | Approver | AWAITING_APPROVAL |

## Selective width (Phase 1)

`W = max(1, ctx.councilSize ?? 1)` via `stageCouncilSize`:

| Stage | Seats |
| --- | --- |
| research | `min(W, 3)` |
| strategy | `W` |
| review | `W` if `HIGH_ASSURANCE`, else `1` |
| judge | `W` |
| writers | always 3 |

## Enrichment & token control (Phase 2)

| Lever | Behavior |
| --- | --- |
| Skill summaries | Compass gets short playbook clips (`skillSummariesFor`) |
| Skill budgets by role | writer 18k / review 10k / adapt 12k total (`withSkills(..., role)`) |
| Compact claims | Lens uses `claimsIdsText` (id + statement, no evidence URLs) |
| Run context pack | `runContextPack` — topic, goal, strategy stub, claim ids |
| Top-N Lens | Standard assurance: only top **2** drafts get platform review; rest SKIP to judge. Thorough reviews all |

## Settings

- Automation → team thoroughness dial **1–5** (`agentCouncilSize`, default **3**)
- Quality checks → Standard vs Thorough (`HIGH_ASSURANCE`)

## Code map

```
docs/enterprise-agent-council-plan.md
packages/agent-council/src/stages/council.ts     stageCouncilSize, councilPrefs
packages/agent-council/src/stages/shared.ts      skillSummariesFor, skill budgets,
                                                 claimsIdsText, runContextPack,
                                                 draftsForPlatformReview
packages/agent-council/src/stages/{research,strategy,review,judge,writers,adapt,…}.ts
apps/web/.../automation-settings.tsx             Select 1–5
```

## Packaging (SaaS)

| Capability | Starter | Growth | Enterprise |
| --- | --- | --- | --- |
| Seven agents | Yes | Yes | Yes |
| Default width | 1 | 3 | 3 (max 5) |
| Thorough assurance | No | Yes | Default for regulated |
| Approval | Optional | Required | Forced |

## Next (Phase 3+)

- Plan entitlements / forced approval by tier
- Audit export API
- Budget webhooks
- Optional Scout topic playbooks
- Shared context pack wired into more prompts (judge already can use compact claims)

## Non-goals

- Default width 5 for all tenants  
- Tools on every agent  
- Auto-publish with no org policy  
