#!/usr/bin/env bash
# End-to-end smoke test against a running `next start` on :3000 and a running worker.
# Usage: bash apps/web/scripts/smoke/run.sh  (requires `next start` on :3000 and the worker running,
# a freshly migrated + seeded database, and META_APP_SECRET=test-meta-app-secret / META_WEBHOOK_VERIFY_TOKEN=verify-me in apps/web/.env)
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
WORK=$(mktemp -d)
set -u
RUN=$(date +%s)
ADA="ada-$RUN@example.com"; BOB="bob-$RUN@example.com"; SLUG="acme-$RUN"; PNID="PN-$RUN"
BASE=http://localhost:3000
J=$WORK/cookies.txt
rm -f "$J"
pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; pass=$((pass+1)); else echo "FAIL  $1 expected=$2 got=$3"; fail=$((fail+1)); fi
}
req() { # method path [json]
  if [ $# -ge 3 ]; then curl -s -o $WORK/body -w "%{http_code}" -b "$J" -c "$J" -X "$1" -H "content-type: application/json" -H "origin: $BASE" "$BASE$2" -d "$3";
  else curl -s -o $WORK/body -w "%{http_code}" -b "$J" -c "$J" -X "$1" -H "origin: $BASE" "$BASE$2"; fi
}
jq_() { node -e "const b=require('fs').readFileSync('$WORK/body','utf8');let j;try{j=JSON.parse(b)}catch{process.stdout.write('');process.exit(0)};const v=($1)(j);process.stdout.write(v===undefined?'':String(v))"; }

echo "== health"
check "GET /api/health" 200 "$(req GET /api/health)"
check "anon /dashboard redirects" 307 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/dashboard)"
check "anon /api/posts 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/posts)"

echo "== auth"
check "sign-up" 200 "$(req POST /api/auth/sign-up/email '{"name":"Ada Lovelace","email":"'$ADA'","password":"correct-horse-battery"}')"
check "session" 200 "$(req GET /api/auth/get-session)"
USER_ID=$(jq_ 'j=>j.user.id')
check "no active org -> 403" 403 "$(req GET /api/organizations/settings)"

echo "== organization"
check "create org" 200 "$(req POST /api/auth/organization/create '{"name":"Acme Corp","slug":"'$SLUG'"}')"
ORG_ID=$(jq_ 'j=>j.id')
check "set active org" 200 "$(req POST /api/auth/organization/set-active "{\"organizationId\":\"$ORG_ID\"}")"
check "settings created by hook" 200 "$(req GET /api/organizations/settings)"
check "settings.requireApproval default" true "$(jq_ 'j=>j.settings.requireApproval')"
check "patch settings" 200 "$(req PATCH /api/organizations/settings '{"timezone":"Europe/London","requireApproval":true}')"
check "dashboard renders" 200 "$(req GET /dashboard)"
check "team page renders" 200 "$(req GET /team)"
check "invite member" 200 "$(req POST /api/auth/organization/invite-member '{"email":"'$BOB'","role":"EDITOR"}')"

echo "== seed a connected account (simulates OAuth callback persistence)"
ACCOUNT_ID=$(cd $ROOT/apps/web && ORG_ID=$ORG_ID USER_ID=$USER_ID PHONE_NUMBER_ID=$PNID pnpm exec tsx scripts/smoke/seed-account.mts 2>/dev/null | tail -1)
check "account seeded" 1 "$( [ -n "$ACCOUNT_ID" ] && echo 1 || echo 0 )"
check "list accounts" 200 "$(req GET /api/accounts)"
check "credential not exposed" "" "$(grep -o fake-token $WORK/body)"

echo "== post lifecycle"
check "create post" 201 "$(req POST /api/posts "{\"masterText\":\"Hello world from the platform\",\"variants\":[{\"socialAccountId\":\"$ACCOUNT_ID\"}]}")"
POST_ID=$(jq_ 'j=>j.post.id')
check "schedule before approval -> 409" 409 "$(req POST /api/posts/$POST_ID/schedule '{"scheduledAt":"2030-01-01T10:00:00Z"}')"
check "submit for review" 200 "$(req POST /api/posts/$POST_ID/submit)"
check "status IN_REVIEW" IN_REVIEW "$(jq_ 'j=>j.post.status')"
check "approve (owner may approve own)" 200 "$(req POST /api/posts/$POST_ID/review '{"decision":"APPROVED","comment":"looks good"}')"
check "status APPROVED" APPROVED "$(jq_ 'j=>j.post.status')"
check "publish now" 200 "$(req POST /api/posts/$POST_ID/publish)"
check "status QUEUED" QUEUED "$(jq_ 'j=>j.post.status')"
check "post page renders" 200 "$(req GET /posts/$POST_ID)"
check "invalid transition (submit again) -> 409" 409 "$(req POST /api/posts/$POST_ID/submit)"
check "validation error -> 400" 400 "$(req POST /api/posts '{"masterText":"x","variants":[]}')"
check "cross-tenant account -> 400" 400 "$(req POST /api/posts '{"masterText":"x","variants":[{"socialAccountId":"not-mine"}]}')"

echo "== auto-publish on approval"
check "create auto-publish post" 201 "$(req POST /api/posts "{\"masterText\":\"𝗕𝗼𝗹𝗱 launch • bullet #coffee\",\"autoPublishOnApproval\":true,\"variants\":[{\"socialAccountId\":\"$ACCOUNT_ID\"}]}")"
AUTO_ID=$(jq_ 'j=>j.post.id')
check "submit auto-publish post" 200 "$(req POST /api/posts/$AUTO_ID/submit)"
check "approve -> queued automatically" 200 "$(req POST /api/posts/$AUTO_ID/review '{"decision":"APPROVED"}')"
# The worker may pick the job up before the response is built, so any post-approval pipeline state counts.
check "status left review after approval" 1 "$(jq_ 'j=>["QUEUED","PUBLISHING","RETRYING","FAILED","PUBLISHED"].includes(j.post.status)?1:0')"
check "create scheduled auto-publish post" 201 "$(req POST /api/posts "{\"masterText\":\"Later #coffee\",\"autoPublishOnApproval\":true,\"scheduledAt\":\"2030-01-01T10:00:00Z\",\"variants\":[{\"socialAccountId\":\"$ACCOUNT_ID\"}]}")"
SCHED_ID=$(jq_ 'j=>j.post.id')
req POST /api/posts/$SCHED_ID/submit >/dev/null
check "approve scheduled -> queued for 2030" 200 "$(req POST /api/posts/$SCHED_ID/review '{"decision":"APPROVED"}')"
check "scheduledAt kept" 2030-01-01T10:00:00.000Z "$(jq_ 'j=>j.post.scheduledAt')"
check "status QUEUED (delayed job)" QUEUED "$(jq_ 'j=>j.post.status')"

echo "== research skills & connectors"
check "list skills + connectors" 200 "$(req GET /api/ai/research)"
check "five built-in skills" 5 "$(jq_ 'j=>j.skills.length')"
check "connector status listed" 2 "$(jq_ 'j=>j.connectors.length')"
check "search skill without connector -> 409" 409 "$(req POST /api/ai/research '{"skillId":"topic-research","input":"coffee trends","platforms":["LINKEDIN"]}')"
check "url skill without AI keys -> 400 ai" 400 "$(req POST /api/ai/research '{"skillId":"url-to-posts","input":"https://example.com","platforms":["LINKEDIN"]}')"
check "unknown skill -> 404" 404 "$(req POST /api/ai/research '{"skillId":"nope","input":"some topic","platforms":["LINKEDIN"]}')"
check "connector settings listed" 200 "$(req GET /api/organizations/connectors)"
check "bad connector key rejected" 400 "$(req POST /api/organizations/connectors '{"connector":"TAVILY","apiKey":"definitely-not-a-key"}')"

echo "== webhook (signed WhatsApp inbound)"
BODY='{"object":"whatsapp_business_account","entry":[{"id":"WABA1","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550001111","phone_number_id":"'$PNID'"},"contacts":[{"profile":{"name":"Grace"},"wa_id":"44770'$RUN'"}],"messages":[{"from":"44770'$RUN'","id":"wamid.'$RUN'","timestamp":"'$(date +%s)'","type":"text","text":{"body":"Hi, is the store open today?"}}]}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "test-meta-app-secret" | awk '{print $2}')
check "webhook verify handshake" 200 "$(curl -s -o $WORK/body -w '%{http_code}' "$BASE/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42")"
check "handshake echoes challenge" 42 "$(cat $WORK/body)"
check "webhook bad signature -> 401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'x-hub-signature-256: sha256=deadbeef' --data "$BODY" $BASE/api/webhooks/whatsapp)"
check "webhook signed -> 200" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H "x-hub-signature-256: sha256=$SIG" --data "$BODY" $BASE/api/webhooks/whatsapp)"
check "webhook duplicate -> 200 (idempotent)" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H "x-hub-signature-256: sha256=$SIG" --data "$BODY" $BASE/api/webhooks/whatsapp)"

echo "== media"
check "request upload" 201 "$(req POST /api/media '{"fileName":"dot.png","mimeType":"image/png","size":95}')"
ASSET_ID=$(jq_ 'j=>j.assetId'); UPLOAD_URL=$(jq_ 'j=>j.uploadUrl')
check "reject bad type" 400 "$(req POST /api/media '{"fileName":"x.exe","mimeType":"application/octet-stream","size":10}')"
(cd "$ROOT/packages/media" && node -e "require('sharp')({create:{width:640,height:400,channels:3,background:{r:30,g:120,b:200}}}).png().toFile(process.argv[1])" "$WORK/dot.png")
check "PUT to signed upload url" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J" -X PUT -H 'content-type: image/png' --data-binary @$WORK/dot.png "$UPLOAD_URL")"
check "key traversal rejected" 404 "$(curl -s -o /dev/null -w '%{http_code}' -b "$J" -X PUT --data-binary @$WORK/dot.png "$BASE/api/media/dev?key=../../etc/passwd")"
check "anon media GET rejected" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$UPLOAD_URL")"
check "complete upload" 200 "$(req POST /api/media/$ASSET_ID/complete)"

echo "== AI without keys"
check "ai generate -> 400 clear error" 400 "$(req POST /api/ai/generate '{"idea":"Launch of our new espresso machine","platforms":["LINKEDIN"]}')"
check "ai error code" ai "$(jq_ 'j=>j.error')"

echo "== waiting for worker (publish, webhook, media)"
sleep 8
check "post FAILED gracefully (no LinkedIn app configured)" FAILED "$(req GET /api/posts/$POST_ID >/dev/null; jq_ 'j=>j.post.status')"
check "attempt recorded" 1 "$(jq_ 'j=>j.post.variants[0].publishJobs[0].attemptCount')"
check "conversations from webhook" 1 "$(req GET /api/whatsapp/conversations >/dev/null; jq_ 'j=>j.total')"
CONV_ID=$(jq_ 'j=>j.items[0].id'); check "contact name from webhook" Grace "$(jq_ 'j=>j.items[0].contact.name')"
check "messages in conversation" 1 "$(req GET /api/whatsapp/conversations/$CONV_ID/messages >/dev/null; jq_ 'j=>j.messages.length')"
check "inbox page renders" 200 "$(req GET /whatsapp/inbox)"
check "outbound text queued (inside window)" 201 "$(req POST /api/whatsapp/messages "{\"conversationId\":\"$CONV_ID\",\"text\":\"We are open until 6pm!\"}")"
check "media READY" READY "$(req GET /api/media >/dev/null; jq_ 'j=>j.items[0].status')"
check "media thumbnail rendition" 1 "$(jq_ 'j=>j.items[0].variants && j.items[0].variants.thumbnail ? 1 : 0')"

echo "== RBAC: second user as VIEWER"
J2=$WORK/cookies2.txt; rm -f $J2
INV_ID=$(cd $ROOT/apps/web && ORG_ID=$ORG_ID pnpm exec tsx scripts/smoke/query.mts invitation 2>/dev/null | tail -1)
curl -s -o /dev/null -c $J2 -X POST -H 'content-type: application/json' -H "origin: $BASE" $BASE/api/auth/sign-up/email -d '{"name":"Bob","email":"'$BOB'","password":"another-long-password"}'
check "bob accepts invitation" 200 "$(curl -s -o $WORK/body -w '%{http_code}' -b $J2 -c $J2 -X POST -H 'content-type: application/json' -H "origin: $BASE" $BASE/api/auth/organization/accept-invitation -d "{\"invitationId\":\"$INV_ID\"}")"
curl -s -o /dev/null -b $J2 -c $J2 -X POST -H 'content-type: application/json' -H "origin: $BASE" $BASE/api/auth/organization/set-active -d "{\"organizationId\":\"$ORG_ID\"}"
check "editor cannot approve -> 403" 403 "$(curl -s -o $WORK/body -w '%{http_code}' -b $J2 -X POST -H 'content-type: application/json' $BASE/api/posts/$POST_ID/review -d '{"decision":"APPROVED"}')"
check "editor cannot change settings -> 403" 403 "$(curl -s -o /dev/null -w '%{http_code}' -b $J2 -X PATCH -H 'content-type: application/json' $BASE/api/organizations/settings -d '{"timezone":"UTC"}')"
check "editor can list posts" 200 "$(curl -s -o /dev/null -w '%{http_code}' -b $J2 $BASE/api/posts)"
check "editor cannot publish -> 403" 403 "$(curl -s -o /dev/null -w '%{http_code}' -b $J2 -X POST $BASE/api/posts/$POST_ID/publish)"
check "non-admin /admin redirected" 307 "$(curl -s -o /dev/null -w '%{http_code}' -b $J2 $BASE/admin)"
check "non-admin /api/admin/stats -> 403" 403 "$(curl -s -o /dev/null -w '%{http_code}' -b $J2 $BASE/api/admin/stats)"

echo "== super admin"
(cd "$ROOT/packages/database" && SEED_ADMIN_EMAIL=$ADA pnpm exec tsx prisma/seed.ts >/dev/null 2>&1)
req POST /api/auth/sign-out >/dev/null; rm -f "$J"
check "re-login as promoted admin" 200 "$(req POST /api/auth/sign-in/email '{"email":"'$ADA'","password":"correct-horse-battery"}')"
req POST /api/auth/organization/set-active "{\"organizationId\":\"$ORG_ID\"}" >/dev/null
check "admin overview renders" 200 "$(req GET /admin)"
check "admin stats" 200 "$(req GET /api/admin/stats)"
check "admin queues" 200 "$(req GET /api/admin/queues)"
check "admin organizations page" 200 "$(req GET /admin/organizations)"
check "admin users page" 200 "$(req GET /admin/users)"
check "admin audit page" 200 "$(req GET /admin/audit-logs)"
echo "== analytics export (feature flag)"
check "export disabled -> 403" 403 "$(req GET '/api/analytics/export?days=30')"
check "admin enables flag" 200 "$(req PUT /api/admin/feature-flags '{"key":"analytics_export","description":"CSV export of analytics","enabled":true,"organizationIds":[]}')"
check "export enabled -> 200 csv" 200 "$(req GET '/api/analytics/export?days=30')"
check "csv header row" 1 "$(head -1 $WORK/body | grep -c '^postId,title,platform')"
check "admin disables flag" 200 "$(req PUT /api/admin/feature-flags '{"key":"analytics_export","description":"CSV export of analytics","enabled":false,"organizationIds":[]}')"
check "analytics page renders" 200 "$(req GET /analytics)"
check "suspend org" 200 "$(req PATCH /api/admin/organizations/$ORG_ID '{"status":"SUSPENDED"}')"
check "editor blocked on suspended org" 403 "$(curl -s -o /dev/null -w '%{http_code}' -b $J2 $BASE/api/posts)"
check "reactivate org" 200 "$(req PATCH /api/admin/organizations/$ORG_ID '{"status":"ACTIVE"}')"
AUDIT=$(cd $ROOT/apps/web && pnpm exec tsx scripts/smoke/query.mts audit 2>/dev/null | tail -1)
echo "webhook events: $(cd $ROOT/apps/web && pnpm exec tsx scripts/smoke/query.mts webhooks 2>/dev/null | tail -1)"
echo "audit rows: $AUDIT"
check "audit trail non-empty" 1 "$( [ "${AUDIT%% *}" -gt 10 ] && echo 1 || echo 0 )"

echo; echo "RESULT: $pass passed, $fail failed"
