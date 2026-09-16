import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { configuration } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { SurveysModule } from './surveys/surveys.module';
import { CouponsModule } from './coupons/coupons.module';
import { BatchesModule } from './batches/batches.module';
import { RedeemModule } from './redeem/redeem.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthController } from './health/health.controller';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: (config.get<number>('rateLimit.ttlSeconds') ?? 60) * 1000,
            limit: config.get<number>('rateLimit.limit') ?? 60,
          },
          {
            name: 'redeem',
            ttl: (config.get<number>('rateLimit.redeemTtlSeconds') ?? 60) * 1000,
            limit: config.get<number>('rateLimit.redeemLimit') ?? 10,
          },
          { name: 'burst', ttl: 5_000, limit: 20 },
        ],
      }),
    }),
    PrismaModule,
    CryptoModule,
    MailModule,
    AuthModule,
    SurveysModule,
    CouponsModule,
    BatchesModule,
    RedeemModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
