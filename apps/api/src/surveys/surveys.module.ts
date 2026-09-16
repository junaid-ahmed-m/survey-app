import { Module } from '@nestjs/common';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';
import { ContentfulService } from './contentful.service';

@Module({
  controllers: [SurveysController],
  providers: [SurveysService, ContentfulService],
  exports: [SurveysService, ContentfulService],
})
export class SurveysModule {}
