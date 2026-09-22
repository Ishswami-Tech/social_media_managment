# Social AI Platform

AI-powered social media & WhatsApp management platform: a multi-tenant SaaS where organizations connect
social and messaging accounts, create and schedule content, generate copy and images with OpenAI / Anthropic /
Google, publish through provider adapters, run a shared WhatsApp inbox, and monitor everything from one
dashboard. This repository implements the architecture specification (v1.0) as a pnpm + Turborepo monorepo.

## Stack

| Concern    | Choice                                                               |
| ---------- | -------------------------------------------------------------------- |
| Web / API  | Next.js 16 (App Router, Route Handlers, `proxy.ts`), React 19        |
| Auth       | better-auth (email/password, `admin` + `organization` plugins)       |
| UI         | Tailwind CSS 4 + shadcn/ui (vendored under `apps/web/components/ui`) |
| Validation | Zod (env, API bodies, AI structured output)                          |
| Database   | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`)                         |
| Queues     | Redis + BullMQ (publish, webhooks, media, WhatsApp, campaigns, cron) |
| Media      | Cloudflare R2 / S3 (signed URLs), sharp renditions                   |
| Encryption | AES-256-GCM keyring with key rotation for tokens and BYO API keys    |
| Tooling    | TypeScript 5.9, ESLint 9, Prettier, Vitest, Turbo, Docker, GitHub CI |

## Repository layout

```
apps/web                      Next.js app: pages, API routes, lib/services, workers/
packages/types                Shared enums (roles, platforms, post states, WhatsApp, AI)
packages/config               Zod-validated environment loader
packages/encryption           Keyring (AES-256-GCM), HMAC helpers, secret redaction
packages/rbac                 Permission matrix (§4.9) with per-org configurable grants
packages/database             Prisma schema, migrations, lazy client, tenant guard, credentials
packages/social-core          SocialProvider contract (§10), registry, validation, errors, OAuth/PKCE
packages/social-linkedin      LinkedIn adapter (member + organization publishing, media upload)
packages/social-meta          Meta OAuth, Facebook Pages, Instagram publishing, webhook signature
packages/whatsapp             WhatsApp Cloud API client + webhook parser
packages/ai-core              AIProvider contract, ModelRouter, AIExecutor (failover), content operations
packages/ai-openai|anthropic|google   Provider implementations (text, image, embeddings, health)
packages/media                Upload validation, magic-byte sniffing, R2 storage, renditions
packages/queue                Queue names, job payloads, backoff/retry policy, BullMQ registry
docker/                       Dockerfiles for web and worker; docker-compose.yml at the root
```

## Getting started

```bash
cp .env.example apps/web/.env            # fill in secrets (see below)
cp .env.example packages/database/.env   # only DATABASE_URL is needed here
pnpm install
pnpm db:generate                         # Prisma client
pnpm db:migrate                          # applies prisma/migrations (creates the DB schema)
pnpm db:seed                             # plans, AI model catalogue, feature flags
pnpm --filter web dev                    # http://localhost:3000
pnpm --filter web worker:dev             # BullMQ workers (separate process)
```

Generate secrets:

```bash
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY (exactly 32 bytes)
```

First run: register at `/register`, create an organization, then promote yourself to Super Admin:

```bash
SEED_ADMIN_EMAIL=you@example.com pnpm db:seed
```

### Quickest way to try the UI (Docker)

```bash
cp .env.example .env
# set AUTH_SECRET and ENCRYPTION_KEY in .env (see "Generate secrets" above); APP_URL=http://localhost:3000
docker compose up --build
```

This starts Postgres, Redis, the web app and the worker. The worker applies migrations and the seed on
start, so once `web` is healthy open http://localhost:3000/register. Everything else is optional:
without LinkedIn/Meta app credentials the connect buttons will report the provider as not configured,
and without AI providers the AI features explain that a provider must be added first. To promote your account
to Super Admin set `SEED_ADMIN_EMAIL=you@example.com` in `.env` and restart the worker
(`docker compose restart worker`).

There is no mock or demo data: every model, post, metric and recommendation in the UI comes from a real
provider, a real connected account or your own database. Add AI providers under Super Admin → AI providers
(any number of OpenAI, Anthropic, Google or OpenAI-compatible gateways with their own keys and URLs) or per
organization under Settings → AI.

### Models come from your providers, not a list

The model pickers (composer, AI Studio, Settings defaults) are discovered live from whichever provider
endpoints the organization can reach: an AI connection (any Anthropic- or OpenAI-compatible gateway),
a bring-your-own key, or the platform keys. A configured gateway takes precedence for its provider, so
the picker shows exactly what that gateway serves. The Super Admin catalogue only supplies pricing for
automatic routing and acts as a fallback when a provider cannot be listed. Results are cached for ten
minutes per endpoint.

### Skills (importable playbooks)

Settings → Skills imports Agent-Skills style playbooks (a `SKILL.md` with frontmatter plus optional
`references/*.md`) from any GitHub repository, folder or file URL, for example
https://github.com/sergebulaev/linkedin-skills. You can also write one by hand. Enabled skills appear
next to the built-in research skills in the composer's "+" menu and in the Research dialog; the model
follows the skill's instructions and returns platform-ready posts you can drop into the composer.

Skills can also be attached to ordinary AI actions: pick them under "Skills · attach to every AI action" in
the composer's "+" menu (chips show what is attached), or switch a skill to "always" in Settings so it is
injected into every generate, rewrite, shorten, expand, hashtags and calendar call for the organization.

### Plugins (tools the model can call)

Settings → Plugins registers MCP servers (streamable HTTP; every tool the server lists becomes available)
or single HTTP endpoints (one tool; arguments are sent as JSON). Plugins are offered to every skill run,
so a skill can look up your CRM, search an internal index or call any API you expose. Request headers are
encrypted at rest and each plugin is connection-tested when saved.

### Post history and removal

Every post page shows a timeline (created, edited, submitted, approved/rejected, scheduled, each publish
attempt with the provider's error, removal) built from the audit log and publish attempts. Published
posts can be removed from LinkedIn and Facebook with "Remove from platform", which moves the post to
the `DELETED` status; Instagram's API does not support deleting posts.

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `APP_URL`.
Optional integrations: `LINKEDIN_CLIENT_ID/SECRET` (plus `LINKEDIN_API_VERSION`, a YYYYMM value to bump when LinkedIn retires the default), `META_APP_ID/SECRET`, `META_WEBHOOK_VERIFY_TOKEN`,
`R2_*`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`, `RESEND_API_KEY`/`EMAIL_FROM`, `SENTRY_DSN`. Without R2 the app falls back
to in-memory media storage for development.

Provider console settings:

- LinkedIn redirect URL: `${APP_URL}/api/oauth/linkedin/callback`
- Meta redirect URL: `${APP_URL}/api/oauth/meta/callback`
- Meta / WhatsApp webhook URL: `${WEBHOOK_BASE_URL}/api/webhooks/meta` (verify token = `META_WEBHOOK_VERIFY_TOKEN`)

## How the pieces map to the specification

- **Tenancy & roles (§3–4).** better-auth's organization plugin owns `Organization`, `Member`, `Invitation` and the
  active organization on the session. Roles are `OWNER | ADMIN | MANAGER | EDITOR | APPROVER | MEMBER | VIEWER`.
  Super Admin is the better-auth admin role (`user.role = "admin"`), never an org membership. Domain capabilities
  are enforced by `@platform/rbac`; "Configured" cells of the matrix are toggled per organization in Settings.
- **Tenant isolation (§21, §32).** `withTenantGuard` (packages/database/src/tenant.ts) throws if any
  organization-owned table is queried without an `organizationId` filter. All API handlers go through
  `withOrg(req, capability, …)` which resolves the active organization and checks the capability.
- **Connecting accounts (§9).** `/api/oauth/{linkedin|meta}/start` creates a single-use, expiring `OAuthState`
  bound to org + user; the callback exchanges the code, discovers every account (LinkedIn member + admin'd
  organizations; every Facebook Page and linked Instagram account) and stores each one with its own
  encrypted credential (`SocialCredential`, AAD-bound to the account id).
- **Content lifecycle (§13–15).** `Post` → `PostVariant` per account. Transitions are validated by
  `assertTransition`. Scheduling creates one idempotent `PublishJob` per variant (`idempotencyKey`), enqueued in
  BullMQ with the same id. The publish worker (`lib/services/publishing.ts`) refreshes tokens, validates against
  platform capabilities, publishes through the adapter, records `PublishAttempt`s, retries transient errors with
  jittered exponential backoff, and marks accounts `EXPIRED` on auth failures (post → `DISCONNECTED_ACCOUNT`).
- **AI (§11–12).** `ModelRouter` resolves user → organization → platform → automatic (cheapest capable model);
  `AIExecutor` fails over across providers on transient errors and meters every call into `AIUsage`.
  Organizations can bring their own keys (encrypted). Brand voice, rules and a keyword-retrieved slice of the
  knowledge base are injected into prompts, scoped to the organization.
- **WhatsApp (§16–17).** Modelled as a messaging/CRM domain: `WhatsAppAccount`, `Contact`, `Conversation`,
  `Message`, `WhatsAppTemplate`, `Campaign`, `Automation`. Inbound webhooks are signature-verified, stored
  idempotently (`WebhookEvent`), and processed by the webhook worker. The inbox enforces the 24-hour service
  window (templates only outside it), supports assignment, notes, AI-suggested replies with human approval,
  keyword automations and template campaigns.
- **Media (§19).** Signed upload → `MediaAsset` → media worker (checksum de-dup, EXIF stripping, thumbnail,
  Instagram/LinkedIn/Facebook renditions).
- **Analytics (§20).** Adapters expose `getPostMetrics` / `getAccountMetrics` (LinkedIn organization pages,
  Facebook Pages, Instagram). A maintenance job fans out an analytics job per connected account and per post
  published in the last 30 days every 6 hours; results land in `AnalyticsSnapshot` (normalised subset + raw).
  CSV export at `/api/analytics/export` is gated by the `analytics_export` feature flag.
- **Email.** Invitations are sent through Resend when `RESEND_API_KEY` is set; otherwise the message (with the
  accept link) is logged.
- **Super Admin console (§22).** `/admin`: overview, organizations (suspend/plan), users (promote, ban,
  audited impersonation), AI model catalogue + health checks, social integration status, queues & webhooks,
  feature flags, audit logs.

## Deploying

### Vercel (web app + cron-driven worker)

The app is a standard Next.js project; `apps/web/vercel.json` holds the monorepo build commands and a cron that calls
`/api/internal/drain` every minute to process queued jobs for ~50 s (BullMQ workers run in short bursts because Vercel
has no long-lived processes). Per-minute crons need the Pro plan; on Hobby, run the worker elsewhere (see below).

1. Import the repository in Vercel with **Root Directory = `apps/web`** (framework: Next.js).
2. Provision Postgres (Neon, Supabase, Vercel Postgres) and Redis (Upstash, Redis Cloud). Use a TLS `rediss://` URL.
3. Set environment variables: `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `APP_URL`
   (`https://<your-domain>`), `CRON_SECRET` (Vercel sends it as `Authorization: Bearer`), the `R2_*` block
   (required: Vercel's filesystem is ephemeral), plus any provider/AI/search keys.
4. Run migrations once against the production database: `DATABASE_URL=... pnpm db:deploy && pnpm db:seed`.
5. Deploy. Then register your email, create an organization, and promote yourself with
   `SEED_ADMIN_EMAIL=you@example.com pnpm db:seed` against the production database.

### Docker / Coolify / any VM

`docker compose up --build` runs Postgres, Redis, the web app and a persistent worker (`docker/Dockerfile.worker`
applies migrations on start). Point Cloudflare at the web service and set the same environment variables.

## Scripts

```bash
pnpm typecheck   # tsc across all packages and the app
pnpm lint        # ESLint (packages + app)
pnpm format      # Prettier
pnpm test        # Vitest across the workspace
pnpm --filter web build
```

## Roadmap status

Phases 0–7 of the roadmap are implemented end to end (foundation, RBAC + Super Admin, LinkedIn, Meta, AI Studio,
scheduler, WhatsApp, analytics collection + export). Phase 8 providers (X, TikTok, YouTube, Threads, Pinterest) plug into the existing
`SocialProvider` contract and registry. Phase 9 has plans, quotas and feature flags modelled; billing is not wired.
