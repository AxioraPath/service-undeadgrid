#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
GH="${GH_TOKEN:?}"

SERVICE_APP="chw-Qan1keU9lQNSD1S2R"
WEBAPP_APP="Ntx4JeON7uTlZP-E5e-cp"
API_HOST="api.undeadgrid.axiorapath.com.mx"
WEB_HOST="undeadgrid.axiorapath.com.mx"

upd() { # jsonfile
  curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' --data @"$1" "$API/application.update"
  echo
}

# --- BACKEND (service) ---
python3 - "$SERVICE_APP" "$GH" "$WEB_HOST" <<'PY' > /tmp/s.json
import json,sys
app,tok,web=sys.argv[1],sys.argv[2],sys.argv[3]
print(json.dumps({
 "applicationId":app,"sourceType":"git",
 "customGitUrl":f"https://x-access-token:{tok}@github.com/AxioraPath/service-undeadgrid.git",
 "customGitBranch":"main","customGitBuildPath":"/","customGitSSHKeyId":None,
 "buildType":"dockerfile","dockerfile":"Dockerfile","autoDeploy":True,
 # CORS: permite el origen del front.
 "env":f"CORS_ORIGINS=https://{web}\nLOG_LEVELS=log,error,warn"
}))
PY
echo "=== service: git+build+env ==="; upd /tmp/s.json

# --- FRONTEND (web-app) ---
python3 - "$WEBAPP_APP" "$GH" "$API_HOST" <<'PY' > /tmp/w.json
import json,sys
app,tok,api=sys.argv[1],sys.argv[2],sys.argv[3]
print(json.dumps({
 "applicationId":app,"sourceType":"git",
 "customGitUrl":f"https://x-access-token:{tok}@github.com/AxioraPath/undeadgrid-web-app.git",
 "customGitBranch":"main","customGitBuildPath":"/","customGitSSHKeyId":None,
 "buildType":"dockerfile","dockerfile":"Dockerfile","autoDeploy":True,
 # El front apunta su API/WebSocket al dominio del backend.
 "buildArgs":f"VITE_API_URL=https://{api}"
}))
PY
echo "=== web-app: git+build+buildArgs ==="; upd /tmp/w.json

rm -f /tmp/s.json /tmp/w.json

# --- Dominios ---
dom() { # appId host port
  cat > /tmp/d.json <<JSON
{"applicationId":"$1","host":"$2","path":"/","port":$3,"https":true,"certificateType":"letsencrypt","domainType":"application"}
JSON
  curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' --data @/tmp/d.json "$API/domain.create"; echo
}
echo "=== dominio service ($API_HOST:3000) ==="; dom "$SERVICE_APP" "$API_HOST" 3000
echo "=== dominio web-app ($WEB_HOST:80) ==="; dom "$WEBAPP_APP" "$WEB_HOST" 80
rm -f /tmp/d.json
echo "LISTO"
