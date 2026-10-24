import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { RoomModule } from './room/room.module';

@Module({
  imports: [RoomModule],
  controllers: [HealthController],
})
export class AppModule {}
