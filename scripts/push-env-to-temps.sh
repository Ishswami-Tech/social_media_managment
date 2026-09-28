#!/usr/bin/env bash
# Copy secrets from a local .env into the Temps projects that run this app.
#
# The values are read from the file and sent straight to the Temps API. They
# are never printed, so nothing lands in a terminal history, a log or a chat
# transcript. Only key names and HTTP codes are shown.
#
#   TEMPS_API_URL=https://deploy.dataspacesecurity.com \
#   TEMPS_API_TOKEN=... \
#   ./scripts/push-env-to-temps.sh apps/web/.env 6 7
#
# The token comes from the server: jq -r .api_key ~/.temps/setup-result.json
# Redeploy both projects afterwards; environment changes reach a container
# only when it is recreated.
set -euo pipefail

ENV_FILE="${1:-apps/web/.env}"
shift || true
PROJECTS=("$@")
[ ${#PROJECTS[@]} -eq 0 ] && PROJECTS=(6 7)

: "${TEMPS_API_URL:?set TEMPS_API_URL, e.g. https://deploy.dataspacesecurity.com}"
: "${TEMPS_API_TOKEN:?set TEMPS_API_TOKEN}"
[ -f "$ENV_FILE" ] || { echo "no such file: $ENV_FILE" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

# Only what production needs. Local-only conveniences (MEDIA_LOCAL_DIR,
# LOG_LEVEL) and anything the deployment already sets for itself (DATABASE_URL,
# REDIS_URL, APP_URL, AUTH_SECRET, ENCRYPTION_KEY) are deliberately absent:
# copying those from a laptop would point production at a laptop's database.
WANTED=(
  ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
  OPENAI_API_KEY GOOGLE_AI_API_KEY META_AI_API_KEY META_AI_BASE_URL
  HUGGINGFACE_API_KEY POLLINATIONS_API_KEY
  LINKEDIN_CLIENT_ID LINKEDIN_CLIENT_SECRET
  TAVILY_API_KEY BRAVE_SEARCH_API_KEY
  RESEND_API_KEY EMAIL_FROM
  S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_PUBLIC_BASE_URL
  CRON_SECRET
)

# Keys whose value is not a secret, so they stay readable in the dashboard.
is_public () {
  case "$1" in
    *_BASE_URL|S3_ENDPOINT|S3_REGION|S3_BUCKET|EMAIL_FROM|LINKEDIN_CLIENT_ID) return 0 ;;
    *) return 1 ;;
  esac
}

read_value () { # key -> value from the env file, quotes stripped
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

for project in "${PROJECTS[@]}"; do
  echo "project $project"
  existing=$(curl -fsS -H "Authorization: Bearer $TEMPS_API_TOKEN" "$TEMPS_API_URL/api/projects/$project/env-vars")
  for key in "${WANTED[@]}"; do
    value=$(read_value "$key")
    [ -z "$value" ] && continue
    secret=true; is_public "$key" && secret=false
    id=$(printf '%s' "$existing" | jq -r --arg k "$key" '.[] | select(.key==$k) | .id' | head -1)
    body=$(jq -n --arg k "$key" --arg v "$value" --argjson e "[$project]" --argjson s "$secret" \
      '{key:$k,value:$v,environment_ids:$e,is_secret:$s}')
    if [ -n "$id" ]; then
      code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $TEMPS_API_TOKEN" \
        -H 'Content-Type: application/json' -d "$body" "$TEMPS_API_URL/api/projects/$project/env-vars/$id")
      printf '  %-24s updated %s\n' "$key" "$code"
    else
      code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $TEMPS_API_TOKEN" \
        -H 'Content-Type: application/json' -d "$body" "$TEMPS_API_URL/api/projects/$project/env-vars")
      printf '  %-24s added   %s\n' "$key" "$code"
    fi
  done
done

echo
echo "Redeploy both projects so the containers pick the new values up:"
for project in "${PROJECTS[@]}"; do
  echo "  curl -X POST -H \"Authorization: Bearer \$TEMPS_API_TOKEN\" -H 'Content-Type: application/json' \\"
  echo "    -d '{\"environment_id\":$project,\"branch\":\"main\"}' \"\$TEMPS_API_URL/api/projects/$project/trigger-pipeline\""
done
