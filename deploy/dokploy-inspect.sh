#!/usr/bin/env bash
set -euo pipefail
API="http://localhost:3000/api"
KEY="${DOKPLOY_KEY:?}"

curl -s -H "x-api-key: $KEY" "$API/project.all" > /tmp/ug_projects.json
python3 - <<'PY'
import json
d=json.load(open('/tmp/ug_projects.json'))
for p in d:
    if p['name']=='undeadgrid':
        print('PROJECT_ID', p['projectId'])
        for e in p.get('environments',[]):
            print('  ENV', e['environmentId'], 'default=', e.get('isDefault'))
            for a in e.get('applications',[]):
                print('    APP', a['applicationId'], a['name'], a.get('applicationStatus'))
PY
