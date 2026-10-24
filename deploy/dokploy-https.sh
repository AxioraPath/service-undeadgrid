#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
GH="${GH_TOKEN:?}"
APP_ID="gCCTqgfb9UMnUI57IqsUY"

# 1) Repo del backend por HTTPS con token embebido + build args con el token
#    para que el Dockerfile clone el frontend privado.
python3 - "$APP_ID" "$GH" <<'PY' > /tmp/ug_cfg.json
import json,sys
app,tok=sys.argv[1],sys.argv[2]
url=f"https://x-access-token:{tok}@github.com/AxioraPath/service-undeadgrid.git"
print(json.dumps({
  "applicationId": app,
  "sourceType": "git",
  "customGitUrl": url,
  "customGitBranch": "main",
  "customGitBuildPath": "/",
  "customGitSSHKeyId": None,
  "buildType": "dockerfile",
  "dockerfile": "Dockerfile",
  "buildArgs": f"GIT_TOKEN={tok}",
  "autoDeploy": True
}))
PY

echo "=== application.update ==="
curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
  --data @/tmp/ug_cfg.json "$API/application.update"; echo
rm -f /tmp/ug_cfg.json

echo "=== verificacion ==="
curl -s -H "x-api-key: $KEY" "$API/application.one?applicationId=$APP_ID" | python3 -c "
import sys,json
d=json.load(sys.stdin)
u=d.get('customGitUrl','') or ''
# ocultar token al imprimir
import re
print('customGitUrl =', re.sub(r':[^@/]+@',':***@',u))
print('buildType =', d.get('buildType'))
print('buildArgs set =', bool(d.get('buildArgs')))
print('autoDeploy =', d.get('autoDeploy'))
"
