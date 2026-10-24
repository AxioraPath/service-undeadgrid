import { join } from 'path';
import { existsSync } from 'fs';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { HealthController } from './health/health.controller';
import { RoomModule } from './room/room.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { StatsModule } from './stats/stats.module';
import { TestingModule } from './testing/testing.module';

/**
 * Carpeta del build del frontend (Vite). En el contenedor de producción el
 * build se copia a `<raíz>/public`. Si no existe, no se sirve nada estático.
 */
const CLIENT_DIR = join(__dirname, '..', 'public');
const serveStatic = existsSync(CLIENT_DIR)
  ? [
      ServeStaticModule.forRoot({
        rootPath: CLIENT_DIR,
        exclude: ['/api/{*splat}', '/health', '/socket.io/{*splat}'],
        serveStaticOptions: {
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
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    StatsModule,
    TestingModule,
    ...serveStatic,
    RoomModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
