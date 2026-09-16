import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventDelivery } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { assertSafeDestinationUrl } from './event-safety.util';

export interface SendResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  /** A 4xx that will never succeed on retry. */
  permanent: boolean;
}

const CLAIM_SIZE = 25;
const MAX_LOOPS = 4;
const REQUEST_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 5 * 60_000;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

/**
 * Drains the `EventDelivery` outbox.
 *
 * The row is written inside the redemption transaction, so once a consumer sees
 * "thank you" the event is durable. Delivery then happens out of band: the
 * worker claims due rows with `FOR UPDATE SKIP LOCKED` (safe to run on several
 * instances), retries with exponential backoff and never drops a row - a crash
 * mid-flight only leaves a stale lock, which is reclaimed after 5 minutes.
 */
@Injectable()
export class EventDispatcherService {
  private readonly logger = new Logger(EventDispatcherService.name);
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  private get allowLocalUrls(): boolean {
    return (this.config.get<string>('env') ?? 'development') !== 'production';
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async drain(): Promise<void> {
    if (this.draining) return; // a slow destination must not stack up workers
    this.draining = true;
    try {
      await this.reclaimStaleLocks();
      for (let loop = 0; loop < MAX_LOOPS; loop += 1) {
        const claimed = await this.claim(CLAIM_SIZE);
        if (claimed.length === 0) return;
        for (const row of claimed) {
          await this.process(row);
        }
        if (claimed.length < CLAIM_SIZE) return;
      }
    } catch (error) {
      this.logger.error(`Outbox drain failed: ${(error as Error).message}`);
    } finally {
      this.draining = false;
    }
  }

  /** A worker that died mid-delivery leaves a DELIVERING row; put it back in the queue. */
  private async reclaimStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MS);
    const { count } = await this.prisma.eventDelivery.updateMany({
      where: { status: 'DELIVERING', lockedAt: { lt: cutoff } },
      data: { status: 'PENDING', lockedAt: null },
    });
    if (count > 0) {
      this.logger.warn(`Reclaimed ${count} stalled event deliveries.`);
    }
  }

  private claim(limit: number): Promise<EventDelivery[]> {
    // Single statement queue-pop: concurrent workers skip each other's rows
    // instead of blocking, and the attempt counter moves with the claim so a
    // hard crash can never produce an infinite retry loop.
    return this.prisma.$queryRaw<EventDelivery[]>`
      UPDATE "EventDelivery" AS d
         SET "status" = 'DELIVERING',
             "lockedAt" = now(),
             "attempts" = d."attempts" + 1,
             "updatedAt" = now()
       WHERE d."id" IN (
               SELECT p."id"
                 FROM "EventDelivery" AS p
                WHERE p."status" = 'PENDING'
                  AND p."nextAttemptAt" <= now()
                ORDER BY p."nextAttemptAt"
                  FOR UPDATE SKIP LOCKED
                LIMIT ${limit}
             )
      RETURNING d.*;
    `;
  }

  private async process(row: EventDelivery): Promise<void> {
    const secret = row.secretEncrypted ? this.safeDecrypt(row.secretEncrypted) : null;
    const result = await this.send(row.target, row.endpoint, secret, row.payload, row.id, row.codeId);

    if (result.ok) {
      await this.prisma.eventDelivery.update({
        where: { id: row.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          lockedAt: null,
          lastError: null,
          lastStatusCode: result.statusCode,
        },
      });
      return;
    }

    const exhausted = result.permanent || row.attempts >= row.maxAttempts;
    await this.prisma.eventDelivery.update({
      where: { id: row.id },
      data: {
        status: exhausted ? 'FAILED' : 'PENDING',
        lockedAt: null,
        lastError: (result.error ?? 'Unknown error').slice(0, 500),
        lastStatusCode: result.statusCode,
        nextAttemptAt: exhausted ? row.nextAttemptAt : this.nextAttempt(row.attempts),
      },
    });

    const reason = result.permanent ? 'permanently rejected' : `attempt ${row.attempts}/${row.maxAttempts}`;
    this.logger.warn(`Event ${row.id} -> ${row.target} failed (${reason}): ${result.error}`);
  }

  /** Exponential backoff with jitter so a recovering destination is not stampeded. */
  private nextAttempt(attempts: number): Date {
    const base = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(attempts - 1, 0), MAX_BACKOFF_MS);
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return new Date(Date.now() + base + jitter);
  }

  /**
   * Posts one event. Shared by the outbox worker and the "send test event"
   * button, so both exercise exactly the same transport.
   */
  async send(
    target: string,
    endpoint: string,
    secret: string | null,
    payload: string,
    deliveryId: string,
    idempotencyKey: string | null,
  ): Promise<SendResult> {
    let url: URL;
    try {
      url = assertSafeDestinationUrl(endpoint, this.allowLocalUrls);
    } catch (error) {
      return { ok: false, statusCode: null, error: (error as Error).message, permanent: true };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'qr-rewards-platform/1.0',
      'X-Event-Id': deliveryId,
    };
    const body = payload;
    let requestUrl = url.toString();

    if (target === 'RUDDERSTACK') {
      // RudderStack HTTP source: Basic auth with the write key as the username.
      requestUrl = `${requestUrl.replace(/\/+$/, '')}/v1/track`;
      headers.Authorization = `Basic ${Buffer.from(`${secret ?? ''}:`).toString('base64')}`;
    } else {
      headers['X-Idempotency-Key'] = idempotencyKey ?? deliveryId;
      if (secret) {
        const timestamp = Date.now().toString();
        headers['X-Webhook-Timestamp'] = timestamp;
        headers['X-Webhook-Signature'] = `sha256=${crypto
          .createHmac('sha256', secret)
          .update(`${timestamp}.${body}`)
          .digest('hex')}`;
      }
    }

    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body,
        // A 30x could point anywhere, including inside our own network.
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status >= 200 && response.status < 300) {
        return { ok: true, statusCode: response.status, error: null, permanent: false };
      }

      const detail = (await response.text().catch(() => '')).slice(0, 300);
      const permanent =
        response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status);
      return {
        ok: false,
        statusCode: response.status,
        error: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        permanent,
      };
    } catch (error) {
      // Network errors, DNS failures and timeouts are all worth retrying.
      return { ok: false, statusCode: null, error: (error as Error).message, permanent: false };
    }
  }

  private safeDecrypt(value: string): string | null {
    try {
      return this.crypto.decrypt(value);
    } catch {
      this.logger.error('Unable to decrypt a destination secret - check CODE_ENCRYPTION_KEY.');
      return null;
    }
  }
}
