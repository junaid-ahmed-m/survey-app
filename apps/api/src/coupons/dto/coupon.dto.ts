import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCouponTypeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[A-Z0-9_-]+$/i, { message: 'Coupon type code may only contain letters, numbers, _ and -.' })
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  value?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCouponTypeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  value?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ImportCouponsDto {
  @IsString()
  couponTypeCode!: string;

  /** Explicit coupon codes (e.g. supplied by a partner). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  codes?: string[];

  /** Or auto-generate `generateCount` coupon codes. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  generateCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  generatePrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(6)
  @Max(24)
  generateLength?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  value?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class ListCouponsQueryDto {
  @IsOptional()
  @IsString()
  couponTypeCode?: string;

  @IsOptional()
  @IsIn(['AVAILABLE', 'RESERVED', 'ISSUED', 'EXPIRED'])
  status?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
