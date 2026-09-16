import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Batch } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CodeGeneratorService } from '../common/crypto/code-generator.service';

/**
 * Batches at or below this size are produced inside the create request; larger
 * ones are queued and filled by the cron so the API is never blocked encrypting
 * hundreds of thousands of codes on the event loop.
 */
export const INLINE_GENERATION_LIMIT = 10_000;

/** Rows per insert round trip. */
const INSERT_CHUNK = 500;
/** Codes produced between two yields to the event loop. */
const SLICE_SIZE = 2_000;
/** How long one cron tick may keep working before releasing the batch. */
const TICK_BUDGET_MS = 5_000;
/** A worker that died mid-slice releases its claim after this long. */
const STALE_LOCK_MS = 5 * 60_000;
/** Consecutive failing slices before the batch is parked as FAILED. */
const MAX_ATTEMPTS = 5;

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

@Injectable()
export class CodeGenerationService {
  private readonly logger = new Logger(CodeGenerationService.name);
  private working = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly generator: CodeGeneratorService,
  ) {}

  /**
   * Writes up to `count` codes for a batch and returns how many were stored.
   * Duplicates are filtered against the unique `codeHash` index and retried, so
   * a collision costs a round trip instead of failing the whole slice.
   */
  async generateInto(batch: Batch, count: number): Promise<number> {
    const options = {
      charset: batch.charset,
      length: batch.codeLength,
      prefix: batch.prefix ?? '',
    };

    let inserted = 0;
    let round = 0;

    while (inserted < count && round < 10) {
      const candidates = this.generator.generateMany(count - inserted, options);

      for (let i = 0; i < candidates.length; i += INSERT_CHUNK) {
        const chunk = candidates.slice(i, i + INSERT_CHUNK);
        const rows = chunk.map((code) => ({
          batchId: batch.id,
          codeHash: this.crypto.hash(code),
          codeEncrypted: this.crypto.encrypt(code),
          codeMasked: this.crypto.mask(code),
          status: 'UNUSED',
        }));

        const clashes = await this.prisma.code.findMany({
          where: { codeHash: { in: rows.map((row) => row.codeHash) } },
          select: { codeHash: true },
        });
        const taken = new Set(clashes.map((c) => c.codeHash));
        const fresh = rows.filter((row) => !taken.has(row.codeHash));
        if (fresh.length === 0) continue;

        const result = await this.prisma.code.createMany({ data: fresh });
        inserted += result.count;
      }

      round += 1;
    }

    return inserted;
  }

  // ------------------------------------------------------------- the worker

  @Cron(CronExpression.EVERY_10_SECONDS)
  async drain(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      await this.reclaimStaleLocks();
      const batch = await this.claim();
      if (batch) await this.fill(batch);
    } catch (error) {
      this.logger.error(`Code generation tick failed: ${(error as Error).message}`);
    } finally {
      this.working = false;
    }
  }

  /** A process that crashed mid-slice would otherwise hold its batch forever. */
  private async reclaimStaleLocks(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_LOCK_MS);
    const released = await this.prisma.batch.updateMany({
      where: { generationStatus: 'RUNNING', generationLockedAt: { lt: cutoff } },
      data: { generationStatus: 'PENDING', generationLockedAt: null },
    });
    if (released.count > 0) {
      this.logger.warn(`Reclaimed ${released.count} stalled code generation job(s).`);
    }
  }

  /**
   * Takes ownership of the oldest queued batch. `FOR UPDATE SKIP LOCKED` means
   * several API instances can run this cron without ever picking the same batch.
   */
  private async claim(): Promise<Batch | null> {
    const rows = await this.prisma.$queryRaw<Batch[]>`
      UPDATE "Batch" AS b
         SET "generationStatus" = 'RUNNING',
             "generationLockedAt" = now(),
             "generationAttempts" = b."generationAttempts" + 1,
             "generationStartedAt" = COALESCE(b."generationStartedAt", now()),
             "updatedAt" = now()
       WHERE b."id" = (
               SELECT p."id"
                 FROM "Batch" AS p
                WHERE p."generationStatus" = 'PENDING'
                ORDER BY p."createdAt"
                  FOR UPDATE SKIP LOCKED
                LIMIT 1
             )
      RETURNING b.*;
    `;
    return rows[0] ?? null;
  }

  /**
   * Produces codes for the claimed batch until the tick budget runs out, saving
   * progress after every slice so the admin UI advances while it works. The
   * batch goes back to PENDING for the next tick until it is full.
   */
  private async fill(batch: Batch): Promise<void> {
    const startedAt = Date.now();
    let produced = batch.generatedCount;

    try {
      while (produced < batch.quantity && Date.now() - startedAt < TICK_BUDGET_MS) {
        const slice = Math.min(SLICE_SIZE, batch.quantity - produced);
        const inserted = await this.generateInto(batch, slice);

        if (inserted === 0) {
          throw new Error('No codes could be stored - the code space may be exhausted.');
        }

        produced += inserted;
        await this.prisma.batch.update({
          where: { id: batch.id },
          data: { generatedCount: produced },
        });

        await nextTick();
      }
    } catch (error) {
      await this.fail(batch, error as Error);
      return;
    }

    const done = produced >= batch.quantity;
    await this.prisma.batch.update({
      where: { id: batch.id },
      data: {
        // Back to PENDING so the next tick continues where this one stopped.
        generationStatus: done ? 'COMPLETE' : 'PENDING',
        generationLockedAt: null,
        generationAttempts: 0,
        generationError: null,
        ...(done ? { generationCompletedAt: new Date() } : {}),
      },
    });

    if (done) {
      this.logger.log(`Batch ${batch.id}: generated ${produced}/${batch.quantity} codes.`);
    }
  }

  /** Transient problems are retried; a batch that keeps failing is parked. */
  private async fail(batch: Batch, error: Error): Promise<void> {
    const exhausted = batch.generationAttempts >= MAX_ATTEMPTS;
    this.logger.error(
      `Batch ${batch.id} generation ${exhausted ? 'failed' : 'slice failed'}: ${error.message}`,
    );
    await this.prisma.batch.update({
      where: { id: batch.id },
      data: {
        generationStatus: exhausted ? 'FAILED' : 'PENDING',
        generationLockedAt: null,
        generationError: error.message.slice(0, 500),
      },
    });
  }
}
