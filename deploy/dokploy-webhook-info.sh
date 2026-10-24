#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
APP_ID="gCCTqgfb9UMnUI57IqsUY"

echo "=== refreshToken ==="
curl -s -H "x-api-key: $KEY" "$API/application.one?applicationId=$APP_ID" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('refreshToken'))"

echo "=== dominio del panel Dokploy (serverIp / url) ==="
# Dokploy guarda su propia URL en settings; probamos varios endpoints.
for ep in admin.one user.get settings.getDokployCloud; do
  echo "- $ep:"
  curl -s -H "x-api-key: $KEY" "$API/$ep" 2>/dev/null | head -c 300
  echo
done

echo "=== hosts en traefik dynamic (incluye panel si tiene dominio) ==="
sudo grep -rhoE 'Host\(`[^`]+`\)' /etc/dokploy/traefik 2>/dev/null | sort -u
