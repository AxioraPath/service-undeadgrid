#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
PROJECT_ID="fTJKPtFTVgpENMMDX3bYB"
ENV_ID="ENMPpAXM-PIgifkS6uxl0"

create_app() {
  local name="$1" appname="$2" desc="$3"
  cat > /tmp/ug_na.json <<JSON
{"name":"$name","appName":"$appname","description":"$desc","projectId":"$PROJECT_ID","environmentId":"$ENV_ID"}
JSON
  echo "=== creando app '$name' ==="
  curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
    --data @/tmp/ug_na.json "$API/application.create" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print('applicationId =',d.get('applicationId'),' appName =',d.get('appName'))"
}

create_app "service" "undeadgrid-service" "Backend NestJS + Socket.IO"
create_app "web-app" "undeadgrid-webapp" "Frontend Vite (React)"
