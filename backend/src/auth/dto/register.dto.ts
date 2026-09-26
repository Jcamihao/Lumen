import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { IsAvatarDataUrl } from "../../common/validators/avatar-data-url.validator";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "../constants/password.constants";
import { IsStrongPassword } from "../../common/validators/password-strength.validator";

export class RegisterDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(AUTH_PASSWORD_MIN_LENGTH, {
    message: `A senha precisa ter no minimo ${AUTH_PASSWORD_MIN_LENGTH} caracteres.`,
  })
  @MaxLength(AUTH_PASSWORD_MAX_LENGTH, {
    message: `A senha pode ter no maximo ${AUTH_PASSWORD_MAX_LENGTH} caracteres.`,
  })
  @IsStrongPassword()
  password!: string;

  @IsOptional()
  @IsString()
  // 2 MB de imagem (limite do front) vira ~2,8M caracteres em base64.
  @MaxLength(3000000)
  @IsAvatarDataUrl()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^$|^[0-9()+\-.\s]{8,20}$/, {
    message: "Informe um telefone valido.",
  })
  phone?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  occupation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  primaryGoal?: string;

  @IsBoolean()
  privacyNoticeAccepted!: boolean;

  @IsOptional()
  @IsBoolean()
  aiAssistantEnabled?: boolean;

  @IsOptional()
  @IsString()
  preferredCurrency?: string;

  @IsOptional()
  @IsNumber()
  monthlyIncome?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  monthClosingDay?: number;

  @IsOptional()
  @IsString()
  timezone?: string;
}
