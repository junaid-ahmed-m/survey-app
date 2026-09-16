import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { maskEmail } from '../common/mask.util';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const [codeStats, couponStats, batches, responses, recent, couponAlerts] = await Promise.all([
      this.prisma.code.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.coupon.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.batch.count(),
      this.prisma.surveyResponse.count(),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      this.couponAlerts(),
    ]);

    const pick = (rows: { status: string; _count: { _all: number } }[], status: string) =>
      rows.find((r) => r.status === status)?._count._all ?? 0;

    const totalCodes = codeStats.reduce((sum, r) => sum + r._count._all, 0);
    const usedCodes = pick(codeStats, 'USED');

    return {
      codes: {
        total: totalCodes,
        unused: pick(codeStats, 'UNUSED'),
        used: usedCodes,
        disabled: pick(codeStats, 'DISABLED'),
        redemptionRate: totalCodes ? Math.round((usedCodes / totalCodes) * 1000) / 10 : 0,
      },
      coupons: {
        available: pick(couponStats, 'AVAILABLE'),
        reserved: pick(couponStats, 'RESERVED'),
        issued: pick(couponStats, 'ISSUED'),
        expired: pick(couponStats, 'EXPIRED'),
      },
      couponAlerts,
      batches,
      responses,
      recentActivity: recent.map((a) => ({
        id: a.id,
        action: a.action,
        entityId: a.entityId,
        createdAt: a.createdAt,
      })),
    };
  }

  /**
   * Per-type stock warning. An empty pool blocks redemptions (the code is not
   * consumed, the shopper is asked to retry), so each type is checked against its
   * own `lowStockThreshold` rather than a single global number.
   */
  async couponAlerts() {
    const [types, counts, batches] = await Promise.all([
      this.prisma.couponType.findMany({ where: { isActive: true } }),
      this.prisma.coupon.groupBy({
        by: ['couponTypeCode', 'status'],
        _count: { _all: true },
      }),
      this.prisma.batch.groupBy({
        by: ['couponType'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);

    const activeBatchesFor = (code: string) =>
      batches.find((b) => b.couponType === code)?._count._all ?? 0;

    return types
      .map((type) => {
        const forType = counts.filter((c) => c.couponTypeCode === type.code);
        const get = (status: string) => forType.find((c) => c.status === status)?._count._all ?? 0;
        const available = get('AVAILABLE');
        return {
          couponTypeCode: type.code,
          name: type.name,
          available,
          reserved: get('RESERVED'),
          threshold: type.lowStockThreshold,
          activeBatches: activeBatchesFor(type.code),
          severity: available === 0 ? ('EMPTY' as const) : ('LOW' as const),
        };
      })
      .filter((alert) => alert.available <= alert.threshold)
      // Empty pools first, then the closest to running out.
      .sort((a, b) => a.available - b.available);
  }

  /** `reveal` is only true for callers holding `emails:reveal`. */
  async responses(
    query: { batchId?: string; page?: string; pageSize?: string },
    reveal = false,
  ) {
    const page = Math.max(Number.parseInt(query.page ?? '1', 10) || 1, 1);
    const pageSize = Math.min(Math.max(Number.parseInt(query.pageSize ?? '25', 10) || 25, 1), 200);
    const where = query.batchId ? { batchId: query.batchId } : {};

    const [total, items] = await Promise.all([
      this.prisma.surveyResponse.count({ where }),
      this.prisma.surveyResponse.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const batchIds = Array.from(new Set(items.map((i) => i.batchId)));
    const batches = await this.prisma.batch.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(batches.map((b) => [b.id, b.name]));

    return {
      total,
      page,
      pageSize,
      items: items.map((r) => ({
        id: r.id,
        batchId: r.batchId,
        batchName: nameById.get(r.batchId) ?? null,
        surveyType: r.surveyType,
        email: reveal ? r.email : null,
        maskedEmail: maskEmail(r.email),
        completedAt: r.completedAt,
        answers: this.parse(r.answers),
      })),
    };
  }

  /** CSV of every response matching the filter. Audited, because it leaves the app. */
  async exportResponsesCsv(
    query: { batchId?: string },
    revealEmails: boolean,
    actor: { id: string },
  ): Promise<string> {
    const where = query.batchId ? { batchId: query.batchId } : {};
    const items = await this.prisma.surveyResponse.findMany({
      where,
      orderBy: { completedAt: 'desc' },
    });

    const batches = await this.prisma.batch.findMany({ select: { id: true, name: true } });
    const nameById = new Map(batches.map((b) => [b.id, b.name]));

    const answerKeys = Array.from(
      new Set(items.flatMap((r) => Object.keys(this.parse(r.answers)))),
    ).sort();

    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const cell = (value: unknown) =>
      Array.isArray(value) ? value.join(' | ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : value;

    const header = ['completed_at', 'batch', 'survey_type', 'email', ...answerKeys].map(escape);
    const lines = items.map((r) => {
      const answers = this.parse(r.answers);
      return [
        r.completedAt.toISOString(),
        nameById.get(r.batchId) ?? r.batchId,
        r.surveyType,
        revealEmails ? (r.email ?? '') : maskEmail(r.email),
        ...answerKeys.map((key) => cell(answers[key])),
      ]
        .map(escape)
        .join(',');
    });

    await this.audit('RESPONSES_EXPORTED', actor.id, query.batchId, {
      count: items.length,
      emails: revealEmails ? 'clear' : 'masked',
    });

    return [header.join(','), ...lines].join('\r\n');
  }

  private async audit(
    action: string,
    actorId: string,
    entityId?: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actorId,
          entity: 'SurveyResponse',
          entityId: entityId ?? null,
          meta: meta ? JSON.stringify(meta) : null,
        },
      });
    } catch {
      // Auditing must never block the response.
    }
  }

  private parse(value: string): Record<string, unknown> {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
