# Deploy on Temps

[Temps](https://temps.sh) runs the two services from this repository. It looks
for a `Dockerfile` at the app directory before anything else and only invents
one from a framework preset when none exists, so `nixpacks.toml` and
`nixpacks.worker.toml` are **not** read here: the root `Dockerfile` is.

## Two projects, one repository

A Temps project deploys one service, so the web app and the worker are two
projects pointing at the same repository and branch. Both build the same
image; `SERVICE` decides which half of it runs.

| Setting            | Web                          | Worker                          |
| ------------------ | ---------------------------- | ------------------------------- |
| Project            | `social-media-web`           | `social-media-worker`           |
| App directory      | `.`                          | `.`                             |
| Branch             | `main`                       | `main`                          |
| `SERVICE`          | unset (defaults to the app)  | `worker`                        |
| Public URL         | yes                          | none                            |
| Health check       | `/api/health`                | none                            |

The worker's start command applies migrations and runs the idempotent seed
before it opens the queues, so no separate release job is needed.

## Environment

Set these on **both** projects, in the production environment:

| Variable                        | Notes                                                        |
| ------------------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`                  | The managed Postgres, reached by container name on `temps-app-network` |
| `REDIS_URL`                     | Dragonfly, same network, password included                    |
| `AUTH_SECRET`, `ENCRYPTION_KEY` | Mark as secrets. Generate once; the encryption key is what decrypts stored OAuth tokens, so changing it strands them |
| `APP_URL`, `WEBHOOK_BASE_URL`   | The web service's public HTTPS URL                            |
| `NODE_ENV`                      | `production`                                                  |
| `SERVICE`                       | Worker project only: `worker`                                 |

Then add the provider credentials the app needs from `.env.example`
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `META_AI_API_KEY`,
the LinkedIn app, `S3_*`, and so on). Without them the app runs but cannot
call a model or publish.

Secrets are injected at run time, not during the build. The build therefore
supplies its own placeholders for `AUTH_SECRET` and `ENCRYPTION_KEY`: Next
reads the environment as soon as a session helper is imported, and a build
has neither a request nor the real values.

## Dragonfly needs one flag

BullMQ's Lua scripts touch keys they do not declare, which Dragonfly refuses
by default: every worker dies with `script tried accessing undeclared key`.
Run Dragonfly with:

```
--default_lua_flags=allow-undeclared-keys
```

## DNS

Temps gives each environment a hostname under the apps domain, so that domain
needs a wildcard `A` record pointing at the server. The wildcard certificate
is issued separately and does not create the record.

## Checking a deployment

```bash
# newest deployment and its jobs
curl -s -H "Authorization: Bearer $TEMPS_API_TOKEN" "$TEMPS_API_URL/api/projects/<id>/deployments" | jq '.deployments[0].status'
curl -s -H "Authorization: Bearer $TEMPS_API_TOKEN" "$TEMPS_API_URL/api/projects/<id>/deployments/<dep>/jobs" | jq -r '.jobs[] | "\(.job_id) \(.status)"'

# start one
curl -s -X POST -H "Authorization: Bearer $TEMPS_API_TOKEN" -H 'content-type: application/json' \
  -d '{"environment_id":<env>,"branch":"main"}' "$TEMPS_API_URL/api/projects/<id>/trigger-pipeline"
```

Build logs are on the server under `~/.temps/data/logs/<project>/<environment>/…`.
