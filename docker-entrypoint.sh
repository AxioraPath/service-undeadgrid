#!/bin/sh
# Entrypoint del backend: aplica migraciones de Prisma y arranca el servidor.
# Si las migraciones fallan (p. ej. BD no lista), reintenta unas veces antes de
# rendirse, para tolerar que Postgres arranque en paralelo.
set -e

echo "[entrypoint] Aplicando migraciones de Prisma..."
i=0
until npx prisma migrate deploy; do
  i=$((i + 1))
  if [ "$i" -ge 10 ]; then
    echo "[entrypoint] ERROR: no se pudieron aplicar las migraciones tras 10 intentos."
    exit 1
  fi
  echo "[entrypoint] Reintento $i/10 en 3s (¿BD no lista?)..."
  sleep 3
done

echo "[entrypoint] Migraciones OK. Arrancando servidor..."
exec node dist/main.js
