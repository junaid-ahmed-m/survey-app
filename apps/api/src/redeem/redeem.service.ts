import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Batch, Code } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CodeGeneratorService } from '../common/crypto/code-generator.service';
import { CouponsService } from '../coupons/coupons.service';
import { SurveysService } from '../surveys/surveys.service';
import { ContentfulService } from '../surveys/contentful.service';
import { MailService } from '../mail/mail.service';
import { REDEEM_ERRORS } from '../common/constants';
import { ResolvedSurvey } from '../surveys/survey.types';
import { CompleteRedemptionDto, VerifyCodeDto } from './dto/redeem.dto';

@Injectable()
export class RedeemService {
  private readonly logger = new Logger(RedeemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly generator: CodeGeneratorService,
    private readonly coupons: CouponsService,
    private readonly surveys: SurveysService,
    private readonly contentful: ContentfulService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private get sessionTtlMs(): number {
    return (this.config.get<number>('redeem.sessionTtlMinutes') ?? 30) * 60_000;
  }

  private invalidCode(): never {
    // Deliberately identical for "unknown" and "bad checksum" so the endpoint
    // cannot be used as an oracle to enumerate valid codes.
    throw new NotFoundException({
      code: REDEEM_ERRORS.INVALID_CODE,
      message: 'This code is not valid. Please check the QR code and try again.',
    });
  }

  /**
   * Step 1 - the public app calls this right after the QR URL is opened.
   *
   * Guarantees:
   *  - a code is only "consumed" once,
   *  - a coupon is reserved BEFORE the survey is shown; if the inventory is empty
   *    the code stays UNUSED and the user is asked to retry later.
   */
  async verify(dto: VerifyCodeDto, ip?: string) {
    const normalized = this.generator.normalizeCode(dto.code);

    if (!this.generator.hasValidChecksum(normalized)) {
      await this.audit('REDEEM_INVALID_CHECKSUM', { ip });
      this.invalidCode();
    }

    const record = await this.prisma.code.findUnique({
      where: { codeHash: this.crypto.hash(normalized) },
      include: { batch: true },
    });
    if (!record) {
      await this.audit('REDEEM_UNKNOWN_CODE', { ip });
      this.invalidCode();
    }

    if (record.status === 'DISABLED') {
      throw new ForbiddenException({
        code: REDEEM_ERRORS.CODE_DISABLED,
        message: 'This code has been deactivated.',
      });
    }
    if (record.status === 'USED') {
      throw new ConflictException({
        code: REDEEM_ERRORS.ALREADY_USED,
        message: 'This code has already been used.',
        details: { usedAt: record.usedAt },
      });
    }

    this.assertBatchUsable(record.batch);

    await this.prisma.code.update({
      where: { id: record.id },
      data: { scanCount: { increment: 1 }, lastScanAt: new Date() },
    });

    // Resume an in-flight session instead of burning a second coupon.
    if (
      record.status === 'RESERVED' &&
      record.sessionToken &&
      record.sessionExpiresAt &&
      record.sessionExpiresAt > new Date()
    ) {
      const survey = await this.resolveSurvey(record.batch, record.sessionToken);
      return this.sessionPayload(record.sessionToken, record.sessionExpiresAt, record.batch, survey);
    }

    const expiresAt = new Date(Date.now() + this.sessionTtlMs);
    const sessionToken = this.crypto.randomToken(32);

    // Reserve inventory first - no coupon, no survey, code stays unused.
    const coupon = await this.coupons.reserveForCode(record.batch.couponType, record.id, expiresAt);
    if (!coupon) {
      await this.audit('REDEEM_COUPONS_EXHAUSTED', { ip, entityId: record.id, batchId: record.batchId });
      throw new ServiceUnavailableException({
        code: REDEEM_ERRORS.COUPONS_EXHAUSTED,
        message: 'We are unable to cater to this request right now. Please try again later.',
      });
    }

    let survey: ResolvedSurvey;
    try {
      survey = await this.resolveSurvey(record.batch, sessionToken);
    } catch (error) {
      // Roll the coupon back so it is not lost when the survey provider is down.
      await this.coupons.releaseForCode(record.id);
      throw error;
    }

    // Conditional claim: if a parallel scan already opened a session we reuse it
    // instead of handing out two sessions for the same code.
    const claimed = await this.prisma.code.updateMany({
      where: { id: record.id, status: 'UNUSED' },
      data: { status: 'RESERVED', sessionToken, sessionExpiresAt: expiresAt },
    });

    if (claimed.count === 0) {
      const current = await this.prisma.code.findUnique({ where: { id: record.id } });
      if (current?.status === 'RESERVED' && current.sessionToken && current.sessionExpiresAt) {
        const runningSurvey = await this.resolveSurvey(record.batch, current.sessionToken);
        return this.sessionPayload(current.sessionToken, current.sessionExpiresAt, record.batch, runningSurvey);
      }
      throw new ConflictException({
        code: REDEEM_ERRORS.ALREADY_USED,
        message: 'This code has already been used.',
      });
    }

    await this.audit('REDEEM_STARTED', { ip, entityId: record.id, batchId: record.batchId });

    return this.sessionPayload(sessionToken, expiresAt, record.batch, survey);
  }

  /** Step 2 - used by the app to rehydrate a session (refresh / third-party return). */
  async getSession(sessionToken: string) {
    const record = await this.prisma.code.findUnique({
      where: { sessionToken },
      include: { batch: true, response: true },
    });
    if (!record) {
      throw new NotFoundException({
        code: REDEEM_ERRORS.SESSION_EXPIRED,
        message: 'This session is no longer available. Please scan the QR code again.',
      });
    }

    if (record.status === 'USED') {
      const coupon = await this.prisma.coupon.findUnique({ where: { codeId: record.id } });
      return {
        status: 'COMPLETED' as const,
        completedAt: record.usedAt,
        email: record.response?.email ?? null,
        coupon: coupon
          ? {
              code: this.safeDecrypt(coupon.couponCodeEncrypted),
              value: coupon.value,
              couponTypeCode: coupon.couponTypeCode,
              expiresAt: coupon.expiresAt,
            }
          : null,
      };
    }

    if (!record.sessionExpiresAt || record.sessionExpiresAt <= new Date()) {
      throw new NotFoundException({
        code: REDEEM_ERRORS.SESSION_EXPIRED,
        message: 'This session has expired. Please scan the QR code again.',
      });
    }

    const survey = await this.resolveSurvey(record.batch, sessionToken);
    return this.sessionPayload(sessionToken, record.sessionExpiresAt, record.batch, survey);
  }

  /** Step 3 - survey finished: consume the code, issue + e-mail the coupon. */
  async complete(dto: CompleteRedemptionDto, ip?: string) {
    const record = await this.prisma.code.findUnique({
      where: { sessionToken: dto.sessionToken },
      include: { batch: true },
    });

    if (!record) {
      throw new NotFoundException({
        code: REDEEM_ERRORS.SESSION_EXPIRED,
        message: 'This session is no longer available. Please scan the QR code again.',
      });
    }

    if (record.status === 'USED') {
      throw new ConflictException({
        code: REDEEM_ERRORS.ALREADY_USED,
        message: 'This code has already been redeemed.',
      });
    }

    if (record.status !== 'RESERVED' || !record.sessionExpiresAt || record.sessionExpiresAt <= new Date()) {
      throw new NotFoundException({
        code: REDEEM_ERRORS.SESSION_EXPIRED,
        message: 'This session has expired. Please scan the QR code again.',
      });
    }

    const email = dto.email.trim().toLowerCase();
    const reserved = await this.prisma.coupon.findUnique({ where: { codeId: record.id } });
    if (!reserved || reserved.status === 'AVAILABLE') {
      // The reservation lapsed (e.g. the user left the page open for hours).
      throw new ServiceUnavailableException({
        code: REDEEM_ERRORS.COUPONS_EXHAUSTED,
        message: 'We are unable to cater to this request right now. Please try again later.',
      });
    }

    if (record.batch.surveyType === 'NATIVE') {
      await this.validateNativeAnswers(record.batch.surveyId, dto.answers ?? {});
    }

    await this.prisma.$transaction([
      this.prisma.surveyResponse.create({
        data: {
          codeId: record.id,
          batchId: record.batchId,
          surveyType: record.batch.surveyType,
          surveyRef: record.batch.surveyId ?? record.batch.surveyUrl ?? null,
          answers: JSON.stringify(dto.answers ?? {}),
          email,
        },
      }),
      this.prisma.code.update({
        where: { id: record.id },
        data: { status: 'USED', usedAt: new Date(), sessionExpiresAt: null },
      }),
    ]);

    const issued = await this.coupons.issueForCode(record.id, email);
    if (!issued) {
      throw new ServiceUnavailableException({
        code: REDEEM_ERRORS.COUPONS_EXHAUSTED,
        message: 'We are unable to cater to this request right now. Please try again later.',
      });
    }

    const couponType = await this.prisma.couponType.findUnique({
      where: { code: issued.couponTypeCode },
    });

    const emailed = await this.mail.sendCoupon({
      to: email,
      couponCode: issued.code,
      couponName: couponType?.name ?? issued.couponTypeCode,
      couponValue: issued.value,
      expiresAt: issued.expiresAt,
    });

    await this.audit('REDEEM_COMPLETED', { ip, entityId: record.id, batchId: record.batchId });

    return {
      status: 'COMPLETED' as const,
      emailed,
      email,
      coupon: {
        code: issued.code,
        value: issued.value,
        couponTypeCode: issued.couponTypeCode,
        couponName: couponType?.name ?? issued.couponTypeCode,
        expiresAt: issued.expiresAt,
      },
    };
  }

  // ------------------------------------------------------------- internals

  private assertBatchUsable(batch: Batch): void {
    if (batch.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: REDEEM_ERRORS.BATCH_INACTIVE,
        message: 'This campaign is not active at the moment.',
      });
    }
    if (batch.expiresAt && batch.expiresAt <= new Date()) {
      throw new ForbiddenException({
        code: REDEEM_ERRORS.BATCH_INACTIVE,
        message: 'This campaign has ended.',
      });
    }
  }

  private sessionPayload(
    sessionToken: string,
    expiresAt: Date,
    batch: Batch,
    survey: ResolvedSurvey,
  ) {
    return {
      status: 'SURVEY_READY' as const,
      sessionToken,
      sessionExpiresAt: expiresAt,
      campaign: { id: batch.id, name: batch.name, description: batch.description },
      survey,
    };
  }

  private async resolveSurvey(batch: Batch, sessionToken: string): Promise<ResolvedSurvey> {
    switch (batch.surveyType) {
      case 'NATIVE': {
        const survey = batch.surveyId ? await this.surveys.getDefinition(batch.surveyId) : null;
        if (!survey || survey.questions.length === 0) {
          throw new ServiceUnavailableException({
            code: REDEEM_ERRORS.SURVEY_UNAVAILABLE,
            message: 'The survey is not available right now. Please try again later.',
          });
        }
        return { type: 'NATIVE', survey };
      }
      case 'CONTENTFUL': {
        if (!batch.surveyId) {
          throw new ServiceUnavailableException({
            code: REDEEM_ERRORS.SURVEY_UNAVAILABLE,
            message: 'The survey is not available right now. Please try again later.',
          });
        }
        const survey = await this.contentful.fetchSurvey(batch.surveyId);
        if (survey.questions.length === 0) {
          throw new ServiceUnavailableException({
            code: REDEEM_ERRORS.SURVEY_UNAVAILABLE,
            message: 'The survey is not available right now. Please try again later.',
          });
        }
        return { type: 'CONTENTFUL', survey };
      }
      case 'THIRD_PARTY': {
        if (!batch.surveyUrl) {
          throw new ServiceUnavailableException({
            code: REDEEM_ERRORS.SURVEY_UNAVAILABLE,
            message: 'The survey is not available right now. Please try again later.',
          });
        }
        const appUrl = this.config.get<string>('publicAppUrl');
        const returnUrl = `${appUrl}/survey/return?session=${encodeURIComponent(sessionToken)}`;
        const url = new URL(batch.surveyUrl);
        url.searchParams.set('ref', sessionToken);
        url.searchParams.set('return_url', returnUrl);
        return { type: 'THIRD_PARTY', url: url.toString(), returnUrl };
      }
      default:
        throw new ServiceUnavailableException({
          code: REDEEM_ERRORS.SURVEY_UNAVAILABLE,
          message: 'The survey is not available right now. Please try again later.',
        });
    }
  }

  private async validateNativeAnswers(surveyId: string | null, answers: Record<string, unknown>) {
    if (!surveyId) return;
    const survey = await this.surveys.getDefinition(surveyId);
    if (!survey) return;

    const missing = survey.questions
      .filter((q) => q.required !== false)
      .filter((q) => {
        const value = answers[q.id];
        if (value === undefined || value === null) return true;
        if (typeof value === 'string') return value.trim() === '';
        if (Array.isArray(value)) return value.length === 0;
        return false;
      })
      .map((q) => q.label);

    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'INCOMPLETE_SURVEY',
        message: 'Please answer all required questions.',
        details: { missing },
      });
    }
  }

  private async audit(
    action: string,
    meta: { ip?: string; entityId?: string; batchId?: string },
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          entity: 'Code',
          entityId: meta.entityId,
          ip: meta.ip,
          meta: meta.batchId ? JSON.stringify({ batchId: meta.batchId }) : null,
        },
      });
    } catch (error) {
      this.logger.warn(`Audit write failed: ${(error as Error).message}`);
    }
  }

  private safeDecrypt(payload: string): string {
    try {
      return this.crypto.decrypt(payload);
    } catch {
      return '••••••••';
    }
  }
}
