#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"

deploy() {
  cat > /tmp/dep.json <<JSON
{"applicationId":"$1"}
JSON
  echo "=== deploy $2 ==="
  curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' --data @/tmp/dep.json "$API/application.deploy"
  echo " (encolado)"
}

deploy "chw-Qan1keU9lQNSD1S2R" "service (backend)"
deploy "Ntx4JeON7uTlZP-E5e-cp" "web-app (frontend)"
rm -f /tmp/dep.json
