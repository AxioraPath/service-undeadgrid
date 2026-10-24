import { Global, Module } from '@nestjs/common';
import { MatchStatsService } from './match-stats.service';

@Global()
@Module({
  providers: [MatchStatsService],
  exports: [MatchStatsService],
})
export class StatsModule {}
