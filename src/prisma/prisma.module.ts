import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Módulo global: PrismaService disponible en toda la app sin reimportar. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
