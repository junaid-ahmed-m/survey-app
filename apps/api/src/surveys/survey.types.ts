export type QuestionType =
  | 'single_choice'
  | 'multi_choice'
  | 'rating'
  | 'text'
  | 'textarea'
  | 'nps';

export interface SurveyQuestion {
  id: string;
  type: QuestionType;
  label: string;
  helpText?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface SurveyDefinition {
  id: string;
  title: string;
  description?: string | null;
  questions: SurveyQuestion[];
}

/** What the public app receives after a code has been verified. */
export type ResolvedSurvey =
  | { type: 'NATIVE'; survey: SurveyDefinition }
  | { type: 'CONTENTFUL'; survey: SurveyDefinition }
  | { type: 'THIRD_PARTY'; url: string; returnUrl: string };
