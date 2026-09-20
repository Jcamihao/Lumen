import { IsString, IsUUID, MinLength } from "class-validator";
import { AUTH_PASSWORD_MIN_LENGTH } from "../constants/password.constants";

export class ResetPasswordDto {
  @IsUUID()
  id!: string;

  @IsString()
  @MinLength(20)
  token!: string;

  @IsString()
  @MinLength(AUTH_PASSWORD_MIN_LENGTH)
  password!: string;
}
