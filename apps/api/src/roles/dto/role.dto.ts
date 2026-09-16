import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ALL_PERMISSIONS } from '../../common/constants';

export class CreateRoleDto {
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,31}$/, {
    message: 'Use upper-case letters, digits and underscores (3-32 characters).',
  })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS as unknown as string[], { each: true })
  permissions!: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSIONS as unknown as string[], { each: true })
  permissions?: string[];
}
