#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"
APP_ID="gCCTqgfb9UMnUI57IqsUY"

# Lee las claves desde archivos temporales subidos por scp (/tmp/ug_key, /tmp/ug_key.pub).
PRIV="$(cat /tmp/ug_key)"
PUB="$(cat /tmp/ug_key.pub)"

# organizationId del proyecto existente.
ORG="$(curl -s -H "x-api-key: $KEY" "$API/project.all" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['organizationId'])")"

# Construye el body con Python para escapar correctamente los saltos de línea.
python3 - "$PRIV" "$PUB" "$ORG" <<'PY' > /tmp/ug_sshbody.json
import json,sys
priv,pub,org=sys.argv[1],sys.argv[2],sys.argv[3]
print(json.dumps({"name":"undeadgrid-deploy","privateKey":priv,"publicKey":pub,"organizationId":org}))
PY

echo "=== sshKey.create ==="
curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
  --data @/tmp/ug_sshbody.json "$API/sshKey.create" > /tmp/ug_sshresp.json
cat /tmp/ug_sshresp.json; echo

SSH_ID="$(python3 -c "import json;d=json.load(open('/tmp/ug_sshresp.json'));print(d.get('sshKeyId',''))" 2>/dev/null || true)"
# Si no vino en la respuesta, buscar por nombre.
if [ -z "$SSH_ID" ]; then
  SSH_ID="$(curl -s -H "x-api-key: $KEY" "$API/sshKey.all" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(next((k['sshKeyId'] for k in d if k.get('name')=='undeadgrid-deploy'),''))")"
fi
echo "SSH_ID=$SSH_ID"

# Cambia la app a URL SSH + la deploy key.
cat > /tmp/ug_gitssh.json <<JSON
{"applicationId":"$APP_ID","sourceType":"git","customGitUrl":"git@github.com:AxioraPath/service-undeadgrid.git","customGitBranch":"main","customGitBuildPath":"/","customGitSSHKeyId":"$SSH_ID","buildType":"dockerfile","dockerfile":"Dockerfile","autoDeploy":true}
JSON
echo "=== application.update (git ssh) ==="
curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
  --data @/tmp/ug_gitssh.json "$API/application.update"; echo

# Limpia la clave privada del disco.
shred -u /tmp/ug_key /tmp/ug_sshbody.json 2>/dev/null || rm -f /tmp/ug_key /tmp/ug_sshbody.json
echo "LISTO"
