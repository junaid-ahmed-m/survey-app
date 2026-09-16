import { Module } from '@nestjs/common';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { CodeGenerationService } from './code-generation.service';
import { SurveysModule } from '../surveys/surveys.module';

@Module({
  imports: [SurveysModule],
  controllers: [BatchesController],
  providers: [BatchesService, CodeGenerationService],
  exports: [BatchesService],
})
export class BatchesModule {}
