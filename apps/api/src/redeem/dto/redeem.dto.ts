import { IsEmail, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class VerifyCodeDto {
  @IsString()
  @MinLength(4, { message: 'This code does not look valid.' })
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'This code does not look valid.' })
  code!: string;
}

export class CompleteRedemptionDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  sessionToken!: string;

  @IsEmail({}, { message: 'Please enter a valid e-mail address.' })
  @MaxLength(180)
  email!: string;

  @IsOptional()
  @IsObject()
  answers?: Record<string, unknown>;
}
