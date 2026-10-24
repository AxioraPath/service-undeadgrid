#!/usr/bin/env bash
#
# Provisiona un VPS Ubuntu limpio para Undead Grid (ejecutar UNA vez).
# Instala: Node.js 22, PM2, Nginx, Git. Activa BBR para latencia TCP estable.
#
# Uso (en el VPS, como usuario con sudo):
#   bash setup-vps.sh
#
set -euo pipefail

echo "==> Actualizando paquetes"
sudo apt-get update -y
sudo apt-get upgrade -y

echo "==> Instalando utilidades base"
sudo apt-get install -y curl git ufw ca-certificates

echo "==> Instalando Node.js 22 LTS"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version
npm --version

echo "==> Instalando PM2 (gestor de procesos)"
sudo npm install -g pm2@latest
# Arranque automático de PM2 al reiniciar el VPS.
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u "$USER" --hp "$HOME" || true

echo "==> Instalando Nginx"
sudo apt-get install -y nginx

echo "==> Activando BBR (control de congestion TCP) para latencia estable"
# BBR mejora notablemente el throughput y la estabilidad de latencia en
# conexiones largas como WebSocket, especialmente a larga distancia (CA<->MX).
if ! grep -q "tcp_congestion_control=bbr" /etc/sysctl.conf; then
  echo "net.core.default_qdisc=fq" | sudo tee -a /etc/sysctl.conf
  echo "net.ipv4.tcp_congestion_control=bbr" | sudo tee -a /etc/sysctl.conf
  sudo sysctl -p
fi
echo "Control de congestion activo: $(sysctl -n net.ipv4.tcp_congestion_control)"

echo "==> Configurando firewall (SSH + HTTP + HTTPS)"
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status

echo "==> Creando directorios de despliegue"
sudo mkdir -p /var/www/undeadgrid/web        # build del frontend
sudo mkdir -p /opt/undeadgrid/service         # codigo del backend
sudo chown -R "$USER":"$USER" /var/www/undeadgrid /opt/undeadgrid

echo "==> Listo. Siguiente paso: configurar Nginx y desplegar."
