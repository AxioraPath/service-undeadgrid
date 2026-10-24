import { Logger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

/** Orígenes permitidos para CORS HTTP (el gateway lee los suyos por su cuenta). */
function corsOrigins(): string[] | boolean {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return true; // mismo dominio / sin restricción explícita (producción Render)
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : true;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: logLevels() });

  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Undead Grid service escuchando en http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
