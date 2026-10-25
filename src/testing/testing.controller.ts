import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { seedBodySchema } from './seed';
import { TestEndpointsGuard } from './test-endpoints.guard';
import { TestingService } from './testing.service';

@Controller('test')
@UseGuards(TestEndpointsGuard)
export class TestingController {
  constructor(private readonly testing: TestingService) {}

  @Get('telemetry')
  telemetry() {
    return this.testing.telemetry();
  }

  // La especificación pide HTTP 200 en todos los /api/test/* (Nest responde 201 por defecto a un POST).
  @Post('seed')
  @HttpCode(200)
  seed(@Body() body: unknown) {
    const parsed = seedBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.testing.seed(parsed.data.matches, parsed.data.seed);
  }

  @Delete('seed')
  clean() {
    return this.testing.clean();
  }
}
