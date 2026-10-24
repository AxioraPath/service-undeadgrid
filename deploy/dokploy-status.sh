#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
APP_ID="gCCTqgfb9UMnUI57IqsUY"

echo "=== estado de la app ==="
curl -s -H "x-api-key: $KEY" "$API/application.one?applicationId=$APP_ID" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('status =',d.get('applicationStatus'))"

echo "=== servicios swarm undeadgrid ==="
sudo docker service ls 2>/dev/null | grep -i undeadgrid || echo "(sin servicio todavia)"

echo "=== ultimo deployment ==="
curl -s -H "x-api-key: $KEY" "$API/deployment.all?applicationId=$APP_ID" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
if isinstance(d,list) and d:
    x=d[0]
    print('deployment status =',x.get('status'),' title=',x.get('title'))
    print('logPath =',x.get('logPath'))
else:
    print('(sin deployments)')
" 2>/dev/null || echo "(no se pudo leer deployments)"

# Muestra las ultimas lineas del log del build si existe.
LOG=$(ls -t /etc/dokploy/logs/*/*.log 2>/dev/null | head -1 || true)
echo "=== build log (buscando referencias a undeadgrid) ==="
sudo find /etc/dokploy -name '*.log' -newermt '-10 minutes' 2>/dev/null | xargs -r ls -t 2>/dev/null | head -3
