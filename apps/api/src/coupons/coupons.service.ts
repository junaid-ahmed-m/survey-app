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

  async listCoupons(query: ListCouponsQueryDto) {
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
        couponCode: this.safeDecrypt(c.couponCodeEncrypted),
        value: c.value,
        status: c.status,
        issuedToEmail: c.issuedToEmail,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
      })),
    };
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
   */
  async reserveForCode(couponTypeCode: string, codeId: string, reservedUntil: Date): Promise<Coupon | null> {
    const alreadyReserved = await this.prisma.coupon.findUnique({ where: { codeId } });
    if (alreadyReserved && ['RESERVED', 'ISSUED'].includes(alreadyReserved.status)) {
      return this.prisma.coupon.update({ where: { id: alreadyReserved.id }, data: { reservedUntil } });
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = await this.prisma.coupon.findFirst({
        where: {
          couponTypeCode: couponTypeCode.toUpperCase(),
          status: 'AVAILABLE',
          codeId: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!candidate) return null;

      // Conditional update = optimistic lock; only one concurrent request wins.
      let updated: Prisma.BatchPayload;
      try {
        updated = await this.prisma.coupon.updateMany({
          where: { id: candidate.id, status: 'AVAILABLE', codeId: null },
          data: { status: 'RESERVED', codeId, reservedUntil },
        });
      } catch (error) {
        // Two scans of the same QR raced each other: the code already owns a coupon.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          String(error.meta?.target ?? '').includes('codeId')
        ) {
          const existing = await this.prisma.coupon.findUnique({ where: { codeId } });
          if (existing) return existing;
          continue;
        }
        throw error;
      }

      if (updated.count === 1) {
        return this.prisma.coupon.findUnique({ where: { id: candidate.id } });
      }
    }

    this.logger.warn(`Could not reserve a ${couponTypeCode} coupon after 5 attempts (high contention).`);
    return null;
  }

  async issueForCode(codeId: string, email: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { codeId } });
    if (!coupon) return null;
    const issued = await this.prisma.coupon.update({
      where: { id: coupon.id },
      data: { status: 'ISSUED', issuedToEmail: email, issuedAt: new Date(), reservedUntil: null },
    });
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
    const expired = await this.prisma.coupon.findMany({
      where: { status: 'RESERVED', reservedUntil: { lt: new Date() } },
      select: { id: true },
    });
    if (expired.length === 0) return 0;

    const result = await this.prisma.coupon.updateMany({
      where: { id: { in: expired.map((c) => c.id) } },
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
