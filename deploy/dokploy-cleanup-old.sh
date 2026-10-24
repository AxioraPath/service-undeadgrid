#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
OLD_APP="gCCTqgfb9UMnUI57IqsUY"   # app 'server' (combinada, ya no se usa)

echo "=== detener la app server vieja ==="
cat > /tmp/stop.json <<JSON
{"applicationId":"$OLD_APP"}
JSON
curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' --data @/tmp/stop.json "$API/application.stop" ; echo

echo "=== eliminar la app server vieja (libera el dominio undeadgrid.axiorapath.com.mx) ==="
curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' --data @/tmp/stop.json "$API/application.delete" ; echo
rm -f /tmp/stop.json

echo "=== estado del proyecto ==="
curl -s -H "x-api-key: $KEY" "$API/project.all" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for p in d:
    if p['name']=='undeadgrid':
        for e in p.get('environments',[]):
            for a in e.get('applications',[]):
                print('APP',a['applicationId'],a['name'],a.get('applicationStatus'))
"
