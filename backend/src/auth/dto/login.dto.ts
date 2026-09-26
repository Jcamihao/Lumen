import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import {
  AUTH_LOGIN_PASSWORD_MAX_LENGTH,
  AUTH_LOGIN_PASSWORD_MIN_LENGTH,
} from '../constants/password.constants';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(AUTH_LOGIN_PASSWORD_MIN_LENGTH)
  @MaxLength(AUTH_LOGIN_PASSWORD_MAX_LENGTH)
  password!: string;
}
