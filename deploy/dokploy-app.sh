#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
PROJECT_ID="fTJKPtFTVgpENMMDX3bYB"
ENV_ID="ENMPpAXM-PIgifkS6uxl0"

cat > /tmp/ug_appbody.json <<JSON
{"name":"server","appName":"undeadgrid-server","description":"Undead Grid front+back (mismo dominio)","projectId":"$PROJECT_ID","environmentId":"$ENV_ID"}
JSON

echo "=== application.create ==="
curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
  --data @/tmp/ug_appbody.json "$API/application.create" > /tmp/ug_appresp.json
cat /tmp/ug_appresp.json
echo
python3 - <<'PY'
import json
try:
    d=json.load(open('/tmp/ug_appresp.json'))
    aid=d.get('applicationId') or (d.get('data') or {}).get('applicationId')
    print('APP_ID', aid)
    open('/tmp/ug_app_id','w').write(aid or '')
except Exception as e:
    print('ERR', e)
PY
