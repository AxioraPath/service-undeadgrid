import { Module } from '@nestjs/common';
import { RateLimiterService } from '../common/rate-limiter.service';
import { PhaseOrchestrator } from './phase-orchestrator.service';
import { RoomGateway } from './room.gateway';
import { RoomService } from './room.service';

@Module({
  providers: [RoomService, PhaseOrchestrator, RateLimiterService, RoomGateway],
  exports: [RoomService],
})
export class RoomModule {}
