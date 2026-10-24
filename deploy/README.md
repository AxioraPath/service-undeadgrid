# Despliegue en VPS (OVH) con actualización automática por push

Arquitectura optimizada para **jugadores en México** desde un VPS Ubuntu:

```
                 Internet
                    │
             ┌──────▼───────┐
             │    Nginx     │  :80/:443  (sirve el front + proxy WebSocket)
             │  gzip, cache │
             └──────┬───────┘
          /socket.io│/api /health → 127.0.0.1:3000
             ┌──────▼───────┐
             │  NestJS API  │  PM2 (fork, 1 instancia) — salas en memoria
             └──────────────┘
```

Decisiones (lo más óptimo para este caso):
- **Nginx + PM2, sin Docker:** menos overhead de red → menor latencia.
- **WebSocket forzado** en Socket.IO: evita el long-polling inicial.
- **BBR** activado en el kernel: latencia TCP estable a larga distancia (CA↔MX).
- **PM2 fork con 1 instancia:** las salas viven en memoria; no se puede clusterizar sin Redis.
- **Mismo dominio** para front y back: sin CORS ni saltos extra.

> Nota sobre el ping: el VPS está en OVH Canadá. El ping físico CA↔MX es ~60–90 ms
> (límite geográfico, no de software). Para ~20–40 ms convendría un VPS en EE.UU.
> El deploy está automatizado, así que migrar a otro VPS sería solo cambiar los secrets.

---

## 1. Provisión del VPS (una sola vez)

En tu máquina, copia el script y los configs al VPS y ejecútalos:

```bash
# Sube el script de provisión
scp -i ~/.ssh/undeadgrid_deploy service-undeadgrid/deploy/setup-vps.sh ubuntu@149.56.96.84:~
ssh -i ~/.ssh/undeadgrid_deploy ubuntu@149.56.96.84 "bash ~/setup-vps.sh"

# Instala la config de Nginx
scp -i ~/.ssh/undeadgrid_deploy service-undeadgrid/deploy/nginx.conf \
    ubuntu@149.56.96.84:~/undeadgrid.nginx
ssh -i ~/.ssh/undeadgrid_deploy ubuntu@149.56.96.84 '
  sudo mv ~/undeadgrid.nginx /etc/nginx/sites-available/undeadgrid
  sudo ln -sf /etc/nginx/sites-available/undeadgrid /etc/nginx/sites-enabled/undeadgrid
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t && sudo systemctl reload nginx
'
```

## 2. Primer arranque del backend

```bash
ssh -i ~/.ssh/undeadgrid_deploy ubuntu@149.56.96.84 '
  git clone https://github.com/AxioraPath/service-undeadgrid.git /opt/undeadgrid/service
  cd /opt/undeadgrid/service
  npm ci && npm run build
  pm2 start ecosystem.config.cjs && pm2 save
'
```

Comprueba: `curl http://149.56.96.84/health` → `{"status":"ok",...}`.

## 3. Actualización automática en cada `git push`

Ya hay workflows de GitHub Actions en ambos repos
(`.github/workflows/deploy.yml`). En cada push a `main`:

- **Backend:** compila, se conecta por SSH, `git pull`, `npm ci`, `npm run build`, `pm2 reload`.
- **Frontend:** compila con Vite y sincroniza el `dist/` a `/var/www/undeadgrid/web` con rsync.

### Secrets a configurar en GitHub (en AMBOS repos)

En *Settings → Secrets and variables → Actions → New repository secret*:

| Secret        | Valor                                             |
|---------------|---------------------------------------------------|
| `VPS_HOST`    | `149.56.96.84`                                    |
| `VPS_USER`    | `ubuntu`                                           |
| `VPS_SSH_KEY` | Contenido de la clave PRIVADA `~/.ssh/undeadgrid_deploy` |

> La clave PRIVADA nunca se sube al repo; solo vive como secret cifrado en GitHub.
> La clave PÚBLICA (`undeadgrid_deploy.pub`) va en `~/.ssh/authorized_keys` del VPS.

Para ver el contenido de la clave privada a pegar en el secret:

```bash
cat ~/.ssh/undeadgrid_deploy        # pega TODO, incluidas las líneas BEGIN/END
```

## 4. Operación diaria

A partir de aquí: **haces `git push` y se actualiza solo.** Nada más.

Comandos útiles en el VPS:

```bash
pm2 status                 # estado del backend
pm2 logs undeadgrid-api    # logs en vivo
pm2 reload undeadgrid-api  # recarga manual
sudo systemctl reload nginx
```

## 5. (Opcional) Dominio + HTTPS

Con un dominio apuntando a `149.56.96.84`:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tu-dominio.com
```

Actualiza `server_name` en `deploy/nginx.conf` con el dominio.
