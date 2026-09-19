# Working in this repository

pnpm + Turborepo monorepo. Node 22. Run `pnpm install`, `pnpm db:generate`, then `pnpm typecheck && pnpm lint && pnpm test`.

- `apps/web` is the Next.js 16 app (App Router). API handlers live under `app/api/**/route.ts` and must use
  `withOrg`/`withUser`/`withSuperAdmin` from `lib/api.ts`; business logic lives in `lib/services/*`.
- Organization-scoped data must be queried with an `organizationId` filter; `withTenantGuard` throws otherwise.
- Never log or return tokens/keys. Use the `Keyring` from `@platform/encryption` for anything secret at rest.
- Post status transitions go through `assertTransition` (`@platform/types`). Publishing is idempotent per `PublishJob`.
- New social platforms: implement `SocialProvider` in a `packages/social-*` package and register it in
  `apps/web/lib/providers.ts`. New AI providers implement `AIProvider` and register in `apps/web/lib/ai.ts`.
- UI uses shadcn/ui components in `apps/web/components/ui` (vendored; `components.json` is configured for the CLI).
- Schema changes: edit `packages/database/prisma/schema.prisma`, run `pnpm db:migrate --name <change>`.
