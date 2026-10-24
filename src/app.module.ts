import { join } from 'path';
import { existsSync } from 'fs';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { HealthController } from './health/health.controller';
import { RoomModule } from './room/room.module';

/**
 * Carpeta del build del frontend (Vite). En el contenedor de producción el
 * build se copia a `<raíz>/public`. Si no existe (desarrollo del backend solo),
 * simplemente no se sirve nada estático y el front corre por su cuenta en Vite.
 */
const CLIENT_DIR = join(__dirname, '..', 'public');
const serveStatic = existsSync(CLIENT_DIR)
  ? [
      ServeStaticModule.forRoot({
        rootPath: CLIENT_DIR,
        // No interceptar la API ni el socket: esas rutas las maneja Nest/Socket.IO.
        exclude: ['/api/{*splat}', '/health', '/socket.io/{*splat}'],
        serveStaticOptions: {
          // Assets con hash de Vite: cache inmutable; index.html sin cache.
          setHeaders: (res, path) => {
            if (path.includes(`${require('path').sep}assets${require('path').sep}`)) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
          },
        },
      }),
    ]
  : [];

@Module({
  imports: [...serveStatic, RoomModule],
  controllers: [HealthController],
})
export class AppModule {}
