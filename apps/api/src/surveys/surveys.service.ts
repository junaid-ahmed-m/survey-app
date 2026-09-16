import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSurveyDto, UpdateSurveyDto } from './dto/survey.dto';
import { SurveyDefinition, SurveyQuestion } from './survey.types';

@Injectable()
export class SurveysService {
  constructor(private readonly prisma: PrismaService) {}

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

  async list() {
    const surveys = await this.prisma.survey.findMany({ orderBy: { createdAt: 'desc' } });
    return surveys.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      isActive: s.isActive,
      questionCount: this.toDefinition(s).questions.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  async findOne(id: string) {
    const survey = await this.prisma.survey.findUnique({ where: { id } });
    if (!survey) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Survey not found.' });
    }
    return { ...this.toDefinition(survey), isActive: survey.isActive };
  }

  async getDefinition(id: string): Promise<SurveyDefinition | null> {
    const survey = await this.prisma.survey.findFirst({ where: { id, isActive: true } });
    return survey ? this.toDefinition(survey) : null;
  }

  async create(dto: CreateSurveyDto) {
    const survey = await this.prisma.survey.create({
      data: {
        title: dto.title,
        description: dto.description,
        questions: JSON.stringify(this.withIds(dto.questions)),
        isActive: dto.isActive ?? true,
      },
    });
    return this.findOne(survey.id);
  }

  async update(id: string, dto: UpdateSurveyDto) {
    await this.findOne(id);
    await this.prisma.survey.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        isActive: dto.isActive,
        ...(dto.questions ? { questions: JSON.stringify(this.withIds(dto.questions)) } : {}),
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
