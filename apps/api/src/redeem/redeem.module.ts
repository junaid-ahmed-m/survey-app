import { Module } from '@nestjs/common';
import { RedeemController } from './redeem.controller';
import { RedeemService } from './redeem.service';
import { RedeemCleanupService } from './redeem-cleanup.service';
import { CouponsModule } from '../coupons/coupons.module';
import { SurveysModule } from '../surveys/surveys.module';

@Module({
  imports: [CouponsModule, SurveysModule],
  controllers: [RedeemController],
  providers: [RedeemService, RedeemCleanupService],
})
export class RedeemModule {}
