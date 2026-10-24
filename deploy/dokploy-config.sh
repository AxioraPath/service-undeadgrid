#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
APP_ID="gCCTqgfb9UMnUI57IqsUY"

post() { # endpoint  jsonfile
  echo "=== POST $1 ==="
  curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
    --data @"$2" "$API/$1"
  echo
}

# 1) Fuente: Custom Git (repo público HTTPS) + build por Dockerfile.
cat > /tmp/ug_git.json <<JSON
{"applicationId":"$APP_ID","customGitUrl":"https://github.com/AxioraPath/service-undeadgrid.git","customGitBranch":"main","customGitBuildPath":"/","sourceType":"git","buildType":"dockerfile","dockerfile":"Dockerfile","autoDeploy":true,"triggerType":"push"}
JSON
post "application.saveGitProvider" /tmp/ug_git.json || true

# Algunos builds de Dokploy exponen saveGitProdiver via application.update; probamos tambien update.
cat > /tmp/ug_upd.json <<JSON
{"applicationId":"$APP_ID","sourceType":"git","customGitUrl":"https://github.com/AxioraPath/service-undeadgrid.git","customGitBranch":"main","customGitBuildPath":"/","buildType":"dockerfile","dockerfile":"Dockerfile","autoDeploy":true}
JSON
post "application.update" /tmp/ug_upd.json || true

# 2) Build type explicito (por si update no lo tomó).
cat > /tmp/ug_build.json <<JSON
{"applicationId":"$APP_ID","buildType":"dockerfile","dockerfile":"Dockerfile"}
JSON
post "application.saveBuildType" /tmp/ug_build.json || true

echo "=== estado final de la app ==="
curl -s -H "x-api-key: $KEY" "$API/application.one?applicationId=$APP_ID" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for k in ['sourceType','buildType','dockerfile','customGitUrl','customGitBranch','autoDeploy','appName','applicationStatus']:
    print(k,'=',d.get(k))
"
