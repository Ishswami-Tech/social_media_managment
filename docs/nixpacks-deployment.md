# Deploy with Nixpacks

Use two services from this repository: a web app and an always-running worker.
Both build from the **repository root** so pnpm workspace packages are available.
Choose the Nixpacks build pack in your host instead of a custom Dockerfile.
Nixpacks generates a container image internally; it removes the need to maintain
your own Dockerfile, but it is not a container-free deployment.

Nixpacks is in [maintenance mode](https://nixpacks.com/docs/getting-started).
These configurations are for hosts that still support it, such as a compatible
Coolify installation. Vercel uses its own Next.js build system and does not use
these files.

## Services

| Setting                     | Web                          | Worker                                      |
| --------------------------- | ---------------------------- | ------------------------------------------- |
| Build context               | Repository root              | Repository root                             |
| Config file                 | `nixpacks.toml` (automatic)  | `nixpacks.worker.toml`                      |
| Config environment variable | Not needed                   | `NIXPACKS_CONFIG_FILE=nixpacks.worker.toml` |
| Public port                 | `3000`, or the host's `PORT` | None                                        |
| Health check                | `/api/health`                | Process health; no HTTP health check        |

The web build generates Prisma, builds Next.js and copies public/static assets
into the standalone output. Its start command runs the standalone server on
`0.0.0.0`. The worker generates Prisma and runs `pnpm worker`, with FFmpeg
available. Both use Node 22 and the pnpm version in `package.json`. Keep dev
dependencies installed: Prisma CLI, tsx and dotenv are needed by deployment and
worker commands.

Leave install/build/start command overrides empty in your hosting dashboard so
the files control them. Host environment overrides take precedence over the
configuration files.

## Environment and data services

Provision PostgreSQL and a BullMQ-compatible Redis service separately. Configure
both app services with the same `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`,
`ENCRYPTION_KEY`, `APP_URL`, and provider credentials from `.env.example`.
Use the public HTTPS app URL for `APP_URL` and `WEBHOOK_BASE_URL`.

Configure Contabo `S3_*` variables on both services and allow your app origin in
the bucket's CORS settings: see [Contabo setup](contabo-storage.md). Local media
storage is not shared between these services.

Make `DATABASE_URL` available during the build because Prisma's configuration
reads it during client generation. Supply any other environment required by the
app's build through the host's secret configuration; do not commit credentials
or put them in these TOML files. Builds do not run migrations or seed data.

## Database release step

Before starting the first web/worker deployment, run these commands once in a
release job using the built worker image, its environment and repository root:

```sh
pnpm db:deploy
pnpm db:seed
```

For subsequent deployments, run migrations once as a pre-deploy/release step;
rerun the idempotent seed when the application catalogue changes. The migration
job must reach PostgreSQL. The current Prisma configuration uses `DATABASE_URL`
for migrations, so give the job a direct database connection if runtime services
use a pooler. Set `SEED_ADMIN_EMAIL` if you use the seed's admin promotion.

Do not run migrations on every worker replica or during image builds. Start
both services after the release step succeeds. The persistent worker processes
queues continuously; the Vercel cron configuration is not used by Nixpacks.

## Validate and launch

With Nixpacks installed, inspect the resolved plans from the repository root:

```sh
nixpacks plan .
nixpacks plan . --config nixpacks.worker.toml
```

Confirm Node 22, the pinned pnpm install, the expected build/start commands, and
FFmpeg in the worker. Then deploy using your host, verify `/api/health`, sign in,
upload media, and check that the worker processes a scheduled job. Configure
automatic restarts and database backups in the host.
