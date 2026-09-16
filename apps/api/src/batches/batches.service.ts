import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CodeGeneratorService, DEFAULT_CHARSET } from '../common/crypto/code-generator.service';
import { SurveysService } from '../surveys/surveys.service';
import {
  CreateBatchDto,
  ListBatchesQueryDto,
  ListCodesQueryDto,
  PreviewCodeDto,
  UpdateBatchStatusDto,
} from './dto/batch.dto';

const INSERT_CHUNK = 500;

@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly generator: CodeGeneratorService,
    private readonly surveys: SurveysService,
    private readonly config: ConfigService,
  ) {}

  private redeemUrl(code: string): string {
    return `${this.config.get<string>('publicAppUrl')}/read/${code}`;
  }

  previewStrength(dto: PreviewCodeDto) {
    const strength = this.generator.strength({ charset: dto.charset, length: dto.codeLength });
    const samples = Array.from({ length: 5 }, () =>
      this.generator.generateOne({ charset: dto.charset, length: dto.codeLength, prefix: dto.prefix }),
    );
    return { ...strength, samples, exampleUrl: this.redeemUrl(samples[0]) };
  }

  async create(dto: CreateBatchDto, createdById?: string) {
    await this.validateSurveyConfig(dto);

    const couponType = await this.prisma.couponType.findUnique({
      where: { code: dto.couponType.toUpperCase() },
    });
    if (!couponType) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Coupon type "${dto.couponType}" does not exist. Create it under Coupons first.`,
      });
    }

    const charset = this.generator.normalizeCharset(dto.charset ?? DEFAULT_CHARSET);
    const prefix = this.generator.normalizePrefix(dto.prefix);

    const strength = this.generator.strength({ charset, length: dto.codeLength });
    if (strength.combinations < dto.quantity * 1000) {
      throw new BadRequestException({
        code: 'WEAK_CODE_SPACE',
        message:
          'The configured charset/length is too small for this quantity. ' +
          'Increase the code length so codes stay hard to guess.',
      });
    }

    const batch = await this.prisma.batch.create({
      data: {
        name: dto.name,
        description: dto.description,
        sku: dto.sku?.trim().toUpperCase() || null,
        surveyType: dto.surveyType,
        surveyId: dto.surveyId,
        surveyUrl: dto.surveyUrl,
        couponType: couponType.code,
        prefix: prefix || null,
        charset,
        codeLength: dto.codeLength,
        quantity: dto.quantity,
        status: 'ACTIVE',
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById,
      },
    });

    const generated = await this.generateCodesForBatch(batch.id, dto.quantity, {
      charset,
      length: dto.codeLength,
      prefix,
    });

    return { ...(await this.findOne(batch.id)), generated };
  }

  /**
   * Generates and persists codes. Collisions with existing rows are detected by the
   * unique index on `codeHash`; those rows are simply retried with new values.
   */
  private async generateCodesForBatch(
    batchId: string,
    quantity: number,
    options: { charset: string; length: number; prefix: string },
  ): Promise<number> {
    let remaining = quantity;
    let inserted = 0;
    let round = 0;

    while (remaining > 0 && round < 10) {
      const candidates = this.generator.generateMany(remaining, options);
      const rows = candidates.map((code) => ({
        batchId,
        codeHash: this.crypto.hash(code),
        codeEncrypted: this.crypto.encrypt(code),
        codeMasked: this.crypto.mask(code),
        status: 'UNUSED',
      }));

      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        const chunk = rows.slice(i, i + INSERT_CHUNK);
        // SQLite has no `skipDuplicates`, so collisions are filtered explicitly.
        const clashes = await this.prisma.code.findMany({
          where: { codeHash: { in: chunk.map((row) => row.codeHash) } },
          select: { codeHash: true },
        });
        const taken = new Set(clashes.map((c) => c.codeHash));
        const fresh = chunk.filter((row) => !taken.has(row.codeHash));
        if (fresh.length === 0) continue;

        const result = await this.prisma.code.createMany({ data: fresh });
        inserted += result.count;
      }

      remaining = quantity - inserted;
      round += 1;
    }

    if (remaining > 0) {
      this.logger.error(`Batch ${batchId}: only ${inserted}/${quantity} codes could be generated.`);
    }
    return inserted;
  }

  private async validateSurveyConfig(dto: CreateBatchDto): Promise<void> {
    if (dto.surveyType === 'NATIVE') {
      if (!dto.surveyId) {
        throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Select a native survey.' });
      }
      const survey = await this.surveys.getDefinition(dto.surveyId);
      if (!survey) {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'The selected native survey does not exist or is inactive.',
        });
      }
    }
    if (dto.surveyType === 'CONTENTFUL' && !dto.surveyId) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'A Contentful entry id is required.' });
    }
    if (dto.surveyType === 'THIRD_PARTY' && !dto.surveyUrl) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'A third party survey URL is required.' });
    }
  }

  async list(query: ListBatchesQueryDto) {
    const page = Math.max(Number.parseInt(query.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize ?? '20', 10) || 20, 1), 100);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { sku: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, batches] = await Promise.all([
      this.prisma.batch.count({ where }),
      this.prisma.batch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const stats = await this.prisma.code.groupBy({
      by: ['batchId', 'status'],
      where: { batchId: { in: batches.map((b) => b.id) } },
      _count: { _all: true },
    });

    return {
      total,
      page,
      pageSize,
      items: batches.map((batch) => this.withStats(batch, stats)),
    };
  }

  private withStats(batch: any, stats: { batchId: string; status: string; _count: { _all: number } }[]) {
    const mine = stats.filter((s) => s.batchId === batch.id);
    const get = (status: string) => mine.find((s) => s.status === status)?._count._all ?? 0;
    return {
      ...batch,
      stats: {
        total: mine.reduce((sum, s) => sum + s._count._all, 0),
        unused: get('UNUSED'),
        used: get('USED'),
        disabled: get('DISABLED'),
      },
    };
  }

  async findOne(id: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id } });
    if (!batch) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Batch not found.' });
    }
    const stats = await this.prisma.code.groupBy({
      by: ['batchId', 'status'],
      where: { batchId: id },
      _count: { _all: true },
    });

    let surveyLabel: string | null = null;
    if (batch.surveyType === 'NATIVE' && batch.surveyId) {
      const survey = await this.prisma.survey.findUnique({ where: { id: batch.surveyId } });
      surveyLabel = survey?.title ?? null;
    }

    const inventory = await this.prisma.coupon.count({
      where: { couponTypeCode: batch.couponType, status: 'AVAILABLE' },
    });

    return { ...this.withStats(batch, stats), surveyLabel, couponsAvailable: inventory };
  }

  async updateStatus(id: string, dto: UpdateBatchStatusDto) {
    await this.findOne(id);
    await this.prisma.batch.update({ where: { id }, data: { status: dto.status } });
    return this.findOne(id);
  }

  async listCodes(batchId: string, query: ListCodesQueryDto) {
    await this.findOne(batchId);
    const page = Math.max(Number.parseInt(query.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize ?? '25', 10) || 25, 1), 200);

    const where = { batchId, ...(query.status ? { status: query.status } : {}) };

    const [total, codes] = await Promise.all([
      this.prisma.code.count({ where }),
      this.prisma.code.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: codes.map((code) => ({
        id: code.id,
        // Clear text is never part of a listing - see revealCode().
        code: null,
        masked: code.codeMasked,
        status: code.status,
        scanCount: code.scanCount,
        usedAt: code.usedAt,
        createdAt: code.createdAt,
        url: null,
      })),
    };
  }

  /** Decrypts a single code. Callers must hold `codes:reveal`; every read is audited. */
  async revealCode(codeId: string, actorId: string) {
    const code = await this.prisma.code.findUnique({ where: { id: codeId } });
    if (!code) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Code not found.' });
    }
    const plain = this.safeDecrypt(code.codeEncrypted);
    await this.audit('CODE_REVEALED', actorId, codeId);
    return { id: code.id, code: plain, masked: code.codeMasked, url: this.redeemUrl(plain) };
  }

  async exportCsv(batchId: string, actor: { id: string }): Promise<string> {
    const batch = await this.findOne(batchId);
    const codes = await this.prisma.code.findMany({
      where: { batchId },
      orderBy: { createdAt: 'asc' },
    });

    const header = ['batch', 'sku', 'code', 'url', 'status', 'used_at'];
    const escape = (value: string) => `"${String(value ?? '').replace(/"/g, '""')}"`;

    const lines = codes.map((code) => {
      const plain = this.safeDecrypt(code.codeEncrypted);
      return [
        batch.name,
        batch.sku ?? '',
        plain,
        this.redeemUrl(plain),
        code.status,
        code.usedAt?.toISOString() ?? '',
      ]
        .map(escape)
        .join(',');
    });

    await this.audit('CODES_EXPORTED', actor.id, batchId, { count: codes.length });

    return [header.join(','), ...lines].join('\r\n');
  }

  async qrDataUrl(codeId: string): Promise<{ code: string; url: string; dataUrl: string }> {
    const code = await this.prisma.code.findUnique({ where: { id: codeId } });
    if (!code) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Code not found.' });
    }
    const plain = this.safeDecrypt(code.codeEncrypted);
    const url = this.redeemUrl(plain);
    const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 512 });
    return { code: plain, url, dataUrl };
  }

  async qrPngBuffer(codeId: string): Promise<{ code: string; buffer: Buffer }> {
    const code = await this.prisma.code.findUnique({ where: { id: codeId } });
    if (!code) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Code not found.' });
    }
    const plain = this.safeDecrypt(code.codeEncrypted);
    const buffer = await QRCode.toBuffer(this.redeemUrl(plain), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
    });
    return { code: plain, buffer };
  }

  private async audit(
    action: string,
    actorId: string,
    entityId: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actorId,
          entity: 'Code',
          entityId,
          meta: meta ? JSON.stringify(meta) : null,
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
      return 'DECRYPT-ERROR';
    }
  }
}
