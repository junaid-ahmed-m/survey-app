import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Coupon, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CodeGeneratorService } from '../common/crypto/code-generator.service';
import {
  CreateCouponTypeDto,
  ImportCouponsDto,
  ListCouponsQueryDto,
  UpdateCouponTypeDto,
} from './dto/coupon.dto';
import { maskEmail, maskSecret } from '../common/mask.util';
import { isUniqueViolation } from '../common/prisma-error.util';

@Injectable()
export class CouponsService {
  private readonly logger = new Logger(CouponsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly generator: CodeGeneratorService,
  ) {}

  // ---------------------------------------------------------------- types

  async listTypes() {
    const types = await this.prisma.couponType.findMany({ orderBy: { createdAt: 'desc' } });
    const counts = await this.prisma.coupon.groupBy({
      by: ['couponTypeCode', 'status'],
      _count: { _all: true },
    });

    return types.map((type) => {
      const forType = counts.filter((c) => c.couponTypeCode === type.code);
      const get = (status: string) => forType.find((c) => c.status === status)?._count._all ?? 0;
      return {
        ...type,
        inventory: {
          available: get('AVAILABLE'),
          reserved: get('RESERVED'),
          issued: get('ISSUED'),
          expired: get('EXPIRED'),
          total: forType.reduce((sum, c) => sum + c._count._all, 0),
        },
      };
    });
  }

  async createType(dto: CreateCouponTypeDto) {
    const code = dto.code.toUpperCase();
    const existing = await this.prisma.couponType.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException({ code: 'CONFLICT', message: 'A coupon type with this code already exists.' });
    }
    return this.prisma.couponType.create({
      data: {
        code,
        name: dto.name,
        description: dto.description,
        value: dto.value,
        lowStockThreshold: dto.lowStockThreshold ?? 10,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateType(code: string, dto: UpdateCouponTypeDto) {
    const existing = await this.prisma.couponType.findUnique({ where: { code: code.toUpperCase() } });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Coupon type not found.' });
    }
    return this.prisma.couponType.update({ where: { code: existing.code }, data: dto });
  }

  // ------------------------------------------------------------ inventory

  async importCoupons(dto: ImportCouponsDto) {
    const couponTypeCode = dto.couponTypeCode.toUpperCase();
    const type = await this.prisma.couponType.findUnique({ where: { code: couponTypeCode } });
    if (!type) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Coupon type not found.' });
    }

    let rawCodes: string[] = [];
    if (dto.codes?.length) {
      rawCodes = dto.codes.map((c) => c.trim().toUpperCase()).filter(Boolean);
    } else if (dto.generateCount) {
      rawCodes = this.generator.generateMany(dto.generateCount, {
        length: dto.generateLength ?? 10,
        prefix: dto.generatePrefix ?? couponTypeCode.slice(0, 4),
      });
    }

    if (rawCodes.length === 0) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Provide either a list of coupon codes or a number of coupons to generate.',
      });
    }

    const unique = Array.from(new Set(rawCodes));
    const rows = unique.map((value) => ({
      couponTypeCode,
      couponCodeEncrypted: this.crypto.encrypt(value),
      couponCodeHash: this.crypto.hash(value),
      value: dto.value ?? type.value,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      status: 'AVAILABLE',
    }));

    // Keep the import idempotent when a partner re-sends a file (SQLite has no `skipDuplicates`).
    const clashes = await this.prisma.coupon.findMany({
      where: { couponCodeHash: { in: rows.map((row) => row.couponCodeHash) } },
      select: { couponCodeHash: true },
    });
    const taken = new Set(clashes.map((c) => c.couponCodeHash));
    const fresh = rows.filter((row) => !taken.has(row.couponCodeHash));
    const created = fresh.length > 0 ? await this.prisma.coupon.createMany({ data: fresh }) : { count: 0 };

    return {
      requested: rawCodes.length,
      imported: created.count,
      skippedDuplicates: rawCodes.length - created.count,
    };
  }

  /** `revealEmails` is only true when the caller holds `emails:reveal` and asked for it. */
  async listCoupons(query: ListCouponsQueryDto, revealEmails = false) {
    const page = Math.max(Number.parseInt(query.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize ?? '25', 10) || 25, 1), 200);

    const where = {
      ...(query.couponTypeCode ? { couponTypeCode: query.couponTypeCode.toUpperCase() } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.coupon.count({ where }),
      this.prisma.coupon.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map((c) => ({
        id: c.id,
        couponTypeCode: c.couponTypeCode,
        // Clear text only through revealCoupon().
        couponCode: null,
        maskedCouponCode: maskSecret(this.safeDecrypt(c.couponCodeEncrypted)),
        value: c.value,
        status: c.status,
        issuedToEmail: revealEmails ? c.issuedToEmail : null,
        maskedIssuedToEmail: maskEmail(c.issuedToEmail),
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
      })),
    };
  }

  /** Decrypts a single coupon code. Callers must hold `coupons:reveal`; audited. */
  async revealCoupon(id: string, actorId: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Coupon not found.' });
    }
    const plain = this.safeDecrypt(coupon.couponCodeEncrypted);
    try {
      await this.prisma.auditLog.create({
        data: { action: 'COUPON_REVEALED', actorId, entity: 'Coupon', entityId: id },
      });
    } catch (error) {
      this.logger.warn(`Audit write failed: ${(error as Error).message}`);
    }
    return { id: coupon.id, couponCode: plain, maskedCouponCode: maskSecret(plain) };
  }

  async inventoryFor(couponTypeCode: string) {
    const available = await this.prisma.coupon.count({
      where: {
        couponTypeCode: couponTypeCode.toUpperCase(),
        status: 'AVAILABLE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return { available };
  }

  // ------------------------------------------------------- reserve / issue

  /**
   * Atomically reserves one coupon for a code.
   * Returns `null` when the inventory is exhausted - the caller must then refuse
   * to start the survey and must NOT mark the code as used.
   *
   * Calling it again for a code that already holds a coupon only extends the hold.
   */
  async reserveForCode(couponTypeCode: string, codeId: string, reservedUntil: Date): Promise<Coupon | null> {
    const alreadyReserved = await this.prisma.coupon.findUnique({ where: { codeId } });
    if (alreadyReserved && ['RESERVED', 'ISSUED'].includes(alreadyReserved.status)) {
      return this.prisma.coupon.update({ where: { id: alreadyReserved.id }, data: { reservedUntil } });
    }

    try {
      // Queue-pop in a single statement. FOR UPDATE SKIP LOCKED makes N concurrent
      // shoppers take N *different* coupons instead of all contending for the oldest
      // row, so there is no retry loop and no false "exhausted" under load.
      const rows = await this.prisma.$queryRaw<Coupon[]>`
        UPDATE "Coupon" AS c
           SET "status" = 'RESERVED',
               "codeId" = ${codeId},
               "reservedUntil" = ${reservedUntil},
               "updatedAt" = now()
         WHERE c."id" = (
                 SELECT p."id"
                   FROM "Coupon" AS p
                  WHERE p."couponTypeCode" = ${couponTypeCode.toUpperCase()}
                    AND p."status" = 'AVAILABLE'
                    AND p."codeId" IS NULL
                    AND (p."expiresAt" IS NULL OR p."expiresAt" > now())
                  ORDER BY p."createdAt"
                    FOR UPDATE SKIP LOCKED
                  LIMIT 1
               )
        RETURNING c.*;
      `;

      if (rows.length === 0) {
        this.logger.warn(`Coupon inventory for ${couponTypeCode.toUpperCase()} is exhausted.`);
        return null;
      }
      return rows[0];
    } catch (error) {
      // Two scans of the same QR raced each other: Coupon.codeId is unique, so the
      // loser is rejected and simply re-uses the coupon the winner reserved.
      if (isUniqueViolation(error, 'codeId')) {
        const existing = await this.prisma.coupon.findUnique({ where: { codeId } });
        if (existing) return existing;
      }
      throw error;
    }
  }

  /**
   * Flips the coupon held by `codeId` to ISSUED. The `status: 'RESERVED'` guard makes
   * this a compare-and-swap, so a hold released by the cleanup cron can never be
   * issued behind our back. Pass `client` to run inside the caller's transaction.
   * `email` is null when the survey opted out of storing consumer data here.
   */
  async issueForCode(
    codeId: string,
    email: string | null,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const claimed = await client.coupon.updateMany({
      where: { codeId, status: 'RESERVED' },
      data: { status: 'ISSUED', issuedToEmail: email, issuedAt: new Date(), reservedUntil: null },
    });
    if (claimed.count !== 1) return null;

    const issued = await client.coupon.findFirst({ where: { codeId, status: 'ISSUED' } });
    if (!issued) return null;

    return {
      code: this.safeDecrypt(issued.couponCodeEncrypted),
      value: issued.value,
      couponTypeCode: issued.couponTypeCode,
      expiresAt: issued.expiresAt,
    };
  }

  async releaseForCode(codeId: string) {
    await this.prisma.coupon.updateMany({
      where: { codeId, status: 'RESERVED' },
      data: { status: 'AVAILABLE', codeId: null, reservedUntil: null },
    });
  }

  /** Puts coupons whose reservation window elapsed back into the pool. */
  async releaseExpiredReservations(): Promise<number> {
    // Single conditional update: a hold that was extended between the read and the
    // write is no longer stale, so the WHERE clause simply skips it.
    const result = await this.prisma.coupon.updateMany({
      where: { status: 'RESERVED', reservedUntil: { lt: new Date() } },
      data: { status: 'AVAILABLE', codeId: null, reservedUntil: null },
    });
    return result.count;
  }

  async expireOutdatedCoupons(): Promise<number> {
    const result = await this.prisma.coupon.updateMany({
      where: { status: 'AVAILABLE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }

  private safeDecrypt(payload: string): string {
    try {
      return this.crypto.decrypt(payload);
    } catch {
      return '••••••••';
    }
  }
}
