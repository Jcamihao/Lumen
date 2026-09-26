import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "../constants/password.constants";
import { IsStrongPassword } from "../../common/validators/password-strength.validator";

export class ResetPasswordDto {
  @IsUUID()
  id!: string;

  @IsString()
  @MinLength(20)
  token!: string;

  @IsString()
  @MinLength(AUTH_PASSWORD_MIN_LENGTH, {
    message: `A senha precisa ter no minimo ${AUTH_PASSWORD_MIN_LENGTH} caracteres.`,
  })
  @MaxLength(AUTH_PASSWORD_MAX_LENGTH, {
    message: `A senha pode ter no maximo ${AUTH_PASSWORD_MAX_LENGTH} caracteres.`,
  })
  @IsStrongPassword()
  password!: string;
}
