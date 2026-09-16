import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FORWARD_TARGETS } from '../../common/constants';

/** Where the answers are pushed once a redemption commits. */
export class SurveyForwardingDto {
  @IsOptional()
  @IsIn(FORWARD_TARGETS as unknown as string[])
  forwardTarget?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  forwardUrl?: string;

  /** Webhook signing secret or RudderStack write key. Blank on update = keep the stored one. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  forwardSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  forwardEventName?: string;

  /** false = this platform keeps no answers or e-mail for the survey. */
  @IsOptional()
  @IsBoolean()
  retainResponses?: boolean;
}

export class SurveyOptionDto {
  @IsString()
  @MaxLength(120)
  value!: string;

  @IsString()
  @MaxLength(200)
  label!: string;
}

export class SurveyQuestionDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsIn(['single_choice', 'multi_choice', 'rating', 'text', 'textarea', 'nps'])
  type!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  helpText?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SurveyOptionDto)
  options?: SurveyOptionDto[];

  @IsOptional()
  @IsInt()
  min?: number;

  @IsOptional()
  @IsInt()
  max?: number;
}

export class CreateSurveyDto extends SurveyForwardingDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionDto)
  questions!: SurveyQuestionDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSurveyDto extends SurveyForwardingDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionDto)
  questions?: SurveyQuestionDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
