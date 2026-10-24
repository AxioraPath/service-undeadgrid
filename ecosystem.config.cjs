// Configuración de PM2 para el servicio Undead Grid.
//
// IMPORTANTE: exec_mode 'fork' con UNA sola instancia. El estado de las salas
// vive en memoria (sin Redis), por lo que NO se puede usar 'cluster'/varias
// instancias: los jugadores de una misma sala deben caer siempre en el mismo
// proceso. Cuando se añada Redis + adaptador de Socket.IO, se podrá escalar.
module.exports = {
  apps: [
    {
      name: 'undeadgrid-api',
      script: 'dist/main.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        // El front se sirve desde el mismo dominio (Nginx), así que CORS por
        // defecto permite el mismo origen. Ajustar si se separa el dominio.
        CORS_ORIGINS: '',
        LOG_LEVELS: 'log,error,warn',
      },
    },
  ],
};
