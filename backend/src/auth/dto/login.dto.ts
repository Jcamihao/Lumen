import { IsEmail, IsString, MinLength } from 'class-validator';
import { AUTH_PASSWORD_MIN_LENGTH } from '../constants/password.constants';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(AUTH_PASSWORD_MIN_LENGTH)
  password!: string;
}
