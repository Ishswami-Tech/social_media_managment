# Agent Council — implementation specification

Autonomous campaign pipeline for the Social AI Platform. The AI layer produces a
**recommendation per connected account**; approval and publishing stay in the
existing deterministic `Post → PublishJob → provider` path. **An LLM never calls a
social API.**

```
Campaign brief ─▶ RESEARCHING ─▶ claims ledger ─▶ STRATEGIZING (one strategy per account)
  ─▶ DRAFTING (2–3 writers on different providers) ─▶ REVIEWING (deterministic checks,
  revision agent only on failures, cross-review only in HIGH_ASSURANCE) ─▶ JUDGING (blind
  judge: labels A/B/C, no provider/model/cost) ─▶ ADAPTING (synthesis + platform-native
  adaptation + media concept per account) ─▶ AWAITING_APPROVAL | APPROVED (policy)
  ─▶ PUBLISHING (application creates Post/variants, existing publisher) ─▶ COMPLETED
Side states: PAUSED (user), BLOCKED (token expired, budget exceeded, missing media…), FAILED (retryable → QUEUED)
```

## Folder structure

```
packages/types/src/agent.ts            run statuses, transitions, enums (done)
packages/agent-council/
  src/contracts.ts                     ports & data contracts (done)
  src/prompts/registry.ts              versioned prompts: key, version, template, sha256 hash
  src/prompts/*.ts                     prompt templates (research, claims, strategy, writer, revision, judge, synthesis, adapt)
  src/checks/*.ts                      deterministic checks (length, urls, pii, banned phrases, duplicates, claims, platform rules)
  src/stages/research.ts               runAgent with research tools → Brief; extract claims → ClaimRecord[]
  src/stages/strategy.ts               per-account strategy from brief + claims + Account Brain
  src/stages/writers.ts                N writers across providers (allow-list aware), circuit-breaker aware, budget reserve/settle
  src/stages/review.ts                 checks → revision agent for failures; HIGH_ASSURANCE cross-review
  src/stages/judge.ts                  blind judge (labels only) with rubric, must not be a writer provider when possible
  src/stages/synthesis.ts              winner + borrowed elements → final text
  src/stages/adapt.ts                  platform-native adaptation using PlatformCapabilities; media concept per account
  src/pipeline.ts                      advance(runId): executes the next stage, persists via store, emits events
  src/budget.ts                        cost estimation helpers (cents) from usage & catalogue
  src/circuit-breaker.ts               in-memory breaker used by ProviderHealthPort implementations
  test/*.test.ts                       every stage with the fakes in test/helpers; pipeline end-to-end with in-memory store
packages/queue/src/jobs.ts             agent-run + dead-letter queues (done)
apps/web/lib/agent/
  store.ts                             Prisma AgentRunStore
  budget.ts                            BudgetPort (BudgetReservation rows, monthly cap, per-run cap)
  provider-health.ts                   ProviderHealthPort (ProviderHealth rows)
  runs.ts                              createRun, pause/resume/cancel/retry, approve/reject per account, policy gate
  apply.ts                             approved recommendation → Post + PostVariant(+media) → schedule (existing services/posts)
  tokens.ts                            HMAC approval tokens (hash stored, consumed on POST only)
  learning.ts                          PostFeatures extraction, statistically gated Account Brain updates, human-edit signals
  context.ts                           builds PipelineContext for an organization (aiRuntime, tools, ports)
apps/web/lib/workers/agent-run.ts      BullMQ processor: advance until a waiting state; retries; dead-letter on exhaustion
apps/web/app/api/agent/runs/...        REST (below)
apps/web/app/(app)/agent/...           Campaigns list, new campaign, run detail (replay timeline + per-account approval)
apps/web/app/approve/[token]/...       GET confirmation page → POST consume
apps/web/app/(admin)/admin/queues      dead-letter inspection + retry
```

## State machine

`@platform/types` `AGENT_RUN_TRANSITIONS`; every status change calls `assertRunTransition`.
`PAUSED`/`BLOCKED` store `resumeStatus`. `FAILED → QUEUED` is the only retry path; the worker
increments `attempt`; after 3 attempts the job goes to `dead-letter`.

## Budget

`reserve(org, run, cents)` inserts a `BudgetReservation(RESERVED)` inside a transaction that
checks `sum(RESERVED + SETTLED this month) + cents ≤ agentMonthlyBudgetCents` and
`run.spentCents + reserved ≤ run.maxCents`; `settle(id, actual)` writes actualCents; `release`
marks RELEASED. Stages reserve an estimate before each model call and settle after.

## Circuit breaker

Per provider: 5 failures in 60 s → OPEN for 120 s → HALF_OPEN (one probe) → CLOSED. Writers skip
OPEN providers; if all are open the run becomes BLOCKED ("providers unavailable").

## Blind judge

Input: `[{ candidate: "A", text }, …]` only. Rubric: goal fit, hook strength, clarity, platform
fit, claim discipline, brand voice. Output JSON `{ winner, scores[], borrow[] }`. The judge model
is chosen from a provider that did not write, when any is available.

## Checks (deterministic, no model)

length ≤ capabilities.text.maxLength; URLs must be http(s) and appear in claim sources or the
brief; no emails/phones (PII) unless present in the brief; banned phrases from Account Brain
`voice.forbiddenLanguage`; forbidden topics; hashtags ≤ platform limit (30 IG, 5 LI recommended);
duplicate detection against the organization's last 50 published texts (Jaccard ≥ 0.8 → fail);
every numeric/percentage claim must map to a SUPPORTED claim id or be flagged; platform rules
(Instagram needs media).

## API

```
POST   /api/agent/runs                    { topic, goal, audience?, notes?, socialAccountIds[], assurance?, scheduledAt?, maxCents? }
GET    /api/agent/runs?status=&page=      list
GET    /api/agent/runs/:id                run + accounts + drafts + events (replay)
POST   /api/agent/runs/:id/pause | resume | cancel | retry
POST   /api/agent/runs/:id/decide         { accountIds[], decision: APPROVED|REJECTED, comment?, editedText? }  (content:approve)
GET    /approve/:token                    confirmation page (no side effects)
POST   /api/agent/approve                 { token, decision, accountIds[] } consumes the token, checks permission, applies decision
GET    /api/admin/dead-letter, POST /api/admin/dead-letter/:id/retry (Super Admin)
```

## Automatic publishing policy (all must hold)

organization `agentPublishMode = AUTOMATIC` ∧ creator has `content:publish` ∧ every target
account `agentAutoPublish` ∧ run `publishMode = AUTOMATIC` ∧ all checks passed ∧ budget not
exceeded ∧ no policy violation. Otherwise `AWAITING_APPROVAL` (or MANUAL: recommendation only).

## Learning (Account Brain)

After publish + ≥ 3 days, when ≥ 200 impressions and ≥ 5 samples for the account: compute
feature performance with recency weighting and only update `performance` when the difference
from baseline is ≥ 1 standard error. Human edits diff `finalText` vs `editedText` → weighted
preference (`weight 0.3`, capped list of 20, decays). Rejections with comments → preference.

## Security

RBAC: `ai:generate` to create runs, `content:approve` to decide, `content:publish` for
AUTOMATIC. Tenant isolation on every query. Approval tokens: 32 random bytes, sha256 stored,
7-day expiry, single use, bound to run+user+org+accountIds. Prompts never include secrets;
tool outputs are truncated; PII check on outputs; claim verification before approval.

## Implementation order

1. contracts, schema, state machine (done)  2. prompts + checks + stages + pipeline with tests
3. ports (store/budget/health) + worker + DLQ  4. API + UI + approval flow + apply
5. learning + admin observability  6. e2e run against real providers, docs.
