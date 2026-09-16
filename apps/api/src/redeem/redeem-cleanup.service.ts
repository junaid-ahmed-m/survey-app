import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';

/**
 * Abandoned sessions must not permanently lock inventory:
 * every minute expired coupon holds are returned to stock and dead session
 * tokens are cleared. The code itself stays USED - the survey was already shown.
 */
@Injectable()
export class RedeemCleanupService {
  private readonly logger = new Logger(RedeemCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async releaseExpiredSessions(): Promise<void> {
    const now = new Date();

    const closedSessions = await this.prisma.code.updateMany({
      where: { sessionExpiresAt: { lt: now } },
      data: { sessionToken: null, sessionExpiresAt: null },
    });

    const releasedCoupons = await this.coupons.releaseExpiredReservations();
    const expiredCoupons = await this.coupons.expireOutdatedCoupons();

    if (closedSessions.count || releasedCoupons || expiredCoupons) {
      this.logger.log(
        `Cleanup: ${closedSessions.count} stale session(s) closed, ` +
          `${releasedCoupons} coupon(s) returned to stock, ${expiredCoupons} coupon(s) expired.`,
      );
    }
  }
}
