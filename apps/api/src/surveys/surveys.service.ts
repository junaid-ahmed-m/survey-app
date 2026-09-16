import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Survey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { assertSafeDestinationUrl } from '../events/event-safety.util';
import { ForwardConfig } from '../events/events.service';
import { CreateSurveyDto, SurveyForwardingDto, UpdateSurveyDto } from './dto/survey.dto';
import { SurveyDefinition, SurveyQuestion } from './survey.types';

@Injectable()
export class SurveysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  private toDefinition(survey: {
    id: string;
    title: string;
    description: string | null;
    questions: string;
  }): SurveyDefinition {
    let questions: SurveyQuestion[] = [];
    try {
      questions = JSON.parse(survey.questions) as SurveyQuestion[];
    } catch {
      questions = [];
    }
    return {
      id: survey.id,
      title: survey.title,
      description: survey.description,
      questions,
    };
  }

  private withIds(questions: CreateSurveyDto['questions']): SurveyQuestion[] {
    return questions.map((q, index) => ({
      ...q,
      id: q.id && q.id.trim() ? q.id.trim() : `q${index + 1}`,
      required: q.required ?? true,
    })) as SurveyQuestion[];
  }

  /** The secret is write-only: callers only ever learn whether one is stored. */
  private forwardingView(survey: Survey) {
    return {
      forwardTarget: survey.forwardTarget,
      forwardUrl: survey.forwardUrl,
      forwardEventName: survey.forwardEventName,
      forwardSecretSet: Boolean(survey.forwardSecretEncrypted),
      retainResponses: survey.retainResponses,
    };
  }

  /**
   * Builds the persisted forwarding columns. The URL is validated here (and again
   * before every request) so an admin cannot point the platform at an internal
   * address, and the credential is encrypted at rest like every other secret.
   */
  private forwardingData(dto: SurveyForwardingDto, existing?: Survey) {
    const target = dto.forwardTarget ?? existing?.forwardTarget ?? 'NONE';
    const url = (dto.forwardUrl ?? existing?.forwardUrl ?? '').trim() || null;

    if (target !== 'NONE') {
      if (!url) {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'A destination URL is required when forwarding is enabled.',
        });
      }
      const allowLocal = (this.config.get<string>('env') ?? 'development') !== 'production';
      assertSafeDestinationUrl(url, allowLocal);
    }

    const secretProvided = typeof dto.forwardSecret === 'string' && dto.forwardSecret.trim().length > 0;
    if (target === 'RUDDERSTACK' && !secretProvided && !existing?.forwardSecretEncrypted) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'RudderStack needs a write key.',
      });
    }

    return {
      forwardTarget: target,
      forwardUrl: target === 'NONE' ? null : url,
      forwardEventName:
        (dto.forwardEventName ?? existing?.forwardEventName ?? '').trim() || 'Survey Completed',
      ...(secretProvided
        ? { forwardSecretEncrypted: this.crypto.encrypt((dto.forwardSecret as string).trim()) }
        : {}),
      ...(target === 'NONE' ? { forwardSecretEncrypted: null } : {}),
      retainResponses: dto.retainResponses ?? existing?.retainResponses ?? true,
    };
  }

  async list() {
    const surveys = await this.prisma.survey.findMany({ orderBy: { createdAt: 'desc' } });
    return surveys.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      isActive: s.isActive,
      questionCount: this.toDefinition(s).questions.length,
      ...this.forwardingView(s),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async findOne(id: string) {
    const survey = await this.prisma.survey.findUnique({ where: { id } });
    if (!survey) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Survey not found.' });
    }
    return { ...this.toDefinition(survey), isActive: survey.isActive, ...this.forwardingView(survey) };
  }

  async getDefinition(id: string): Promise<SurveyDefinition | null> {
    const survey = await this.prisma.survey.findFirst({ where: { id, isActive: true } });
    return survey ? this.toDefinition(survey) : null;
  }

  /** Used by the redemption flow to decide where the answers go and what to keep. */
  async getForwarding(
    id: string,
  ): Promise<{ config: ForwardConfig; retainResponses: boolean; title: string } | null> {
    const survey = await this.prisma.survey.findUnique({ where: { id } });
    if (!survey) return null;
    return {
      config: {
        target: survey.forwardTarget,
        url: survey.forwardUrl,
        secretEncrypted: survey.forwardSecretEncrypted,
        eventName: survey.forwardEventName,
      },
      retainResponses: survey.retainResponses,
      title: survey.title,
    };
  }

  async create(dto: CreateSurveyDto) {
    const survey = await this.prisma.survey.create({
      data: {
        title: dto.title,
        description: dto.description,
        questions: JSON.stringify(this.withIds(dto.questions)),
        isActive: dto.isActive ?? true,
        ...this.forwardingData(dto),
      },
    });
    return this.findOne(survey.id);
  }

  async update(id: string, dto: UpdateSurveyDto) {
    const existing = await this.prisma.survey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Survey not found.' });
    }
    await this.prisma.survey.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        isActive: dto.isActive,
        ...(dto.questions ? { questions: JSON.stringify(this.withIds(dto.questions)) } : {}),
        ...this.forwardingData(dto, existing),
      },
    });
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    const inUse = await this.prisma.batch.count({ where: { surveyType: 'NATIVE', surveyId: id } });
    if (inUse > 0) {
      // Keep referential sanity - archive instead of deleting.
      await this.prisma.survey.update({ where: { id }, data: { isActive: false } });
      return { deleted: false, archived: true };
    }
    await this.prisma.survey.delete({ where: { id } });
    return { deleted: true, archived: false };
  }
}
