import { BadRequestException, Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
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

  @Post('seed')
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
