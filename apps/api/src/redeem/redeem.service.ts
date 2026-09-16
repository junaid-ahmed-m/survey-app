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
import { EventsService } from '../events/events.service';
import { REDEEM_ERRORS } from '../common/constants';
import { isUniqueViolation } from '../common/prisma-error.util';
import { ResolvedSurvey } from '../surveys/survey.types';
import { CompleteRedemptionDto, VerifyCodeDto } from './dto/redeem.dto';

/** Bounds for the attacker-controlled answers object. */
const MAX_ANSWER_FIELDS = 100;
const MAX_ANSWER_OPTIONS = 50;
const MAX_ANSWER_LENGTH = 2000;

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
    private readonly events: EventsService,
    private readonly config: ConfigService,
  ) {}

  private get sessionTtlMs(): number {
    return (this.config.get<number>('redeem.sessionTtlMinutes') ?? 30) * 60_000;
  }

  /** Coupons are only held for a short window; they go back to stock afterwards. */
  private get couponReservationMs(): number {
    return (this.config.get<number>('redeem.couponReservationSeconds') ?? 60) * 1_000;
  }

  private couponReservedUntil(): Date {
    return new Date(Date.now() + this.couponReservationMs);
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
   *  - a code is either UNUSED or USED; it flips to USED the moment the survey
   *    is handed out, so a QR can never open a second survey,
   *  - a coupon is held for a short window before the survey is shown; if the
   *    inventory is empty the code stays UNUSED and the user is asked to retry.
   */
  async verify(dto: VerifyCodeDto, ip?: string) {
    const normalized = this.generator.normalizeCode(dto.code);

    if (!this.generator.hasValidChecksum(normalized)) {
      await this.audit('REDEEM_INVALID_CHECKSUM', { ip });
      this.invalidCode();
    }

    const record = await this.prisma.code.findUnique({
      where: { codeHash: this.crypto.hash(normalized) },
      include: { batch: true, response: true },
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

    this.assertBatchUsable(record.batch);

    await this.prisma.code.update({
      where: { id: record.id },
      data: { scanCount: { increment: 1 }, lastScanAt: new Date() },
    });

    if (record.status === 'USED') {
      // The survey was already handed out. Re-opening the same QR only resumes the
      // still-running session; anything else is a spent code.
      if (
        !record.response &&
        record.sessionToken &&
        record.sessionExpiresAt &&
        record.sessionExpiresAt > new Date()
      ) {
        const survey = await this.resolveSurvey(record.batch, record.sessionToken);
        return this.sessionPayload(record.sessionToken, record.sessionExpiresAt, record.batch, survey);
      }
      throw new ConflictException({
        code: REDEEM_ERRORS.ALREADY_USED,
        message: 'This code has already been used.',
        details: { usedAt: record.usedAt },
      });
    }

    const expiresAt = new Date(Date.now() + this.sessionTtlMs);
    const sessionToken = this.crypto.randomToken(32);

    // Hold inventory first - no coupon, no survey, code stays unused.
    const coupon = await this.coupons.reserveForCode(
      record.batch.couponType,
      record.id,
      this.couponReservedUntil(),
    );
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

    // Conditional claim: showing the survey consumes the code. If a parallel scan
    // won the race we resume its session instead of handing out two surveys.
    const claimed = await this.prisma.code.updateMany({
      where: { id: record.id, status: 'UNUSED' },
      data: { status: 'USED', usedAt: new Date(), sessionToken, sessionExpiresAt: expiresAt },
    });

    if (claimed.count === 0) {
      const current = await this.prisma.code.findUnique({
        where: { id: record.id },
        include: { response: true },
      });
      if (
        current &&
        !current.response &&
        current.sessionToken &&
        current.sessionExpiresAt &&
        current.sessionExpiresAt > new Date()
      ) {
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

    if (record.response) {
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

  /** Step 3 - survey finished: record the answers, issue + e-mail the coupon. */
  async complete(dto: CompleteRedemptionDto, ip?: string) {
    const record = await this.prisma.code.findUnique({
      where: { sessionToken: dto.sessionToken },
      include: { batch: true, response: true },
    });

    if (!record) {
      throw new NotFoundException({
        code: REDEEM_ERRORS.SESSION_EXPIRED,
        message: 'This session is no longer available. Please scan the QR code again.',
      });
    }

    if (record.response) {
      throw new ConflictException({
        code: REDEEM_ERRORS.ALREADY_USED,
        message: 'This code has already been redeemed.',
      });
    }

    if (!record.sessionExpiresAt || record.sessionExpiresAt <= new Date()) {
      throw new NotFoundException({
        code: REDEEM_ERRORS.SESSION_EXPIRED,
        message: 'This session has expired. Please scan the QR code again.',
      });
    }

    const email = dto.email.trim().toLowerCase();

    // Re-reserving extends a live hold and pulls a fresh coupon when the window
    // lapsed, so the cleanup cron cannot pull the rug mid-submit.
    const reserved = await this.coupons.reserveForCode(
      record.batch.couponType,
      record.id,
      this.couponReservedUntil(),
    );
    if (!reserved) {
      throw new ServiceUnavailableException({
        code: REDEEM_ERRORS.COUPONS_EXHAUSTED,
        message: 'We are unable to cater to this request right now. Please try again later.',
      });
    }

    if (record.batch.surveyType === 'NATIVE') {
      await this.validateNativeAnswers(record.batch.surveyId, dto.answers ?? {});
    }
    // Native surveys can push their answers to an external system and, when they
    // do, opt out of keeping consumer data here at all.
    const forwarding =
      record.batch.surveyType === 'NATIVE' && record.batch.surveyId
        ? await this.surveys.getForwarding(record.batch.surveyId)
        : null;
    const forwardConfig = forwarding && this.events.isEnabled(forwarding.config) ? forwarding.config : null;
    const retain = forwarding ? forwarding.retainResponses : true;
    // Never store or forward the raw body: unknown keys are dropped and every
    // value is bounded, so a crafted request cannot inflate the row or the event.
    const answers = await this.sanitizeAnswers(record.batch, dto.answers ?? {});

    // Answers, the code flip, the coupon hand-out and the outbound event commit
    // together: a failure here leaves the session replayable instead of burning
    // the reward, and a delivered redemption always has its event queued.
    let issued: NonNullable<Awaited<ReturnType<CouponsService['issueForCode']>>>;
    try {
      issued = await this.prisma.$transaction(async (tx) => {
        await tx.surveyResponse.create({
          data: {
            codeId: record.id,
            batchId: record.batchId,
            surveyType: record.batch.surveyType,
            surveyRef: record.batch.surveyId ?? record.batch.surveyUrl ?? null,
            // The forwarded event is the system of record when retention is off.
            answers: retain ? JSON.stringify(answers) : '{}',
            email: retain ? email : null,
          },
        });
        await tx.code.update({
          where: { id: record.id },
          data: { status: 'USED', usedAt: record.usedAt ?? new Date(), sessionExpiresAt: null },
        });

        const coupon = await this.coupons.issueForCode(record.id, retain ? email : null, tx);
        if (!coupon) {
          throw new ServiceUnavailableException({
            code: REDEEM_ERRORS.COUPONS_EXHAUSTED,
            message: 'We are unable to cater to this request right now. Please try again later.',
          });
        }

        if (forwardConfig) {
          await this.events.enqueueSurveyCompleted(tx, forwardConfig, {
            codeId: record.id,
            batchId: record.batchId,
            batchName: record.batch.name,
            sku: record.batch.sku,
            surveyType: record.batch.surveyType,
            surveyRef: record.batch.surveyId ?? null,
            surveyTitle: forwarding?.title ?? null,
            couponTypeCode: coupon.couponTypeCode,
            couponValue: coupon.value,
            email,
            answers,
            completedAt: new Date(),
          });
        }

        return coupon;
      });
    } catch (error) {
      // Two submits raced: SurveyResponse.codeId is unique, so the loser is the
      // duplicate - report it as a spent code rather than a server error.
      if (isUniqueViolation(error, 'codeId')) {
        throw new ConflictException({
          code: REDEEM_ERRORS.ALREADY_USED,
          message: 'This code has already been redeemed.',
        });
      }
      throw error;
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

  /**
   * The answers object is attacker controlled, so it is rebuilt rather than
   * trusted: for a native survey only the declared question ids survive, and
   * every value is bounded before it reaches the database or an outbound event.
   */
  private async sanitizeAnswers(
    batch: Batch,
    answers: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const allowed =
      batch.surveyType === 'NATIVE' && batch.surveyId
        ? new Set((await this.surveys.getDefinition(batch.surveyId))?.questions.map((q) => q.id) ?? [])
        : null;

    const clamp = (value: unknown): unknown => {
      if (typeof value === 'string') return value.slice(0, MAX_ANSWER_LENGTH);
      if (typeof value === 'number' || typeof value === 'boolean') return value;
      if (Array.isArray(value)) {
        return value
          .slice(0, MAX_ANSWER_OPTIONS)
          .map((item) => (typeof item === 'string' ? item.slice(0, MAX_ANSWER_LENGTH) : item))
          .filter((item) => ['string', 'number', 'boolean'].includes(typeof item));
      }
      return undefined;
    };

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answers)) {
      if (Object.keys(sanitized).length >= MAX_ANSWER_FIELDS) break;
      if (allowed && !allowed.has(key)) continue;
      if (!allowed && key.length > 64) continue;
      const clamped = clamp(value);
      if (clamped !== undefined) sanitized[key] = clamped;
    }
    return sanitized;
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
