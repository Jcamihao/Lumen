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
import { AUTH_PASSWORD_MIN_LENGTH } from "../constants/password.constants";

export class RegisterDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(AUTH_PASSWORD_MIN_LENGTH)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4500000)
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
