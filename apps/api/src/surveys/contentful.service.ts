import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SurveyDefinition, SurveyQuestion } from './survey.types';

interface ContentfulEntry {
  sys: { id: string };
  fields: Record<string, any>;
}

interface ContentfulResponse {
  items: ContentfulEntry[];
  includes?: { Entry?: ContentfulEntry[] };
}

/**
 * Minimal Contentful Delivery API client (no SDK dependency).
 *
 * Expected content model (field ids are matched leniently):
 *   survey        : title, description, questions[] (links)
 *   surveyQuestion: label/question, type, required, helpText, options[] (strings or
 *                   objects with value/label), min, max
 */
@Injectable()
export class ContentfulService {
  private readonly logger = new Logger(ContentfulService.name);
  private readonly cache = new Map<string, { expires: number; value: SurveyDefinition }>();
  private readonly cacheTtlMs = 60_000;

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    const { spaceId, accessToken } = this.config.get('contentful') as {
      spaceId: string;
      accessToken: string;
    };
    return Boolean(spaceId && accessToken);
  }

  async fetchSurvey(entryId: string): Promise<SurveyDefinition> {
    const cached = this.cache.get(entryId);
    if (cached && cached.expires > Date.now()) return cached.value;

    if (!this.isConfigured) {
      throw new ServiceUnavailableException({
        code: 'CONTENTFUL_NOT_CONFIGURED',
        message: 'The survey provider is not configured. Please try again later.',
      });
    }

    const { spaceId, environment, accessToken } = this.config.get('contentful') as {
      spaceId: string;
      environment: string;
      accessToken: string;
    };

    const url =
      `https://cdn.contentful.com/spaces/${encodeURIComponent(spaceId)}` +
      `/environments/${encodeURIComponent(environment || 'master')}/entries` +
      `?sys.id=${encodeURIComponent(entryId)}&include=3`;

    let payload: ContentfulResponse;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        throw new Error(`Contentful responded with ${response.status}`);
      }
      payload = (await response.json()) as ContentfulResponse;
    } catch (error) {
      this.logger.error(`Contentful fetch failed for entry ${entryId}: ${(error as Error).message}`);
      throw new ServiceUnavailableException({
        code: 'SURVEY_UNAVAILABLE',
        message: 'We could not load the survey right now. Please try again later.',
      });
    }

    const entry = payload.items?.[0];
    if (!entry) {
      throw new ServiceUnavailableException({
        code: 'SURVEY_UNAVAILABLE',
        message: 'The survey linked to this code could not be found.',
      });
    }

    const definition = this.mapEntry(entry, payload.includes?.Entry ?? []);
    this.cache.set(entryId, { expires: Date.now() + this.cacheTtlMs, value: definition });
    return definition;
  }

  private mapEntry(entry: ContentfulEntry, included: ContentfulEntry[]): SurveyDefinition {
    const byId = new Map(included.map((i) => [i.sys.id, i]));
    const fields = entry.fields ?? {};
    const rawQuestions: any[] =
      fields.questions ?? fields.surveyQuestions ?? fields.surveyQuestion ?? fields.items ?? [];

    const questions: SurveyQuestion[] = rawQuestions
      .map((raw, index) => {
        const resolved = raw?.sys?.id ? byId.get(raw.sys.id) : undefined;
        const qf = resolved?.fields ?? (raw?.fields ?? raw) ?? {};
        const label = qf.label ?? qf.question ?? qf.title ?? '';
        if (!label) return null;

        const options = (qf.options ?? qf.choices ?? qf.answers ?? []).map((opt: any) =>
          typeof opt === 'string'
            ? { value: opt, label: opt }
            : { value: String(opt.value ?? opt.label), label: String(opt.label ?? opt.value) },
        );

        return {
          id: String(resolved?.sys?.id ?? qf.id ?? `q${index + 1}`),
          type: this.mapType(qf.type ?? qf.questionType, options.length > 0),
          label: this.toPlainText(label),
          helpText: this.toPlainText(qf.helpText ?? qf.description) || undefined,
          required: qf.required !== false,
          options: options.length ? options : undefined,
          min: typeof qf.min === 'number' ? qf.min : undefined,
          max: typeof qf.max === 'number' ? qf.max : undefined,
        } as SurveyQuestion;
      })
      .filter(Boolean) as SurveyQuestion[];

    return {
      id: entry.sys.id,
      title: this.toPlainText(fields.title ?? fields.name) || 'Survey',
      description: this.toPlainText(fields.description) || null,
      questions,
    };
  }

  /** Contentful long-text fields can be Rich Text documents - flatten them to plain text. */
  private toPlainText(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((v) => this.toPlainText(v)).join(' ').trim();
    if (typeof value === 'object') {
      const node = value as { value?: unknown; content?: unknown };
      if (typeof node.value === 'string') return node.value;
      if (node.content) return this.toPlainText(node.content);
      return '';
    }
    return String(value);
  }

  private mapType(raw: unknown, hasOptions: boolean): SurveyQuestion['type'] {
    const value = String(raw ?? '').toLowerCase().replace(/[\s-]/g, '_');
    const allowed: SurveyQuestion['type'][] = [
      'single_choice',
      'multi_choice',
      'rating',
      'text',
      'textarea',
      'nps',
    ];
    const needsOptions: SurveyQuestion['type'][] = ['single_choice', 'multi_choice'];
    if (allowed.includes(value as SurveyQuestion['type'])) {
      const type = value as SurveyQuestion['type'];
      // A choice question without options would render an empty step - degrade to free text.
      return needsOptions.includes(type) && !hasOptions ? 'text' : type;
    }
    if (['radio', 'select', 'choice'].includes(value)) return hasOptions ? 'single_choice' : 'text';
    if (['checkbox', 'multiselect', 'multiple'].includes(value)) return hasOptions ? 'multi_choice' : 'text';
    if (['long_text', 'paragraph'].includes(value)) return 'textarea';
    if (['star', 'stars', 'score'].includes(value)) return 'rating';
    return hasOptions ? 'single_choice' : 'text';
  }
}
