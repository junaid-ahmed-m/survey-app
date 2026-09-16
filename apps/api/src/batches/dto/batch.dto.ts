import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SURVEY_TYPES } from '../../common/constants';

export class CreateBatchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Product identifier printed on the pack this batch belongs to. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._\/-]*$/, {
    message: 'SKU may only contain letters, numbers and . _ / -',
  })
  sku?: string;

  @IsIn(SURVEY_TYPES as unknown as string[])
  surveyType!: string;

  /** Native Survey id or Contentful entry id. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  surveyId?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'Survey URL must be a valid absolute URL.' })
  @MaxLength(500)
  surveyUrl?: string;

  @IsString()
  @MaxLength(40)
  couponType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  @Matches(/^[A-Za-z0-9-]*$/, { message: 'Prefix may only contain letters, numbers and dashes.' })
  prefix?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  charset?: string;

  @IsInt()
  @Min(6, { message: 'Code length must be at least 6 characters to stay guess-proof.' })
  @Max(32)
  codeLength!: number;

  /** Above 10 000 the codes are produced by the background worker. */
  @IsInt()
  @Min(1)
  @Max(1000000)
  quantity!: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateBatchStatusDto {
  @IsIn(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'])
  status!: string;
}

export class ListBatchesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}

export class ListCodesQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}

export class PreviewCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(12)
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  charset?: string;

  @IsInt()
  @Min(6)
  @Max(32)
  codeLength!: number;
}
