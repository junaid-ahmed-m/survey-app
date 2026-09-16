import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'A valid e-mail address is required.' })
  email!: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters.' })
  password!: string;
}
