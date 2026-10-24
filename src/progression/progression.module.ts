import { Global, Module } from '@nestjs/common';
import { ProgressionService } from './progression.service';

@Global()
@Module({
  providers: [ProgressionService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
