#!/usr/bin/env bash
# Orquesta la creación del proyecto/app de Undead Grid en Dokploy vía su API.
# Se ejecuta DENTRO del VPS (la API escucha en localhost:3000).
set -euo pipefail

API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?falta DOKPLOY_KEY}"

jqget() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }

say() { echo ">> $*"; }

# --- 1. Proyecto (reutiliza si ya existe) ---
PROJECTS="$(curl -s -H "x-api-key: $KEY" "$API/project.all")"
PROJECT_ID="$(echo "$PROJECTS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
pid=''
for p in d:
    if p.get('name')=='undeadgrid': pid=p['projectId']
print(pid)
")"

if [ -z "$PROJECT_ID" ]; then
  say "Creando proyecto undeadgrid"
  RESP="$(curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
    -d '{"name":"undeadgrid","description":"Undead Grid - juego 1v1 (NestJS + Socket.IO + front Vite)"}' \
    "$API/project.create")"
  PROJECT_ID="$(echo "$RESP" | jqget "['projectId']")"
fi
say "projectId=$PROJECT_ID"

# environmentId por defecto del proyecto
ENV_ID="$(curl -s -H "x-api-key: $KEY" "$API/project.one?projectId=$PROJECT_ID" | python3 -c "
import sys,json
d=json.load(sys.stdin)
envs=d.get('environments',[])
eid=''
for e in envs:
    if e.get('isDefault'): eid=e['environmentId']
if not eid and envs: eid=envs[0]['environmentId']
print(eid)
")"
say "environmentId=$ENV_ID"

# --- 2. Aplicación (reutiliza si ya existe) ---
APP_ID="$(curl -s -H "x-api-key: $KEY" "$API/project.one?projectId=$PROJECT_ID" | python3 -c "
import sys,json
d=json.load(sys.stdin)
aid=''
for e in d.get('environments',[]):
    for a in e.get('applications',[]):
        if a.get('name')=='server': aid=a['applicationId']
print(aid)
")"

if [ -z "$APP_ID" ]; then
  say "Creando aplicación 'server'"
  RESP="$(curl -s -X POST -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
    -d "{\"name\":\"server\",\"appName\":\"undeadgrid-server\",\"description\":\"front+back\",\"projectId\":\"$PROJECT_ID\",\"environmentId\":\"$ENV_ID\"}" \
    "$API/application.create")"
  APP_ID="$(echo "$RESP" | jqget "['applicationId']")"
fi
say "applicationId=$APP_ID"
echo "$APP_ID" > /tmp/ug_app_id
