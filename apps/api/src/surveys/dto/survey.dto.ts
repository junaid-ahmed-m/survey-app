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

export class CreateSurveyDto {
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

export class UpdateSurveyDto {
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
