#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
APP_ID="gCCTqgfb9UMnUI57IqsUY"

cat > /tmp/ug_deploy.json <<JSON
{"applicationId":"$APP_ID"}
JSON

echo "=== application.deploy ==="
curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
  --data @/tmp/ug_deploy.json "$API/application.deploy"
echo
