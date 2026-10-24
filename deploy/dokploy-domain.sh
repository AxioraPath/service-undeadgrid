#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
APP_ID="gCCTqgfb9UMnUI57IqsUY"
HOST="undeadgrid.axiorapath.com.mx"

# ¿Ya existe el dominio?
EXIST="$(curl -s -H "x-api-key: $KEY" "$API/domain.byApplicationId?applicationId=$APP_ID" \
  | python3 -c "import sys,json
try:
 d=json.load(sys.stdin)
 print(any(x.get('host')=='$HOST' for x in d))
except: print(False)")"

if [ "$EXIST" = "True" ]; then
  echo "Dominio ya existe"
else
  cat > /tmp/ug_domain.json <<JSON
{"applicationId":"$APP_ID","host":"$HOST","path":"/","port":3000,"https":true,"certificateType":"letsencrypt","domainType":"application"}
JSON
  echo "=== domain.create ==="
  curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
    --data @/tmp/ug_domain.json "$API/domain.create"
  echo
fi

echo "=== dominios de la app ==="
curl -s -H "x-api-key: $KEY" "$API/domain.byApplicationId?applicationId=$APP_ID"
echo
