import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CodeGeneratorService, DEFAULT_CHARSET } from '../common/crypto/code-generator.service';
import { SurveysService } from '../surveys/surveys.service';
import { CodeGenerationService, INLINE_GENERATION_LIMIT } from './code-generation.service';
import {
  CreateBatchDto,
  ListBatchesQueryDto,
  ListCodesQueryDto,
  PreviewCodeDto,
  UpdateBatchStatusDto,
} from './dto/batch.dto';

/** Rows pulled per round trip while streaming a CSV export. */
const EXPORT_CHUNK = 1_000;

@Injectable()
export class BatchesService {
  private readonly logger = new Logger(BatchesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly generator: CodeGeneratorService,
    private readonly surveys: SurveysService,
    private readonly generation: CodeGenerationService,
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

    // Anything large is queued: encrypting hundreds of thousands of codes inside
    // the request would block the event loop and time the caller out.
    const inline = dto.quantity <= INLINE_GENERATION_LIMIT;

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
        generationStatus: inline ? 'COMPLETE' : 'PENDING',
        generationStartedAt: new Date(),
        ...(inline ? { generationCompletedAt: new Date() } : {}),
      },
    });

    let generated = 0;
    if (inline) {
      generated = await this.generation.generateInto(batch, dto.quantity);
      await this.prisma.batch.update({
        where: { id: batch.id },
        data: { generatedCount: generated },
      });
      if (generated < dto.quantity) {
        this.logger.error(`Batch ${batch.id}: only ${generated}/${dto.quantity} codes generated.`);
      }
    }

    return { ...(await this.findOne(batch.id)), generated, queued: !inline };
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
    const generated = Math.min(batch.generatedCount ?? 0, batch.quantity);
    return {
      ...batch,
      stats: {
        total: mine.reduce((sum, s) => sum + s._count._all, 0),
        unused: get('UNUSED'),
        used: get('USED'),
        disabled: get('DISABLED'),
      },
      generation: {
        status: batch.generationStatus,
        generated,
        total: batch.quantity,
        percent: batch.quantity > 0 ? Math.floor((generated / batch.quantity) * 100) : 100,
        error: batch.generationError ?? null,
        startedAt: batch.generationStartedAt ?? null,
        completedAt: batch.generationCompletedAt ?? null,
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
        // Every code in a batch shares one createdAt, so `id` is the only stable
        // sort key - ordering by the timestamp makes paging skip or repeat rows.
        orderBy: { id: 'asc' },
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

  /**
   * Streams the batch as CSV. A batch can hold millions of codes, so rows are
   * pulled in cursor-paged chunks and written straight to the response instead
   * of being decrypted into one big string in memory.
   */
  async streamCsv(
    batchId: string,
    actor: { id: string },
    write: (chunk: string) => Promise<void>,
  ): Promise<number> {
    const batch = await this.findOne(batchId);

    // Exporting half a batch would send an incomplete print file to a supplier.
    if (batch.generationStatus !== 'COMPLETE') {
      throw new ConflictException({
        code: 'GENERATION_IN_PROGRESS',
        message: 'This batch is still generating its codes. Please wait until it finishes.',
      });
    }

    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

    await write(['batch', 'sku', 'code', 'url', 'status', 'used_at'].join(',') + '\r\n');

    let cursor: string | undefined;
    let exported = 0;

    for (;;) {
      const rows = await this.prisma.code.findMany({
        where: { batchId },
        orderBy: { id: 'asc' },
        take: EXPORT_CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;

      await write(
        rows
          .map((code) => {
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
          })
          .join('\r\n') + '\r\n',
      );

      exported += rows.length;
      cursor = rows[rows.length - 1].id;
      if (rows.length < EXPORT_CHUNK) break;
    }

    await this.audit('CODES_EXPORTED', actor.id, batchId, { count: exported });
    return exported;
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
