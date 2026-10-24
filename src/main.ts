import { Logger, ValidationPipe, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

/** Niveles de log configurables por env (LOG_LEVELS). */
function logLevels(): LogLevel[] {
  const raw = process.env.LOG_LEVELS;
  if (!raw) return ['log', 'error', 'warn'];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as LogLevel[];
}

/** Orígenes permitidos para CORS HTTP. */
function corsOrigins(): string[] | boolean {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return true;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : true;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: logLevels() });

  app.use(cookieParser());
  // Los endpoints REST viven bajo /api; health y socket.io quedan fuera.
  app.setGlobalPrefix('api', { exclude: ['health', 'socket.io'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Undead Grid service escuchando en http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
