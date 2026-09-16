import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { EventDispatcherService } from './event-dispatcher.service';
import { scrubPii } from './event-safety.util';
import { ListEventDeliveriesQueryDto } from './dto/event.dto';

export interface ForwardConfig {
  target: string;
  url: string | null;
  secretEncrypted: string | null;
  eventName: string;
}

export interface SurveyCompletedContext {
  codeId: string;
  batchId: string;
  batchName: string;
  sku: string | null;
  surveyType: string;
  surveyRef: string | null;
  surveyTitle: string | null;
  couponTypeCode: string;
  couponValue: string | null;
  /** Used only to derive a stable pseudonymous id - never forwarded. */
  email: string;
  answers: Record<string, unknown>;
  completedAt: Date;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly dispatcher: EventDispatcherService,
  ) {}

  isEnabled(config: ForwardConfig | null | undefined): config is ForwardConfig {
    return Boolean(config && config.target !== 'NONE' && config.url);
  }

  /**
   * Writes the outbox row. MUST be called with the transaction client that also
   * stores the survey response: either both land or neither does, which is what
   * makes the hand-off lossless.
   */
  async enqueueSurveyCompleted(
    tx: Prisma.TransactionClient,
    config: ForwardConfig,
    context: SurveyCompletedContext,
  ): Promise<void> {
    const deliveryId = crypto.randomUUID();
    const payload = this.buildPayload(deliveryId, config, context);

    await tx.eventDelivery.create({
      data: {
        id: deliveryId,
        eventName: config.eventName,
        target: config.target,
        endpoint: config.url as string,
        secretEncrypted: config.secretEncrypted,
        codeId: context.codeId,
        batchId: context.batchId,
        surveyRef: context.surveyRef,
        payload: JSON.stringify(payload),
      },
    });
  }

  /**
   * The consumer's e-mail is deliberately absent. Downstream systems get a
   * stable peppered hash instead, so they can stitch sessions together without
   * ever receiving a contact detail.
   */
  private buildPayload(deliveryId: string, config: ForwardConfig, context: SurveyCompletedContext) {
    const anonymousId = this.crypto.hash(context.email.trim().toLowerCase());
    const timestamp = context.completedAt.toISOString();
    const properties = {
      surveyType: context.surveyType,
      surveyRef: context.surveyRef,
      surveyTitle: context.surveyTitle,
      batchId: context.batchId,
      batchName: context.batchName,
      sku: context.sku,
      couponTypeCode: context.couponTypeCode,
      couponValue: context.couponValue,
      codeId: context.codeId,
      completedAt: timestamp,
      answers: scrubPii(context.answers) as Record<string, unknown>,
    };

    if (config.target === 'RUDDERSTACK') {
      return {
        type: 'track',
        event: config.eventName,
        messageId: deliveryId,
        anonymousId,
        originalTimestamp: timestamp,
        channel: 'server',
        context: { library: { name: 'qr-rewards-platform', version: '1.0' } },
        properties,
      };
    }

    return {
      event: config.eventName,
      messageId: deliveryId,
      anonymousId,
      occurredAt: timestamp,
      properties,
    };
  }

  // ------------------------------------------------------------------ admin

  async list(query: ListEventDeliveriesQueryDto) {
    const page = Math.max(Number.parseInt(query.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize ?? '20', 10) || 20, 1), 100);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.target ? { target: query.target } : {}),
    };

    const [total, rows, grouped] = await Promise.all([
      this.prisma.eventDelivery.count({ where }),
      this.prisma.eventDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.eventDelivery.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const countFor = (status: string) =>
      grouped.find((g) => g.status === status)?._count._all ?? 0;

    return {
      total,
      page,
      pageSize,
      counts: {
        pending: countFor('PENDING') + countFor('DELIVERING'),
        delivered: countFor('DELIVERED'),
        failed: countFor('FAILED'),
      },
      items: rows.map((row) => ({
        id: row.id,
        eventName: row.eventName,
        target: row.target,
        // Query strings can carry tokens - only the stable part is listed.
        endpoint: this.safeEndpoint(row.endpoint),
        status: row.status,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        nextAttemptAt: row.nextAttemptAt,
        lastError: row.lastError,
        lastStatusCode: row.lastStatusCode,
        deliveredAt: row.deliveredAt,
        createdAt: row.createdAt,
        batchId: row.batchId,
      })),
    };
  }

  /** The payload is PII free by construction, so it is safe to show for debugging. */
  async findOne(id: string) {
    const row = await this.prisma.eventDelivery.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Event delivery not found.' });
    }
    let payload: unknown = row.payload;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      /* keep the raw string */
    }
    return {
      id: row.id,
      eventName: row.eventName,
      target: row.target,
      endpoint: this.safeEndpoint(row.endpoint),
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      nextAttemptAt: row.nextAttemptAt,
      lastError: row.lastError,
      lastStatusCode: row.lastStatusCode,
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
      payload,
    };
  }

  /** Puts an exhausted delivery back in the queue - nothing is ever discarded. */
  async retry(id: string, actorId: string) {
    const row = await this.prisma.eventDelivery.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Event delivery not found.' });
    }
    if (row.status === 'DELIVERED') {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'This event has already been delivered.',
      });
    }

    await this.prisma.eventDelivery.update({
      where: { id },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lockedAt: null },
    });
    await this.prisma.auditLog.create({
      data: { action: 'EVENT_RETRIED', actorId, entity: 'EventDelivery', entityId: id },
    });
    return this.findOne(id);
  }

  /** Fires a sample event so an integration can be verified before it goes live. */
  async sendTest(config: ForwardConfig, actorId: string, label: string) {
    if (!this.isEnabled(config)) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Configure a destination URL before sending a test event.',
      });
    }

    const deliveryId = crypto.randomUUID();
    const payload = this.buildPayload(deliveryId, config, {
      codeId: 'test-code',
      batchId: 'test-batch',
      batchName: 'Test batch',
      sku: 'TEST-SKU',
      surveyType: 'NATIVE',
      surveyRef: label,
      surveyTitle: label,
      couponTypeCode: 'TEST',
      couponValue: null,
      email: `test+${deliveryId}@example.com`,
      answers: { q1: 'This is a test event.' },
      completedAt: new Date(),
    });

    const secret = config.secretEncrypted ? this.crypto.decrypt(config.secretEncrypted) : null;
    const result = await this.dispatcher.send(
      config.target,
      config.url as string,
      secret,
      JSON.stringify(payload),
      deliveryId,
      null,
    );

    await this.prisma.auditLog.create({
      data: {
        action: 'EVENT_TEST_SENT',
        actorId,
        entity: 'Survey',
        entityId: label,
        meta: JSON.stringify({ ok: result.ok, statusCode: result.statusCode }),
      },
    });

    return { ok: result.ok, statusCode: result.statusCode, error: result.error };
  }

  private safeEndpoint(value: string): string {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return value;
    }
  }
}
