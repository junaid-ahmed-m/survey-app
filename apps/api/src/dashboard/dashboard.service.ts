import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const [codeStats, couponStats, batches, responses, recent] = await Promise.all([
      this.prisma.code.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.coupon.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.batch.count(),
      this.prisma.surveyResponse.count(),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    const pick = (rows: { status: string; _count: { _all: number } }[], status: string) =>
      rows.find((r) => r.status === status)?._count._all ?? 0;

    const totalCodes = codeStats.reduce((sum, r) => sum + r._count._all, 0);
    const usedCodes = pick(codeStats, 'USED');

    return {
      codes: {
        total: totalCodes,
        unused: pick(codeStats, 'UNUSED'),
        reserved: pick(codeStats, 'RESERVED'),
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

  async responses(query: { batchId?: string; page?: string; pageSize?: string }) {
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
        email: r.email,
        completedAt: r.completedAt,
        answers: this.parse(r.answers),
      })),
    };
  }

  private parse(value: string): Record<string, unknown> {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
