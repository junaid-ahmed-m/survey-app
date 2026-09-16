import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from '../coupons/coupons.service';

/**
 * Abandoned sessions must not permanently lock inventory:
 * every minute expired reservations are released and the codes become scannable again.
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

    const releasedCodes = await this.prisma.code.updateMany({
      where: { status: 'RESERVED', sessionExpiresAt: { lt: now } },
      data: { status: 'UNUSED', sessionToken: null, sessionExpiresAt: null },
    });

    const releasedCoupons = await this.coupons.releaseExpiredReservations();
    const expiredCoupons = await this.coupons.expireOutdatedCoupons();

    if (releasedCodes.count || releasedCoupons || expiredCoupons) {
      this.logger.log(
        `Cleanup: ${releasedCodes.count} code session(s) released, ` +
          `${releasedCoupons} coupon(s) returned to stock, ${expiredCoupons} coupon(s) expired.`,
      );
    }
  }
}
